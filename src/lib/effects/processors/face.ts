import { registerEffect} from "../effect-registry";
import { FaceBounds, getEyeLandmarks, getMouthLandmarks, getLandmarkBounds } from "../face-detector";
import { hexToRgb, isPointInFaceBounds} from "./shared";

// ─── Forehead text helpers ────────────────────────────────────────────────────

// MediaPipe FaceLandmarker upper eyebrow edge indices (topmost points of each brow)
const EYEBROW_INDICES = [
  46, 53, 52, 65, 55, 70, 63, 105, 66, 107,   // left brow
  276, 283, 282, 295, 285, 300, 293, 334, 296, 336, // right brow
];
const FOREHEAD_TOP_INDEX = 10;

function getForeheadBounds(
  face: FaceBounds,
  imgWidth: number,
  imgHeight: number
): { x: number; y: number; w: number; h: number } | null {
  if (!face.landmarks || face.landmarks.length < 400) return null;

  const browLandmarks = EYEBROW_INDICES
    .filter((i) => i < face.landmarks!.length)
    .map((i) => face.landmarks![i]);

  if (browLandmarks.length === 0) return null;

  const browTopY = Math.min(...browLandmarks.map((l) => l.y));
  const foreheadTopY = face.landmarks[FOREHEAD_TOP_INDEX].y;

  const foreheadHeight = browTopY - foreheadTopY;
  if (foreheadHeight < 0.02) return null;

  const faceCenterX = face.x + face.width / 2;
  const boxW = face.width * 0.88;
  const boxH = foreheadHeight * 0.65;
  const boxCenterY = foreheadTopY + foreheadHeight * 0.5;

  const px = Math.round((faceCenterX - boxW / 2) * imgWidth);
  const py = Math.round((boxCenterY - boxH / 2) * imgHeight);
  const pw = Math.max(1, Math.round(boxW * imgWidth));
  const ph = Math.max(1, Math.round(boxH * imgHeight));

  return { x: px, y: py, w: pw, h: ph };
}

let _foreheadOC: OffscreenCanvas | null = null;
let _foreheadCtx: OffscreenCanvasRenderingContext2D | null = null;
let _foreheadLastKey = "";
let _foreheadLastData: ImageData | null = null;

function renderForeheadText(
  text: string,
  boxW: number,
  boxH: number,
  textColor: string,
  bgColor: string,
  bgOpacity: number,
  font: string,
  sizeMultiplier: number
): ImageData | null {
  const key = `${text}|${boxW}|${boxH}|${textColor}|${bgColor}|${bgOpacity}|${font}|${sizeMultiplier}`;
  if (key === _foreheadLastKey && _foreheadLastData) return _foreheadLastData;

  try {
    if (!_foreheadOC) {
      _foreheadOC = new OffscreenCanvas(boxW, boxH);
      _foreheadCtx = _foreheadOC.getContext("2d") as OffscreenCanvasRenderingContext2D;
    } else {
      _foreheadOC.width = boxW;
      _foreheadOC.height = boxH;
    }

    const ctx = _foreheadCtx!;
    ctx.clearRect(0, 0, boxW, boxH);

    const { r: br, g: bg, b: bb } = hexToRgb(bgColor);
    ctx.fillStyle = `rgba(${br},${bg},${bb},${bgOpacity / 100})`;
    ctx.fillRect(0, 0, boxW, boxH);

    let fontSize = Math.round(boxH * 0.62 * (sizeMultiplier / 100));
    fontSize = Math.max(8, fontSize);

    const fontStr = `bold ${fontSize}px ${font}`;
    ctx.font = fontStr;
    let textW = ctx.measureText(text).width;

    if (textW > boxW * 0.92) {
      fontSize = Math.max(6, Math.floor(fontSize * ((boxW * 0.92) / textW)));
      ctx.font = `bold ${fontSize}px ${font}`;
      textW = ctx.measureText(text).width;
    }

    const { r: tr, g: tg, b: tb } = hexToRgb(textColor);
    ctx.fillStyle = `rgb(${tr},${tg},${tb})`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, boxW / 2, boxH / 2);

    _foreheadLastKey = key;
    _foreheadLastData = ctx.getImageData(0, 0, boxW, boxH);
    return _foreheadLastData;
  } catch {
    return null;
  }
}

