import { registerEffect } from "../../effect-registry";
import { hexToRgb } from "../shared";

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
