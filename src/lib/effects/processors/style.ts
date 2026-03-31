import { registerEffect, ProcessConfig, getEffectDefinition } from "../effect-registry";
import { EffectType, EffectParamConfig } from "../types";
import { FaceBounds, HandBounds, PoseBounds, getEyeLandmarks, getMouthLandmarks, getLandmarkBounds } from "../face-detector";
import { BAYER_MATRIX_4x4, motionSmearState, datamoshState, blockShovingState, bilinearSample, meltState, perlinNoise, posterizeTimeCache, pseudoRandom, clamp, sortSegment, sortSegmentV, getBlockAverage, hexToRgb, rgbToHsl, hslToRgb, isPointInFaceBounds, frameHistoryStore, storeFrame, getFrameFromHistory } from "./shared";

let blobTrackMiniBuffer: Uint8ClampedArray | null = null;
const BLOB_DETECT_INTERVAL = 3;

interface BlobInfo {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
}

let blobTrackCache: {
  blobs: BlobInfo[];
  frameKey: number;
  width: number;
  height: number;
} | null = null;

function getBlobTrackMiniBuffer(size: number): Uint8ClampedArray {
  if (!blobTrackMiniBuffer || blobTrackMiniBuffer.length < size) {
    blobTrackMiniBuffer = new Uint8ClampedArray(size);
  }
  return blobTrackMiniBuffer;
}

// ─── Register style effects that are rendered by effects-renderer.ts ────────
// These effects don't have pixel processors — they are handled by the renderer
// via styleEffectToRenderMode(). We register them so they appear in the panel.

registerEffect({
  type: "pixelate",
  label: "Pixelate",
  category: "style",
  defaultParams: { density: 64 },
  paramsConfig: [
    { key: "density", label: "Density", type: "slider", min: 8, max: 200, step: 1 },
  ],
  processor: () => {},  // handled by renderer
});

registerEffect({
  type: "emoji",
  label: "Emoji",
  category: "style",
  defaultParams: { density: 48, palette: "standard" },
  paramsConfig: [
    { key: "density", label: "Density", type: "slider", min: 8, max: 128, step: 1 },
    { key: "palette", label: "Palette", type: "select", options: ["standard", "nature", "food", "faces", "animals", "objects", "halloween", "christmas"] },
  ],
  processor: () => {},
});

registerEffect({
  type: "ascii",
  label: "ASCII",
  category: "style",
  defaultParams: { density: 80, charset: "standard", colorMode: "colored" },
  paramsConfig: [
    { key: "density", label: "Density", type: "slider", min: 16, max: 200, step: 1 },
    { key: "charset", label: "Character Set", type: "select", options: ["standard", "blocks", "binary", "dots", "kanji"] },
    { key: "colorMode", label: "Color Mode", type: "select", options: ["colored", "green", "amber", "white"] },
  ],
  processor: () => {},
});

registerEffect({
  type: "matrix",
  label: "Matrix",
  category: "style",
  defaultParams: { density: 64 },
  paramsConfig: [
    { key: "density", label: "Density", type: "slider", min: 16, max: 200, step: 1 },
  ],
  processor: () => {},
});

registerEffect({
  type: "halftone",
  label: "Halftone",
  category: "style",
  defaultParams: { density: 64, dotScale: 1.0, shape: "circle", angle: 0, colorMode: "colored" },
  paramsConfig: [
    { key: "density", label: "Density", type: "slider", min: 8, max: 200, step: 1 },
    { key: "dotScale", label: "Dot Scale", type: "slider", min: 0.1, max: 3.0, step: 0.05 },
    { key: "shape", label: "Dot Shape", type: "select", options: ["circle", "square", "diamond", "line"] },
    { key: "angle", label: "Angle", type: "slider", min: 0, max: 360, step: 5 },
    { key: "colorMode", label: "Color Mode", type: "select", options: ["colored", "mono", "cmyk"] },
  ],
  processor: () => {},
});