registerEffect({
  type: "face-eye-censor",
  label: "Eye Censor Bar",
  category: "face",
  defaultParams: { style: "solid", color: "#000000", thickness: 1.5 },
  paramsConfig: [
    { key: "style", label: "Style", type: "select", options: ["solid", "pixelated", "blurred"] },
    { key: "color", label: "Color", type: "color" },
    { key: "thickness", label: "Thickness", type: "slider", min: 0.5, max: 5.0, step: 0.1 }
  ],
  // Face effects stay CPU: they require landmark computation + array uniforms for face rects
  processor: (data, { width, height, faceBounds = [] }, params) => {
    const style = (params.style as string) ?? "solid";
    const color = (params.color as string) ?? "#000000";
    const thickness = (params.thickness as number) ?? 1.5;

    if (faceBounds.length === 0) return;

    const { r, g, b } = hexToRgb(color);
    const source = new Uint8ClampedArray(data);

    for (const face of faceBounds) {
      if (!face.landmarks || face.landmarks.length === 0) continue;

      const { leftEye, rightEye } = getEyeLandmarks(face.landmarks);

      if (leftEye.length === 0 && rightEye.length === 0) continue;

      let combinedBounds = null;

      if (leftEye.length > 0 && rightEye.length > 0) {
        const leftBounds = getLandmarkBounds(leftEye);
        const rightBounds = getLandmarkBounds(rightEye);

        combinedBounds = {
          minX: Math.min(leftBounds.minX, rightBounds.minX),
          maxX: Math.max(leftBounds.maxX, rightBounds.maxX),
          minY: Math.min(leftBounds.minY, rightBounds.minY),
          maxY: Math.max(leftBounds.maxY, rightBounds.maxY),
        };
      } else if (leftEye.length > 0) {
        combinedBounds = getLandmarkBounds(leftEye);
      } else if (rightEye.length > 0) {
        combinedBounds = getLandmarkBounds(rightEye);
      }

      if (!combinedBounds) continue;

      const eyeWidth = (combinedBounds.maxX - combinedBounds.minX) * width;
      const eyeHeight = (combinedBounds.maxY - combinedBounds.minY) * height;

      const barHeight = Math.max(eyeHeight * thickness, 8);
      const padding = eyeWidth * 0.1;

      const startX = Math.max(
        0,
        Math.floor(combinedBounds.minX * width - padding)
      );
      const endX = Math.min(
        width,
        Math.ceil(combinedBounds.maxX * width + padding)
      );
      const centerY = Math.floor(
        ((combinedBounds.minY + combinedBounds.maxY) / 2) * height
      );
      const startY = Math.max(0, Math.floor(centerY - barHeight / 2));
      const endY = Math.min(height, Math.ceil(centerY + barHeight / 2));

      if (style === "solid") {
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const i = (y * width + x) * 4;
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
          }
        }
      } else if (style === "pixelated") {
        const blockSize = Math.max(4, Math.floor(barHeight / 3));
        for (let by = startY; by < endY; by += blockSize) {
          for (let bx = startX; bx < endX; bx += blockSize) {
            const blockEndX = Math.min(bx + blockSize, endX);
            const blockEndY = Math.min(by + blockSize, endY);

            let rSum = 0,
              gSum = 0,
              bSum = 0,
              count = 0;
            for (let y = by; y < blockEndY; y++) {
              for (let x = bx; x < blockEndX; x++) {
                const i = (y * width + x) * 4;
                rSum += source[i];
                gSum += source[i + 1];
                bSum += source[i + 2];
                count++;
              }
            }

            if (count > 0) {
              const avgR = Math.round(rSum / count);
              const avgG = Math.round(gSum / count);
              const avgB = Math.round(bSum / count);

              for (let y = by; y < blockEndY; y++) {
                for (let x = bx; x < blockEndX; x++) {
                  const i = (y * width + x) * 4;
                  data[i] = avgR;
                  data[i + 1] = avgG;
                  data[i + 2] = avgB;
                }
              }
            }
          }
        }
      } else if (style === "blurred") {
        const radius = Math.max(3, Math.floor(barHeight / 4));
        const kernel: number[] = [];
        let kernelSum = 0;

        for (let i = -radius; i <= radius; i++) {
          const value = Math.exp(-(i * i) / (2 * radius * radius));
          kernel.push(value);
          kernelSum += value;
        }

        for (let i = 0; i < kernel.length; i++) {
          kernel[i] /= kernelSum;
        }

        const temp = new Uint8ClampedArray(data.length);

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            let rSum = 0,
              gSum = 0,
              bSum = 0,
              weightSum = 0;

            for (let ky = -radius; ky <= radius; ky++) {
              const sy = y + ky;
              if (sy < startY || sy >= endY) continue;

              const weight = kernel[ky + radius];
              const i = (sy * width + x) * 4;
              rSum += source[i] * weight;
              gSum += source[i + 1] * weight;
              bSum += source[i + 2] * weight;
              weightSum += weight;
            }

            if (weightSum > 0) {
              const i = (y * width + x) * 4;
              temp[i] = Math.round(rSum / weightSum);
              temp[i + 1] = Math.round(gSum / weightSum);
              temp[i + 2] = Math.round(bSum / weightSum);
            }
          }
        }

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            let rSum = 0,
              gSum = 0,
              bSum = 0,
              weightSum = 0;

            for (let kx = -radius; kx <= radius; kx++) {
              const sx = x + kx;
              if (sx < startX || sx >= endX) continue;

              const weight = kernel[kx + radius];
              const i = (y * width + sx) * 4;
              rSum += temp[i] * weight;
              gSum += temp[i + 1] * weight;
              bSum += temp[i + 2] * weight;
              weightSum += weight;
            }

            if (weightSum > 0) {
              const i = (y * width + x) * 4;
              data[i] = Math.round(rSum / weightSum);
              data[i + 1] = Math.round(gSum / weightSum);
              data[i + 2] = Math.round(bSum / weightSum);
            }
          }
        }
      }
    }
  },
});

