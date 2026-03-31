import { registerEffect, ProcessConfig } from "../effect-registry";
import { EffectType, EffectParamConfig } from "../types";
import { FaceBounds, HandBounds, PoseBounds, getEyeLandmarks, getMouthLandmarks, getLandmarkBounds } from "../face-detector";
import { BAYER_MATRIX_4x4, motionSmearState, datamoshState, blockShovingState, bilinearSample, meltState, setMeltState, perlinNoise, posterizeTimeCache, pseudoRandom, clamp, sortSegment, sortSegmentV, getBlockAverage, hexToRgb, rgbToHsl, hslToRgb, isPointInFaceBounds, frameHistoryStore, storeFrame, getFrameFromHistory } from "./shared";

registerEffect({
  type: "chromatic-aberration",
  label: "Chromatic Aberration",
  category: "distortion",
  defaultParams: { offset: 5 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_offset;
void main() {
  vec2 px = 1.0 / u_resolution;
  float off = u_offset * px.x;
  float r = sampleClamped(vec2(v_texCoord.x + off, v_texCoord.y)).r;
  float g = texture(u_source, v_texCoord).g;
  float b = sampleClamped(vec2(v_texCoord.x - off, v_texCoord.y)).b;
  fragColor = vec4(r, g, b, 1.0);
}`,
    uniforms: { offset: "float" },
  },
  processor: (data, { width, height }, params) => {
    const offset = (params.offset as number) || 5;
    if (offset === 0) return;

    const source = new Uint8ClampedArray(data);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const rX = clamp(x + offset, 0, width - 1);
        const bX = clamp(x - offset, 0, width - 1);

        data[i] = source[(y * width + rX) * 4];
        data[i + 2] = source[(y * width + bX) * 4 + 2];
      }
    }
  },
});

registerEffect({
  type: "mirror",
  label: "Mirror",
  category: "distortion",
  defaultParams: { mode: "horizontal" },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform int u_mode;
void main() {
  vec2 uv = v_texCoord;
  if (u_mode == 0) { // horizontal
    if (uv.x >= 0.5) uv.x = 1.0 - uv.x;
  } else if (u_mode == 1) { // vertical
    if (uv.y >= 0.5) uv.y = 1.0 - uv.y;
  } else if (u_mode == 2) { // quad
    if (uv.x >= 0.5) uv.x = 1.0 - uv.x;
    if (uv.y >= 0.5) uv.y = 1.0 - uv.y;
  } else { // kaleidoscope
    vec2 d = uv - 0.5;
    float dist = length(d);
    float angle = atan(d.y, d.x);
    float segAngle = 6.2832 / 6.0;
    angle = mod(angle, segAngle);
    float sector = floor((atan(d.y, d.x)) / segAngle);
    if (mod(sector, 2.0) == 1.0) angle = segAngle - angle;
    uv = clamp(0.5 + vec2(cos(angle), sin(angle)) * dist, 0.0, 1.0);
  }
  fragColor = texture(u_source, uv);
}`,
    uniforms: { mode: "int" },
    uniformMapper: (p) => ({
      ...p,
      mode: ["horizontal", "vertical", "quad", "kaleidoscope"].indexOf((p.mode as string) || "horizontal"),
    }),
  },
  processor: (data, { width, height }, params) => {
    const mode = (params.mode as string) || "horizontal";
    const source = new Uint8ClampedArray(data);
    const cx = width / 2;
    const cy = height / 2;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let srcX = x,
          srcY = y;

        if (mode === "horizontal") {
          if (x >= cx) srcX = width - 1 - x;
        } else if (mode === "vertical") {
          if (y >= cy) srcY = height - 1 - y;
        } else if (mode === "quad") {
          if (x >= cx) srcX = width - 1 - x;
          if (y >= cy) srcY = height - 1 - y;
        } else if (mode === "kaleidoscope") {
          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          let angle = Math.atan2(dy, dx);
          const segments = 6;
          const segmentAngle = (Math.PI * 2) / segments;
          angle = Math.abs((angle % segmentAngle) - segmentAngle / 2);
          srcX = clamp(Math.floor(cx + Math.cos(angle) * dist), 0, width - 1);
          srcY = clamp(Math.floor(cy + Math.sin(angle) * dist), 0, height - 1);
        }

        const src = (srcY * width + srcX) * 4;
        const dst = (y * width + x) * 4;
        data[dst] = source[src];
        data[dst + 1] = source[src + 1];
        data[dst + 2] = source[src + 2];
      }
    }
  },
});