registerEffect({
  type: "3d-mesh",
  label: "3D Mesh",
  category: "style",
  defaultParams: { density: 2, displacementScale: 3, wireframe: true, mode: "mesh", pointSize: 0.08 },
  paramsConfig: [
    { key: "density", label: "Density", type: "slider", min: 0.5, max: 10, step: 0.1 },
    { key: "displacementScale", label: "Displacement", type: "slider", min: 0, max: 10, step: 0.1 },
    { key: "wireframe", label: "Wireframe", type: "checkbox" },
    { key: "mode", label: "Mode", type: "select", options: ["mesh", "points"] },
    { key: "pointSize", label: "Point Size", type: "slider", min: 0.01, max: 0.5, step: 0.01 },
  ],
  processor: () => {},
});

// ─── Detection / tracking style effects with real processors ───────────────

registerEffect({
  type: "detection-labels",
  label: "Detection Labels",
  category: "standard",
    defaultParams: {
        showFaces: true,
        showHands: true,
        showPose: true,
        labelSize: 14,
        boxThickness: 2,
        showConfidence: false,
      },
  paramsConfig: [
    { key: "showFaces", label: "Show Faces", type: "checkbox" },
    { key: "showHands", label: "Show Hands", type: "checkbox" },
    { key: "showPose", label: "Show Pose", type: "checkbox" },
    { key: "labelSize", label: "Label Size", type: "slider", min: 8, max: 32, step: 1 },
    { key: "boxThickness", label: "Box Thickness", type: "slider", min: 1, max: 8, step: 0.5 },
  ],
  processor: (
    data,
    { width, height, faceBounds = [], handBounds = [], poseBounds = [] },
    params
  ) => {
    const showFaces = (params.showFaces as boolean) ?? true;
    const showHands = (params.showHands as boolean) ?? true;
    const showPose = (params.showPose as boolean) ?? true;
    const boxThickness = (params.boxThickness as number) ?? 2;
    const labelSize = (params.labelSize as number) ?? 14;

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) return;

    const imgData = ctx.createImageData(width, height);
    imgData.data.set(data);
    ctx.putImageData(imgData, 0, 0);

    ctx.lineWidth = boxThickness;
    ctx.font = `bold ${labelSize}px -apple-system, BlinkMacSystemFont, sans-serif`;

    const drawBoxWithLabel = (
      x: number,
      y: number,
      w: number,
      h: number,
      label: string,
      color: string
    ) => {
      ctx.strokeStyle = color;
      ctx.strokeRect(x, y, w, h);

      const padding = 6;
      const metrics = ctx.measureText(label);
      const labelWidth = metrics.width + padding * 2;
      const labelHeight = labelSize + padding * 2;

      const labelX = Math.max(2, Math.min(x, width - labelWidth - 2));
      const labelY = Math.max(labelHeight + 2, y - 8);

      ctx.fillStyle = color;
      ctx.fillRect(labelX, labelY - labelHeight, labelWidth, labelHeight);

      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "top";
      ctx.fillText(label, labelX + padding, labelY - labelHeight + padding);

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(labelX + labelWidth / 2, labelY);
      ctx.lineTo(x, y);
      ctx.stroke();
    };

    if (showFaces && faceBounds.length > 0) {
      for (let i = 0; i < faceBounds.length; i++) {
        const face = faceBounds[i];
        const x = Math.floor(face.x * width);
        const y = Math.floor(face.y * height);
        const w = Math.floor(face.width * width);
        const h = Math.floor(face.height * height);

        drawBoxWithLabel(x, y, w, h, `Face ${i + 1}`, "#FF6B6B");
      }
    }

    if (showHands && handBounds.length > 0) {
      for (const hand of handBounds) {
        const isLeft = hand.label.includes("Left");
        const color = isLeft ? "#4ECDC4" : "#45B7D1";

        const x = Math.floor(hand.x * width);
        const y = Math.floor(hand.y * height);
        const w = Math.floor(hand.width * width);
        const h = Math.floor(hand.height * height);

        drawBoxWithLabel(x, y, w, h, hand.label, color);
      }
    }

    if (showPose && poseBounds.length > 0) {
      for (const pose of poseBounds) {
        const x = Math.floor(pose.x * width);
        const y = Math.floor(pose.y * height);
        const w = Math.floor(pose.width * width);
        const h = Math.floor(pose.height * height);

        drawBoxWithLabel(x, y, w, h, pose.label, "#96CEB4");
      }
    }

    const resultData = ctx.getImageData(0, 0, width, height);
    data.set(resultData.data);
  },
});

