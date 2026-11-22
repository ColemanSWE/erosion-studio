import { registerEffect } from "../../effect-registry";
import { clamp } from "../shared";

// ─── 6. Slit Scan ──────────────────────────────────────────────────────────────
// Takes slices from different time frames, compositing past and present.
// Creates iconic time-stretching distortion — dynamic with video.

const slitScanBuffer: {
  slices: Uint8ClampedArray[];
  width: number;
  height: number;
  maxSlices: number;
} = { slices: [], width: 0, height: 0, maxSlices: 120 };

registerEffect({
  type: "slit-scan",
  experimental: true,
  label: "Slit Scan",
  category: "style",
  defaultParams: {
    direction: "vertical",
    timeDepth: 60,
    speed: 1,
    waveAmount: 0,
    waveFrequency: 0.02,
    mirror: false,
  },
  paramsConfig: [
    { key: "direction", label: "Direction", type: "select", options: ["vertical", "horizontal", "radial"] },
    { key: "timeDepth", label: "Time Depth", type: "slider", min: 5, max: 120, step: 5 },
    { key: "speed", label: "Speed", type: "slider", min: 0.5, max: 5, step: 0.5 },
    { key: "waveAmount", label: "Wave Amount", type: "slider", min: 0, max: 50, step: 1 },
    { key: "waveFrequency", label: "Wave Frequency", type: "slider", min: 0.005, max: 0.1, step: 0.005 },
    { key: "mirror", label: "Mirror", type: "checkbox" },
  ],
  processor: (data, { width, height, time = 0 }, params) => {
    const direction = (params.direction as string) ?? "vertical";
    const timeDepth = (params.timeDepth as number) ?? 60;
    const speed = (params.speed as number) ?? 1;
    const waveAmount = (params.waveAmount as number) ?? 0;
    const waveFreq = (params.waveFrequency as number) ?? 0.02;
    const mirror = (params.mirror as boolean) ?? false;

    // Manage frame buffer
    if (slitScanBuffer.width !== width || slitScanBuffer.height !== height) {
      slitScanBuffer.slices = [];
      slitScanBuffer.width = width;
      slitScanBuffer.height = height;
    }

    // Store current frame
    slitScanBuffer.slices.push(new Uint8ClampedArray(data));
    if (slitScanBuffer.slices.length > slitScanBuffer.maxSlices) {
      slitScanBuffer.slices.shift();
    }

    const numSlices = slitScanBuffer.slices.length;
    if (numSlices < 2) return; // Need at least 2 frames

    const maxDepth = Math.min(timeDepth, numSlices);

    if (direction === "vertical") {
      // Each column comes from a different point in time
      for (let x = 0; x < width; x++) {
        let t = x / width;
        if (mirror) t = t < 0.5 ? t * 2 : 2 - t * 2;

        const sliceIdx = numSlices - 1 - Math.floor(t * (maxDepth - 1));
        const safeIdx = clamp(sliceIdx, 0, numSlices - 1);
        const slice = slitScanBuffer.slices[safeIdx];

        for (let y = 0; y < height; y++) {
          const wave = waveAmount > 0 ? Math.floor(Math.sin(y * waveFreq + time * speed) * waveAmount) : 0;
          const srcX = clamp(x + wave, 0, width - 1);
          const dstIdx = (y * width + x) * 4;
          const srcIdx = (y * width + srcX) * 4;
          data[dstIdx] = slice[srcIdx];
          data[dstIdx + 1] = slice[srcIdx + 1];
          data[dstIdx + 2] = slice[srcIdx + 2];
        }
      }
    } else if (direction === "horizontal") {
      // Each row comes from a different point in time
      for (let y = 0; y < height; y++) {
        let t = y / height;
        if (mirror) t = t < 0.5 ? t * 2 : 2 - t * 2;

        const sliceIdx = numSlices - 1 - Math.floor(t * (maxDepth - 1));
        const safeIdx = clamp(sliceIdx, 0, numSlices - 1);
        const slice = slitScanBuffer.slices[safeIdx];

        for (let x = 0; x < width; x++) {
          const wave = waveAmount > 0 ? Math.floor(Math.sin(x * waveFreq + time * speed) * waveAmount) : 0;
          const srcY = clamp(y + wave, 0, height - 1);
          const dstIdx = (y * width + x) * 4;
          const srcIdx = (srcY * width + x) * 4;
          data[dstIdx] = slice[srcIdx];
          data[dstIdx + 1] = slice[srcIdx + 1];
          data[dstIdx + 2] = slice[srcIdx + 2];
        }
      }
    } else {
      // Radial: distance from center determines time slice
      const cx = width / 2;
      const cy = height / 2;
      const maxR = Math.sqrt(cx * cx + cy * cy);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const r = Math.sqrt(dx * dx + dy * dy);
          let t = r / maxR;
          if (mirror) t = t < 0.5 ? t * 2 : 2 - t * 2;

          const sliceIdx = numSlices - 1 - Math.floor(t * (maxDepth - 1));
          const safeIdx = clamp(sliceIdx, 0, numSlices - 1);
          const slice = slitScanBuffer.slices[safeIdx];

          const wave = waveAmount > 0 ? Math.floor(Math.sin(r * waveFreq + time * speed) * waveAmount) : 0;
          const srcX = clamp(x + Math.floor(Math.cos(Math.atan2(dy, dx)) * wave), 0, width - 1);
          const srcY = clamp(y + Math.floor(Math.sin(Math.atan2(dy, dx)) * wave), 0, height - 1);
          const dstIdx = (y * width + x) * 4;
          const srcIdx = (srcY * width + srcX) * 4;
          data[dstIdx] = slice[srcIdx];
          data[dstIdx + 1] = slice[srcIdx + 1];
          data[dstIdx + 2] = slice[srcIdx + 2];
        }
      }
    }
  },
});
