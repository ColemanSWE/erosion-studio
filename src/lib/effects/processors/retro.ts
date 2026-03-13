import { registerEffect, ProcessConfig } from "../effect-registry";
import { EffectType, EffectParamConfig } from "../types";
import { FaceBounds, HandBounds, PoseBounds, getEyeLandmarks, getMouthLandmarks, getLandmarkBounds } from "../face-detector";
import { BAYER_MATRIX_4x4, motionSmearState, datamoshState, blockShovingState, bilinearSample, meltState, perlinNoise, posterizeTimeCache, setPosterizeTimeCache, pseudoRandom, clamp, sortSegment, sortSegmentV, getBlockAverage, hexToRgb, rgbToHsl, hslToRgb, isPointInFaceBounds, frameHistoryStore, storeFrame, getFrameFromHistory } from "./shared";

registerEffect({
  type: "dither",
  label: "Dither",
  category: "retro",
  defaultParams: { depth: 4 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_depth;
const float bayer[16] = float[](
  0.0, 8.0, 2.0, 10.0,
  12.0, 4.0, 14.0, 6.0,
  3.0, 11.0, 1.0, 9.0,
  15.0, 7.0, 13.0, 5.0
);
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float depth = max(2.0, u_depth);
  float step = 1.0 / (depth - 1.0);
  int bx = int(mod(floor(v_texCoord.x * u_resolution.x), 4.0));
  int by = int(mod(floor(v_texCoord.y * u_resolution.y), 4.0));
  float bayerVal = bayer[by * 4 + bx];
  float noise = (bayerVal / 16.0 - 0.5) * step;
  fragColor = vec4(clamp(floor((c.rgb + noise) / step + 0.5) * step, 0.0, 1.0), c.a);
}`,
    uniforms: { depth: "float" },
  },
  processor: (data, { width, height }, params) => {
    const depth = (params.depth as number) || 4;
    const step = 255 / (depth - 1);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const bayerVal = BAYER_MATRIX_4x4[y % 4][x % 4];
        const noise = (bayerVal / 16 - 0.5) * step;

        data[i] = clamp(Math.round((data[i] + noise) / step) * step, 0, 255);
        data[i + 1] = clamp(
          Math.round((data[i + 1] + noise) / step) * step,
          0,
          255
        );
        data[i + 2] = clamp(
          Math.round((data[i + 2] + noise) / step) * step,
          0,
          255
        );
      }
    }
  },
});

registerEffect({
  type: "scanlines",
  label: "Scanlines",
  category: "retro",
  defaultParams: { spacing: 3, opacity: 0.4 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_spacing;
uniform float u_opacity;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float y = floor(v_texCoord.y * u_resolution.y);
  float darken = mod(y, u_spacing) == 0.0 ? 1.0 - u_opacity : 1.0;
  fragColor = vec4(c.rgb * darken, c.a);
}`,
    uniforms: { spacing: "float", opacity: "float" },
  },
  processor: (data, { width, height }, params) => {
    const spacing = (params.spacing as number) || 3;
    const opacity = (params.opacity as number) || 0.4;
    const darken = 1 - opacity;

    for (let y = 0; y < height; y++) {
      if (y % spacing === 0) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          data[i] *= darken;
          data[i + 1] *= darken;
          data[i + 2] *= darken;
        }
      }
    }
  },
});

