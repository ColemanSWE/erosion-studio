import { registerEffect } from "../../effect-registry";
import { clamp, pseudoRandom } from "../shared";

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