registerEffect({
  type: "blob-track",
  label: "Blob Track",
  category: "standard",
    defaultParams: {
        threshold: 128,
        minBlobSize: 200,
        maxBlobSize: 150000,
        maxBlobs: 30,
        flashRate: 5,
        lineWidth: 1.5,
        connectionWidth: 1.0,
        style: "box",
        connections: "none",
        labelStyle: "minimal",
        invert: false,
        forceSquare: false,
        showScanlines: true,
        boxPalette: "custom",
        connectionPalette: "custom",
        innerEffect: "none",
        boxColor: "#00ff88",
        connectionColor: "#00aaff",
        color: "#00ff88", // Legacy, kept for compatibility if needed elsewhere
      },
  paramsConfig: [
    { key: "threshold", label: "Threshold", type: "slider", min: 0, max: 255, step: 1 },
    { key: "minBlobSize", label: "Min Blob Size", type: "slider", min: 10, max: 5000, step: 10 },
    { key: "maxBlobSize", label: "Max Blob Size", type: "slider", min: 1000, max: 500000, step: 1000 },
    { key: "maxBlobs", label: "Max Blobs", type: "slider", min: 1, max: 100, step: 1 },
    { key: "flashRate", label: "Flash Rate", type: "slider", min: 1, max: 10, step: 1 },
    { key: "lineWidth", label: "Line Width", type: "slider", min: 0.5, max: 8, step: 0.5 },
    { key: "connectionWidth", label: "Connection Width", type: "slider", min: 0.5, max: 5, step: 0.5 },
    { key: "style", label: "Style", type: "select", options: ["box", "corners", "crosshair", "grid", "dot", "hidden"] },
    { key: "connections", label: "Connections", type: "select", options: ["none", "neighbors", "all", "hub"] },
    { key: "labelStyle", label: "Label Style", type: "select", options: ["minimal", "object", "value", "none"] },
    { key: "invert", label: "Invert", type: "checkbox" },
    { key: "forceSquare", label: "Force Square", type: "checkbox" },
    { key: "showScanlines", label: "Show Scanlines", type: "checkbox" },
    { key: "boxPalette", label: "Box Palette", type: "select", options: ["custom", "cyberpunk", "neon", "vintage", "monochrome", "danger"] },
    { key: "connectionPalette", label: "Connection Palette", type: "select", options: ["custom", "cyberpunk", "neon", "vintage", "monochrome", "danger"] },
    { key: "innerEffect", label: "Inner Effect", type: "select", options: ["none", "invert", "glitch", "block-corrupt", "pixel-sort", "edge-detect", "noise", "pixelate"] },
    { key: "boxColor", label: "Box Color", type: "color" },
    { key: "connectionColor", label: "Connection Color", type: "color" },
  ],
  processor: (
    data,
    { width, height, time = 0, timelineFrames, faceBounds, handBounds, poseBounds },
    params
  ) => {
    const threshold = (params.threshold as number) ?? 128;
    const minBlobSize = (params.minBlobSize as number) ?? 200;
    const maxBlobSize = (params.maxBlobSize as number) ?? 150000;
    const maxBlobs = (params.maxBlobs as number) ?? 30;
    const flashRate = (params.flashRate as number) ?? 5;
    const boxLineWidth = (params.lineWidth as number) ?? 1.5;
    const connectionLineWidth = (params.connectionWidth as number) ?? 1.0;
    const style = (params.style as string) ?? "box";
    const connections = (params.connections as string) ?? "none";
    const labelStyle = (params.labelStyle as string) ?? "minimal";
    const invertBlobs = (params.invert as boolean) ?? false;
    const forceSquare = (params.forceSquare as boolean) ?? false;
    const showScanlines = (params.showScanlines as boolean) ?? true;
    const boxPaletteName = (params.boxPalette as string) ?? "custom";
    const connPaletteName = (params.connectionPalette as string) ?? "custom";
    const innerEffect = (params.innerEffect as string) ?? "none";
    const boxColor = (params.boxColor as string) ?? (params.color as string) ?? "#00ff88";
    const connectionColor = (params.connectionColor as string) ?? "#00aaff";

    // Pseudo-random function seeded by time for erratic behavior
    const seed = Math.floor(time / Math.max(1, 11 - flashRate));
    const prng = (s: number): number => {
      const x = Math.sin(s * 12.9898 + 78.233) * 43758.5453;
      return x - Math.floor(x);
    };

    const totalPixels = width * height;
    const frameKey = Math.floor(time);
    const canUseCache =
      blobTrackCache &&
      blobTrackCache.width === width &&
      blobTrackCache.height === height &&
      (frameKey - blobTrackCache.frameKey) < BLOB_DETECT_INTERVAL;

    let blobs: BlobInfo[];

    if (canUseCache) {
      blobs = blobTrackCache!.blobs;
    } else {
    const binary = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      const gray = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      const isBright = gray >= threshold;
      binary[i] = (invertBlobs ? !isBright : isBright) ? 1 : 0;
    }

    // Step 2: Connected-Component Labeling (two-pass with union-find)
    const labels = new Int32Array(totalPixels);
    const parent: number[] = [0]; // parent[0] unused, labels start at 1
    let nextLabel = 1;

    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]]; // path compression
        x = parent[x];
      }
      return x;
    };

    const union = (a: number, b: number): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) {
        parent[Math.max(ra, rb)] = Math.min(ra, rb);
      }
    };

    // First pass
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pos = y * width + x;
        if (binary[pos] === 0) continue;

        const left = x > 0 ? labels[pos - 1] : 0;
        const above = y > 0 ? labels[pos - width] : 0;

        if (left === 0 && above === 0) {
          labels[pos] = nextLabel;
          parent.push(nextLabel);
          nextLabel++;
        } else if (left !== 0 && above === 0) {
          labels[pos] = left;
        } else if (left === 0 && above !== 0) {
          labels[pos] = above;
        } else {
          labels[pos] = Math.min(left, above);
          if (left !== above) {
            union(left, above);
          }
        }
      }
    }

    const blobMap = new Map<number, BlobInfo>();

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pos = y * width + x;
        if (labels[pos] === 0) continue;
        const root = find(labels[pos]);
        labels[pos] = root;

        let info = blobMap.get(root);
        if (!info) {
          info = { minX: x, minY: y, maxX: x, maxY: y, area: 0 };
          blobMap.set(root, info);
        }
        info.minX = Math.min(info.minX, x);
        info.minY = Math.min(info.minY, y);
        info.maxX = Math.max(info.maxX, x);
        info.maxY = Math.max(info.maxY, y);
        info.area++;
      }
    }

    let detectedBlobs = Array.from(blobMap.values()).filter(b => b.area >= minBlobSize && b.area <= maxBlobSize);
    detectedBlobs.sort((a, b) => b.area - a.area);
    if (detectedBlobs.length > maxBlobs) {
      detectedBlobs = detectedBlobs.slice(0, maxBlobs);
    }

    blobTrackCache = {
      blobs: detectedBlobs,
      frameKey,
      width,
      height,
    };
    blobs = detectedBlobs;
    }

    if (blobs.length === 0) return;

