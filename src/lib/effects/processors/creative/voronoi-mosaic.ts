import { registerEffect } from "../../effect-registry";
import { clamp } from "../shared";

// ─── 2. Voronoi Mosaic ─────────────────────────────────────────────────────────
// Stained-glass / low-poly look using Voronoi tessellation
registerEffect({
  type: "voronoi-mosaic",
  label: "Voronoi Mosaic",
  category: "style",
  defaultParams: {
    cellCount: 200,
    strokeWidth: 1.5,
    strokeColor: "#000000",
    randomness: 0.8,
    colorBlend: 0.7,
  },
  paramsConfig: [
    { key: "cellCount", label: "Cell Count", type: "slider", min: 20, max: 1000, step: 10 },
    { key: "strokeWidth", label: "Stroke Width", type: "slider", min: 0, max: 5, step: 0.5 },
    { key: "strokeColor", label: "Stroke Color", type: "color" },
    { key: "randomness", label: "Randomness", type: "slider", min: 0, max: 1, step: 0.05 },
    { key: "colorBlend", label: "Color Blend", type: "slider", min: 0, max: 1, step: 0.05 },
  ],
  glsl: {
    uniforms: { cellCount: "float", strokeWidth: "float", strokeColor: "vec3", randomness: "float", colorBlend: "float" },
    uniformMapper: (params) => {
      const parseHex = (hex: string): [number, number, number] => {
        const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex as string);
        return r ? [parseInt(r[1], 16) / 255, parseInt(r[2], 16) / 255, parseInt(r[3], 16) / 255] : [0, 0, 0];
      };
      return {
        cellCount: params.cellCount,
        strokeWidth: params.strokeWidth,
        strokeColor: parseHex(params.strokeColor as string),
        randomness: params.randomness,
        colorBlend: params.colorBlend,
      };
    },
    fragment: `
uniform float u_cellCount;
uniform float u_strokeWidth;
uniform vec3  u_strokeColor;
uniform float u_randomness;
uniform float u_colorBlend;

vec2 cellSeedUV(vec2 cell, vec2 cellSize) {
  float h1 = pseudoRandom(dot(cell, vec2(127.1, 311.7)));
  float h2 = pseudoRandom(dot(cell, vec2(269.5, 183.3)));
  vec2 jitter = (vec2(h1, h2) - 0.5) * u_randomness;
  return clamp((cell + 0.5 + jitter) * cellSize, vec2(0.0), vec2(1.0));
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  float gridCols = ceil(sqrt(u_cellCount * aspect));
  float gridRows = ceil(u_cellCount / gridCols);
  vec2 cellSize = 1.0 / vec2(gridCols, gridRows);

  vec2 gridPos  = v_texCoord / cellSize;
  vec2 gridCell = floor(gridPos);

  float bestDist  = 1e9;
  float secondDist = 1e9;
  vec2  bestSeedUV = vec2(0.0);

  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 nb = gridCell + vec2(float(dx), float(dy));
      vec2 seedUV = cellSeedUV(nb, cellSize);
      float d = distance(v_texCoord, seedUV);
      if (d < bestDist) {
        secondDist = bestDist;
        bestDist   = d;
        bestSeedUV = seedUV;
      } else if (d < secondDist) {
        secondDist = d;
      }
    }
  }

  vec3 seedColor = texture(u_source, bestSeedUV).rgb;
  vec3 srcColor  = texture(u_source, v_texCoord).rgb;
  vec3 cellColor = mix(srcColor, seedColor, u_colorBlend);

  float stroke = 0.0;
  if (u_strokeWidth > 0.0) {
    float minCellDim = min(cellSize.x * u_resolution.x, cellSize.y * u_resolution.y);
    float strokeThresh = u_strokeWidth / minCellDim * (secondDist - bestDist);
    stroke = 1.0 - smoothstep(0.0, u_strokeWidth / u_resolution.x, secondDist - bestDist);
  }

  fragColor = vec4(mix(cellColor, u_strokeColor, stroke), 1.0);
}`,
  },
  processor: (data, { width, height }, params) => {
    const cellCount = (params.cellCount as number) ?? 200;
    const strokeWidth = (params.strokeWidth as number) ?? 1.5;
    const strokeColor = (params.strokeColor as string) ?? "#000000";
    const randomness = (params.randomness as number) ?? 0.8;
    const colorBlend = (params.colorBlend as number) ?? 0.7;

    // Generate seed points — mix of grid-based and random for controllable regularity
    const seeds: { x: number; y: number }[] = [];
    const gridCols = Math.ceil(Math.sqrt(cellCount * (width / height)));
    const gridRows = Math.ceil(cellCount / gridCols);
    const cellW = width / gridCols;
    const cellH = height / gridRows;

    // Deterministic pseudo-random for consistent results per frame
    let prngSeed = cellCount * 7919 + width * 31 + height * 17;
    const prng = (): number => {
      prngSeed = (prngSeed * 16807 + 0) % 2147483647;
      return (prngSeed - 1) / 2147483646;
    };

    for (let gy = 0; gy < gridRows; gy++) {
      for (let gx = 0; gx < gridCols; gx++) {
        const baseX = (gx + 0.5) * cellW;
        const baseY = (gy + 0.5) * cellH;
        const jitterX = (prng() - 0.5) * cellW * randomness;
        const jitterY = (prng() - 0.5) * cellH * randomness;
        seeds.push({
          x: clamp(Math.floor(baseX + jitterX), 0, width - 1),
          y: clamp(Math.floor(baseY + jitterY), 0, height - 1),
        });
      }
    }

    // Compute Voronoi cell ownership for each pixel using brute-force nearest-seed
    // For performance, use a coarser grid and then upscale assignments
    const scale = Math.max(1, Math.floor(Math.sqrt(width * height / 100000)));
    const sw = Math.ceil(width / scale);
    const sh = Math.ceil(height / scale);

    const cellOwner = new Int16Array(sw * sh);

    for (let sy = 0; sy < sh; sy++) {
      for (let sx = 0; sx < sw; sx++) {
        const px = sx * scale + scale / 2;
        const py = sy * scale + scale / 2;
        let bestDist = Infinity;
        let bestIdx = 0;
        for (let s = 0; s < seeds.length; s++) {
          const dx = px - seeds[s].x;
          const dy = py - seeds[s].y;
          const dist = dx * dx + dy * dy;
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = s;
          }
        }
        cellOwner[sy * sw + sx] = bestIdx;
      }
    }

    // Compute average color per cell
    const cellR = new Float32Array(seeds.length);
    const cellG = new Float32Array(seeds.length);
    const cellB = new Float32Array(seeds.length);
    const cellPixelCount = new Float32Array(seeds.length);

    for (let sy = 0; sy < sh; sy++) {
      for (let sx = 0; sx < sw; sx++) {
        const owner = cellOwner[sy * sw + sx];
        const px = Math.min(sx * scale, width - 1);
        const py = Math.min(sy * scale, height - 1);
        const idx = (py * width + px) * 4;
        cellR[owner] += data[idx];
        cellG[owner] += data[idx + 1];
        cellB[owner] += data[idx + 2];
        cellPixelCount[owner]++;
      }
    }

    for (let s = 0; s < seeds.length; s++) {
      if (cellPixelCount[s] > 0) {
        cellR[s] /= cellPixelCount[s];
        cellG[s] /= cellPixelCount[s];
        cellB[s] /= cellPixelCount[s];
      }
    }

    // Apply: fill each pixel with its cell's average color (blended)
    for (let y = 0; y < height; y++) {
      const sy = Math.min(Math.floor(y / scale), sh - 1);
      for (let x = 0; x < width; x++) {
        const sx = Math.min(Math.floor(x / scale), sw - 1);
        const owner = cellOwner[sy * sw + sx];
        const idx = (y * width + x) * 4;

        data[idx] = data[idx] * (1 - colorBlend) + cellR[owner] * colorBlend;
        data[idx + 1] = data[idx + 1] * (1 - colorBlend) + cellG[owner] * colorBlend;
        data[idx + 2] = data[idx + 2] * (1 - colorBlend) + cellB[owner] * colorBlend;
      }
    }

    // Draw cell borders if stroke width > 0
    if (strokeWidth > 0) {
      const hexResult = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(strokeColor);
      const sR = hexResult ? parseInt(hexResult[1], 16) : 0;
      const sG = hexResult ? parseInt(hexResult[2], 16) : 0;
      const sB = hexResult ? parseInt(hexResult[3], 16) : 0;

      for (let y = 0; y < height - 1; y++) {
        const sy = Math.min(Math.floor(y / scale), sh - 1);
        for (let x = 0; x < width - 1; x++) {
          const sx = Math.min(Math.floor(x / scale), sw - 1);
          const here = cellOwner[sy * sw + sx];
          const right = cellOwner[sy * sw + Math.min(sx + 1, sw - 1)];
          const below = cellOwner[Math.min(sy + 1, sh - 1) * sw + sx];

          if (here !== right || here !== below) {
            // Draw border pixel
            const borderRadius = Math.ceil(strokeWidth);
            for (let by = -borderRadius; by <= borderRadius; by++) {
              for (let bx = -borderRadius; bx <= borderRadius; bx++) {
                const px = x + bx, py = y + by;
                if (px >= 0 && px < width && py >= 0 && py < height) {
                  const bidx = (py * width + px) * 4;
                  data[bidx] = sR;
                  data[bidx + 1] = sG;
                  data[bidx + 2] = sB;
                }
              }
            }
          }
        }
      }
    }
  },
});