registerEffect({
  type: "displacement",
  label: "Displacement",
  category: "distortion",
  defaultParams: { scale: 20, animated: true },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_scale;
uniform bool u_animated;
void main() {
  vec4 s = texture(u_source, v_texCoord);
  float lum = (s.r + s.g + s.b) / 3.0 - 0.5;
  float wave = u_animated ? sin(u_time * 0.05 + v_texCoord.y * u_resolution.y * 0.05) * u_scale * 0.3 : 0.0;
  float offsetX = (lum * u_scale + wave) / u_resolution.x;
  fragColor = sampleClamped(vec2(v_texCoord.x + offsetX, v_texCoord.y));
}`,
    uniforms: { scale: "float", animated: "bool" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const scale = (params.scale as number) || 20;
    const animated = (params.animated as boolean) ?? true;

    const source = new Uint8ClampedArray(data);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const lum = (source[i] + source[i + 1] + source[i + 2]) / 3 / 255;

        let wave = 0;
        if (animated) {
          wave = Math.sin(time * 0.05 + y * 0.05) * (scale * 0.3);
        }

        const offsetX = Math.floor((lum - 0.5) * scale + wave);
        const srcX = clamp(x + offsetX, 0, width - 1);

        const src = (y * width + srcX) * 4;
        data[i] = source[src];
        data[i + 1] = source[src + 1];
        data[i + 2] = source[src + 2];
      }
    }
  },
});

registerEffect({
  type: "wave-distortion",
  label: "Wave",
  category: "distortion",
  defaultParams: { amplitude: 10, frequency: 0.1, direction: "horizontal", animated: true },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_amplitude;
uniform float u_frequency;
uniform int u_direction;
uniform bool u_animated;
void main() {
  float phase = u_animated ? u_time * 0.1 : 0.0;
  vec2 uv = v_texCoord;
  if (u_direction == 0) { // horizontal
    float shift = sin(uv.y * u_resolution.y * u_frequency + phase) * u_amplitude / u_resolution.x;
    uv.x += shift;
  } else { // vertical
    float shift = sin(uv.x * u_resolution.x * u_frequency + phase) * u_amplitude / u_resolution.y;
    uv.y += shift;
  }
  fragColor = sampleClamped(uv);
}`,
    uniforms: { amplitude: "float", frequency: "float", direction: "int", animated: "bool" },
    uniformMapper: (p) => ({
      ...p,
      direction: (p.direction as string) === "horizontal" ? 0 : 1,
    }),
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const amplitude = (params.amplitude as number) || 10;
    const frequency = (params.frequency as number) || 0.1;
    const direction = (params.direction as string) || "horizontal";
    const animated = (params.animated as boolean) ?? true;

    const source = new Uint8ClampedArray(data);
    const phase = animated ? time * 0.1 : 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        let srcX = x,
          srcY = y;

        if (direction === "horizontal") {
          srcX = Math.floor(x + Math.sin(y * frequency + phase) * amplitude);
        } else {
          srcY = Math.floor(y + Math.sin(x * frequency + phase) * amplitude);
        }

        srcX = clamp(srcX, 0, width - 1);
        srcY = clamp(srcY, 0, height - 1);

        const srcIdx = (srcY * width + srcX) * 4;
        data[i] = source[srcIdx];
        data[i + 1] = source[srcIdx + 1];
        data[i + 2] = source[srcIdx + 2];
      }
    }
  },
});