registerEffect({
  type: "vhs",
  label: "VHS",
  category: "retro",
  defaultParams: { intensity: 50 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_intensity;
void main() {
  float seed = floor(u_time / 3.0);
  vec2 px = 1.0 / u_resolution;
  float y = v_texCoord.y;
  float wobblePhase = sin(u_time * 0.017) * 3.14159;
  float wobbleFreq = 0.008 + sin(u_time * 0.023) * 0.003;
  float wobbleAmp = (u_intensity / 30.0) * (0.8 + sin(u_time * 0.031) * 0.4);
  float trackingOffset = sin(y * u_resolution.y * wobbleFreq + wobblePhase) * wobbleAmp
    + sin(y * u_resolution.y * wobbleFreq * 2.3 + u_time * 0.07) * (u_intensity / 80.0);
  float jitterSeed = floor(y * u_resolution.y / 10.0);
  float jitter = pseudoRandom(seed + y * u_resolution.y) < 0.02
    ? (pseudoRandom(seed + y * u_resolution.y * 2.0) - 0.5) * u_intensity * px.x
    : 0.0;
  float totalOffset = (trackingOffset + jitter) * px.x;
  int chromaOffset = int(u_intensity / 20.0);
  float chromaUV = float(chromaOffset) * px.x;
  float rX = clamp(v_texCoord.x + totalOffset + chromaUV, 0.0, 1.0);
  float gX = clamp(v_texCoord.x + totalOffset, 0.0, 1.0);
  float bX = clamp(v_texCoord.x + totalOffset - chromaUV, 0.0, 1.0);
  float r = texture(u_source, vec2(rX, y)).r;
  float g = texture(u_source, vec2(gX, y)).g;
  float b = texture(u_source, vec2(bX, y)).b;
  float noiseIntensity = u_intensity / 200.0;
  float pixIdx = floor(v_texCoord.x * u_resolution.x) + floor(y * u_resolution.y) * u_resolution.x;
  float addNoise = pseudoRandom(seed + pixIdx) < noiseIntensity
    ? (pseudoRandom(seed + pixIdx + 1.0) - 0.5) * 100.0 / 255.0
    : 0.0;
  fragColor = vec4(clamp(vec3(r, g, b) + addNoise, 0.0, 1.0), 1.0);
}`,
    uniforms: { intensity: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) || 50;
    if (intensity === 0) return;

    const source = new Uint8ClampedArray(data);
    const seed = Math.floor(time / 3);

    const wobblePhase = Math.sin(time * 0.017) * Math.PI;
    const wobbleFreq = 0.008 + Math.sin(time * 0.023) * 0.003;
    const wobbleAmp = (intensity / 30) * (0.8 + Math.sin(time * 0.031) * 0.4);

    for (let y = 0; y < height; y++) {
      const trackingOffset =
        Math.sin(y * wobbleFreq + wobblePhase) * wobbleAmp +
        Math.sin(y * wobbleFreq * 2.3 + time * 0.07) * (intensity / 80) +
        pseudoRandom(seed + Math.floor(y / 10)) * (intensity / 150);
      const jitter =
        pseudoRandom(seed + y) < 0.02
          ? Math.floor((pseudoRandom(seed + y * 2) - 0.5) * intensity)
          : 0;

      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const srcX = clamp(
          Math.floor(x + trackingOffset + jitter),
          0,
          width - 1
        );

        const chromaOffset = Math.floor(intensity / 20);
        const rX = clamp(srcX + chromaOffset, 0, width - 1);
        const bX = clamp(srcX - chromaOffset, 0, width - 1);

        data[i] = source[(y * width + rX) * 4];
        data[i + 1] = source[(y * width + srcX) * 4 + 1];
        data[i + 2] = source[(y * width + bX) * 4 + 2];
      }
    }

    const noiseIntensity = intensity / 200;
    for (let i = 0; i < data.length; i += 4) {
      if (pseudoRandom(seed + i) < noiseIntensity) {
        const noise = (pseudoRandom(seed + i + 1) - 0.5) * 100;
        data[i] = clamp(data[i] + noise, 0, 255);
        data[i + 1] = clamp(data[i + 1] + noise, 0, 255);
        data[i + 2] = clamp(data[i + 2] + noise, 0, 255);
      }
    }

    const numTrackingLines = Math.floor(intensity / 30);
    for (let t = 0; t < numTrackingLines; t++) {
      const lineY = Math.floor(pseudoRandom(seed + t * 1000) * height);
      const lineThickness = 1 + Math.floor(pseudoRandom(seed + t * 2000) * 3);

      for (let dy = 0; dy < lineThickness && lineY + dy < height; dy++) {
        for (let x = 0; x < width; x++) {
          const i = ((lineY + dy) * width + x) * 4;
          const brightness = 0.3 + pseudoRandom(seed + x + t) * 0.4;
          data[i] *= brightness;
          data[i + 1] *= brightness;
          data[i + 2] *= brightness;
        }
      }
    }
  },
});

registerEffect({
  type: "crt",
  label: "CRT",
  category: "retro",
  defaultParams: { curvature: 0.2, scanlines: 0.3 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_curvature;
uniform float u_scanlines;
void main() {
  vec2 d = v_texCoord - 0.5;
  float dist = length(d);
  float curve = 1.0 + u_curvature * dist * dist;
  vec2 srcUV = 0.5 + d * curve;
  if (srcUV.x < 0.0 || srcUV.x > 1.0 || srcUV.y < 0.0 || srcUV.y > 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec4 c = texture(u_source, srcUV);
  float scanline = mod(floor(v_texCoord.y * u_resolution.y), 3.0) == 0.0 ? 1.0 - u_scanlines : 1.0;
  fragColor = vec4(c.rgb * scanline, c.a);
}`,
    uniforms: { curvature: "float", scanlines: "float" },
  },
  processor: (data, { width, height }, params) => {
    const curvature = (params.curvature as number) || 0.2;
    const scanlineIntensity = (params.scanlines as number) || 0.3;

    const source = new Uint8ClampedArray(data);
    const cx = width / 2;
    const cy = height / 2;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const dx = (x - cx) / width;
        const dy = (y - cy) / height;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const curve = 1 + curvature * dist * dist;
        const srcX = clamp(Math.floor(cx + dx * width * curve), 0, width - 1);
        const srcY = clamp(Math.floor(cy + dy * height * curve), 0, height - 1);

        if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) {
          data[i] = data[i + 1] = data[i + 2] = 0;
        } else {
          const srcIdx = (srcY * width + srcX) * 4;
          data[i] = source[srcIdx];
          data[i + 1] = source[srcIdx + 1];
          data[i + 2] = source[srcIdx + 2];
        }

        const scanline = y % 3 === 0 ? 1 - scanlineIntensity : 1;
        data[i] *= scanline;
        data[i + 1] *= scanline;
        data[i + 2] *= scanline;
      }
    }
  },
});