registerEffect({
  type: "face-mouth-censor",
  label: "Mouth Censor Bar",
  category: "face",
    defaultParams: { style: "solid", color: "#000000", thickness: 1.2 },
  paramsConfig: [
    { key: "style", label: "Style", type: "select", options: ["solid", "pixelated", "blurred"] },
    { key: "color", label: "Color", type: "color" },
    { key: "thickness", label: "Thickness", type: "slider", min: 0.5, max: 4.0, step: 0.1 }
  ],
  processor: (data, { width, height, faceBounds = [] }, params) => {
    const style = (params.style as string) ?? "solid";
    const color = (params.color as string) ?? "#000000";
    const thickness = (params.thickness as number) ?? 1.2;

    if (faceBounds.length === 0) return;

    const { r, g, b } = hexToRgb(color);
    const source = new Uint8ClampedArray(data);

    for (const face of faceBounds) {
      if (!face.landmarks || face.landmarks.length === 0) continue;

      const mouthLandmarks = getMouthLandmarks(face.landmarks);
      if (mouthLandmarks.length === 0) continue;

      const bounds = getLandmarkBounds(mouthLandmarks);
      const mouthWidth = (bounds.maxX - bounds.minX) * width;
      const mouthHeight = (bounds.maxY - bounds.minY) * height;

      const barHeight = Math.max(mouthHeight * thickness, 10);
      const padding = mouthWidth * 0.05;

      const startX = Math.max(0, Math.floor(bounds.minX * width - padding));
      const endX = Math.min(width, Math.ceil(bounds.maxX * width + padding));
      const centerY = Math.floor(((bounds.minY + bounds.maxY) / 2) * height);
      const startY = Math.max(0, Math.floor(centerY - barHeight / 2));
      const endY = Math.min(height, Math.ceil(centerY + barHeight / 2));

      if (style === "solid") {
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const i = (y * width + x) * 4;
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
          }
        }
      } else if (style === "pixelated") {
        const blockSize = Math.max(4, Math.floor(barHeight / 3));
        for (let by = startY; by < endY; by += blockSize) {
          for (let bx = startX; bx < endX; bx += blockSize) {
            const blockEndX = Math.min(bx + blockSize, endX);
            const blockEndY = Math.min(by + blockSize, endY);

            let rSum = 0,
              gSum = 0,
              bSum = 0,
              count = 0;
            for (let y = by; y < blockEndY; y++) {
              for (let x = bx; x < blockEndX; x++) {
                const i = (y * width + x) * 4;
                rSum += source[i];
                gSum += source[i + 1];
                bSum += source[i + 2];
                count++;
              }
            }

            if (count > 0) {
              const avgR = Math.round(rSum / count);
              const avgG = Math.round(gSum / count);
              const avgB = Math.round(bSum / count);

              for (let y = by; y < blockEndY; y++) {
                for (let x = bx; x < blockEndX; x++) {
                  const i = (y * width + x) * 4;
                  data[i] = avgR;
                  data[i + 1] = avgG;
                  data[i + 2] = avgB;
                }
              }
            }
          }
        }
      } else if (style === "blurred") {
        const radius = Math.max(3, Math.floor(barHeight / 4));
        const kernel: number[] = [];
        let kernelSum = 0;

        for (let i = -radius; i <= radius; i++) {
          const value = Math.exp(-(i * i) / (2 * radius * radius));
          kernel.push(value);
          kernelSum += value;
        }

        for (let i = 0; i < kernel.length; i++) {
          kernel[i] /= kernelSum;
        }

        const temp = new Uint8ClampedArray(data.length);

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            let rSum = 0,
              gSum = 0,
              bSum = 0,
              weightSum = 0;

            for (let ky = -radius; ky <= radius; ky++) {
              const sy = y + ky;
              if (sy < startY || sy >= endY) continue;

              const weight = kernel[ky + radius];
              const i = (sy * width + x) * 4;
              rSum += source[i] * weight;
              gSum += source[i + 1] * weight;
              bSum += source[i + 2] * weight;
              weightSum += weight;
            }

            if (weightSum > 0) {
              const i = (y * width + x) * 4;
              temp[i] = Math.round(rSum / weightSum);
              temp[i + 1] = Math.round(gSum / weightSum);
              temp[i + 2] = Math.round(bSum / weightSum);
            }
          }
        }

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            let rSum = 0,
              gSum = 0,
              bSum = 0,
              weightSum = 0;

            for (let kx = -radius; kx <= radius; kx++) {
              const sx = x + kx;
              if (sx < startX || sx >= endX) continue;

              const weight = kernel[kx + radius];
              const i = (y * width + sx) * 4;
              rSum += temp[i] * weight;
              gSum += temp[i + 1] * weight;
              bSum += temp[i + 2] * weight;
              weightSum += weight;
            }

            if (weightSum > 0) {
              const i = (y * width + x) * 4;
              data[i] = Math.round(rSum / weightSum);
              data[i + 1] = Math.round(gSum / weightSum);
              data[i + 2] = Math.round(bSum / weightSum);
            }
          }
        }
      }
    }
  },
});