registerEffect({
  type: "twirl",
  label: "Twirl",
  category: "distortion",
  defaultParams: { angle: 0.5, radius: 0.5 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_angle;
uniform float u_radius;
void main() {
  vec2 d = v_texCoord - 0.5;
  // Correct for aspect ratio to make distance uniform
  float aspect = u_resolution.x / u_resolution.y;
  vec2 da = d * vec2(aspect, 1.0);
  float dist = length(da) / (0.5 * aspect); // normalized 0-1
  vec2 uv = v_texCoord;
  if (dist < u_radius) {
    float twist = u_angle * (1.0 - dist / u_radius);
    float a = atan(d.y, d.x) + twist;
    float r = length(d);
    uv = clamp(0.5 + vec2(cos(a), sin(a)) * r, 0.0, 1.0);
  }
  fragColor = texture(u_source, uv);
}`,
    uniforms: { angle: "float", radius: "float" },
  },
  processor: (data, { width, height }, params) => {
    const angle = (params.angle as number) || 0.5;
    const radius = (params.radius as number) || 0.5;

    const source = new Uint8ClampedArray(data);
    const cx = width / 2;
    const cy = height / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const normalizedDist = dist / maxDist;

        if (normalizedDist < radius) {
          const twist = angle * (1 - normalizedDist / radius);
          const a = Math.atan2(dy, dx) + twist;
          const srcX = clamp(Math.floor(cx + Math.cos(a) * dist), 0, width - 1);
          const srcY = clamp(
            Math.floor(cy + Math.sin(a) * dist),
            0,
            height - 1
          );

          const srcIdx = (srcY * width + srcX) * 4;
          data[i] = source[srcIdx];
          data[i + 1] = source[srcIdx + 1];
          data[i + 2] = source[srcIdx + 2];
        }
      }
    }
  },
});

registerEffect({
  type: "ripple",
  label: "Ripple",
  category: "distortion",
  defaultParams: { amplitude: 20, frequency: 0.05, centerX: 0.5, centerY: 0.5 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_amplitude;
uniform float u_frequency;
uniform float u_centerX;
uniform float u_centerY;
void main() {
  vec2 center = vec2(u_centerX, u_centerY);
  vec2 d = v_texCoord - center;
  // Scale d by resolution to get pixel distances
  vec2 dp = d * u_resolution;
  float dist = length(dp);
  float ripple = sin(dist * u_frequency - u_time * 0.1) * u_amplitude;
  float angle = atan(dp.y, dp.x);
  vec2 offset = vec2(cos(angle), sin(angle)) * ripple / u_resolution;
  fragColor = sampleClamped(v_texCoord + offset);
}`,
    uniforms: { amplitude: "float", frequency: "float", centerX: "float", centerY: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const amplitude = (params.amplitude as number) || 20;
    const frequency = (params.frequency as number) || 0.05;
    const centerX = (params.centerX as number) || 0.5;
    const centerY = (params.centerY as number) || 0.5;

    const source = new Uint8ClampedArray(data);
    const cx = centerX * width;
    const cy = centerY * height;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ripple = Math.sin(dist * frequency - time * 0.1) * amplitude;

        const angle = Math.atan2(dy, dx);
        const srcX = clamp(
          Math.floor(x + Math.cos(angle) * ripple),
          0,
          width - 1
        );
        const srcY = clamp(
          Math.floor(y + Math.sin(angle) * ripple),
          0,
          height - 1
        );

        const srcIdx = (srcY * width + srcX) * 4;
        data[i] = source[srcIdx];
        data[i + 1] = source[srcIdx + 1];
        data[i + 2] = source[srcIdx + 2];
      }
    }
  },
});