registerEffect({
  type: "scan-sweep",
  label: "Scan Sweep",
  category: "retro",
  defaultParams: { speed: 2, count: 3, thickness: 2, direction: "vertical" },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_speed;
uniform float u_count;
uniform float u_thickness;
uniform int u_direction;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float dim = u_direction == 0 ? u_resolution.x : u_resolution.y;
  float coord = u_direction == 0 ? v_texCoord.x * dim : v_texCoord.y * dim;
  float addBright = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= u_count) break;
    float offset = (float(i) / u_count) * dim;
    float pos = mod(u_time * u_speed * 100.0 + offset, dim);
    for (int t = 0; t < 8; t++) {
      if (float(t) >= u_thickness) break;
      float scanPos = mod(pos + float(t), dim);
      float falloff = 1.0 - (float(t) / u_thickness) * 0.5;
      if (abs(coord - scanPos) < 0.5) addBright += 100.0 / 255.0 * falloff;
    }
  }
  fragColor = vec4(clamp(c.rgb + addBright, 0.0, 1.0), c.a);
}`,
    uniforms: { speed: "float", count: "float", thickness: "float", direction: "int" },
    uniformMapper: (p) => ({
      ...p,
      direction: (p.direction as string) === "vertical" ? 0 : 1,
    }),
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const speed = (params.speed as number) || 2;
    const count = (params.count as number) || 3;
    const thickness = (params.thickness as number) || 2;
    const direction = (params.direction as string) || "vertical";

    const isVertical = direction === "vertical";
    const dimension = isVertical ? width : height;

    for (let i = 0; i < count; i++) {
      const offset = (i / count) * dimension;
      const position = (time * speed * 100 + offset) % dimension;

      for (let t = 0; t < thickness; t++) {
        const scanPos = Math.floor(position + t) % dimension;
        const falloff = 1 - (t / thickness) * 0.5;

        if (isVertical) {
          for (let y = 0; y < height; y++) {
            const idx = (y * width + scanPos) * 4;
            data[idx] = clamp(data[idx] + 100 * falloff, 0, 255);
            data[idx + 1] = clamp(data[idx + 1] + 100 * falloff, 0, 255);
            data[idx + 2] = clamp(data[idx + 2] + 100 * falloff, 0, 255);
          }
        } else {
          for (let x = 0; x < width; x++) {
            const idx = (scanPos * width + x) * 4;
            data[idx] = clamp(data[idx] + 100 * falloff, 0, 255);
            data[idx + 1] = clamp(data[idx + 1] + 100 * falloff, 0, 255);
            data[idx + 2] = clamp(data[idx + 2] + 100 * falloff, 0, 255);
          }
        }
      }
    }

    if (Math.random() < 0.05) {
      const glitchPos = Math.floor(Math.random() * dimension);
      const glitchSize = Math.floor(2 + Math.random() * 5);

      for (let t = 0; t < glitchSize; t++) {
        const pos = (glitchPos + t) % dimension;

        if (isVertical) {
          for (let y = 0; y < height; y++) {
            const idx = (y * width + pos) * 4;
            data[idx] = 255;
            data[idx + 1] = 255;
            data[idx + 2] = 255;
          }
        } else {
          for (let x = 0; x < width; x++) {
            const idx = (pos * width + x) * 4;
            data[idx] = 255;
            data[idx + 1] = 255;
            data[idx + 2] = 255;
          }
        }
      }
    }
  },
});

registerEffect({
  type: "posterize-time",
  label: "Posterize Time",
  category: "retro",
    defaultParams: { fps: 12 },
  paramsConfig: [],
  processor: (data, { width, height, time = 0 }, params) => {
    const fps = (params.fps as number) || 12;
    const cacheKey = `${width}x${height}`;

    if (!posterizeTimeCache.has(cacheKey)) {
      setPosterizeTimeCache(cacheKey, {
        lastUpdateTime: 0,
        cachedFrame: null,
      });
    }

    const cache = posterizeTimeCache.get(cacheKey)!;
    const frameInterval = 60 / fps;
    const timeSinceLastUpdate = time - cache.lastUpdateTime;

    if (timeSinceLastUpdate >= frameInterval || cache.cachedFrame === null) {
      cache.cachedFrame = new Uint8ClampedArray(data);
      cache.lastUpdateTime = time;
    } else if (cache.cachedFrame) {
      data.set(cache.cachedFrame);
    }
  },
});

registerEffect({
  type: "strobe-flash",
  label: "Strobe Flash",
  category: "retro",
  defaultParams: { frequency: 8, intensity: 1.0, pattern: "pulse" },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_frequency;
uniform float u_intensity;
uniform int u_pattern;
void main() {
  float t = u_time * 0.1;
  float strobe;
  if (u_pattern == 1)      strobe = mod(t * u_frequency, 1.0);
  else if (u_pattern == 2) strobe = mod(floor(t * u_frequency), 2.0);
  else if (u_pattern == 3) { float ph = mod(t * u_frequency, 2.0); strobe = ph < 1.0 ? ph : 2.0 - ph; }
  else                     strobe = sin(t * u_frequency) > 0.0 ? 1.0 : 0.0;
  float mult = 1.0 + strobe * u_intensity;
  vec4 c = texture(u_source, v_texCoord);
  fragColor = vec4(clamp(c.rgb * mult, 0.0, 1.0), c.a);
}`,
    uniforms: { frequency: "float", intensity: "float", pattern: "int" },
    uniformMapper: (p) => ({
      ...p,
      pattern: ["pulse", "saw", "square", "triangle"].indexOf((p.pattern as string) || "pulse"),
    }),
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const frequency = (params.frequency as number) || 8;
    const intensity = (params.intensity as number) || 1.0;
    const pattern = (params.pattern as string) || "pulse";

    const t = time * 0.1;
    let strobe: number;

    if (pattern === "pulse") {
      strobe = Math.sin(t * frequency) > 0 ? 1 : 0;
    } else if (pattern === "saw") {
      strobe = (t * frequency) % 1;
    } else if (pattern === "square") {
      strobe = Math.floor((t * frequency) % 2);
    } else {
      // triangle
      const phase = (t * frequency) % 2;
      strobe = phase < 1 ? phase : 2 - phase;
    }

    const mult = 1 + strobe * intensity;

    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, data[i] * mult);
      data[i + 1] = Math.min(255, data[i + 1] * mult);
      data[i + 2] = Math.min(255, data[i + 2] * mult);
    }
  },
});

