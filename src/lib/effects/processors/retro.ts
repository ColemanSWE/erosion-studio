import { registerEffect } from "../effect-registry";
import { BAYER_MATRIX_4x4, setPosterizeTimeCache, posterizeTimeCache } from "./shared";

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
    const depth = (params.depth as number) ?? 4;
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
    const spacing = (params.spacing as number) ?? 3;
    const opacity = (params.opacity as number) ?? 0.4;
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
    const intensity = (params.intensity as number) ?? 50;
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
    const curvature = (params.curvature as number) ?? 0.2;
    const scanlineIntensity = (params.scanlines as number) ?? 0.3;

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
    const speed = (params.speed as number) ?? 2;
    const count = (params.count as number) ?? 3;
    const thickness = (params.thickness as number) ?? 2;
    const direction = (params.direction as string) ?? "vertical";

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
    const fps = (params.fps as number) ?? 12;
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
    const frequency = (params.frequency as number) ?? 8;
    const intensity = (params.intensity as number) ?? 1.0;
    const pattern = (params.pattern as string) ?? "pulse";

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
    const rFreq = (params.rFreq as number) ?? 8;
    const gFreq = (params.gFreq as number) ?? 6;
    const bFreq = (params.bFreq as number) ?? 10;
    const intensity = (params.intensity as number) ?? 0.8;

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

const vhsCache: {
  Y: Float32Array | null;
  I: Float32Array | null;
  Q: Float32Array | null;
  row: Float32Array | null;
  source: Uint8ClampedArray | null;
  size: number;
  rowWidth: number;
} = { Y: null, I: null, Q: null, row: null, source: null, size: 0, rowWidth: 0 };

