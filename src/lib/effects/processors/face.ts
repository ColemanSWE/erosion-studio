import { registerEffect, ProcessConfig } from "../effect-registry";
import { EffectType, EffectParamConfig } from "../types";
import { FaceBounds, HandBounds, PoseBounds, getEyeLandmarks, getMouthLandmarks, getLandmarkBounds } from "../face-detector";
import { BAYER_MATRIX_4x4, motionSmearState, datamoshState, blockShovingState, bilinearSample, meltState, perlinNoise, posterizeTimeCache, pseudoRandom, clamp, sortSegment, sortSegmentV, getBlockAverage, hexToRgb, rgbToHsl, hslToRgb, isPointInFaceBounds, frameHistoryStore, storeFrame, getFrameFromHistory } from "./shared";

registerEffect({
  type: "face-eye-censor",
  label: "Eye Censor Bar",
  category: "face",
    defaultParams: { style: "solid", color: "#000000", thickness: 1.5 },
  paramsConfig: [],
  processor: (data, { width, height, faceBounds = [] }, params) => {
    const style = (params.style as string) || "solid";
    const color = (params.color as string) || "#000000";
    const thickness = (params.thickness as number) || 1.5;

    if (faceBounds.length === 0) return;

    const hexToRgb = (hex: string): [number, number, number] => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16),
          ]
        : [0, 0, 0];
    };

    const [r, g, b] = hexToRgb(color);
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
  paramsConfig: [],
  processor: (data, { width, height, faceBounds = [] }, params) => {
    const style = (params.style as string) || "solid";
    const color = (params.color as string) || "#000000";
    const thickness = (params.thickness as number) || 1.2;

    if (faceBounds.length === 0) return;

    const hexToRgb = (hex: string): [number, number, number] => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16),
          ]
        : [0, 0, 0];
    };

    const [r, g, b] = hexToRgb(color);
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
  paramsConfig: [],
  processor: (data, { width, height, faceBounds = [], time = 0 }, params) => {
    const intensity = (params.intensity as number) || 50;
    const lineCount = (params.lineCount as number) || 15;
    const color = (params.color as string) || "#00ff88";

    if (faceBounds.length === 0) return;

    const hexToRgb = (hex: string): [number, number, number] => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16),
          ]
        : [0, 255, 136];
    };

    const [r, g, b] = hexToRgb(color);
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