registerEffect({
  type: "heavy-distortion",
  label: "Heavy Distortion",
  category: "distortion",
  defaultParams: { intensity: 50, frequency: 0.15, speed: 2 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_frequency;
uniform float u_speed;
void main() {
  float t = u_time * u_speed;
  float nx = v_texCoord.x;
  float ny = v_texCoord.y;
  float wave1 = sin(ny * u_resolution.y * u_frequency + t) * u_intensity * 0.8 / u_resolution.x;
  float wave2 = cos(nx * u_resolution.x * u_frequency * 0.7 + t * 1.3) * u_intensity * 0.4 / u_resolution.y;
  float wave3 = sin((nx + ny) * u_resolution.x * u_frequency * 0.3 + t * 0.7) * u_intensity * 0.3 / u_resolution.x;
  float turbX = sin(nx * 20.0 + t) * cos(ny * 15.0 + t * 1.2) * u_intensity * 0.5 / u_resolution.x;
  float offsetX = wave1 + wave3 + turbX;
  float offsetY = wave2 + sin(nx * u_resolution.x * 0.05 + t) * u_intensity * 0.2 / u_resolution.y;
  fragColor = sampleClamped(v_texCoord + vec2(offsetX, offsetY));
}`,
    uniforms: { intensity: "float", frequency: "float", speed: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) || 50;
    const frequency = (params.frequency as number) || 0.15;
    const speed = (params.speed as number) || 2;
    if (intensity === 0) return;

    const source = new Uint8ClampedArray(data);
    const t = time * speed;
    const chaos = Math.random() * 50 * (intensity / 100);

    for (let y = 0; y < height; y++) {
      const rowChaos = Math.random() < intensity / 200;
      const rowJitter = rowChaos ? (Math.random() - 0.5) * 100 : 0;

      for (let x = 0; x < width; x++) {
        const nx = x / width;
        const ny = y / height;

        const wave1 = Math.sin(y * frequency + t + chaos) * intensity * 0.8;
        const wave2 = Math.cos(x * frequency * 0.7 + t * 1.3) * intensity * 0.4;
        const wave3 =
          Math.sin((x + y) * frequency * 0.3 + t * 0.7) * intensity * 0.3;
        const turbulence =
          Math.sin(nx * 20 + t) * Math.cos(ny * 15 + t * 1.2) * intensity * 0.5;

        let offsetX = wave1 + wave3 + turbulence + rowJitter;
        let offsetY = wave2 + Math.sin(x * 0.05 + t) * intensity * 0.2;

        if (Math.random() < intensity / 500) {
          offsetX += (Math.random() - 0.5) * width * 0.3;
          offsetY += (Math.random() - 0.5) * height * 0.1;
        }

        const srcX = clamp(Math.round(x + offsetX), 0, width - 1);
        const srcY = clamp(Math.round(y + offsetY), 0, height - 1);
        const srcIdx = (srcY * width + srcX) * 4;
        const dstIdx = (y * width + x) * 4;

        if (Math.random() < intensity / 300) {
          const rSrcX = clamp(
            srcX + Math.floor((Math.random() - 0.5) * 20),
            0,
            width - 1
          );
          const gSrcX = clamp(
            srcX + Math.floor((Math.random() - 0.5) * 20),
            0,
            width - 1
          );
          const bSrcX = clamp(
            srcX + Math.floor((Math.random() - 0.5) * 20),
            0,
            width - 1
          );
          data[dstIdx] = source[(srcY * width + rSrcX) * 4];
          data[dstIdx + 1] = source[(srcY * width + gSrcX) * 4 + 1];
          data[dstIdx + 2] = source[(srcY * width + bSrcX) * 4 + 2];
        } else {
          data[dstIdx] = source[srcIdx];
          data[dstIdx + 1] = source[srcIdx + 1];
          data[dstIdx + 2] = source[srcIdx + 2];
        }
      }
    }
  },
});

registerEffect({
  type: "melt",
  label: "Melt",
  category: "distortion",
    defaultParams: { intensity: 50, direction: "down" },
  paramsConfig: [],
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) || 50;
    const direction = (params.direction as string) || "down";
    if (intensity === 0) return;

    const key = `${width}x${height}`;
    let meltBuffer = meltState.get(key);

    if (!meltBuffer || meltBuffer.length !== data.length) {
      meltBuffer = new Uint8ClampedArray(data);
      setMeltState(key, meltBuffer);
    }

    const source = new Uint8ClampedArray(data);
    const meltSpeed = intensity / 20;
    const drip = intensity / 100;

    for (let x = 0; x < width; x++) {
      const columnNoise = Math.sin(x * 0.1 + time) * 0.5 + 0.5;
      const meltAmount = Math.floor(
        meltSpeed * (1 + columnNoise * 2) + Math.random() * 3
      );

      if (direction === "down") {
        for (let y = height - 1; y >= meltAmount; y--) {
          const dstIdx = (y * width + x) * 4;
          const srcY = y - meltAmount;
          const srcIdx = (srcY * width + x) * 4;

          const blend = 0.7 + Math.random() * 0.3;
          data[dstIdx] =
            meltBuffer[srcIdx] * blend + source[dstIdx] * (1 - blend);
          data[dstIdx + 1] =
            meltBuffer[srcIdx + 1] * blend + source[dstIdx + 1] * (1 - blend);
          data[dstIdx + 2] =
            meltBuffer[srcIdx + 2] * blend + source[dstIdx + 2] * (1 - blend);
        }

        for (let y = 0; y < meltAmount && y < height; y++) {
          const idx = (y * width + x) * 4;
          const blend = 0.3 + Math.random() * 0.4;
          data[idx] = source[idx] * blend + meltBuffer[idx] * (1 - blend);
          data[idx + 1] =
            source[idx + 1] * blend + meltBuffer[idx + 1] * (1 - blend);
          data[idx + 2] =
            source[idx + 2] * blend + meltBuffer[idx + 2] * (1 - blend);
        }
      } else {
        for (let y = 0; y < height - meltAmount; y++) {
          const dstIdx = (y * width + x) * 4;
          const srcY = y + meltAmount;
          const srcIdx = (srcY * width + x) * 4;

          const blend = 0.7 + Math.random() * 0.3;
          data[dstIdx] =
            meltBuffer[srcIdx] * blend + source[dstIdx] * (1 - blend);
          data[dstIdx + 1] =
            meltBuffer[srcIdx + 1] * blend + source[dstIdx + 1] * (1 - blend);
          data[dstIdx + 2] =
            meltBuffer[srcIdx + 2] * blend + source[dstIdx + 2] * (1 - blend);
        }
      }
    }

    if (Math.random() < drip) {
      const dripX = Math.floor(Math.random() * width);
      const dripLen = Math.floor(20 + Math.random() * 100);
      const dripColor = [
        data[(Math.floor(Math.random() * height) * width + dripX) * 4],
        data[(Math.floor(Math.random() * height) * width + dripX) * 4 + 1],
        data[(Math.floor(Math.random() * height) * width + dripX) * 4 + 2],
      ];

      const startY = direction === "down" ? 0 : height - 1;
      for (let i = 0; i < dripLen; i++) {
        const y = direction === "down" ? startY + i : startY - i;
        if (y >= 0 && y < height) {
          const idx = (y * width + dripX) * 4;
          const fade = 1 - (i / dripLen) * 0.5;
          data[idx] = dripColor[0] * fade;
          data[idx + 1] = dripColor[1] * fade;
          data[idx + 2] = dripColor[2] * fade;
        }
      }
    }

    for (let i = 0; i < data.length; i++) {
      meltBuffer[i] = data[i];
    }
  },
});

registerEffect({
  type: "perlin-distort",
  label: "Perlin Distort",
  category: "distortion",
  defaultParams: { intensity: 50, scale: 0.01, speed: 1 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_scale;
uniform float u_speed;
void main() {
  float t = u_time * u_speed;
  float amp = u_intensity * 0.5;
  vec2 p = v_texCoord * u_resolution;
  float noiseX = perlinNoise(vec2(p.x * u_scale + t, p.y * u_scale));
  float noiseY = perlinNoise(vec2(p.x * u_scale, p.y * u_scale + t));
  vec2 offset = vec2(noiseX, noiseY) * amp / u_resolution;
  fragColor = sampleClamped(v_texCoord + offset);
}`,
    uniforms: { intensity: "float", scale: "float", speed: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) || 50;
    const scale = (params.scale as number) || 0.01;
    const speed = (params.speed as number) || 1;
    if (intensity === 0) return;

    const source = new Uint8ClampedArray(data);
    const t = time * speed;
    const amp = intensity * 0.5;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = x * scale;
        const ny = y * scale;

        const noiseX = perlinNoise(nx + t, ny);
        const noiseY = perlinNoise(nx, ny + t);

        const offsetX = Math.floor(noiseX * amp);
        const offsetY = Math.floor(noiseY * amp);

        const srcX = clamp(x + offsetX, 0, width - 1);
        const srcY = clamp(y + offsetY, 0, height - 1);

        const srcIdx = (srcY * width + srcX) * 4;
        const dstIdx = (y * width + x) * 4;

        data[dstIdx] = source[srcIdx];
        data[dstIdx + 1] = source[srcIdx + 1];
        data[dstIdx + 2] = source[srcIdx + 2];
      }
    }
  },
});