function getVhsBuffers(width: number, height: number) {
  const size = width * height;
  if (vhsCache.size !== size) {
    vhsCache.Y = new Float32Array(size);
    vhsCache.I = new Float32Array(size);
    vhsCache.Q = new Float32Array(size);
    vhsCache.source = new Uint8ClampedArray(size * 4);
    vhsCache.size = size;
  }
  if (vhsCache.rowWidth !== width) {
    vhsCache.row = new Float32Array(width);
    vhsCache.rowWidth = width;
  }
  return {
    Y: vhsCache.Y!,
    I: vhsCache.I!,
    Q: vhsCache.Q!,
    row: vhsCache.row!,
    source: vhsCache.source!,
  };
}

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
    const { Y, I, Q, row, source } = getVhsBuffers(width, height);
    const pixelCount = width * height;

    // ── Digital Layer ─────────────────────────────────────────────────────────

    if (applyJpegNoise) {
      const blockSize = 8;
      const quality = clamp(jpegQuality, 1, 100);
      const chromaStep = 256 / Math.pow(2, Math.max(1, 4 - quality / 25));
      const blend = 1 - quality / 100;

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
          const qR = Math.round(sumR / count / chromaStep) * chromaStep;
          const qG = Math.round(sumG / count / chromaStep) * chromaStep;
          const qB = Math.round(sumB / count / chromaStep) * chromaStep;

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

    if (toneLow > 0 || toneHigh < 255) {
      const range = toneHigh - toneLow;
      const scale = 255 / range;
      for (let i = 0; i < data.length; i += 4) {
        data[i]     = clamp((data[i]     - toneLow) * scale, 0, 255);
        data[i + 1] = clamp((data[i + 1] - toneLow) * scale, 0, 255);
        data[i + 2] = clamp((data[i + 2] - toneLow) * scale, 0, 255);
      }
    }

    // ── Hardware Layer ────────────────────────────────────────────────────────

    if (applyRinging && sharpenIntensity > 0) {
      const radius = sharpenWidth;
      const kernelSize = 2 * radius + 1;
      const amt = sharpenIntensity / 10;
      source.set(data);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          let blurR = 0, blurG = 0, blurB = 0;
          for (let k = -radius; k <= radius; k++) {
            const sx = clamp(x + k, 0, width - 1);
            const si = (y * width + sx) * 4;
            blurR += source[si]; blurG += source[si + 1]; blurB += source[si + 2];
          }
          const invKernel = 1 / kernelSize;
          data[i]     = clamp(source[i]     + (source[i]     - blurR * invKernel) * amt, 0, 255);
          data[i + 1] = clamp(source[i + 1] + (source[i + 1] - blurG * invKernel) * amt, 0, 255);
          data[i + 2] = clamp(source[i + 2] + (source[i + 2] - blurB * invKernel) * amt, 0, 255);
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

    const inv255 = 1 / 255;
    for (let j = 0; j < pixelCount; j++) {
      const idx = j * 4;
      const r = data[idx]     * inv255;
      const g = data[idx + 1] * inv255;
      const b = data[idx + 2] * inv255;
      Y[j] =  0.299 * r + 0.587 * g + 0.114 * b;
      I[j] =  0.596 * r - 0.274 * g - 0.322 * b;
      Q[j] =  0.211 * r - 0.523 * g + 0.311 * b;
    }

    // 1D horizontal box blur (running-sum, O(width) per row, shared row buffer)
    const boxBlur1D = (plane: Float32Array, bw: number) => {
      const radius = Math.max(0, Math.floor(1 / bw) - 1);
      if (radius === 0) return;
      const len = 2 * radius + 1;
      const inv = 1 / len;

      for (let y = 0; y < height; y++) {
        const base = y * width;
        let sum = 0;
        for (let x = 0; x < len && x < width; x++) sum += plane[base + x];

        for (let x = 0; x < width; x++) {
          row[x] = sum * inv;
          const addIdx = x + radius + 1;
          const removeIdx = x - radius;
          if (addIdx < width)  sum += plane[base + addIdx];
          if (removeIdx >= 0)  sum -= plane[base + removeIdx];
        }
        for (let x = 0; x < width; x++) plane[base + x] = row[x];
      }
    };

    boxBlur1D(Y, lumaBandwidth);
    boxBlur1D(I, chromaIBandwidth);
    boxBlur1D(Q, chromaQBandwidth);

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

    if (lumaNoise > 0 || chromaNoise > 0) {
      const lumaAmp  = lumaNoise  * 2;
      const chromaAmp = chromaNoise * 2;
      for (let j = 0; j < pixelCount; j++) {
        if (lumaNoise  > 0) Y[j] += (pseudoRandom(seed + j * 3.1) - 0.5) * lumaAmp;
        if (chromaNoise > 0) {
          I[j] += (pseudoRandom(seed + j * 5.7) - 0.5) * chromaAmp;
          Q[j] += (pseudoRandom(seed + j * 7.3) - 0.5) * chromaAmp;
        }
      }
    }

    for (let j = 0; j < pixelCount; j++) {
      const idx = j * 4;
      const y = Y[j];
      const iv = I[j];
      const q = Q[j];
      data[idx]     = clamp((y + 0.956 * iv + 0.621 * q) * 255, 0, 255);
      data[idx + 1] = clamp((y - 0.272 * iv - 0.647 * q) * 255, 0, 255);
      data[idx + 2] = clamp((y - 1.106 * iv + 1.703 * q) * 255, 0, 255);
    }

    // ── Mechanical Errors ─────────────────────────────────────────────────────

    source.set(data);

    if (jitterFrequency > 0 && jitterAmplitude > 0) {
      for (let y = 0; y < height; y++) {
        if (pseudoRandom(seed + y * 1.3) < jitterFrequency) {
          const offset = Math.round((pseudoRandom(seed + y * 2.7) - 0.5) * 2 * jitterAmplitude);
          if (offset === 0) continue;
          for (let x = 0; x < width; x++) {
            const src = clamp(x - offset, 0, width - 1);
            const di = (y * width + x) * 4;
            const si = (y * width + src) * 4;
            data[di]     = source[si];
            data[di + 1] = source[si + 1];
            data[di + 2] = source[si + 2];
          }
        }
      }
    }

    if (headSwitchHeight > 0 && bottomDistortion > 0) {
      const switchStart = height - headSwitchHeight;
      for (let y = switchStart; y < height; y++) {
        const t = (y - switchStart) / headSwitchHeight;
        const offset = Math.round((pseudoRandom(seed + y * 4.1) - 0.5) * bottomDistortion * t);
        for (let x = 0; x < width; x++) {
          const src = clamp(x + offset, 0, width - 1);
          const di = (y * width + x) * 4;
          const si = (y * width + src) * 4;
          data[di]     = source[si];
          data[di + 1] = source[si + 1];
          data[di + 2] = source[si + 2];
        }
      }
    }

    if (headSwitchHeight > 0 && bottomStaticDensity > 0) {
      const switchStart = height - headSwitchHeight;
      for (let y = switchStart; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const j = y * width + x;
          if (pseudoRandom(seed + j * 1.9) < bottomStaticDensity) {
            const i = j * 4;
            const v = pseudoRandom(seed + j * 3.3) * 255;
            data[i] = v; data[i + 1] = v; data[i + 2] = v;
          }
        }
      }
    }

    if (dropoutCount > 0 && scratchMaxLength > 0) {
      for (let d = 0; d < dropoutCount; d++) {
        const scratchY = Math.floor(pseudoRandom(seed + d * 11.3) * height);
        const startX  = Math.floor(pseudoRandom(seed + d * 13.7) * width);
        const endX    = Math.min(startX + Math.round(pseudoRandom(seed + d * 17.1) * scratchMaxLength), width);
        for (let x = startX; x < endX; x++) {
          const i = (scratchY * width + x) * 4;
          const base = pseudoRandom(seed + x * 1.1 + d) * 255 * scratchIntensity;
          const v = clamp(data[i] * (1 - scratchIntensity) + base, 0, 255);
          data[i] = v; data[i + 1] = v; data[i + 2] = v;
        }
      }
    }

    // ── Scanlines ─────────────────────────────────────────────────────────────

    if (applyScanlines && scanlineBrightness < 1) {
      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          data[i]     = data[i]     * scanlineBrightness;
          data[i + 1] = data[i + 1] * scanlineBrightness;
          data[i + 2] = data[i + 2] * scanlineBrightness;
        }
      }
    }
  },
});

