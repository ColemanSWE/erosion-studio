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

registerEffect({
  type: "vhs-degrade",
  label: "VHS Degrade",
  category: "retro",
  defaultParams: {
    applyJpegNoise: true,
    jpegQuality: 65,
    toneLow: 16,
    toneHigh: 230,
    applyRinging: true,
    sharpenIntensity: 3.0,
    sharpenWidth: 2,
    applyColorCast: true,
    redTint: 0.95,
    greenTint: 1.05,
    blueTint: 1.0,
    lumaBandwidth: 0.40,
    chromaIBandwidth: 0.03,
    chromaQBandwidth: 0.03,
    chromaShiftX: 3,
    lumaNoise: 0.020,
    chromaNoise: 0.010,
    jitterFrequency: 0.05,
    jitterAmplitude: 0.5,
    headSwitchHeight: 15,
    bottomDistortion: 30.0,
    bottomStaticDensity: 0.40,
    dropoutCount: 2,
    scratchMaxLength: 80,
    scratchIntensity: 0.8,
    applyScanlines: true,
    scanlineBrightness: 0.97,
  },
  paramsConfig: [
    { key: "applyJpegNoise",      label: "Apply JPEG Block Noise",    type: "checkbox", group: "Digital Layer" },
    { key: "jpegQuality",         label: "JPEG Quality",               type: "slider",  min: 1,    max: 100,  step: 1,    group: "Digital Layer" },
    { key: "toneLow",             label: "Crush Blacks (Tone Low)",    type: "slider",  min: 0,    max: 128,  step: 1,    group: "Digital Layer" },
    { key: "toneHigh",            label: "Blow Out Whites (Tone High)",type: "slider",  min: 128,  max: 255,  step: 1,    group: "Digital Layer" },
    { key: "applyRinging",        label: "Apply Thick Ringing",        type: "checkbox",                                  group: "Hardware Layer" },
    { key: "sharpenIntensity",    label: "Sharpen Intensity",          type: "slider",  min: 0,    max: 10,   step: 0.1,  group: "Hardware Layer" },
    { key: "sharpenWidth",        label: "Sharpen Width",              type: "slider",  min: 1,    max: 10,   step: 1,    group: "Hardware Layer" },
    { key: "applyColorCast",      label: "Apply Color Cast",           type: "checkbox",                                  group: "Hardware Layer" },
    { key: "redTint",             label: "Red Tint Shift",             type: "slider",  min: 0.5,  max: 1.5,  step: 0.01, group: "Hardware Layer" },
    { key: "greenTint",           label: "Green Tint Shift",           type: "slider",  min: 0.5,  max: 1.5,  step: 0.01, group: "Hardware Layer" },
    { key: "blueTint",            label: "Blue Tint Shift",            type: "slider",  min: 0.5,  max: 1.5,  step: 0.01, group: "Hardware Layer" },
    { key: "lumaBandwidth",       label: "Luminance Bandwidth (Blur)", type: "slider",  min: 0.01, max: 1.0,  step: 0.01, group: "Analog Layer" },
    { key: "chromaIBandwidth",    label: "Chroma I Bandwidth",         type: "slider",  min: 0.01, max: 1.0,  step: 0.01, group: "Analog Layer" },
    { key: "chromaQBandwidth",    label: "Chroma Q Bandwidth (Bleed)", type: "slider",  min: 0.01, max: 1.0,  step: 0.01, group: "Analog Layer" },
    { key: "chromaShiftX",        label: "Chroma Shift X",             type: "slider",  min: -20,  max: 20,   step: 1,    group: "Analog Layer" },
    { key: "lumaNoise",           label: "Luma Noise",                 type: "slider",  min: 0,    max: 0.2,  step: 0.001,group: "Analog Layer" },
    { key: "chromaNoise",         label: "Chroma Noise",               type: "slider",  min: 0,    max: 0.2,  step: 0.001,group: "Analog Layer" },
    { key: "jitterFrequency",     label: "Jitter Frequency",           type: "slider",  min: 0,    max: 1,    step: 0.01, group: "Mechanical Errors" },
    { key: "jitterAmplitude",     label: "Jitter Amplitude",           type: "slider",  min: 0,    max: 10,   step: 0.1,  group: "Mechanical Errors" },
    { key: "headSwitchHeight",    label: "Head Switch Height",         type: "slider",  min: 0,    max: 50,   step: 1,    group: "Mechanical Errors" },
    { key: "bottomDistortion",    label: "Bottom Distortion",          type: "slider",  min: 0,    max: 100,  step: 0.5,  group: "Mechanical Errors" },
    { key: "bottomStaticDensity", label: "Bottom Static Density",      type: "slider",  min: 0,    max: 1,    step: 0.01, group: "Mechanical Errors" },
    { key: "dropoutCount",        label: "Dropout (Scratch) Count",    type: "slider",  min: 0,    max: 20,   step: 1,    group: "Mechanical Errors" },
    { key: "scratchMaxLength",    label: "Scratch Max Length",         type: "slider",  min: 0,    max: 200,  step: 1,    group: "Mechanical Errors" },
    { key: "scratchIntensity",    label: "Scratch Intensity",          type: "slider",  min: 0,    max: 1,    step: 0.01, group: "Mechanical Errors" },
    { key: "applyScanlines",      label: "Apply Scanlines",            type: "checkbox",                                  group: "Scanlines" },
    { key: "scanlineBrightness",  label: "Scanline Brightness",        type: "slider",  min: 0.5,  max: 1.0,  step: 0.01, group: "Scanlines" },
  ],
  processor: (data, { width, height, time = 0 }, params) => {
    const applyJpegNoise      = (params.applyJpegNoise      as boolean) ?? true;
    const jpegQuality         = (params.jpegQuality         as number)  ?? 65;
    const toneLow             = (params.toneLow             as number)  ?? 16;
    const toneHigh            = (params.toneHigh            as number)  ?? 230;
    const applyRinging        = (params.applyRinging        as boolean) ?? true;
    const sharpenIntensity    = (params.sharpenIntensity    as number)  ?? 3.0;
    const sharpenWidth        = Math.max(1, Math.round((params.sharpenWidth as number) ?? 2));
    const applyColorCast      = (params.applyColorCast      as boolean) ?? true;
    const redTint             = (params.redTint             as number)  ?? 0.95;
    const greenTint           = (params.greenTint           as number)  ?? 1.05;
    const blueTint            = (params.blueTint            as number)  ?? 1.0;
    const lumaBandwidth       = Math.max(0.01, (params.lumaBandwidth    as number) ?? 0.40);
    const chromaIBandwidth    = Math.max(0.01, (params.chromaIBandwidth as number) ?? 0.03);
    const chromaQBandwidth    = Math.max(0.01, (params.chromaQBandwidth as number) ?? 0.03);
    const chromaShiftX        = Math.round((params.chromaShiftX        as number)  ?? 3);
    const lumaNoise           = (params.lumaNoise           as number)  ?? 0.020;
    const chromaNoise         = (params.chromaNoise         as number)  ?? 0.010;
    const jitterFrequency     = (params.jitterFrequency     as number)  ?? 0.05;
    const jitterAmplitude     = (params.jitterAmplitude     as number)  ?? 0.5;
    const headSwitchHeight    = Math.round((params.headSwitchHeight    as number)  ?? 15);
    const bottomDistortion    = (params.bottomDistortion    as number)  ?? 30.0;
    const bottomStaticDensity = (params.bottomStaticDensity as number)  ?? 0.40;
    const dropoutCount        = Math.round((params.dropoutCount        as number)  ?? 2);
    const scratchMaxLength    = Math.round((params.scratchMaxLength    as number)  ?? 80);
    const scratchIntensity    = (params.scratchIntensity    as number)  ?? 0.8;
    const applyScanlines      = (params.applyScanlines      as boolean) ?? true;
    const scanlineBrightness  = (params.scanlineBrightness  as number)  ?? 0.97;

    const seed = Math.floor(time * 7);

    // ── Digital Layer ─────────────────────────────────────────────────────────

    if (applyJpegNoise) {
      const blockSize = 8;
      const quality = clamp(jpegQuality, 1, 100);
      const chromaStep = 256 / Math.pow(2, Math.max(1, 4 - quality / 25));

      for (let by = 0; by < height; by += blockSize) {
        for (let bx = 0; bx < width; bx += blockSize) {
          const endY = Math.min(by + blockSize, height);
          const endX = Math.min(bx + blockSize, width);
          let sumR = 0, sumG = 0, sumB = 0, count = 0;

          for (let y = by; y < endY; y++) {
            for (let x = bx; x < endX; x++) {
              const i = (y * width + x) * 4;
              sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2];
              count++;
            }
          }
          const avgR = sumR / count;
          const avgG = sumG / count;
          const avgB = sumB / count;
          const qR = Math.round(avgR / chromaStep) * chromaStep;
          const qG = Math.round(avgG / chromaStep) * chromaStep;
          const qB = Math.round(avgB / chromaStep) * chromaStep;
          const blend = 1 - quality / 100;

          for (let y = by; y < endY; y++) {
            for (let x = bx; x < endX; x++) {
              const i = (y * width + x) * 4;
              data[i]     = clamp(data[i]     + (qR - data[i])     * blend, 0, 255);
              data[i + 1] = clamp(data[i + 1] + (qG - data[i + 1]) * blend, 0, 255);
              data[i + 2] = clamp(data[i + 2] + (qB - data[i + 2]) * blend, 0, 255);
            }
          }
        }
      }
    }

    // Tone crush: remap blacks and whites
    if (toneLow > 0 || toneHigh < 255) {
      const range = toneHigh - toneLow;
      for (let i = 0; i < data.length; i += 4) {
        data[i]     = clamp(Math.round((data[i]     - toneLow) / range * 255), 0, 255);
        data[i + 1] = clamp(Math.round((data[i + 1] - toneLow) / range * 255), 0, 255);
        data[i + 2] = clamp(Math.round((data[i + 2] - toneLow) / range * 255), 0, 255);
      }
    }

    // ── Hardware Layer ────────────────────────────────────────────────────────

    if (applyRinging && sharpenIntensity > 0) {
      const radius = sharpenWidth;
      const source = new Uint8ClampedArray(data);
      const kernelSize = 2 * radius + 1;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          let blurR = 0, blurG = 0, blurB = 0;
          for (let k = -radius; k <= radius; k++) {
            const sx = clamp(x + k, 0, width - 1);
            const si = (y * width + sx) * 4;
            blurR += source[si]; blurG += source[si + 1]; blurB += source[si + 2];
          }
          blurR /= kernelSize; blurG /= kernelSize; blurB /= kernelSize;
          const amt = sharpenIntensity / 10;
          data[i]     = clamp(source[i]     + (source[i]     - blurR) * amt, 0, 255);
          data[i + 1] = clamp(source[i + 1] + (source[i + 1] - blurG) * amt, 0, 255);
          data[i + 2] = clamp(source[i + 2] + (source[i + 2] - blurB) * amt, 0, 255);
        }
      }
    }

    if (applyColorCast) {
      for (let i = 0; i < data.length; i += 4) {
        data[i]     = clamp(data[i]     * redTint,   0, 255);
        data[i + 1] = clamp(data[i + 1] * greenTint, 0, 255);
        data[i + 2] = clamp(data[i + 2] * blueTint,  0, 255);
      }
    }

    // ── Analog Layer (YIQ color space) ────────────────────────────────────────

    // Convert to YIQ float planes
    const Y = new Float32Array(width * height);
    const I = new Float32Array(width * height);
    const Q = new Float32Array(width * height);

    for (let j = 0; j < width * height; j++) {
      const idx = j * 4;
      const r = data[idx] / 255;
      const g = data[idx + 1] / 255;
      const b = data[idx + 2] / 255;
      Y[j] =  0.299 * r + 0.587 * g + 0.114 * b;
      I[j] =  0.596 * r - 0.274 * g - 0.322 * b;
      Q[j] =  0.211 * r - 0.523 * g + 0.311 * b;
    }

    // 1D horizontal box blur (running-sum, O(width) per row)
    const boxBlur1D = (plane: Float32Array, bw: number) => {
      const radius = Math.max(0, Math.floor(1 / bw) - 1);
      if (radius === 0) return;
      const len = 2 * radius + 1;
      const inv = 1 / len;
      const row = new Float32Array(width);

      for (let y = 0; y < height; y++) {
        const base = y * width;
        // Build running sum
        let sum = 0;
        for (let x = 0; x < len && x < width; x++) sum += plane[base + x];

        for (let x = 0; x < width; x++) {
          row[x] = sum * inv;
          const addIdx = x + radius + 1;
          const removeIdx = x - radius;
          if (addIdx < width) sum += plane[base + addIdx];
          if (removeIdx >= 0) sum -= plane[base + removeIdx];
        }
        for (let x = 0; x < width; x++) plane[base + x] = row[x];
      }
    };

    boxBlur1D(Y, lumaBandwidth);
    boxBlur1D(I, chromaIBandwidth);
    boxBlur1D(Q, chromaQBandwidth);

    // Chroma horizontal shift (shift I and Q channels to the right)
    if (chromaShiftX !== 0) {
      const shift = chromaShiftX;
      for (let y = 0; y < height; y++) {
        const base = y * width;
        if (shift > 0) {
          for (let x = width - 1; x >= 0; x--) {
            const src = clamp(x - shift, 0, width - 1);
            I[base + x] = I[base + src];
            Q[base + x] = Q[base + src];
          }
        } else {
          for (let x = 0; x < width; x++) {
            const src = clamp(x - shift, 0, width - 1);
            I[base + x] = I[base + src];
            Q[base + x] = Q[base + src];
          }
        }
      }
    }

    // Noise on luma and chroma
    if (lumaNoise > 0 || chromaNoise > 0) {
      for (let j = 0; j < width * height; j++) {
        if (lumaNoise > 0) {
          Y[j] += (pseudoRandom(seed + j * 3.1) - 0.5) * 2 * lumaNoise;
        }
        if (chromaNoise > 0) {
          I[j] += (pseudoRandom(seed + j * 5.7) - 0.5) * 2 * chromaNoise;
          Q[j] += (pseudoRandom(seed + j * 7.3) - 0.5) * 2 * chromaNoise;
        }
      }
    }

    // Convert back to RGB
    for (let j = 0; j < width * height; j++) {
      const idx = j * 4;
      const y = Y[j];
      const iv = I[j];
      const q = Q[j];
      data[idx]     = clamp(Math.round((y + 0.956 * iv + 0.621 * q) * 255), 0, 255);
      data[idx + 1] = clamp(Math.round((y - 0.272 * iv - 0.647 * q) * 255), 0, 255);
      data[idx + 2] = clamp(Math.round((y - 1.106 * iv + 1.703 * q) * 255), 0, 255);
    }

    // ── Mechanical Errors ─────────────────────────────────────────────────────

    const source2 = new Uint8ClampedArray(data);

    // Per-scanline jitter
    if (jitterFrequency > 0 && jitterAmplitude > 0) {
      for (let y = 0; y < height; y++) {
        if (pseudoRandom(seed + y * 1.3) < jitterFrequency) {
          const offset = Math.round((pseudoRandom(seed + y * 2.7) - 0.5) * 2 * jitterAmplitude);
          if (offset === 0) continue;
          for (let x = 0; x < width; x++) {
            const src = clamp(x - offset, 0, width - 1);
            const di = (y * width + x) * 4;
            const si = (y * width + src) * 4;
            data[di]     = source2[si];
            data[di + 1] = source2[si + 1];
            data[di + 2] = source2[si + 2];
          }
        }
      }
    }

    // Head switch distortion at the bottom of the frame
    if (headSwitchHeight > 0 && bottomDistortion > 0) {
      const switchStart = height - headSwitchHeight;
      for (let y = switchStart; y < height; y++) {
        const t = (y - switchStart) / headSwitchHeight;
        const maxOff = bottomDistortion * t;
        const offset = Math.round((pseudoRandom(seed + y * 4.1) - 0.5) * maxOff);

        for (let x = 0; x < width; x++) {
          const src = clamp(x + offset, 0, width - 1);
          const di = (y * width + x) * 4;
          const si = (y * width + src) * 4;
          data[di]     = source2[si];
          data[di + 1] = source2[si + 1];
          data[di + 2] = source2[si + 2];
        }
      }
    }

    // Bottom static (noise) in the head-switch region
    if (headSwitchHeight > 0 && bottomStaticDensity > 0) {
      const switchStart = height - headSwitchHeight;
      for (let y = switchStart; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (pseudoRandom(seed + (y * width + x) * 1.9) < bottomStaticDensity) {
            const i = (y * width + x) * 4;
            const v = Math.round(pseudoRandom(seed + (y * width + x) * 3.3) * 255);
            data[i] = v; data[i + 1] = v; data[i + 2] = v;
          }
        }
      }
    }

    // Dropout / scratch lines
    if (dropoutCount > 0 && scratchMaxLength > 0) {
      for (let d = 0; d < dropoutCount; d++) {
        const scratchY = Math.floor(pseudoRandom(seed + d * 11.3) * height);
        const startX = Math.floor(pseudoRandom(seed + d * 13.7) * width);
        const length = Math.round(pseudoRandom(seed + d * 17.1) * scratchMaxLength);
        const endX = Math.min(startX + length, width);

        for (let x = startX; x < endX; x++) {
          const i = (scratchY * width + x) * 4;
          const base = Math.round(pseudoRandom(seed + x * 1.1 + d) * 255 * scratchIntensity);
          const orig = data[i] * (1 - scratchIntensity);
          const v = clamp(orig + base, 0, 255);
          data[i] = v; data[i + 1] = v; data[i + 2] = v;
        }
      }
    }

    // ── Scanlines ─────────────────────────────────────────────────────────────

    if (applyScanlines && scanlineBrightness < 1) {
      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          data[i]     = Math.round(data[i]     * scanlineBrightness);
          data[i + 1] = Math.round(data[i + 1] * scanlineBrightness);
          data[i + 2] = Math.round(data[i + 2] * scanlineBrightness);
        }
      }
    }
  },
});