registerEffect({
  type: "rgb-strobe",
  label: "RGB Strobe",
  category: "retro",
  defaultParams: { rFreq: 8, gFreq: 6, bFreq: 10, intensity: 0.8 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_rFreq;
uniform float u_gFreq;
uniform float u_bFreq;
uniform float u_intensity;
void main() {
  float t = u_time * 0.1;
  float rMult = 1.0 + (sin(t * u_rFreq) > 0.0 ? 1.0 : 0.0) * u_intensity;
  float gMult = 1.0 + (sin(t * u_gFreq) > 0.0 ? 1.0 : 0.0) * u_intensity;
  float bMult = 1.0 + (sin(t * u_bFreq) > 0.0 ? 1.0 : 0.0) * u_intensity;
  vec4 c = texture(u_source, v_texCoord);
  fragColor = vec4(clamp(c.r * rMult, 0.0, 1.0), clamp(c.g * gMult, 0.0, 1.0), clamp(c.b * bMult, 0.0, 1.0), c.a);
}`,
    uniforms: { rFreq: "float", gFreq: "float", bFreq: "float", intensity: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const rFreq = (params.rFreq as number) || 8;
    const gFreq = (params.gFreq as number) || 6;
    const bFreq = (params.bFreq as number) || 10;
    const intensity = (params.intensity as number) || 0.8;

    const t = time * 0.1;

    const rStrobe = Math.sin(t * rFreq) > 0 ? 1 : 0;
    const gStrobe = Math.sin(t * gFreq) > 0 ? 1 : 0;
    const bStrobe = Math.sin(t * bFreq) > 0 ? 1 : 0;

    const rMult = 1 + rStrobe * intensity;
    const gMult = 1 + gStrobe * intensity;
    const bMult = 1 + bStrobe * intensity;

    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, data[i] * rMult);
      data[i + 1] = Math.min(255, data[i + 1] * gMult);
      data[i + 2] = Math.min(255, data[i + 2] * bMult);
    }
  },
});