registerEffect({
  type: "face-landmark-glitch",
  label: "Landmark Glitch",
  category: "face",
    defaultParams: { intensity: 50, lineCount: 15, color: "#00ff88" },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 100, step: 1 },
    { key: "lineCount", label: "Line Count", type: "slider", min: 1, max: 50, step: 1 },
    { key: "color", label: "Color", type: "color" }
  ],
  processor: (data, { width, height, faceBounds = [], time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const lineCount = (params.lineCount as number) ?? 15;
    const color = (params.color as string) ?? "#00ff88";

    if (faceBounds.length === 0) return;

    const { r, g, b } = hexToRgb(color);
    const seed = Math.floor(time / 3);

    const pseudoRandom = (s: number): number => {
      const x = Math.sin(s * 12.9898 + 78.233) * 43758.5453;
      return x - Math.floor(x);
    };

    const drawLine = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      thickness: number
    ) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const steps = Math.max(Math.abs(dx), Math.abs(dy));

      if (steps === 0) return;

      const xStep = dx / steps;
      const yStep = dy / steps;

      for (let i = 0; i <= steps; i++) {
        const x = Math.round(x1 + xStep * i);
        const y = Math.round(y1 + yStep * i);

        for (let ty = -thickness; ty <= thickness; ty++) {
          for (let tx = -thickness; tx <= thickness; tx++) {
            const px = x + tx;
            const py = y + ty;
            if (px >= 0 && px < width && py >= 0 && py < height) {
              const idx = (py * width + px) * 4;
              const dist = Math.sqrt(tx * tx + ty * ty);
              const alpha = Math.max(0, 1 - dist / thickness);
              data[idx] = Math.round(data[idx] * (1 - alpha) + r * alpha);
              data[idx + 1] = Math.round(
                data[idx + 1] * (1 - alpha) + g * alpha
              );
              data[idx + 2] = Math.round(
                data[idx + 2] * (1 - alpha) + b * alpha
              );
            }
          }
        }
      }
    };

    for (const face of faceBounds) {
      if (!face.landmarks || face.landmarks.length < 10) continue;

      const numLines = Math.floor(lineCount * (intensity / 100));

      for (let i = 0; i < numLines; i++) {
        const idx1 = Math.floor(
          pseudoRandom(seed + i * 100) * face.landmarks.length
        );
        const idx2 = Math.floor(
          pseudoRandom(seed + i * 200) * face.landmarks.length
        );

        if (idx1 === idx2) continue;

        const p1 = face.landmarks[idx1];
        const p2 = face.landmarks[idx2];

        const x1 = Math.round(p1.x * width);
        const y1 = Math.round(p1.y * height);
        const x2 = Math.round(p2.x * width);
        const y2 = Math.round(p2.y * height);

        const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const maxDist = Math.sqrt(width * width + height * height);
        const distFactor = 1 - dist / maxDist;

        if (pseudoRandom(seed + i * 300) < (intensity / 100) * distFactor) {
          const thickness = Math.max(
            1,
            Math.floor(pseudoRandom(seed + i * 400) * 2)
          );
          drawLine(x1, y1, x2, y2, thickness);
        }
      }
    }
  },
});

