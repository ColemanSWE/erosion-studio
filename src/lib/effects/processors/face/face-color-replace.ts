import { registerEffect } from "../../effect-registry";
import { hexToRgb, isPointInFaceBounds } from "../shared";

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
