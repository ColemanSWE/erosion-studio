import { registerEffect } from "../effect-registry";
import { clamp, hslToRgb } from "./shared";

// ─── Premium Creative Effects ──────────────────────────────────────────────────

// ─── 1. ASCII Overlay ──────────────────────────────────────────────────────────
// Overlays ASCII characters on the original image along detected edges/thresholds

const CHARSETS: Record<string, string> = {
  standard: " .:-=+*#%@",
  blocks: " ░▒▓█",
  binary: "01",
  dots: " ·•●",
  kanji: " 人大中小上下左右",
};

registerEffect({
  type: "ascii-overlay",
  label: "ASCII Overlay",
  category: "style",
  defaultParams: {
    threshold: 80,
    density: 8,
    charset: "standard",
    color: "#00ff88",
    opacity: 0.85,
    edgeMode: "sobel",
    fontSize: 10,
    bgDarken: 0.4,
  },
  paramsConfig: [
    { key: "threshold", label: "Threshold", type: "slider", min: 10, max: 255, step: 1 },
    { key: "density", label: "Spacing", type: "slider", min: 4, max: 24, step: 1 },
    { key: "charset", label: "Character Set", type: "select", options: ["standard", "blocks", "binary", "dots", "kanji"] },
    { key: "color", label: "Char Color", type: "color" },
    { key: "opacity", label: "Opacity", type: "slider", min: 0, max: 1, step: 0.05 },
    { key: "edgeMode", label: "Edge Mode", type: "select", options: ["sobel", "threshold", "canny-approx"] },
    { key: "fontSize", label: "Font Size", type: "slider", min: 6, max: 24, step: 1 },
    { key: "bgDarken", label: "BG Darken", type: "slider", min: 0, max: 1, step: 0.05 },
  ],
  glsl: {
    uniforms: { threshold: "float", density: "float", color: "vec3", opacity: "float", bgDarken: "float" },
    uniformMapper: (params) => {
      const parseHex = (hex: string): [number, number, number] => {
        const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex as string);
        return r ? [parseInt(r[1], 16) / 255, parseInt(r[2], 16) / 255, parseInt(r[3], 16) / 255] : [0, 1, 0.53];
      };
      return {
        threshold: (params.threshold as number) / 255,
        density: params.density,
        color: parseHex(params.color as string),
        opacity: params.opacity,
        bgDarken: params.bgDarken,
      };
    },
    fragment: `
uniform float u_threshold;
uniform float u_density;
uniform vec3  u_color;
uniform float u_opacity;
uniform float u_bgDarken;

void main() {
  // Cell this pixel belongs to
  vec2 cellPx = floor(v_texCoord * u_resolution / u_density);
  vec2 cellCenter = (cellPx + 0.5) * u_density / u_resolution;

  // Average luminance for this cell (sample a 2x2 grid within the cell)
  float cellBri = 0.0;
  for (int dy = 0; dy <= 1; dy++) {
    for (int dx = 0; dx <= 1; dx++) {
      vec2 sUV = clamp(cellCenter + vec2(float(dx) - 0.5, float(dy) - 0.5) * u_density * 0.4 / u_resolution, vec2(0.0), vec2(1.0));
      cellBri += dot(texture(u_source, sUV).rgb, vec3(0.299, 0.587, 0.114));
    }
  }
  cellBri *= 0.25;

  // Position within cell [0,1]
  vec2 cellUV = fract(v_texCoord * u_resolution / u_density);

  // Character density: dark areas → dense fill, bright → sparse
  float charDensity = 1.0 - cellBri;

  // 4x4 dot grid within each character cell (simulates character fill density)
  float dotCol = floor(cellUV.x * 4.0);
  float dotRow = floor(cellUV.y * 4.0);
  float dotHash = pseudoRandom(cellPx * 13.7 + vec2(dotCol * 4.0 + dotRow) * 0.1);
  bool dotOn = dotHash < charDensity && cellBri < (1.0 - u_threshold);

  // Edge mode: highlight edges via Sobel
  vec2 tx = 1.0 / u_resolution;
  vec3 lumaW = vec3(0.299, 0.587, 0.114);
  float tl = dot(texture(u_source, cellCenter + vec2(-tx.x,-tx.y)).rgb, lumaW);
  float tm = dot(texture(u_source, cellCenter + vec2( 0.0, -tx.y)).rgb, lumaW);
  float tr = dot(texture(u_source, cellCenter + vec2( tx.x,-tx.y)).rgb, lumaW);
  float ml = dot(texture(u_source, cellCenter + vec2(-tx.x, 0.0 )).rgb, lumaW);
  float mr = dot(texture(u_source, cellCenter + vec2( tx.x, 0.0 )).rgb, lumaW);
  float bl = dot(texture(u_source, cellCenter + vec2(-tx.x, tx.y)).rgb, lumaW);
  float bm = dot(texture(u_source, cellCenter + vec2( 0.0,  tx.y)).rgb, lumaW);
  float br = dot(texture(u_source, cellCenter + vec2( tx.x, tx.y)).rgb, lumaW);
  float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
  float gy = -tl - 2.0*tm - tr + bl + 2.0*bm + br;
  float edgeMag = length(vec2(gx, gy));
  dotOn = dotOn || edgeMag > u_threshold * 0.5;

  vec3 bg  = texture(u_source, v_texCoord).rgb * (1.0 - u_bgDarken);
  vec3 fg  = mix(bg, u_color, u_opacity);

  fragColor = vec4(dotOn ? fg : bg, 1.0);
}`,
  },
  processor: (data, { width, height }, params) => {
    const threshold = (params.threshold as number) ?? 80;
    const density = (params.density as number) ?? 8;
    const charsetKey = (params.charset as string) ?? "standard";
    const color = (params.color as string) ?? "#00ff88";
    const opacity = (params.opacity as number) ?? 0.85;
    const edgeMode = (params.edgeMode as string) ?? "sobel";
    const fontSize = (params.fontSize as number) ?? 10;
    const bgDarken = (params.bgDarken as number) ?? 0.4;

    const chars = CHARSETS[charsetKey] || CHARSETS.standard;

    // Build grayscale
    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      gray[i] = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
    }

    // Edge detection
    const edges = new Float32Array(width * height);

    if (edgeMode === "sobel" || edgeMode === "canny-approx") {
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const pos = y * width + x;
          // Sobel kernels
          const gx =
            -gray[pos - width - 1] - 2 * gray[pos - 1] - gray[pos + width - 1] +
            gray[pos - width + 1] + 2 * gray[pos + 1] + gray[pos + width + 1];
          const gy =
            -gray[pos - width - 1] - 2 * gray[pos - width] - gray[pos - width + 1] +
            gray[pos + width - 1] + 2 * gray[pos + width] + gray[pos + width + 1];

          let mag = Math.sqrt(gx * gx + gy * gy);

          if (edgeMode === "canny-approx") {
            // Non-maximum suppression approximation
            const angle = Math.atan2(gy, gx);
            const dir = ((angle + Math.PI) / Math.PI * 4) & 3;
            // eslint-disable-next-line no-useless-assignment
            let n1 = 0, n2 = 0;
            if (dir === 0) { n1 = edges[pos - 1] || 0; n2 = edges[pos + 1] || 0; }
            else if (dir === 1) { n1 = edges[pos - width + 1] || 0; n2 = edges[pos + width - 1] || 0; }
            else if (dir === 2) { n1 = edges[pos - width] || 0; n2 = edges[pos + width] || 0; }
            else { n1 = edges[pos - width - 1] || 0; n2 = edges[pos + width + 1] || 0; }
            if (mag < n1 || mag < n2) mag = 0;
          }

          edges[pos] = mag;
        }
      }
    } else {
      // Simple threshold mode
      for (let i = 0; i < gray.length; i++) {
        edges[i] = gray[i] > threshold ? gray[i] : 0;
      }
    }

    // Render with canvas
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) return;

    // Draw original image (darkened)
    const imgData = ctx.createImageData(width, height);
    for (let i = 0; i < data.length; i += 4) {
      imgData.data[i] = data[i] * (1 - bgDarken);
      imgData.data[i + 1] = data[i + 1] * (1 - bgDarken);
      imgData.data[i + 2] = data[i + 2] * (1 - bgDarken);
      imgData.data[i + 3] = data[i + 3];
    }
    ctx.putImageData(imgData, 0, 0);

    // Draw ASCII characters at edge positions
    ctx.font = `bold ${fontSize}px "JetBrains Mono", "Courier New", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const step = density;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const pos = y * width + x;
        const edgeVal = edges[pos];

        if (edgeMode === "threshold") {
          if (edgeVal <= 0) continue;
          const charIdx = Math.floor((edgeVal / 255) * (chars.length - 1));
          const char = chars[clamp(charIdx, 0, chars.length - 1)];
          if (char === " ") continue;
          ctx.fillStyle = color;
          ctx.globalAlpha = opacity;
          ctx.fillText(char, x + step / 2, y + step / 2);
        } else {
          if (edgeVal < threshold) continue;
          const normalized = Math.min(edgeVal / 400, 1);
          const charIdx = Math.floor(normalized * (chars.length - 1));
          const char = chars[clamp(charIdx, 0, chars.length - 1)];
          if (char === " ") continue;
          ctx.fillStyle = color;
          ctx.globalAlpha = opacity * normalized;
          ctx.fillText(char, x + step / 2, y + step / 2);
        }
      }
    }

    ctx.globalAlpha = 1;
    const resultData = ctx.getImageData(0, 0, width, height);
    data.set(resultData.data);
  },
});


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


// ─── 3. Contour Lines ──────────────────────────────────────────────────────────
// Topographic / iso-luminance contour lines
registerEffect({
  type: "contour-lines",
  label: "Contour Lines",
  category: "style",
  defaultParams: {
    levels: 10,
    lineWidth: 1.5,
    lineColor: "#ffffff",
    fillBands: false,
    opacity: 0.9,
    smooth: 2,
  },
  paramsConfig: [
    { key: "levels", label: "Levels", type: "slider", min: 3, max: 30, step: 1 },
    { key: "lineWidth", label: "Line Width", type: "slider", min: 0.5, max: 5, step: 0.5 },
    { key: "lineColor", label: "Line Color", type: "color" },
    { key: "fillBands", label: "Fill Bands", type: "checkbox" },
    { key: "opacity", label: "Opacity", type: "slider", min: 0, max: 1, step: 0.05 },
    { key: "smooth", label: "Smooth", type: "slider", min: 0, max: 8, step: 1 },
  ],
  glsl: {
    uniforms: {
      levels: "int", lineWidth: "float", lineColor: "vec3",
      fillBands: "int", opacity: "float", totalPasses: "int",
    },
    uniformMapper: (params) => {
      const smooth = Math.round((params.smooth as number) ?? 2);
      const parseHex = (hex: string): [number, number, number] => {
        const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex as string);
        return r ? [parseInt(r[1], 16) / 255, parseInt(r[2], 16) / 255, parseInt(r[3], 16) / 255] : [1, 1, 1];
      };
      return {
        levels: Math.round((params.levels as number) ?? 10),
        lineWidth: params.lineWidth,
        lineColor: parseHex(params.lineColor as string),
        fillBands: params.fillBands ? 1 : 0,
        opacity: params.opacity,
        totalPasses: smooth + 1,
      };
    },
    multiPass: (_, params) => Math.round((params.smooth as number) ?? 2) + 1,
    fragment: `