// ─── Photocopy ─────────────────────────────────────────────────────────────────
// Dirty xerox / risograph print simulation: threshold to high-contrast B&W,
// halftone grain, registration offset, optional riso tint

registerEffect({
  type: "photocopy",
  label: "Photocopy",
  category: "retro",
  defaultParams: { threshold: 128, darkness: 0.7, grain: 25, misalign: 2, tint: "black", mode: "xerox" },
  paramsConfig: [
    { key: "threshold", label: "Threshold", type: "slider", min: 40, max: 220, step: 1 },
    { key: "darkness", label: "Darkness", type: "slider", min: 0, max: 1, step: 0.05 },
    { key: "grain", label: "Grain", type: "slider", min: 0, max: 80, step: 1 },
    { key: "misalign", label: "Misalign", type: "slider", min: 0, max: 8, step: 0.5 },
    { key: "tint", label: "Tint", type: "select", options: ["black", "blue", "red", "green", "purple"] },
    { key: "mode", label: "Mode", type: "select", options: ["xerox", "riso"] },
  ],
  glsl: {
    fragment: `
uniform float u_threshold;
uniform float u_darkness;
uniform float u_grain;
uniform float u_misalign;
uniform vec3 u_tintColor;
uniform int u_mode;

const float BAYER[16] = float[16](
   0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
  12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
   3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
  15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
);

void main() {
  vec2 uv = v_texCoord;
  vec2 px = 1.0 / u_resolution;
  vec4 src = texture(u_source, uv);
  float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114)) * 255.0;

  int bx = int(mod(uv.x * u_resolution.x, 4.0));
  int by = int(mod(uv.y * u_resolution.y, 4.0));
  float bayerDot = BAYER[by * 4 + bx];
  float dotGrain = u_grain > 0.0 ? bayerDot * u_grain : 0.0;

  float seed = floor(u_time * 5.0);
  float r = pseudoRandom(seed + uv.x * u_resolution.x * 7.0 + uv.y * u_resolution.y * 13.0);
  float val = lum + dotGrain + (r - 0.5) * u_grain * 0.5;
  bool isInk = val < u_threshold;

  vec3 col;
  if (u_mode == 1) { // riso
    float tone = clamp(1.0 - (val - u_threshold * 0.5) / (u_threshold * 0.5 + 1.0), 0.0, 1.0);
    vec3 paperColor = vec3(245.0, 237.0, 225.0) / 255.0;
    col = mix(paperColor, u_tintColor * u_darkness, tone);
  } else { // xerox
    float r2 = pseudoRandom(seed + uv.x * u_resolution.x * 3.0 + uv.y * u_resolution.y * 17.0);
    float inkDarkness = u_darkness * (0.85 + r2 * 0.15);
    float paperTone = 240.0 + r2 * 15.0;
    col = isInk ? u_tintColor * inkDarkness : vec3(paperTone / 255.0);

      // Registration misalignment ghost layer
    if (u_misalign > 0.0 && isInk) {
      vec2 shiftUV = clamp(uv + vec2(u_misalign * px.x, u_misalign * 0.5 * px.y), 0.0, 1.0);
      float shiftLum = dot(texture(u_source, shiftUV).rgb, vec3(0.299, 0.587, 0.114));
      if (shiftLum < 0.314) {
        vec3 ghostColor = u_tintColor + vec3(80.0 / 255.0);
        col = mix(col, ghostColor, 0.25);
      }
    }
  }
  fragColor = vec4(col, 1.0);
}`,
    uniforms: { threshold: "float", darkness: "float", grain: "float", misalign: "float", tintColor: "vec3", mode: "int" },
    uniformMapper: (p) => {
      const tintMap: Record<string, [number, number, number]> = {
        black: [20/255, 20/255, 20/255],
        blue: [30/255, 60/255, 180/255],
        red: [200/255, 30/255, 40/255],
        green: [30/255, 150/255, 60/255],
        purple: [100/255, 20/255, 160/255],
      };
      return {
        ...p,
        tintColor: tintMap[(p.tint as string) ?? "black"] ?? tintMap.black,
        mode: (p.mode as string) === "riso" ? 1 : 0,
      };
    },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const threshold = (params.threshold as number) ?? 128;
    const darkness = (params.darkness as number) ?? 0.7;
    const grain = (params.grain as number) ?? 25;
    const misalign = (params.misalign as number) ?? 2;
    const tint = (params.tint as string) ?? "black";
    const mode = (params.mode as string) ?? "xerox";

    const tintColors: Record<string, [number, number, number]> = {
      black: [20, 20, 20],
      blue: [30, 60, 180],
      red: [200, 30, 40],
      green: [30, 150, 60],
      purple: [100, 20, 160],
    };
    const [tr, tg, tb] = tintColors[tint] || tintColors.black;

    const seed = Math.floor(time * 5);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

        // Halftone dot pattern
        const bx = x % 4;
        const by = y % 4;
        const bayerDot = BAYER_MATRIX_4x4[by][bx] / 16;
        const dotGrain = grain > 0 ? bayerDot * grain : 0;

        // Threshold + grain to binary
        const val = lum + dotGrain + (pseudoRandom(seed + x * 7 + y * 13) - 0.5) * grain * 0.5;
        const isInk = val < threshold;

        if (isInk) {
          const inkDarkness = darkness * (0.85 + pseudoRandom(seed + i) * 0.15);
          data[i] = tr * inkDarkness;
          data[i + 1] = tg * inkDarkness;
          data[i + 2] = tb * inkDarkness;
        } else {
          const paperTone = mode === "riso" ? 245 + pseudoRandom(seed + i * 3) * 10 : 240 + pseudoRandom(seed + i * 3) * 15;
          data[i] = paperTone;
          data[i + 1] = paperTone * (mode === "riso" ? 0.97 : 1);
          data[i + 2] = paperTone * (mode === "riso" ? 0.93 : 1);
        }
      }
    }

    // Registration misalignment: draw an offset ghost layer in secondary color
    if (misalign > 0) {
      const shiftX = Math.round(misalign);
      const shiftY = Math.round(misalign * 0.5);
      const [gr, gg, gb] = tint === "black" ? [tr + 80, tg + 80, tb + 80] as [number,number,number] : [tr, tg, tb] as [number,number,number];

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const srcX = clamp(x + shiftX, 0, width - 1);
          const srcY = clamp(y + shiftY, 0, height - 1);
          const srcI = (srcY * width + srcX) * 4;
          const dstI = (y * width + x) * 4;

          const srcLum = data[srcI] * 0.299 + data[srcI + 1] * 0.587 + data[srcI + 2] * 0.114;
          if (srcLum < 80) {
            const alpha = 0.25 * (mode === "riso" ? 1 : 0.5);
            data[dstI] = data[dstI] * (1 - alpha) + gr * alpha;
            data[dstI + 1] = data[dstI + 1] * (1 - alpha) + gg * alpha;
            data[dstI + 2] = data[dstI + 2] * (1 - alpha) + gb * alpha;
          }
        }
      }
    }
  },
});