registerEffect({
  type: "face-pixelate",
  label: "Face Pixelate",
  category: "face",
  defaultParams: { blockSize: 16 },
  paramsConfig: [
    { key: "blockSize", label: "Block Size", type: "slider", min: 4, max: 100, step: 1 }
  ],
  processor: (data, { width, height, faceBounds = [] }, params) => {
    const blockSize = (params.blockSize as number) ?? 16;
    if (faceBounds.length === 0) return;
    const source = new Uint8ClampedArray(data);

    for (const face of faceBounds) {
      const faceX = Math.floor(face.x * width);
      const faceY = Math.floor(face.y * height);
      const faceW = Math.floor(face.width * width);
      const faceH = Math.floor(face.height * height);

      const startX = Math.max(0, faceX);
      const startY = Math.max(0, faceY);
      const endX = Math.min(width, faceX + faceW);
      const endY = Math.min(height, faceY + faceH);

      for (let by = startY; by < endY; by += blockSize) {
        for (let bx = startX; bx < endX; bx += blockSize) {
          const blockEndX = Math.min(bx + blockSize, endX);
          const blockEndY = Math.min(by + blockSize, endY);

          let rSum = 0, gSum = 0, bSum = 0, count = 0;
          for (let y = by; y < blockEndY; y++) {
            for (let x = bx; x < blockEndX; x++) {
              if (isPointInFaceBounds(x, y, width, height, face)) {
                const i = (y * width + x) * 4;
                rSum += source[i];
                gSum += source[i + 1];
                bSum += source[i + 2];
                count++;
              }
            }
          }

          if (count > 0) {
            const r = Math.round(rSum / count);
            const g = Math.round(gSum / count);
            const b = Math.round(bSum / count);

            for (let y = by; y < blockEndY; y++) {
              for (let x = bx; x < blockEndX; x++) {
                if (isPointInFaceBounds(x, y, width, height, face)) {
                  const i = (y * width + x) * 4;
                  data[i] = r;
                  data[i + 1] = g;
                  data[i + 2] = b;
                }
              }
            }
          }
        }
      }
    }
  },
});

