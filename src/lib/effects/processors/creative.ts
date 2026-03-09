import { registerEffect, ProcessConfig } from "../effect-registry";
import { clamp, perlinNoise } from "./shared";

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
  processor: (data, { width, height }, params) => {
    const threshold = (params.threshold as number) ?? 80;
    const density = (params.density as number) ?? 8;
    const charsetKey = (params.charset as string) || "standard";
    const color = (params.color as string) || "#00ff88";
    const opacity = (params.opacity as number) ?? 0.85;
    const edgeMode = (params.edgeMode as string) || "sobel";
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
  processor: (data, { width, height }, params) => {
    const cellCount = (params.cellCount as number) ?? 200;
    const strokeWidth = (params.strokeWidth as number) ?? 1.5;
    const strokeColor = (params.strokeColor as string) || "#000000";
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
  processor: (data, { width, height }, params) => {
    const levels = (params.levels as number) ?? 10;
    const lineWidth = (params.lineWidth as number) ?? 1.5;
    const lineColor = (params.lineColor as string) || "#ffffff";
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
  defaultParams: {
    intensity: 30,
    iterations: 2,
    channelSeparate: true,
    direction: "horizontal",
    animated: true,
  },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 1, max: 100, step: 1 },
    { key: "iterations", label: "Iterations", type: "slider", min: 1, max: 8, step: 1 },
    { key: "channelSeparate", label: "Channel Separate", type: "checkbox" },
    { key: "direction", label: "Direction", type: "select", options: ["horizontal", "vertical", "radial"] },
    { key: "animated", label: "Animated", type: "checkbox" },
  ],
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 30;
    const iterations = (params.iterations as number) ?? 2;
    const channelSeparate = (params.channelSeparate as boolean) ?? true;
    const direction = (params.direction as string) || "horizontal";
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
    const color = (params.color as string) || "#00ff88";
    const gridStyle = (params.style as string) || "lines";
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