// ─── CCTV ──────────────────────────────────────────────────────────────────────
// Surveillance camera composite: fisheye distortion, resolution reduction,
// green/gray tint, interlace artifacts, noise, and timestamp overlay

registerEffect({
  type: "cctv",
  label: "CCTV",
  category: "retro",
  defaultParams: { resolution: "low", tint: "green", noise: 0.15, distortion: 0.3, showTimestamp: true, cameraId: "CAM-01" },
  paramsConfig: [
    { key: "resolution", label: "Resolution", type: "select", options: ["low", "medium"] },
    { key: "tint", label: "Tint", type: "select", options: ["green", "gray", "none"] },
    { key: "noise", label: "Noise", type: "slider", min: 0, max: 0.5, step: 0.01 },
    { key: "distortion", label: "Distortion", type: "slider", min: 0, max: 1, step: 0.05 },
    { key: "showTimestamp", label: "Show Timestamp", type: "checkbox" },
    { key: "cameraId", label: "Camera ID", type: "select", options: ["CAM-01", "CAM-02", "CAM-03", "CAM-04", "EXT-01", "INT-02"] },
  ],
  processor: (data, { width, height, time = 0 }, params) => {
    const resolution = (params.resolution as string) ?? "low";
    const tint = (params.tint as string) ?? "green";
    const noiseLevel = (params.noise as number) ?? 0.15;
    const distortion = (params.distortion as number) ?? 0.3;
    const showTimestamp = (params.showTimestamp as boolean) ?? true;
    const cameraId = (params.cameraId as string) ?? "CAM-01";

    const scale = resolution === "low" ? 0.25 : 0.5;

    // Barrel distort + pixelate via canvas
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) return;

    // Put original into canvas
    const srcImage = ctx.createImageData(width, height);
    srcImage.data.set(data);
    ctx.putImageData(srcImage, 0, 0);

    // Reduce resolution (nearest neighbor)
    const lowW = Math.max(1, Math.round(width * scale));
    const lowH = Math.max(1, Math.round(height * scale));
    const lowCanvas = document.createElement("canvas");
    lowCanvas.width = lowW;
    lowCanvas.height = lowH;
    const lowCtx = lowCanvas.getContext("2d");
    if (!lowCtx) return;
    lowCtx.imageSmoothingEnabled = false;
    lowCtx.drawImage(tempCanvas, 0, 0, lowW, lowH);

    // Scale back up without smoothing
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(lowCanvas, 0, 0, width, height);

    const pixelated = ctx.getImageData(0, 0, width, height);

    // Apply barrel distortion + tint + noise to pixel buffer
    const src = new Uint8ClampedArray(pixelated.data);
    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.sqrt(cx * cx + cy * cy);
    const seed = Math.floor(time * 30);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        let sx = x, sy = y;
        if (distortion > 0) {
          const dx = (x - cx) / cx;
          const dy = (y - cy) / cy;
          const r2 = dx * dx + dy * dy;
          const barrel = 1 + distortion * r2;
          sx = cx + dx * barrel * cx;
          sy = cy + dy * barrel * cy;
        }

        const sx0 = clamp(Math.round(sx), 0, width - 1);
        const sy0 = clamp(Math.round(sy), 0, height - 1);
        const si = (sy0 * width + sx0) * 4;

        let r = src[si];
        let g = src[si + 1];
        let b = src[si + 2];

        // Tint
        const lum = r * 0.299 + g * 0.587 + b * 0.114;
        if (tint === "green") {
          r = lum * 0.4;
          g = lum * 1.0;
          b = lum * 0.4;
        } else if (tint === "gray") {
          r = g = b = lum;
        }

        // Noise
        if (noiseLevel > 0) {
          const n = (pseudoRandom(seed + x * 7 + y * 13) - 0.5) * noiseLevel * 255 * 2;
          r = clamp(r + n, 0, 255);
          g = clamp(g + n, 0, 255);
          b = clamp(b + n, 0, 255);
        }

        // Interlace: darken odd rows slightly
        if (y % 2 === 1) {
          r *= 0.75;
          g *= 0.75;
          b *= 0.75;
        }

        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }

    // Draw timestamp overlay via canvas
    if (showTimestamp) {
      const overlayCanvas = document.createElement("canvas");
      overlayCanvas.width = width;
      overlayCanvas.height = height;
      const octx = overlayCanvas.getContext("2d");
      if (!octx) return;

      const plainBuf = new ArrayBuffer(data.length);
      const dataCopy = new Uint8ClampedArray(plainBuf);
      dataCopy.set(data);
      octx.putImageData(new ImageData(dataCopy, width, height), 0, 0);

      const fontSize = Math.max(10, Math.round(height * 0.04));
      octx.font = `${fontSize}px monospace`;
      octx.fillStyle = tint === "green" ? "#00ff40" : tint === "gray" ? "#cccccc" : "#ffffff";

      // Fake timestamp
      const totalSecs = Math.floor(time);
      const hh = String(Math.floor(totalSecs / 3600) % 24).padStart(2, "0");
      const mm = String(Math.floor(totalSecs / 60) % 60).padStart(2, "0");
      const ss = String(totalSecs % 60).padStart(2, "0");
      const dateStr = "1993/08/17";
      const timeStr = `${hh}:${mm}:${ss}`;

      const pad = Math.round(width * 0.02);
      octx.fillText(`${cameraId}  ${dateStr} ${timeStr}`, pad, height - pad - fontSize);

      const result = octx.getImageData(0, 0, width, height);
      data.set(result.data);
    }
  },
});