uniform int u_levels;
uniform float u_lineWidth;
uniform vec3 u_lineColor;
uniform int u_fillBands;
uniform float u_opacity;
uniform int u_totalPasses;
uniform int u_pass;

void main() {
  vec2 tx = 1.0 / u_resolution;

  if (u_pass < u_totalPasses - 1) {
    fragColor = vec4(
      texture(u_source, v_texCoord + vec2(-tx.x,-tx.y)).rgb * 1.0 +
      texture(u_source, v_texCoord + vec2( 0.0, -tx.y)).rgb * 2.0 +
      texture(u_source, v_texCoord + vec2( tx.x,-tx.y)).rgb * 1.0 +
      texture(u_source, v_texCoord + vec2(-tx.x,  0.0)).rgb * 2.0 +
      texture(u_source, v_texCoord              ).rgb * 4.0 +
      texture(u_source, v_texCoord + vec2( tx.x,  0.0)).rgb * 2.0 +
      texture(u_source, v_texCoord + vec2(-tx.x,  tx.y)).rgb * 1.0 +
      texture(u_source, v_texCoord + vec2( 0.0,   tx.y)).rgb * 2.0 +
      texture(u_source, v_texCoord + vec2( tx.x,  tx.y)).rgb * 1.0
    , 1.0) / 16.0;
    return;
  }

  vec3 luma = vec3(0.299, 0.587, 0.114);
  float lumaVal = dot(texture(u_source, v_texCoord).rgb, luma);
  float levels  = float(u_levels);
  float myBand  = floor(lumaVal * levels);

  vec3 col = texture(u_source, v_texCoord).rgb;
  if (u_fillBands == 1) {
    float quantLuma = (myBand + 0.5) / levels;
    if (lumaVal > 0.001) col *= quantLuma / lumaVal;
  }

  int lw = min(2, int(ceil(u_lineWidth)));
  bool isEdge = false;
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      if (!isEdge && abs(dx) <= lw && abs(dy) <= lw && !(dx == 0 && dy == 0)) {
        float nb = dot(texture(u_source, v_texCoord + vec2(float(dx) * tx.x, float(dy) * tx.y)).rgb, luma);
        if (floor(nb * levels) != myBand) isEdge = true;
      }
    }
  }

  if (isEdge) col = mix(col, u_lineColor, u_opacity);
  fragColor = vec4(col, 1.0);
}`,
  },
  processor: (data, { width, height }, params) => {
    const levels = (params.levels as number) ?? 10;
    const lineWidth = (params.lineWidth as number) ?? 1.5;
    const lineColor = (params.lineColor as string) ?? "#ffffff";
    const fillBands = (params.fillBands as boolean) ?? false;
    const opacity = (params.opacity as number) ?? 0.9;
    const smooth = (params.smooth as number) ?? 2;

    // Build grayscale + optional box blur smoothing
    let gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      gray[i] = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
    }

    // Simple box blur for smoothing
    if (smooth > 0) {
      const blurred = new Float32Array(gray.length);
      const r = smooth;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let sum = 0, count = 0;
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                sum += gray[ny * width + nx];
                count++;
              }
            }
          }
          blurred[y * width + x] = sum / count;
        }
      }
      gray = blurred;
    }

    // Quantize to contour bands
    const bandStep = 255 / levels;
    const bandValues = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) {
      bandValues[i] = Math.floor(gray[i] / bandStep);
    }

    const hexResult = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(lineColor);
    const lR = hexResult ? parseInt(hexResult[1], 16) : 255;
    const lG = hexResult ? parseInt(hexResult[2], 16) : 255;
    const lB = hexResult ? parseInt(hexResult[3], 16) : 255;

    if (fillBands) {
      // Color each band with average color of original pixels in that band
      const bandR = new Float32Array(levels + 1);
      const bandG = new Float32Array(levels + 1);
      const bandB = new Float32Array(levels + 1);
      const bandCount = new Float32Array(levels + 1);

      for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        const band = bandValues[i];
        bandR[band] += data[idx];
        bandG[band] += data[idx + 1];
        bandB[band] += data[idx + 2];
        bandCount[band]++;
      }

      for (let b = 0; b <= levels; b++) {
        if (bandCount[b] > 0) {
          bandR[b] /= bandCount[b];
          bandG[b] /= bandCount[b];
          bandB[b] /= bandCount[b];
        }
      }

      for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        const band = bandValues[i];
        data[idx] = bandR[band];
        data[idx + 1] = bandG[band];
        data[idx + 2] = bandB[band];
      }
    }

    // Draw contour lines where band value changes
    const lineThick = Math.ceil(lineWidth);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const here = bandValues[y * width + x];
        const right = bandValues[y * width + x + 1];
        const below = bandValues[(y + 1) * width + x];

        if (here !== right || here !== below) {
          // This is a contour boundary
          for (let dy = -lineThick + 1; dy < lineThick; dy++) {
            for (let dx = -lineThick + 1; dx < lineThick; dx++) {
              const px = x + dx, py = y + dy;
              if (px >= 0 && px < width && py >= 0 && py < height) {
                const pidx = (py * width + px) * 4;
                data[pidx] = data[pidx] * (1 - opacity) + lR * opacity;
                data[pidx + 1] = data[pidx + 1] * (1 - opacity) + lG * opacity;
                data[pidx + 2] = data[pidx + 2] * (1 - opacity) + lB * opacity;
              }
            }
          }
        }
      }
    }
  },
});


// ─── 4. Glitch Displacement Map ────────────────────────────────────────────────
// Self-referential displacement using own luminance, with channel separation

registerEffect({
  type: "glitch-displacement",
  label: "Glitch Displacement",
  category: "distortion",
  defaultParams: { intensity: 30, iterations: 2, channelSeparate: true, direction: "horizontal", animated: true },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 1, max: 100, step: 1 },
    { key: "iterations", label: "Iterations", type: "slider", min: 1, max: 8, step: 1 },
    { key: "channelSeparate", label: "Channel Separate", type: "checkbox" },
    { key: "direction", label: "Direction", type: "select", options: ["horizontal", "vertical", "radial"] },
    { key: "animated", label: "Animated", type: "checkbox" },
  ],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform bool u_channelSeparate;
uniform int u_direction;
uniform bool u_animated;
void main() {
  float t = u_animated ? u_time * 0.05 : 0.0;
  vec4 s = texture(u_source, v_texCoord);
  float lum = (s.r + s.g + s.b) / 3.0 - 0.5;
  float displace = lum * u_intensity;
  if (u_channelSeparate) {
    vec3 result;
    for (int ch = 0; ch < 3; ch++) {
      float chScale = 1.0 + float(ch) * 0.3;
      float d = displace * chScale + (u_animated ? sin(t + float(ch) * 2.1) * 3.0 : 0.0);
      vec2 srcUV = v_texCoord;
      if (u_direction == 0)      srcUV.x = clamp(v_texCoord.x + d / u_resolution.x, 0.0, 1.0);
      else if (u_direction == 1) srcUV.y = clamp(v_texCoord.y + d / u_resolution.y, 0.0, 1.0);
      else {
        vec2 dir2 = normalize(v_texCoord - 0.5);
        srcUV = clamp(v_texCoord + dir2 * d / u_resolution, 0.0, 1.0);
      }
      if (ch == 0) result.r = texture(u_source, srcUV).r;
      else if (ch == 1) result.g = texture(u_source, srcUV).g;
      else result.b = texture(u_source, srcUV).b;
    }
    fragColor = vec4(result, s.a);
  } else {
    float d = displace + (u_animated ? sin(t + v_texCoord.y * u_resolution.y * 0.01) * 5.0 : 0.0);
    vec2 srcUV = v_texCoord;
    if (u_direction == 0)      srcUV.x = clamp(v_texCoord.x + d / u_resolution.x, 0.0, 1.0);
    else if (u_direction == 1) srcUV.y = clamp(v_texCoord.y + d / u_resolution.y, 0.0, 1.0);
    else {
      vec2 dir2 = normalize(v_texCoord - 0.5);
      srcUV = clamp(v_texCoord + dir2 * d / u_resolution, 0.0, 1.0);
    }
    fragColor = texture(u_source, srcUV);
  }
}`,
    uniforms: { intensity: "float", channelSeparate: "bool", direction: "int", animated: "bool" },
    uniformMapper: (p) => ({
      ...p,
      direction: ["horizontal", "vertical", "radial"].indexOf((p.direction as string) || "horizontal"),
    }),
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 30;
    const iterations = (params.iterations as number) ?? 2;
    const channelSeparate = (params.channelSeparate as boolean) ?? true;
    const direction = (params.direction as string) ?? "horizontal";
    const animated = (params.animated as boolean) ?? true;

    const cx = width / 2;
    const cy = height / 2;
    const t = animated ? time * 0.05 : 0;

    let current = new Uint8ClampedArray(data);

    for (let iter = 0; iter < iterations; iter++) {
      const output = new Uint8ClampedArray(current);
      const scale = intensity * (1 - iter * 0.15);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const lum = (current[idx] + current[idx + 1] + current[idx + 2]) / 3 / 255;
          const displace = (lum - 0.5) * scale;

          if (channelSeparate) {
            // Each channel displaced differently
            for (let ch = 0; ch < 3; ch++) {
              const chScale = 1 + ch * 0.3;
              const d = displace * chScale + (animated ? Math.sin(t + ch * 2.1) * 3 : 0);

              let srcX = x, srcY = y;
              if (direction === "horizontal") {
                srcX = clamp(Math.floor(x + d), 0, width - 1);
              } else if (direction === "vertical") {
                srcY = clamp(Math.floor(y + d), 0, height - 1);
              } else { // radial
                const dx = x - cx, dy = y - cy;
                const angle = Math.atan2(dy, dx);
                srcX = clamp(Math.floor(x + Math.cos(angle) * d), 0, width - 1);
                srcY = clamp(Math.floor(y + Math.sin(angle) * d), 0, height - 1);
              }

              output[idx + ch] = current[(srcY * width + srcX) * 4 + ch];
            }
          } else {
            const d = displace + (animated ? Math.sin(t + y * 0.01) * 5 : 0);
            let srcX = x, srcY = y;

            if (direction === "horizontal") {
              srcX = clamp(Math.floor(x + d), 0, width - 1);
            } else if (direction === "vertical") {
              srcY = clamp(Math.floor(y + d), 0, height - 1);
            } else {
              const dx = x - cx, dy = y - cy;
              const angle = Math.atan2(dy, dx);
              srcX = clamp(Math.floor(x + Math.cos(angle) * d), 0, width - 1);
              srcY = clamp(Math.floor(y + Math.sin(angle) * d), 0, height - 1);
            }

            const srcIdx = (srcY * width + srcX) * 4;
            output[idx] = current[srcIdx];
            output[idx + 1] = current[srcIdx + 1];
            output[idx + 2] = current[srcIdx + 2];
          }
        }
      }

      current = output;
    }

    data.set(current);
  },
});


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