registerEffect({
  type: "face-blur",
  label: "Face Blur",
  category: "face",
  defaultParams: { radius: 20 },
  paramsConfig: [
    { key: "radius", label: "Blur Radius", type: "slider", min: 1, max: 100, step: 1 }
  ],
  processor: (data, { width, height, faceBounds = [] }, params) => {
    const radius = (params.radius as number) ?? 20;
    if (faceBounds.length === 0 || radius <= 0) return;

    const source = new Uint8ClampedArray(data);
    const boxPasses = 3;
    const boxRadius = Math.ceil(radius / boxPasses);

    for (const face of faceBounds) {
      const padding = 0.15;
      const faceX = Math.floor((face.x - face.width * padding) * width);
      const faceY = Math.floor((face.y - face.height * padding) * height);
      const faceW = Math.floor(face.width * (1 + padding * 2) * width);
      const faceH = Math.floor(face.height * (1 + padding * 2) * height);

      const startX = Math.max(0, faceX);
      const startY = Math.max(0, faceY);
      const endX = Math.min(width, faceX + faceW);
      const endY = Math.min(height, faceY + faceH);
      const regionW = endX - startX;
      const regionH = endY - startY;

      if (regionW <= 0 || regionH <= 0) continue;

      const regionSize = regionW * regionH * 4;
      const current = new Uint8ClampedArray(regionSize);
      const temp = new Uint8ClampedArray(regionSize);

      for (let y = 0; y < regionH; y++) {
        for (let x = 0; x < regionW; x++) {
          const srcI = ((startY + y) * width + (startX + x)) * 4;
          const dstI = (y * regionW + x) * 4;
          current[dstI] = source[srcI];
          current[dstI + 1] = source[srcI + 1];
          current[dstI + 2] = source[srcI + 2];
          current[dstI + 3] = source[srcI + 3];
        }
      }

      for (let pass = 0; pass < boxPasses; pass++) {
        for (let y = 0; y < regionH; y++) {
          for (let x = 0; x < regionW; x++) {
            let rSum = 0, gSum = 0, bSum = 0, count = 0;
            const minKX = Math.max(0, x - boxRadius);
            const maxKX = Math.min(regionW - 1, x + boxRadius);
            for (let kx = minKX; kx <= maxKX; kx++) {
              const i = (y * regionW + kx) * 4;
              rSum += current[i]; gSum += current[i + 1]; bSum += current[i + 2];
              count++;
            }
            const i = (y * regionW + x) * 4;
            temp[i] = Math.round(rSum / count);
            temp[i + 1] = Math.round(gSum / count);
            temp[i + 2] = Math.round(bSum / count);
            temp[i + 3] = current[i + 3];
          }
        }
        for (let x = 0; x < regionW; x++) {
          for (let y = 0; y < regionH; y++) {
            let rSum = 0, gSum = 0, bSum = 0, count = 0;
            const minKY = Math.max(0, y - boxRadius);
            const maxKY = Math.min(regionH - 1, y + boxRadius);
            for (let ky = minKY; ky <= maxKY; ky++) {
              const i = (ky * regionW + x) * 4;
              rSum += temp[i]; gSum += temp[i + 1]; bSum += temp[i + 2];
              count++;
            }
            const i = (y * regionW + x) * 4;
            current[i] = Math.round(rSum / count);
            current[i + 1] = Math.round(gSum / count);
            current[i + 2] = Math.round(bSum / count);
          }
        }
      }

      for (let y = 0; y < regionH; y++) {
        for (let x = 0; x < regionW; x++) {
          const dstI = ((startY + y) * width + (startX + x)) * 4;
          const srcI = (y * regionW + x) * 4;
          data[dstI] = current[srcI];
          data[dstI + 1] = current[srcI + 1];
          data[dstI + 2] = current[srcI + 2];
        }
      }
    }
  },
});

