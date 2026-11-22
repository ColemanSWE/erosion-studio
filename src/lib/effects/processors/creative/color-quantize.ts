import { registerEffect } from "../../effect-registry";
import { clamp } from "../shared";

// ─── 5. Color Quantize ─────────────────────────────────────────────────────────
// Reduces image to optimal N colors using median-cut quantization

interface ColorBox {
  rMin: number; rMax: number;
  gMin: number; gMax: number;
  bMin: number; bMax: number;
  pixels: number[][]; // [r, g, b]
}

function medianCut(pixels: number[][], targetColors: number): number[][] {
  if (pixels.length === 0) return [[0, 0, 0]];

  const boxes: ColorBox[] = [{
    rMin: 255, rMax: 0,
    gMin: 255, gMax: 0,
    bMin: 255, bMax: 0,
    pixels: pixels,
  }];

  // Compute bounds
  const computeBounds = (box: ColorBox) => {
    box.rMin = box.rMax = box.pixels[0][0];
    box.gMin = box.gMax = box.pixels[0][1];
    box.bMin = box.bMax = box.pixels[0][2];
    for (const p of box.pixels) {
      if (p[0] < box.rMin) box.rMin = p[0];
      if (p[0] > box.rMax) box.rMax = p[0];
      if (p[1] < box.gMin) box.gMin = p[1];
      if (p[1] > box.gMax) box.gMax = p[1];
      if (p[2] < box.bMin) box.bMin = p[2];
      if (p[2] > box.bMax) box.bMax = p[2];
    }
  };
  computeBounds(boxes[0]);

  while (boxes.length < targetColors) {
    // Find box with largest range
    let maxRange = 0, maxBoxIdx = 0;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.pixels.length <= 1) continue;
      const rRange = box.rMax - box.rMin;
      const gRange = box.gMax - box.gMin;
      const bRange = box.bMax - box.bMin;
      const range = Math.max(rRange, gRange, bRange);
      if (range > maxRange) {
        maxRange = range;
        maxBoxIdx = i;
      }
    }

    if (maxRange === 0) break;

    const box = boxes[maxBoxIdx];
    const rRange = box.rMax - box.rMin;
    const gRange = box.gMax - box.gMin;
    const bRange = box.bMax - box.bMin;

    // Sort along longest axis
    let sortCh = 0;
    if (gRange >= rRange && gRange >= bRange) sortCh = 1;
    else if (bRange >= rRange && bRange >= gRange) sortCh = 2;

    box.pixels.sort((a, b) => a[sortCh] - b[sortCh]);

    const mid = Math.floor(box.pixels.length / 2);
    const box1: ColorBox = { rMin: 0, rMax: 0, gMin: 0, gMax: 0, bMin: 0, bMax: 0, pixels: box.pixels.slice(0, mid) };
    const box2: ColorBox = { rMin: 0, rMax: 0, gMin: 0, gMax: 0, bMin: 0, bMax: 0, pixels: box.pixels.slice(mid) };

    if (box1.pixels.length > 0) computeBounds(box1);
    if (box2.pixels.length > 0) computeBounds(box2);

    boxes.splice(maxBoxIdx, 1);
    if (box1.pixels.length > 0) boxes.push(box1);
    if (box2.pixels.length > 0) boxes.push(box2);
  }

  // Average each box to get palette colors
  return boxes.map(box => {
    let rSum = 0, gSum = 0, bSum = 0;
    for (const p of box.pixels) {
      rSum += p[0]; gSum += p[1]; bSum += p[2];
    }
    const n = box.pixels.length;
    return [Math.round(rSum / n), Math.round(gSum / n), Math.round(bSum / n)];
  });
}

