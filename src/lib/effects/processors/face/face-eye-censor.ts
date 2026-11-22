import { registerEffect } from "../../effect-registry";
import { getEyeLandmarks, getLandmarkBounds } from "../../face-detector";
import { hexToRgb, scratchCopy } from "../shared";

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
    const source = scratchCopy(data, "face-eye-censor/source");

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