registerEffect({
  type: "kaleidoscope",
  label: "Kaleidoscope",
  category: "distortion",
  defaultParams: { segments: 6, angle: 0, animated: true },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_segments;
uniform float u_angle;
uniform bool u_animated;
void main() {
  float rotation = u_animated ? u_time * 0.01 : u_angle;
  vec2 d = v_texCoord - 0.5;
  float dist = length(d);
  float theta = atan(d.y, d.x) + rotation;
  float segAngle = 6.2832 / u_segments;
  theta = mod(theta, segAngle);
  float sector = floor((atan(d.y, d.x) + rotation) / segAngle);
  if (mod(sector, 2.0) == 1.0) theta = segAngle - theta;
  vec2 srcUV = clamp(0.5 + vec2(cos(theta), sin(theta)) * dist, 0.0, 1.0);
  fragColor = texture(u_source, srcUV);
}`,
    uniforms: { segments: "float", angle: "float", animated: "bool" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const segments = (params.segments as number) || 6;
    const angle = (params.angle as number) || 0;
    const animated = (params.animated as boolean) !== false;

    const source = new Uint8ClampedArray(data);
    const centerX = width / 2;
    const centerY = height / 2;
    const rotation = animated ? time * 0.01 : angle;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - centerX;
        const dy = y - centerY;

        const dist = Math.sqrt(dx * dx + dy * dy);
        let theta = Math.atan2(dy, dx) + rotation;

        // Mirror across segments
        const segmentAngle = (Math.PI * 2) / segments;
        theta = theta % segmentAngle;
        if (Math.floor((Math.atan2(dy, dx) + rotation) / segmentAngle) % 2 === 1) {
          theta = segmentAngle - theta;
        }

        const srcX = Math.floor(centerX + Math.cos(theta) * dist);
        const srcY = Math.floor(centerY + Math.sin(theta) * dist);

        const i = (y * width + x) * 4;

        if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
          const si = (srcY * width + srcX) * 4;
          data[i] = source[si];
          data[i + 1] = source[si + 1];
          data[i + 2] = source[si + 2];
        }
      }
    }
  },
});

registerEffect({
  type: "mirror-blend",
  label: "Mirror Blend",
  category: "distortion",
  defaultParams: { mode: "quadrant", blendAmount: 0.5 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform int u_mode;
uniform float u_blendAmount;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  vec2 uv = v_texCoord;
  if (u_mode == 0) { // quadrant
    vec2 q = vec2(uv.x < 0.5 ? uv.x : 1.0 - uv.x, uv.y < 0.5 ? uv.y : 1.0 - uv.y);
    vec4 mirror = texture(u_source, q);
    fragColor = vec4(mix(c.rgb, mirror.rgb, u_blendAmount), c.a);
  } else {
    vec4 miH = texture(u_source, vec2(1.0 - uv.x, uv.y));
    vec4 miV = texture(u_source, vec2(uv.x, 1.0 - uv.y));
    vec3 avg = (miH.rgb + miV.rgb) * 0.5;
    fragColor = vec4(mix(c.rgb, avg, u_blendAmount), c.a);
  }
}`,
    uniforms: { mode: "int", blendAmount: "float" },
    uniformMapper: (p) => ({
      ...p,
      mode: (p.mode as string) === "quadrant" ? 0 : 1,
    }),
  },
  processor: (data, { width, height }, params) => {
    const mode = (params.mode as string) || "quadrant";
    const blendAmount = (params.blendAmount as number) || 0.5;

    const source = new Uint8ClampedArray(data);

    if (mode === "quadrant") {
      // Mirror into 4 quadrants
      const halfW = Math.floor(width / 2);
      const halfH = Math.floor(height / 2);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;

          const qx = x < halfW ? x : width - 1 - x;
          const qy = y < halfH ? y : height - 1 - y;
          const qi = (qy * width + qx) * 4;

          data[i] = data[i] * (1 - blendAmount) + source[qi] * blendAmount;
          data[i + 1] = data[i + 1] * (1 - blendAmount) + source[qi + 1] * blendAmount;
          data[i + 2] = data[i + 2] * (1 - blendAmount) + source[qi + 2] * blendAmount;
        }
      }
    } else {
      // horizontal and vertical blend
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;

          const mirrorX = width - 1 - x;
          const mirrorY = height - 1 - y;
          const miH = (y * width + mirrorX) * 4;
          const miV = (mirrorY * width + x) * 4;

          data[i] = data[i] * (1 - blendAmount) + (source[miH] + source[miV]) * 0.5 * blendAmount;
          data[i + 1] = data[i + 1] * (1 - blendAmount) + (source[miH + 1] + source[miV + 1]) * 0.5 * blendAmount;
          data[i + 2] = data[i + 2] * (1 - blendAmount) + (source[miH + 2] + source[miV + 2]) * 0.5 * blendAmount;
        }
      }
    }
  },
});