// Global cache for blob-track temp canvas
let blobTrackCanvas: HTMLCanvasElement | null = null;
let blobTrackCtx: CanvasRenderingContext2D | null = null;

function getOrCreateBlobCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  if (!blobTrackCanvas || blobTrackCanvas.width !== width || blobTrackCanvas.height !== height) {
    blobTrackCanvas = document.createElement("canvas");
    blobTrackCanvas.width = width;
    blobTrackCanvas.height = height;
    blobTrackCtx = blobTrackCanvas.getContext("2d", { willReadFrequently: true });
  }
  if (!blobTrackCtx) {
    throw new Error("Failed to get 2D context for blob-track canvas");
  }
  return { canvas: blobTrackCanvas, ctx: blobTrackCtx };
}

    // Step 4: Render overlays using a cached canvas
    const { canvas: tempCanvas, ctx } = getOrCreateBlobCanvas(width, height);
    ctx.clearRect(0, 0, width, height);

    const imgData = ctx.createImageData(width, height);
    imgData.data.set(data);
    ctx.putImageData(imgData, 0, 0);

    // Color Palettes
    const palettes: Record<string, string[]> = {
      cyberpunk: ["#ff00ff", "#00ffff", "#ffff00", "#ff0088", "#00ff88"],
      neon: ["#ff3366", "#33ccff", "#ccff33", "#ff9933", "#cc33ff"],
      vintage: ["#d4b483", "#e4dfda", "#c1666b", "#48a9a6", "#4281a4"],
      monochrome: ["#ffffff", "#cccccc", "#999999", "#666666", "#333333"],
      danger: ["#ff0000", "#ff3300", "#ff6600", "#cc0000", "#990000"],
    };

    const getPaletteColor = (paletteName: string, customColor: string, index: number): string => {
      if (paletteName === "custom" || !palettes[paletteName]) return customColor;
      const palette = palettes[paletteName];
      return palette[index % palette.length];
    };

    // Parse color helpers
    const getRgbStr = (hex: string): string => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      if (!result) return "0, 255, 136";
      return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
    };

    const boxRgbStr = getRgbStr(boxColor);
    const connRgbStr = getRgbStr(connectionColor);

    ctx.lineWidth = 1.5;
    ctx.font = `bold 10px monospace`;
    ctx.textBaseline = "top";

    const blobCenters: { cx: number; cy: number }[] = [];
    const blobsToDraw: BlobInfo[] = [];

    for (let i = 0; i < blobs.length; i++) {
      const blob = blobs[i];

      // Erratic flicker: skip some blobs randomly each frame
      const flickerChance = flashRate / 10;
      if (prng(seed + i * 7.31) > (0.3 + flickerChance * 0.7)) continue;

      // Jitter position slightly
      const jitterX = Math.floor((prng(seed + i * 13.7) - 0.5) * flashRate * 1.5);
      const jitterY = Math.floor((prng(seed + i * 23.1) - 0.5) * flashRate * 1.5);

      blobsToDraw.push({
        ...blob,
        minX: blob.minX + jitterX,
        minY: blob.minY + jitterY,
        maxX: blob.maxX + jitterX,
        maxY: blob.maxY + jitterY,
      });
    }

    // Draw detected blobs with stylized overlays
    for (let i = 0; i < blobsToDraw.length; i++) {
      const blob = blobsToDraw[i];
      let bx = blob.minX, by = blob.minY, bw = blob.maxX - blob.minX, bh = blob.maxY - blob.minY;
      const cx = bx + bw / 2, cy = by + bh / 2;

      if (forceSquare) {
        const side = Math.max(bw, bh);
        bx = cx - side / 2;
        by = cy - side / 2;
        bw = side;
        bh = side;
      }

      blobCenters.push({ cx, cy });

      // --- Inner Effect Compositing ---
      // Apply the inner effect only to the bounds of the current blob
      if (innerEffect && innerEffect !== "none") {
        const effectDef = getEffectDefinition(innerEffect as EffectType);
        
        if (effectDef && effectDef.processor) {
          const safeBx = Math.max(0, Math.floor(bx));
          const safeBy = Math.max(0, Math.floor(by));
          const safeBw = Math.min(width - safeBx, Math.ceil(bw));
          const safeBh = Math.min(height - safeBy, Math.ceil(bh));

          if (safeBw > 0 && safeBh > 0) {
            const miniSize = safeBw * safeBh * 4;
            const miniBuffer = getBlobTrackMiniBuffer(miniSize);
            for (let localY = 0; localY < safeBh; localY++) {
              for (let localX = 0; localX < safeBw; localX++) {
                const srcIdx = ((safeBy + localY) * width + (safeBx + localX)) * 4;
                const dstIdx = (localY * safeBw + localX) * 4;
                miniBuffer[dstIdx] = data[srcIdx];
                miniBuffer[dstIdx + 1] = data[srcIdx + 1];
                miniBuffer[dstIdx + 2] = data[srcIdx + 2];
                miniBuffer[dstIdx + 3] = data[srcIdx + 3];
              }
            }

            // Run the processor aggressively just on this sub-region
            effectDef.processor(
              miniBuffer, 
              { 
                width: safeBw, 
                height: safeBh, 
                time, 
                timelineFrames, 
                faceBounds, 
                handBounds, 
                poseBounds 
              }, 
              effectDef.defaultParams || {}
            );

            const chunkData = new ImageData(
              new Uint8ClampedArray(miniBuffer.subarray(0, miniSize)),
              safeBw,
              safeBh,
            );
            ctx.putImageData(chunkData, safeBx, safeBy);
          }
        }
      }

      // Resolve colors for this blob
      const currentBoxColor = getPaletteColor(boxPaletteName, boxColor, i);
      const boxRgbStr = getRgbStr(currentBoxColor);

      const opacity = 0.4 + prng(seed + i * 13.3) * 0.6;
      const drawColor = `rgba(${boxRgbStr}, ${opacity})`;
      ctx.strokeStyle = drawColor;
      ctx.fillStyle = drawColor;

      // Randomly vary line width for erratic feel, scaled by user setting
      const currentLineWidth = boxLineWidth + prng(seed + i * 5.7) * boxLineWidth;
      ctx.lineWidth = currentLineWidth;

      if (style === "box") {
        ctx.strokeRect(bx, by, bw, bh);
      } else if (style === "corners") {
        // Draw corner brackets
        const cornerLen = Math.min(bw, bh, 20);
        ctx.beginPath();
        // Top-left
        ctx.moveTo(bx, by + cornerLen); ctx.lineTo(bx, by); ctx.lineTo(bx + cornerLen, by);
        // Top-right
        ctx.moveTo(bx + bw - cornerLen, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + cornerLen);
        // Bottom-right
        ctx.moveTo(bx + bw, by + bh - cornerLen); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw - cornerLen, by + bh);
        // Bottom-left
        ctx.moveTo(bx + cornerLen, by + bh); ctx.lineTo(bx, by + bh); ctx.lineTo(bx, by + bh - cornerLen);
        ctx.stroke();
      } else if (style === "crosshair") {
        const crossSize = Math.min(bw, bh) * 0.4;
        ctx.beginPath();
        // Horizontal
        ctx.moveTo(cx - crossSize, cy); ctx.lineTo(cx + crossSize, cy);
        // Vertical
        ctx.moveTo(cx, cy - crossSize); ctx.lineTo(cx, cy + crossSize);
        ctx.stroke();
        // Circle
        ctx.beginPath();
        ctx.arc(cx, cy, crossSize * 0.7, 0, Math.PI * 2);
        ctx.stroke();
      } else if (style === "grid") {
        // Internal grid lines relative to box size
        const cols = Math.max(2, Math.floor(prng(seed + i * 8.1) * 4) + 2);
        const rows = Math.max(2, Math.floor(prng(seed + i * 9.2) * 4) + 2);
        ctx.beginPath();
        ctx.rect(bx, by, bw, bh);
        for (let c = 1; c < cols; c++) {
          const gx = bx + (bw / cols) * c;
          ctx.moveTo(gx, by); ctx.lineTo(gx, by + bh);
        }
        for (let r = 1; r < rows; r++) {
          const gy = by + (bh / rows) * r;
          ctx.moveTo(bx, gy); ctx.lineTo(bx + bw, gy);
        }
        ctx.stroke();
      } else if (style === "dot") {
        // Just a center dot/circle
        ctx.beginPath();
        ctx.arc(cx, cy, 3 + currentLineWidth, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } // "hidden" does nothing

      // Labels
      if (labelStyle !== "none") {
        let labelText = "";
        const areaRatio = (blob.area / totalPixels).toFixed(4);
        
        if (labelStyle === "minimal") {
          labelText = `${i}:${areaRatio}`;
        } else if (labelStyle === "object") {
          labelText = `OBJ_${i.toString().padStart(2, '0')}`;
        } else if (labelStyle === "value") {
          labelText = prng(seed + i * 99.1).toFixed(3);
        }

        const labelAlpha = 0.5 + prng(seed + i * 41.3) * 0.5;
        
        if (labelStyle === "object") {
          // Object mode: Header bar spanning the top of the box
          const barHeight = 16;
          ctx.fillStyle = `rgba(${boxRgbStr}, ${labelAlpha})`;
          ctx.fillRect(bx, by - barHeight, bw, barHeight);
          
          ctx.fillStyle = "#000000";
          ctx.font = `bold 10px monospace`;
          ctx.fillText(labelText, bx + 4, by - barHeight + 3);
        } else if (labelStyle === "value") {
          // Value mode: Centered inside the box
          ctx.font = `bold 14px monospace`;
          const metrics = ctx.measureText(labelText);
          const lblX = bx + (bw / 2) - (metrics.width / 2);
          const lblY = by + (bh / 2) - 7;
          
          ctx.fillStyle = `rgba(${boxRgbStr}, ${labelAlpha})`;
          ctx.fillText(labelText, lblX, lblY);
        } else {
          // Minimal mode: Small tag above top-left corner
          ctx.font = `bold 10px monospace`;
          ctx.fillStyle = `rgba(${boxRgbStr}, ${labelAlpha})`;
          const metrics = ctx.measureText(labelText);
          const lblX = Math.max(0, Math.min(bx, width - metrics.width - 4));
          const lblY = Math.max(0, by - 13);
          ctx.fillRect(lblX, lblY, metrics.width + 4, 12);

          ctx.fillStyle = "#000000";
          ctx.fillText(labelText, lblX + 2, lblY + 1);
        }
      }

      // Random scan lines within some blobs for extra data-viz feel
      if (showScanlines && style !== "hidden" && style !== "dot" && prng(seed + i * 61.7) > 0.6) {
        ctx.strokeStyle = `rgba(${boxRgbStr}, 0.3)`;
        ctx.lineWidth = boxLineWidth * 0.5;
        const lineSpacing = 4 + Math.floor(prng(seed + i * 71.3) * 6);
        for (let ly = by; ly < by + bh; ly += lineSpacing) {
          ctx.beginPath();
          ctx.moveTo(bx, ly);
          ctx.lineTo(bx + bw, ly);
          ctx.stroke();
        }
      }
    }

    // Connection lines between blob centers
    if (connections !== "none" && blobCenters.length > 1) {
      for (let i = 0; i < blobCenters.length; i++) {
        // Color depends on the connection origin blob
        const currentConnColor = getPaletteColor(connPaletteName, connectionColor, i);
        const connRgbStr = getRgbStr(currentConnColor);
        ctx.strokeStyle = `rgba(${connRgbStr}, 0.3)`;
        ctx.lineWidth = connectionLineWidth;
        
        if (connections === "neighbors") {
          // Connect to nearest neighbors (1 or 2 indices ahead)
          for (let j = 1; j <= 2 && i + j < blobCenters.length; j++) {
            if (prng(seed + i * 100 + j * 50) > 0.4) continue;
            ctx.beginPath();
            ctx.moveTo(blobCenters[i].cx, blobCenters[i].cy);
            ctx.lineTo(blobCenters[i + j].cx, blobCenters[i + j].cy);
            ctx.stroke();
          }
        } else if (connections === "all") {
          // Web / All-to-all - gets very chaotic, lower alpha needed
          ctx.strokeStyle = `rgba(${connRgbStr}, 0.15)`;
          for (let j = i + 1; j < blobCenters.length; j++) {
            if (prng(seed * 2 + i * 33 + j * 77) > 0.8) continue; // Skip a few so it's not a solid block
            ctx.beginPath();
            ctx.moveTo(blobCenters[i].cx, blobCenters[i].cy);
            ctx.lineTo(blobCenters[j].cx, blobCenters[j].cy);
            ctx.stroke();
          }
        }
      }
      
      // Hub is calculated across all, uses the base connection color
      if (connections === "hub") {
        const connRgbStr = getRgbStr(connectionColor);
        ctx.strokeStyle = `rgba(${connRgbStr}, 0.3)`;
        ctx.lineWidth = connectionLineWidth;

        // Find center of mass of all blobs
        let hubX = 0, hubY = 0;
        for (const center of blobCenters) {
          hubX += center.cx; hubY += center.cy;
        }
        hubX /= blobCenters.length; hubY /= blobCenters.length;

        // Draw central hub point
        ctx.fillStyle = `rgba(${connRgbStr}, 0.8)`;
        ctx.beginPath();
        ctx.arc(hubX, hubY, connectionLineWidth * 3, 0, Math.PI * 2);
        ctx.fill();

        // Connect all blobs to hub
        for (const center of blobCenters) {
          ctx.beginPath();
          ctx.moveTo(hubX, hubY);
          ctx.lineTo(center.cx, center.cy);
          ctx.stroke();
        }
      }
    }

    // Grab result back into pixel data
    const resultData = ctx.getImageData(0, 0, width, height);
    data.set(resultData.data);
  },
});