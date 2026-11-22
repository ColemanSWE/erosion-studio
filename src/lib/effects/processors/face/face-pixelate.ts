import { registerEffect } from "../../effect-registry";
import { isPointInFaceBounds, scratchCopy } from "../shared";

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
    const source = scratchCopy(data, "face-pixelate/source");

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
