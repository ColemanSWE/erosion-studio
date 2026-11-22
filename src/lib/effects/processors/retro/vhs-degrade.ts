import { registerEffect } from "../../effect-registry";
import { clamp, pseudoRandom } from "../shared";

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
  glsl: {
    uniforms: {
      applyJpegNoise: "int", jpegQuality: "float", toneLow: "float", toneHigh: "float",
      applyRinging: "int", sharpenIntensity: "float", sharpenWidth: "float",
      applyColorCast: "int", redTint: "float", greenTint: "float", blueTint: "float",
      chromaBlurRadius: "float", chromaShiftX: "float",
      lumaNoise: "float", chromaNoise: "float",
      jitterFrequency: "float", jitterAmplitude: "float",
      headSwitchHeight: "float", bottomDistortion: "float", bottomStaticDensity: "float",
      applyScanlines: "int", scanlineBrightness: "float",
    },
    uniformMapper: (params) => ({
      applyJpegNoise:      (params.applyJpegNoise as boolean) ? 1 : 0,
      jpegQuality:         params.jpegQuality,
      toneLow:             (params.toneLow as number) / 255,
      toneHigh:            (params.toneHigh as number) / 255,
      applyRinging:        (params.applyRinging as boolean) ? 1 : 0,
      sharpenIntensity:    (params.sharpenIntensity as number) / 10,
      sharpenWidth:        params.sharpenWidth,
      applyColorCast:      (params.applyColorCast as boolean) ? 1 : 0,
      redTint:             params.redTint,
      greenTint:           params.greenTint,
      blueTint:            params.blueTint,
      chromaBlurRadius:    Math.max(0, Math.floor(1 / Math.max(0.01, (params.chromaQBandwidth as number) ?? 0.03)) - 1),
      chromaShiftX:        (params.chromaShiftX as number) ?? 3,
      lumaNoise:           params.lumaNoise,
      chromaNoise:         params.chromaNoise,
      jitterFrequency:     params.jitterFrequency,
      jitterAmplitude:     params.jitterAmplitude,
      headSwitchHeight:    (params.headSwitchHeight as number) / 100,
      bottomDistortion:    (params.bottomDistortion as number) / 100,
      bottomStaticDensity: params.bottomStaticDensity,
      applyScanlines:      (params.applyScanlines as boolean) ? 1 : 0,
      scanlineBrightness:  params.scanlineBrightness,
    }),
    fragment: `
uniform int   u_applyJpegNoise;
uniform float u_jpegQuality;
uniform float u_toneLow;
uniform float u_toneHigh;
uniform int   u_applyRinging;
uniform float u_sharpenIntensity;
uniform float u_sharpenWidth;
uniform int   u_applyColorCast;
uniform float u_redTint;
uniform float u_greenTint;
uniform float u_blueTint;
uniform float u_chromaBlurRadius;
uniform float u_chromaShiftX;
uniform float u_lumaNoise;
uniform float u_chromaNoise;
uniform float u_jitterFrequency;
uniform float u_jitterAmplitude;
uniform float u_headSwitchHeight;
uniform float u_bottomDistortion;
uniform float u_bottomStaticDensity;
uniform int   u_applyScanlines;
uniform float u_scanlineBrightness;

void main() {
  float frameSeed = floor(u_time * 7.0);
  vec2 uv = v_texCoord;

  // ── Horizontal jitter (per-row random shift) ─────────────────────────────────
  float rowSeed = floor(uv.y * u_resolution.y);
  float jitterRand = pseudoRandom(frameSeed * 0.01 + rowSeed * 0.001);
  if (jitterRand < u_jitterFrequency) {
    float shift = (pseudoRandom(frameSeed * 0.013 + rowSeed * 0.002) - 0.5) * u_jitterAmplitude / u_resolution.x;
    uv.x = clamp(uv.x + shift, 0.0, 1.0);
  }

  // ── Bottom distortion (head-switch wobble near bottom) ───────────────────────
  float distY = 1.0 - uv.y;
  if (distY < u_bottomDistortion) {
    float t = distY / max(u_bottomDistortion, 0.001);
    float distortion = (1.0 - t) * sin(frameSeed * 3.7 + uv.y * 40.0) * 0.05;
    uv.x = clamp(uv.x + distortion, 0.0, 1.0);
  }

  // ── Head switch bar ──────────────────────────────────────────────────────────
  if (distY < u_headSwitchHeight) {
    float t = distY / max(u_headSwitchHeight, 0.001);
    uv.x = clamp(uv.x + (1.0 - t) * sin(frameSeed * 5.1 + uv.y * 80.0) * 0.02, 0.0, 1.0);
  }

  vec3 col = texture(u_source, uv).rgb;

  // ── JPEG block noise ─────────────────────────────────────────────────────────
  if (u_applyJpegNoise == 1) {
    float blockPx = 8.0;
    vec2 blockCenter = (floor(uv * u_resolution / blockPx) + 0.5) * blockPx / u_resolution;
    vec3 blockCol = texture(u_source, blockCenter).rgb;
    float q = u_jpegQuality / 100.0;
    float chromaStep = 256.0 / pow(2.0, max(1.0, 4.0 - u_jpegQuality / 25.0));
    vec3 qColor = round(blockCol * 255.0 / chromaStep) * chromaStep / 255.0;
    col = mix(col, qColor, 1.0 - q);
  }

  // ── Tone mapping ─────────────────────────────────────────────────────────────
  float range = max(u_toneHigh - u_toneLow, 0.001);
  col = clamp((col - u_toneLow) / range, 0.0, 1.0);

  // ── Unsharp mask / ringing ───────────────────────────────────────────────────
  if (u_applyRinging == 1 && u_sharpenIntensity > 0.0) {
    float blurR = 0.0, blurG = 0.0, blurB = 0.0;
    float sw = u_sharpenWidth;
    float px = 1.0 / u_resolution.x;
    for (int k = -5; k <= 5; k++) {
      if (abs(float(k)) <= sw) {
        vec3 s = texture(u_source, clamp(uv + vec2(float(k) * px, 0.0), vec2(0.0), vec2(1.0))).rgb;
        blurR += s.r; blurG += s.g; blurB += s.b;
      }
    }
    float kernelSize = sw * 2.0 + 1.0;
    vec3 blurred = vec3(blurR, blurG, blurB) / kernelSize;
    col += (col - blurred) * u_sharpenIntensity;
  }

  // ── Color cast ───────────────────────────────────────────────────────────────
  if (u_applyColorCast == 1) {
    col = vec3(col.r * u_redTint, col.g * u_greenTint, col.b * u_blueTint);
  }

  // ── YIQ chroma bleed + chroma shift ─────────────────────────────────────────
  float Y =  0.299 * col.r + 0.587 * col.g + 0.114 * col.b;
  float I =  0.596 * col.r - 0.274 * col.g - 0.322 * col.b;
  float Q =  0.211 * col.r - 0.523 * col.g + 0.311 * col.b;

  // Chroma shift: sample I,Q from offset position
  float shiftX = u_chromaShiftX / u_resolution.x;
  vec3 shifted = texture(u_source, clamp(uv + vec2(shiftX, 0.0), vec2(0.0), vec2(1.0))).rgb;
  float Is = 0.596 * shifted.r - 0.274 * shifted.g - 0.322 * shifted.b;
  float Qs = 0.211 * shifted.r - 0.523 * shifted.g + 0.311 * shifted.b;

  // Chroma bleed (horizontal box blur on I,Q channels)
  if (u_chromaBlurRadius > 0.0) {
    float blurI = 0.0, blurQ = 0.0, cnt = 0.0;
    float step = 1.0 / u_resolution.x;
    for (int k = -8; k <= 8; k++) {
      if (abs(float(k)) <= u_chromaBlurRadius) {
        vec3 s = texture(u_source, clamp(uv + vec2(float(k) * step, 0.0), vec2(0.0), vec2(1.0))).rgb;
        blurI += 0.596 * s.r - 0.274 * s.g - 0.322 * s.b;
        blurQ += 0.211 * s.r - 0.523 * s.g + 0.311 * s.b;
        cnt += 1.0;
      }
    }
    Is = blurI / cnt;
    Qs = blurQ / cnt;
  }

  col = clamp(vec3(
    Y + 0.956 * Is + 0.621 * Qs,
    Y - 0.272 * Is - 0.647 * Qs,
    Y - 1.106 * Is + 1.703 * Qs
  ), 0.0, 1.0);

  // ── Luma + chroma noise ──────────────────────────────────────────────────────
  if (u_lumaNoise > 0.0) {
    float n = pseudoRandom(dot(uv, vec2(127.1, 311.7)) + frameSeed * 0.01) * 2.0 - 1.0;
    col += n * u_lumaNoise;
  }
  if (u_chromaNoise > 0.0) {
    float ni = pseudoRandom(dot(uv, vec2(269.5, 183.3)) + frameSeed * 0.013) * 2.0 - 1.0;
    float nq = pseudoRandom(dot(uv, vec2(113.7, 409.1)) + frameSeed * 0.017) * 2.0 - 1.0;
    col.r += ni * u_chromaNoise;
    col.b += nq * u_chromaNoise;
  }

  // ── Bottom static ────────────────────────────────────────────────────────────
  if (u_bottomStaticDensity > 0.0 && distY < u_bottomDistortion * 1.5) {
    float staticN = pseudoRandom(dot(uv, vec2(17.3, 93.7)) + frameSeed * 0.031);
    if (staticN < u_bottomStaticDensity) {
      col = vec3(pseudoRandom(dot(uv, vec2(41.9, 127.3)) + frameSeed * 0.041));
    }
  }

  // ── Scanlines ────────────────────────────────────────────────────────────────
  if (u_applyScanlines == 1) {
    float scanRow = floor(v_texCoord.y * u_resolution.y);
    if (mod(scanRow, 2.0) >= 1.0) col *= u_scanlineBrightness;
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`,
  },
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