registerEffect({
  type: "color-quantize",
  label: "Color Quantize",
  category: "color",
  defaultParams: {
    colors: 8,
    dither: true,
    ditherStrength: 0.5,
  },
  paramsConfig: [
    { key: "colors", label: "Colors", type: "slider", min: 2, max: 32, step: 1 },
    { key: "dither", label: "Dither", type: "checkbox" },
    { key: "ditherStrength", label: "Dither Strength", type: "slider", min: 0.1, max: 1.0, step: 0.05 },
  ],
  glsl: {
    uniforms: { levels: "float", dither: "int", ditherStrength: "float" },
    uniformMapper: (params) => ({
      levels: params.colors,
      dither: (params.dither as boolean) ? 1 : 0,
      ditherStrength: params.ditherStrength,
    }),
    fragment: `
uniform float u_levels;
uniform int   u_dither;
uniform float u_ditherStrength;

// 4x4 Bayer matrix (values 0-15, normalized to 0-1)
float bayer4x4(ivec2 pos) {
  int bayer[16];
  bayer[0]  = 0;  bayer[1]  = 8;  bayer[2]  = 2;  bayer[3]  = 10;
  bayer[4]  = 12; bayer[5]  = 4;  bayer[6]  = 14; bayer[7]  = 6;
  bayer[8]  = 3;  bayer[9]  = 11; bayer[10] = 1;  bayer[11] = 9;
  bayer[12] = 15; bayer[13] = 7;  bayer[14] = 13; bayer[15] = 5;
  int idx = (pos.y % 4) * 4 + (pos.x % 4);
  return (float(bayer[idx]) + 0.5) / 16.0 - 0.5;
}

void main() {
  vec3 col = texture(u_source, v_texCoord).rgb;

  if (u_dither == 1) {
    ivec2 px = ivec2(floor(v_texCoord * u_resolution));
    float noise = bayer4x4(px) * u_ditherStrength / u_levels;
    col = clamp(col + vec3(noise), 0.0, 1.0);
  }

  col = floor(col * u_levels) / u_levels;
  fragColor = vec4(col, 1.0);
}`,
  },
  processor: (data, { width, height }, params) => {
    const numColors = (params.colors as number) ?? 8;
    const dither = (params.dither as boolean) ?? true;
    const ditherStrength = (params.ditherStrength as number) ?? 0.5;

    // Sample pixels for median cut (use subset for performance)
    const sampleRate = Math.max(1, Math.floor(width * height / 10000));
    const samplePixels: number[][] = [];
    for (let i = 0; i < width * height; i += sampleRate) {
      const idx = i * 4;
      samplePixels.push([data[idx], data[idx + 1], data[idx + 2]]);
    }

    const palette = medianCut(samplePixels, numColors);

    // Find nearest palette color
    const findNearest = (r: number, g: number, b: number): number[] => {
      let bestDist = Infinity;
      let best = palette[0];
      for (const c of palette) {
        const dr = r - c[0], dg = g - c[1], db = b - c[2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      return best;
    };

    if (dither) {
      // Floyd-Steinberg dithering
      const floats = new Float32Array(width * height * 3);
      for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        floats[i * 3] = data[idx];
        floats[i * 3 + 1] = data[idx + 1];
        floats[i * 3 + 2] = data[idx + 2];
      }

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const fi = (y * width + x) * 3;
          const oldR = floats[fi], oldG = floats[fi + 1], oldB = floats[fi + 2];
          const nearest = findNearest(
            clamp(Math.round(oldR), 0, 255),
            clamp(Math.round(oldG), 0, 255),
            clamp(Math.round(oldB), 0, 255)
          );

          const idx = (y * width + x) * 4;
          data[idx] = nearest[0];
          data[idx + 1] = nearest[1];
          data[idx + 2] = nearest[2];

          const errR = (oldR - nearest[0]) * ditherStrength;
          const errG = (oldG - nearest[1]) * ditherStrength;
          const errB = (oldB - nearest[2]) * ditherStrength;

          // Distribute error to neighbors (Floyd-Steinberg pattern)
          const distribute = (ox: number, oy: number, factor: number) => {
            const nx = x + ox, ny = y + oy;
            if (nx >= 0 && nx < width && ny < height) {
              const ni = (ny * width + nx) * 3;
              floats[ni] += errR * factor;
              floats[ni + 1] += errG * factor;
              floats[ni + 2] += errB * factor;
            }
          };

          distribute(1, 0, 7 / 16);
          distribute(-1, 1, 3 / 16);
          distribute(0, 1, 5 / 16);
          distribute(1, 1, 1 / 16);
        }
      }
    } else {
      // Direct quantization (no dithering)
      for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        const nearest = findNearest(data[idx], data[idx + 1], data[idx + 2]);
        data[idx] = nearest[0];
        data[idx + 1] = nearest[1];
        data[idx + 2] = nearest[2];
      }
    }
  },
});