// ─── 6. Grid Overlay ────────────────────────────────────────────────────────────
// Scientific / measurement / technical grid overlay

registerEffect({
  type: "grid-overlay",
  label: "Grid Overlay",
  category: "style",
  defaultParams: {
    spacing: 40,
    lineWidth: 1,
    color: "#00ff88",
    style: "lines",
    opacity: 0.6,
    showCoordinates: false,
  },
  paramsConfig: [
    { key: "spacing", label: "Spacing", type: "slider", min: 10, max: 200, step: 5 },
    { key: "lineWidth", label: "Line Width", type: "slider", min: 0.5, max: 5, step: 0.5 },
    { key: "color", label: "Color", type: "color" },
    { key: "style", label: "Style", type: "select", options: ["lines", "dots", "crosshairs", "rulers"] },
    { key: "opacity", label: "Opacity", type: "slider", min: 0.1, max: 1, step: 0.05 },
    { key: "showCoordinates", label: "Show Coordinates", type: "checkbox" },
  ],
  processor: (data, { width, height }, params) => {
    const spacing = (params.spacing as number) ?? 40;
    const lineWidth = (params.lineWidth as number) ?? 1;
    const color = (params.color as string) ?? "#00ff88";
    const gridStyle = (params.style as string) ?? "lines";
    const opacity = (params.opacity as number) ?? 0.6;
    const showCoordinates = (params.showCoordinates as boolean) ?? false;

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) return;

    // Draw original image
    const imgData = ctx.createImageData(width, height);
    imgData.data.set(data);
    ctx.putImageData(imgData, 0, 0);

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = opacity;

    if (gridStyle === "lines") {
      // Standard grid lines
      for (let x = spacing; x < width; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = spacing; y < height; y += spacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    } else if (gridStyle === "dots") {
      // Dot grid at intersections
      const dotRadius = lineWidth + 1;
      for (let y = spacing; y < height; y += spacing) {
        for (let x = spacing; x < width; x += spacing) {
          ctx.beginPath();
          ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (gridStyle === "crosshairs") {
      // Small crosshairs at each intersection
      const crossSize = Math.min(spacing * 0.25, 10);
      for (let y = spacing; y < height; y += spacing) {
        for (let x = spacing; x < width; x += spacing) {
          ctx.beginPath();
          ctx.moveTo(x - crossSize, y);
          ctx.lineTo(x + crossSize, y);
          ctx.moveTo(x, y - crossSize);
          ctx.lineTo(x, y + crossSize);
          ctx.stroke();
        }
      }
    } else if (gridStyle === "rulers") {
      // Ruler markings along edges with tick marks
      const majorSpacing = spacing;
      const minorSpacing = spacing / 4;

      // Top ruler
      for (let x = 0; x < width; x += minorSpacing) {
        const isMajor = Math.abs(x % majorSpacing) < 1;
        const tickLen = isMajor ? 12 : 5;
        ctx.lineWidth = isMajor ? lineWidth * 1.5 : lineWidth * 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, tickLen);
        ctx.stroke();

        // Bottom
        ctx.beginPath();
        ctx.moveTo(x, height);
        ctx.lineTo(x, height - tickLen);
        ctx.stroke();
      }

      // Left ruler
      for (let y = 0; y < height; y += minorSpacing) {
        const isMajor = Math.abs(y % majorSpacing) < 1;
        const tickLen = isMajor ? 12 : 5;
        ctx.lineWidth = isMajor ? lineWidth * 1.5 : lineWidth * 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(tickLen, y);
        ctx.stroke();

        // Right
        ctx.beginPath();
        ctx.moveTo(width, y);
        ctx.lineTo(width - tickLen, y);
        ctx.stroke();
      }

      // Center crosshair
      ctx.lineWidth = lineWidth;
      const centerCross = Math.min(width, height) * 0.03;
      ctx.beginPath();
      ctx.moveTo(width / 2 - centerCross, height / 2);
      ctx.lineTo(width / 2 + centerCross, height / 2);
      ctx.moveTo(width / 2, height / 2 - centerCross);
      ctx.lineTo(width / 2, height / 2 + centerCross);
      ctx.stroke();
    }

    // Coordinate labels at intersections
    if (showCoordinates) {
      ctx.font = "9px monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.globalAlpha = opacity * 0.8;

      for (let y = spacing; y < height - 10; y += spacing) {
        for (let x = spacing; x < width - 30; x += spacing) {
          ctx.fillText(`${x},${y}`, x + 3, y + 3);
        }
      }
    }

    ctx.globalAlpha = 1;
    const resultData = ctx.getImageData(0, 0, width, height);
    data.set(resultData.data);
  },
});

// ─── Chrome ────────────────────────────────────────────────────────────────────
// Liquid metal / chrome surface simulation using Sobel normals mapped to
// a metallic environment gradient
registerEffect({
  type: "chrome",
  label: "Chrome",
  category: "style",
  defaultParams: { reflectivity: 0.85, tint: "silver", contrast: 1.5, smoothing: 2 },
  paramsConfig: [
    { key: "reflectivity", label: "Reflectivity", type: "slider", min: 0, max: 1, step: 0.05 },
    { key: "tint", label: "Tint", type: "select", options: ["silver", "gold", "rainbow", "copper"] },
    { key: "contrast", label: "Contrast", type: "slider", min: 0.5, max: 4, step: 0.1 },
    { key: "smoothing", label: "Smoothing", type: "slider", min: 0, max: 5, step: 0.5 },
  ],
  glsl: {
    uniforms: { reflectivity: "float", contrast: "float", tintMode: "int", totalPasses: "int" },
    uniformMapper: (params) => {
      const smoothing = Math.round((params.smoothing as number) ?? 2);
      return {
        reflectivity: params.reflectivity,
        contrast: params.contrast,
        tintMode: params.tint === "gold" ? 1 : params.tint === "rainbow" ? 2 : params.tint === "copper" ? 3 : 0,
        totalPasses: smoothing + 1,
      };
    },
    multiPass: (_, params) => Math.round((params.smoothing as number) ?? 2) + 1,
    fragment: `
uniform float u_reflectivity;
uniform float u_contrast;
uniform int u_tintMode;
uniform int u_totalPasses;
uniform int u_pass;

vec3 chromeTint(float rawT) {
  float t = clamp(rawT * u_contrast - (u_contrast - 1.0) * 0.5, 0.0, 1.0);
  if (u_tintMode == 1) {
    if (t < 0.25) return mix(vec3(50,30,0)/255.0,   vec3(160,110,20)/255.0,  t * 4.0);
    if (t < 0.5)  return mix(vec3(160,110,20)/255.0, vec3(255,220,80)/255.0,  (t-0.25)*4.0);
    if (t < 0.75) return mix(vec3(255,220,80)/255.0, vec3(255,255,180)/255.0, (t-0.5)*4.0);
    return mix(vec3(255,255,180)/255.0, vec3(255,240,120)/255.0, (t-0.75)*4.0);
  }
  if (u_tintMode == 2) return hslToRgb(t * 360.0, 0.9, 0.55 + t * 0.1);
  if (u_tintMode == 3) {
    if (t < 0.25) return mix(vec3(40,15,5)/255.0,    vec3(150,70,30)/255.0,   t * 4.0);
    if (t < 0.5)  return mix(vec3(150,70,30)/255.0,  vec3(220,140,80)/255.0,  (t-0.25)*4.0);
    if (t < 0.75) return mix(vec3(220,140,80)/255.0, vec3(255,200,150)/255.0, (t-0.5)*4.0);
    return mix(vec3(255,200,150)/255.0, vec3(240,180,130)/255.0, (t-0.75)*4.0);
  }
  float hi = t > 0.85 ? (t - 0.85) / 0.15 : 0.0;
  return vec3(t + hi * 0.157, t + hi * 0.157, clamp(t + 0.039 + hi * 0.157, 0.0, 1.0));
}

void main() {
  vec2 tx = 1.0 / u_resolution;

  if (u_pass < u_totalPasses - 1) {
    fragColor = vec4(
      texture(u_source, v_texCoord + vec2(-tx.x,-tx.y)).rgb * 1.0 +
      texture(u_source, v_texCoord + vec2(0.0,  -tx.y)).rgb * 2.0 +
      texture(u_source, v_texCoord + vec2( tx.x,-tx.y)).rgb * 1.0 +
      texture(u_source, v_texCoord + vec2(-tx.x, 0.0 )).rgb * 2.0 +
      texture(u_source, v_texCoord              ).rgb * 4.0 +
      texture(u_source, v_texCoord + vec2( tx.x, 0.0 )).rgb * 2.0 +
      texture(u_source, v_texCoord + vec2(-tx.x, tx.y)).rgb * 1.0 +
      texture(u_source, v_texCoord + vec2(0.0,   tx.y)).rgb * 2.0 +
      texture(u_source, v_texCoord + vec2( tx.x, tx.y)).rgb * 1.0
    , 1.0) / 16.0;
    return;
  }

  vec3 luma = vec3(0.299, 0.587, 0.114);
  float tl = dot(texture(u_source, v_texCoord + vec2(-tx.x,-tx.y)).rgb, luma);
  float tm = dot(texture(u_source, v_texCoord + vec2(0.0,  -tx.y)).rgb, luma);
  float tr = dot(texture(u_source, v_texCoord + vec2( tx.x,-tx.y)).rgb, luma);
  float ml = dot(texture(u_source, v_texCoord + vec2(-tx.x, 0.0 )).rgb, luma);
  float mr = dot(texture(u_source, v_texCoord + vec2( tx.x, 0.0 )).rgb, luma);
  float bl = dot(texture(u_source, v_texCoord + vec2(-tx.x, tx.y)).rgb, luma);
  float bm = dot(texture(u_source, v_texCoord + vec2(0.0,   tx.y)).rgb, luma);
  float br = dot(texture(u_source, v_texCoord + vec2( tx.x, tx.y)).rgb, luma);

  float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
  float gy = -tl - 2.0*tm - tr + bl + 2.0*bm + br;
  float mag = length(vec2(gx, gy));
  float envU = gx / (mag + 0.001);
  float envV = gy / (mag + 0.001);
  float rawT = (envU * 0.5 + envV * 0.5 + 1.0) * 0.5;

  vec3 src = texture(u_source, v_texCoord).rgb;
  fragColor = vec4(mix(src, chromeTint(rawT), u_reflectivity), 1.0);
}`,
  },
  processor: (data, { width, height }, params) => {
    const reflectivity = (params.reflectivity as number) ?? 0.85;
    const tint = (params.tint as string) ?? "silver";
    const contrast = (params.contrast as number) ?? 1.5;
    const smoothing = Math.round((params.smoothing as number) ?? 2);

    let src = data;
    if (smoothing > 0) {
      src = new Uint8ClampedArray(data);
      for (let pass = 0; pass < smoothing; pass++) {
        const blurred = new Uint8ClampedArray(src.length);
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            const i = (y * width + x) * 4;
            for (let c = 0; c < 3; c++) {
              blurred[i + c] = (
                src[((y - 1) * width + x - 1) * 4 + c] + src[((y - 1) * width + x) * 4 + c] * 2 + src[((y - 1) * width + x + 1) * 4 + c] +
                src[(y * width + x - 1) * 4 + c] * 2 + src[i + c] * 4 + src[(y * width + x + 1) * 4 + c] * 2 +
                src[((y + 1) * width + x - 1) * 4 + c] + src[((y + 1) * width + x) * 4 + c] * 2 + src[((y + 1) * width + x + 1) * 4 + c]
              ) / 16;
            }
            blurred[i + 3] = src[i + 3];
          }
        }
        src = blurred;
      }
    }

    const luma = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      luma[i] = (src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114) / 255;
    }

    const nxArr = new Float32Array(width * height);
    const nyArr = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const gx = (
          -luma[(y - 1) * width + x - 1] + luma[(y - 1) * width + x + 1] +
          -2 * luma[y * width + x - 1] + 2 * luma[y * width + x + 1] +
          -luma[(y + 1) * width + x - 1] + luma[(y + 1) * width + x + 1]
        );
        const gy = (
          -luma[(y - 1) * width + x - 1] - 2 * luma[(y - 1) * width + x] - luma[(y - 1) * width + x + 1] +
          luma[(y + 1) * width + x - 1] + 2 * luma[(y + 1) * width + x] + luma[(y + 1) * width + x + 1]
        );
        nxArr[idx] = gx;
        nyArr[idx] = gy;
      }
    }

    const getChromeTint = (envU: number, envV: number): [number, number, number] => {
      const t = (envU * 0.5 + envV * 0.5 + 1) * 0.5;
      const tc = clamp(t * contrast - (contrast - 1) * 0.5, 0, 1);

      if (tint === "gold") {
        const stops: [number, number, number][] = [[50, 30, 0], [160, 110, 20], [255, 220, 80], [255, 255, 180], [255, 240, 120]];
        const pos = tc * (stops.length - 1);
        const sidx = Math.min(stops.length - 2, Math.floor(pos));
        const frac = pos - sidx;
        return [
          stops[sidx][0] + (stops[sidx + 1][0] - stops[sidx][0]) * frac,
          stops[sidx][1] + (stops[sidx + 1][1] - stops[sidx][1]) * frac,
          stops[sidx][2] + (stops[sidx + 1][2] - stops[sidx][2]) * frac,
        ];
      } else if (tint === "rainbow") {
        return hslToRgb(tc * 360, 0.9, 0.55 + tc * 0.1);
      } else if (tint === "copper") {
        const stops: [number, number, number][] = [[40, 15, 5], [150, 70, 30], [220, 140, 80], [255, 200, 150], [240, 180, 130]];
        const pos = tc * (stops.length - 1);
        const sidx = Math.min(stops.length - 2, Math.floor(pos));
        const frac = pos - sidx;
        return [
          stops[sidx][0] + (stops[sidx + 1][0] - stops[sidx][0]) * frac,
          stops[sidx][1] + (stops[sidx + 1][1] - stops[sidx][1]) * frac,
          stops[sidx][2] + (stops[sidx + 1][2] - stops[sidx][2]) * frac,
        ];
      } else {
        const v = Math.round(tc * 255);
        const highlight = tc > 0.85 ? (tc - 0.85) / 0.15 : 0;
        return [
          clamp(v + highlight * 40, 0, 255),
          clamp(v + highlight * 40, 0, 255),
          clamp(v + 10 + highlight * 40, 0, 255),
        ];
      }
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const i = idx * 4;
        const mag = Math.sqrt(nxArr[idx] * nxArr[idx] + nyArr[idx] * nyArr[idx]);
        const envU = nxArr[idx] / (mag + 0.001);
        const envV = nyArr[idx] / (mag + 0.001);
        const [cr, cg, cb] = getChromeTint(envU, envV);
        data[i] = data[i] * (1 - reflectivity) + cr * reflectivity;
        data[i + 1] = data[i + 1] * (1 - reflectivity) + cg * reflectivity;
        data[i + 2] = data[i + 2] * (1 - reflectivity) + cb * reflectivity;
      }
    }
  },
});