// ─── FMV ───────────────────────────────────────────────────────────────────────
// Late-90s / early-2000s Full-Motion Video simulation: low-res codec pixelation,
// MPEG macroblock compression, oversaturated color grading with early highlight
// clip, selectable color tone (Y2K blue default), 4:3 pillarbox letterboxing,
// hard shadow/highlight contrast, and interlace scanlines.

registerEffect({
  type: "fmv",
  label: "FMV",
  category: "retro",
  defaultParams: {
    resolution: 0.25,
    blockSize: 8,
    compressionStrength: 0.6,
    saturation: 1.6,
    contrast: 1.5,
    highlightClip: 200,
    colorTone: "blue",
    toneStrength: 0.35,
    letterbox: true,
    scanlineOpacity: 0.15,
    noise: 0.05,
  },
  paramsConfig: [
    { key: "resolution",          label: "Resolution",           type: "slider",   min: 0.1,  max: 0.6,  step: 0.01, group: "Codec" },
    { key: "blockSize",           label: "Block Size",           type: "slider",   min: 4,    max: 16,   step: 1,    group: "Codec" },
    { key: "compressionStrength", label: "Compression Strength", type: "slider",   min: 0,    max: 1,    step: 0.05, group: "Codec" },
    { key: "saturation",          label: "Saturation",           type: "slider",   min: 1.0,  max: 2.5,  step: 0.05, group: "Color" },
    { key: "contrast",            label: "Contrast",             type: "slider",   min: 1.0,  max: 2.5,  step: 0.05, group: "Color" },
    { key: "highlightClip",       label: "Highlight Clip",       type: "slider",   min: 140,  max: 255,  step: 1,    group: "Color" },
    { key: "colorTone",           label: "Color Tone",           type: "select",   options: ["blue", "warm", "green", "neutral"], group: "Color" },
    { key: "toneStrength",        label: "Tone Strength",        type: "slider",   min: 0,    max: 1,    step: 0.05, group: "Color" },
    { key: "letterbox",           label: "4:3 Letterbox",        type: "checkbox",             group: "Display" },
    { key: "scanlineOpacity",     label: "Scanline Opacity",     type: "slider",   min: 0,    max: 0.5,  step: 0.01, group: "Display" },
    { key: "noise",               label: "Noise",                type: "slider",   min: 0,    max: 0.2,  step: 0.005, group: "Display" },
  ],
  glsl: {
    fragment: `
uniform float u_resScale;
uniform float u_blockSize;
uniform float u_compressionStrength;
uniform float u_saturation;
uniform float u_contrast;
uniform float u_highlightClip;
uniform int   u_colorTone;
uniform float u_toneStrength;
uniform bool  u_letterbox;
uniform float u_scanlineOpacity;
uniform float u_noise;

void main() {
  vec2 uv = v_texCoord;

  // 4:3 letterbox: compute pillarbox/letterbox bars
  float canvasAspect = u_resolution.x / u_resolution.y;
  float targetAspect = 4.0 / 3.0;
  vec2 sampleUV = uv;

  if (u_letterbox) {
    if (canvasAspect > targetAspect) {
      // wider than 4:3 – pillarbox
      float barFrac = (1.0 - targetAspect / canvasAspect) * 0.5;
      if (uv.x < barFrac || uv.x > 1.0 - barFrac) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      sampleUV.x = (uv.x - barFrac) / (1.0 - 2.0 * barFrac);
    } else if (canvasAspect < targetAspect) {
      // taller than 4:3 – letterbox top/bottom
      float barFrac = (1.0 - canvasAspect / targetAspect) * 0.5;
      if (uv.y < barFrac || uv.y > 1.0 - barFrac) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      sampleUV.y = (uv.y - barFrac) / (1.0 - 2.0 * barFrac);
    }
  }

  // Resolution pixelation: snap UV to low-res grid
  float lowResW = max(1.0, floor(u_resolution.x * u_resScale));
  float lowResH = max(1.0, floor(u_resolution.y * u_resScale));
  vec2 pixUV = floor(sampleUV * vec2(lowResW, lowResH)) / vec2(lowResW, lowResH)
               + 0.5 / vec2(lowResW, lowResH);

  // MPEG block compression: average colour within NxN block
  float bw = u_blockSize / u_resolution.x;
  float bh = u_blockSize / u_resolution.y;
  vec2 blockBase = floor(pixUV / vec2(bw, bh)) * vec2(bw, bh);
  vec2 blockCenter = blockBase + vec2(bw, bh) * 0.5;

  vec4 pixelColor  = texture(u_source, pixUV);
  vec4 blockColor  = texture(u_source, clamp(blockCenter, 0.0, 1.0));
  vec4 compressed  = mix(pixelColor, blockColor, u_compressionStrength);

  vec3 col = compressed.rgb;

  // Contrast: expand around 0.5
  col = (col - 0.5) * u_contrast + 0.5;
  col = clamp(col, 0.0, 1.0);

  // Highlight clip / bleed: values above threshold bloom toward white
  float clipN = u_highlightClip / 255.0;
  for (int c = 0; c < 3; c++) {
    float ch = col[c];
    if (ch > clipN) {
      col[c] = clipN + (ch - clipN) * 2.5; // overshoot → blow out
    }
  }
  col = clamp(col, 0.0, 1.0);

  // Saturation boost (work in HSL lightness / chroma)
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, u_saturation);
  col = clamp(col, 0.0, 1.0);

  // Color tone tint
  vec3 toneColor;
  if      (u_colorTone == 0) toneColor = vec3(0.55, 0.72, 1.00); // blue Y2K
  else if (u_colorTone == 1) toneColor = vec3(1.00, 0.80, 0.55); // warm
  else if (u_colorTone == 2) toneColor = vec3(0.55, 1.00, 0.65); // green
  else                       toneColor = vec3(1.00, 1.00, 1.00); // neutral
  col = mix(col, col * toneColor, u_toneStrength);
  col = clamp(col, 0.0, 1.0);

  // Scanlines: darken alternating pixel rows
  float rowY = floor(v_texCoord.y * u_resolution.y);
  float scanline = mod(rowY, 2.0) == 0.0 ? 1.0 - u_scanlineOpacity : 1.0;
  col *= scanline;

  // Noise
  if (u_noise > 0.0) {
    float seed = floor(u_time * 15.0);
    float px   = floor(v_texCoord.x * u_resolution.x);
    float py   = floor(v_texCoord.y * u_resolution.y);
    float n    = (pseudoRandom(seed + px * 7.3 + py * 13.7) - 0.5) * u_noise * 2.0;
    col = clamp(col + n, 0.0, 1.0);
  }

  fragColor = vec4(col, 1.0);
}`,
    uniforms: {
      resScale:            "float",
      blockSize:           "float",
      compressionStrength: "float",
      saturation:          "float",
      contrast:            "float",
      highlightClip:       "float",
      colorTone:           "int",
      toneStrength:        "float",
      letterbox:           "bool",
      scanlineOpacity:     "float",
      noise:               "float",
    },
    uniformMapper: (p) => ({
      ...p,
      resScale:  p.resolution,
      colorTone: ["blue", "warm", "green", "neutral"].indexOf((p.colorTone as string) || "blue"),
    }),
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const resolution          = (params.resolution          as number)  ?? 0.25;
    const blockSize           = Math.max(1, Math.round((params.blockSize as number) ?? 8));
    const compressionStrength = (params.compressionStrength as number)  ?? 0.6;
    const saturationMult      = (params.saturation          as number)  ?? 1.6;
    const contrastMult        = (params.contrast            as number)  ?? 1.5;
    const highlightClip       = (params.highlightClip       as number)  ?? 200;
    const colorTone           = (params.colorTone           as string)  ?? "blue";
    const toneStrength        = (params.toneStrength        as number)  ?? 0.35;
    const letterbox           = (params.letterbox           as boolean) ?? true;
    const scanlineOpacity     = (params.scanlineOpacity     as number)  ?? 0.15;
    const noiseLevel          = (params.noise               as number)  ?? 0.05;

    const seed = Math.floor(time * 15);

    // ── Resolution reduction (nearest-neighbour via canvas) ──────────────────
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width  = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) return;

    const srcImage = ctx.createImageData(width, height);
    srcImage.data.set(data);
    ctx.putImageData(srcImage, 0, 0);

    const lowW = Math.max(1, Math.round(width  * resolution));
    const lowH = Math.max(1, Math.round(height * resolution));
    const lowCanvas = document.createElement("canvas");
    lowCanvas.width  = lowW;
    lowCanvas.height = lowH;
    const lowCtx = lowCanvas.getContext("2d");
    if (!lowCtx) return;
    lowCtx.imageSmoothingEnabled = false;
    lowCtx.drawImage(tempCanvas, 0, 0, lowW, lowH);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(lowCanvas, 0, 0, width, height);

    const pixelated = ctx.getImageData(0, 0, width, height);
    const src = pixelated.data;

    // ── MPEG macroblock compression ──────────────────────────────────────────
    if (compressionStrength > 0) {
      for (let by = 0; by < height; by += blockSize) {
        for (let bx = 0; bx < width; bx += blockSize) {
          const endY = Math.min(by + blockSize, height);
          const endX = Math.min(bx + blockSize, width);
          let sumR = 0, sumG = 0, sumB = 0, count = 0;

          for (let y = by; y < endY; y++) {
            for (let x = bx; x < endX; x++) {
              const i = (y * width + x) * 4;
              sumR += src[i]; sumG += src[i + 1]; sumB += src[i + 2];
              count++;
            }
          }
          const avgR = sumR / count;
          const avgG = sumG / count;
          const avgB = sumB / count;

          for (let y = by; y < endY; y++) {
            for (let x = bx; x < endX; x++) {
              const i = (y * width + x) * 4;
              src[i]     = src[i]     + (avgR - src[i])     * compressionStrength;
              src[i + 1] = src[i + 1] + (avgG - src[i + 1]) * compressionStrength;
              src[i + 2] = src[i + 2] + (avgB - src[i + 2]) * compressionStrength;
            }
          }
        }
      }
    }

    // ── Color tone table ─────────────────────────────────────────────────────
    const toneMap: Record<string, [number, number, number]> = {
      blue:    [0.55, 0.72, 1.00],
      warm:    [1.00, 0.80, 0.55],
      green:   [0.55, 1.00, 0.65],
      neutral: [1.00, 1.00, 1.00],
    };
    const [tR, tG, tB] = toneMap[colorTone] ?? toneMap.blue;

    // ── Per-pixel grading, letterbox, scanlines, noise ───────────────────────
    const canvasAspect = width / height;
    const targetAspect = 4 / 3;
    let barLeft = 0, barRight = width, barTop = 0, barBottom = height;

    if (letterbox) {
      if (canvasAspect > targetAspect) {
        const barW = Math.round((width - height * targetAspect) / 2);
        barLeft  = barW;
        barRight = width - barW;
      } else if (canvasAspect < targetAspect) {
        const barH = Math.round((height - width / targetAspect) / 2);
        barTop    = barH;
        barBottom = height - barH;
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        // Pillarbox / letterbox fill
        if (letterbox && (x < barLeft || x >= barRight || y < barTop || y >= barBottom)) {
          data[i] = data[i + 1] = data[i + 2] = 0;
          data[i + 3] = 255;
          continue;
        }

        let r = src[i]     / 255;
        let g = src[i + 1] / 255;
        let b = src[i + 2] / 255;

        // Contrast
        r = clamp((r - 0.5) * contrastMult + 0.5, 0, 1);
        g = clamp((g - 0.5) * contrastMult + 0.5, 0, 1);
        b = clamp((b - 0.5) * contrastMult + 0.5, 0, 1);

        // Highlight clip / bleed
        const clipN = highlightClip / 255;
        if (r > clipN) r = clamp(clipN + (r - clipN) * 2.5, 0, 1);
        if (g > clipN) g = clamp(clipN + (g - clipN) * 2.5, 0, 1);
        if (b > clipN) b = clamp(clipN + (b - clipN) * 2.5, 0, 1);

        // Saturation
        const lum = r * 0.299 + g * 0.587 + b * 0.114;
        r = clamp(lum + (r - lum) * saturationMult, 0, 1);
        g = clamp(lum + (g - lum) * saturationMult, 0, 1);
        b = clamp(lum + (b - lum) * saturationMult, 0, 1);

        // Color tone tint
        r = clamp(r + (r * tR - r) * toneStrength, 0, 1);
        g = clamp(g + (g * tG - g) * toneStrength, 0, 1);
        b = clamp(b + (b * tB - b) * toneStrength, 0, 1);

        // Scanlines
        if (scanlineOpacity > 0 && y % 2 === 0) {
          r *= (1 - scanlineOpacity);
          g *= (1 - scanlineOpacity);
          b *= (1 - scanlineOpacity);
        }

        // Noise
        if (noiseLevel > 0) {
          const n = (pseudoRandom(seed + x * 7.3 + y * 13.7) - 0.5) * noiseLevel * 2;
          r = clamp(r + n, 0, 1);
          g = clamp(g + n, 0, 1);
          b = clamp(b + n, 0, 1);
        }

        data[i]     = r * 255;
        data[i + 1] = g * 255;
        data[i + 2] = b * 255;
        data[i + 3] = 255;
      }
    }
  },
});