registerEffect({
  type: "face-color-replace",
  label: "Face Color Replace",
  category: "face",
  defaultParams: { mode: "solid", color: "#ff00ff" },
  paramsConfig: [
    { key: "mode", label: "Mode", type: "select", options: ["solid", "gradient", "thermal"] },
    { key: "color", label: "Color", type: "color" }
  ],
  processor: (data, { width, height, faceBounds = [] }, params) => {
    const mode = (params.mode as string) ?? "solid";
    const color = (params.color as string) ?? "#ff00ff";
    if (faceBounds.length === 0) return;

    const { r, g, b } = hexToRgb(color);

    for (const face of faceBounds) {
      const faceX = Math.floor(face.x * width);
      const faceY = Math.floor(face.y * height);
      const faceW = Math.floor(face.width * width);
      const faceH = Math.floor(face.height * height);

      const startX = Math.max(0, faceX);
      const startY = Math.max(0, faceY);
      const endX = Math.min(width, faceX + faceW);
      const endY = Math.min(height, faceY + faceH);

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          if (!isPointInFaceBounds(x, y, width, height, face)) continue;
          const i = (y * width + x) * 4;
          const origR = data[i], origG = data[i + 1], origB = data[i + 2];
          if (mode === "solid") {
            data[i] = r; data[i + 1] = g; data[i + 2] = b;
          } else if (mode === "gradient") {
            const brightness = (origR + origG + origB) / 3 / 255;
            data[i] = Math.round(r * brightness);
            data[i + 1] = Math.round(g * brightness);
            data[i + 2] = Math.round(b * brightness);
          } else if (mode === "thermal") {
            const brightness = (origR + origG + origB) / 3 / 255;
            data[i] = Math.round(255 * brightness);
            data[i + 1] = Math.round(255 * brightness * 0.5);
            data[i + 2] = Math.round(255 * (1 - brightness));
          }
        }
      }
    }
  },
});

registerEffect({
  type: "face-forehead-text",
  label: "Forehead Text",
  category: "face",
  defaultParams: {
    text: "INSERT TEXT",
    textColor: "#ffffff",
    bgColor: "#000000",
    bgOpacity: 85,
    size: 100,
    font: "monospace",
  },
  paramsConfig: [
    { key: "text", label: "Text", type: "text", placeholder: "Enter text..." },
    { key: "textColor", label: "Text Color", type: "color" },
    { key: "bgColor", label: "Background", type: "color" },
    { key: "bgOpacity", label: "BG Opacity", type: "slider", min: 0, max: 100, step: 1 },
    { key: "size", label: "Size", type: "slider", min: 20, max: 200, step: 1 },
    { key: "font", label: "Font", type: "select", options: ["monospace", "sans-serif", "serif", "Impact, fantasy"] },
  ],
  processor: (data, { width, height, faceBounds = [] }, params) => {
    const text       = (params.text as string) ?? "INSERT TEXT";
    const textColor  = (params.textColor as string) ?? "#ffffff";
    const bgColor    = (params.bgColor as string) ?? "#000000";
    const bgOpacity  = (params.bgOpacity as number) ?? 85;
    const size       = (params.size as number) ?? 100;
    const font       = (params.font as string) ?? "monospace";

    if (faceBounds.length === 0 || !text) return;

    for (const face of faceBounds) {
      const box = getForeheadBounds(face, width, height);
      if (!box) continue;

      const textImg = renderForeheadText(
        text, box.w, box.h,
        textColor, bgColor, bgOpacity,
        font, size
      );
      if (!textImg) continue;

      const td = textImg.data;

      for (let ty = 0; ty < box.h; ty++) {
        for (let tx = 0; tx < box.w; tx++) {
          const dx = box.x + tx;
          const dy = box.y + ty;
          if (dx < 0 || dx >= width || dy < 0 || dy >= height) continue;

          const ti = (ty * box.w + tx) * 4;
          const alpha = td[ti + 3] / 255;
          if (alpha === 0) continue;

          const di = (dy * width + dx) * 4;
          data[di]     = Math.round(td[ti]     * alpha + data[di]     * (1 - alpha));
          data[di + 1] = Math.round(td[ti + 1] * alpha + data[di + 1] * (1 - alpha));
          data[di + 2] = Math.round(td[ti + 2] * alpha + data[di + 2] * (1 - alpha));
        }
      }
    }
  },
});