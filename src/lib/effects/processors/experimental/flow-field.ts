import { registerEffect } from "../../effect-registry";
import { clamp, scratchFloats } from "../shared";

// ─── Experimental / Avant-Garde Effects ────────────────────────────────────────

// ─── 1. Flow Field ─────────────────────────────────────────────────────────────
// Computes gradient vectors from the image and renders flowing animated lines
// that follow the contours of the scene. Like a wind-map of the image.

registerEffect({
  type: "flow-field",
  experimental: true,
  label: "Flow Field",
  category: "style",
  defaultParams: {
    density: 4000,
    lineLength: 25,
    speed: 2,
    opacity: 0.7,
    color: "#00ff88",
    colorFromImage: true,
    lineWidth: 1.5,
    fadeAmount: 0.15,
  },
  paramsConfig: [
    { key: "density", label: "Particle Count", type: "slider", min: 500, max: 15000, step: 500 },
    { key: "lineLength", label: "Line Length", type: "slider", min: 3, max: 80, step: 1 },
    { key: "speed", label: "Speed", type: "slider", min: 0.5, max: 8, step: 0.5 },
    { key: "opacity", label: "Opacity", type: "slider", min: 0.1, max: 1, step: 0.05 },
    { key: "color", label: "Color", type: "color" },
    { key: "colorFromImage", label: "Color From Image", type: "checkbox" },
    { key: "lineWidth", label: "Line Width", type: "slider", min: 0.5, max: 5, step: 0.5 },
    { key: "fadeAmount", label: "BG Fade", type: "slider", min: 0, max: 1, step: 0.05 },
  ],
  processor: (data, { width, height, time = 0 }, params) => {
    const density = (params.density as number) ?? 4000;
    const lineLength = (params.lineLength as number) ?? 25;
    const speed = (params.speed as number) ?? 2;
    const opacity = (params.opacity as number) ?? 0.7;
    const color = (params.color as string) ?? "#00ff88";
    const colorFromImage = (params.colorFromImage as boolean) ?? true;
    const lineWidth = (params.lineWidth as number) ?? 1.5;
    const fadeAmount = (params.fadeAmount as number) ?? 0.15;

    // Build grayscale for gradient computation
    const gray = scratchFloats(width * height, "flow-field/gray");
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      gray[i] = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
    }

    // Compute gradient angle field
    const angles = scratchFloats(width * height, "flow-field/angles");
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const gx = gray[y * width + x + 1] - gray[y * width + x - 1];
        const gy = gray[(y + 1) * width + x] - gray[(y - 1) * width + x];
        angles[y * width + x] = Math.atan2(gy, gx);
      }
    }

    // Render
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) return;

    // Draw darkened original as background
    const imgData = ctx.createImageData(width, height);
    for (let i = 0; i < data.length; i += 4) {
      imgData.data[i] = data[i] * (1 - fadeAmount);
      imgData.data[i + 1] = data[i + 1] * (1 - fadeAmount);
      imgData.data[i + 2] = data[i + 2] * (1 - fadeAmount);
      imgData.data[i + 3] = data[i + 3];
    }
    ctx.putImageData(imgData, 0, 0);

    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = opacity;
    ctx.lineCap = "round";

    // Deterministic particle positions seeded by density
    let seed = density * 7 + width * 13;
    const prng = (): number => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const t = time * speed;

    for (let p = 0; p < density; p++) {
      let px = prng() * width;
      let py = prng() * height;

      // Animate starting positions with time
      px = (px + t * 10 * prng()) % width;
      py = (py + t * 5 * prng()) % height;

      const startIdx = (Math.floor(py) * width + Math.floor(px)) * 4;
      if (colorFromImage && startIdx >= 0 && startIdx + 2 < data.length) {
        ctx.strokeStyle = `rgba(${data[startIdx]},${data[startIdx + 1]},${data[startIdx + 2]},${opacity})`;
      } else {
        ctx.strokeStyle = color;
      }

      ctx.beginPath();
      ctx.moveTo(px, py);

      for (let step = 0; step < lineLength; step++) {
        const ix = clamp(Math.floor(px), 0, width - 1);
        const iy = clamp(Math.floor(py), 0, height - 1);
        const angle = angles[iy * width + ix] + Math.sin(t * 0.1 + step * 0.1) * 0.3;

        px += Math.cos(angle) * speed;
        py += Math.sin(angle) * speed;

        if (px < 0 || px >= width || py < 0 || py >= height) break;
        ctx.lineTo(px, py);
      }

      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    const resultData = ctx.getImageData(0, 0, width, height);
    data.set(resultData.data);
  },
});
