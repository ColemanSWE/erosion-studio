import { registerEffect } from "../../effect-registry";
import { scratchCopy } from "../shared";

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

    const source = scratchCopy(data, "face-blur/source");
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
