import { registerEffect, ProcessConfig } from "../effect-registry";
import { EffectType, EffectParamConfig } from "../types";
import { FaceBounds, HandBounds, PoseBounds, getEyeLandmarks, getMouthLandmarks, getLandmarkBounds } from "../face-detector";
import { BAYER_MATRIX_4x4, motionSmearState, datamoshState, blockShovingState, bilinearSample, meltState, perlinNoise, posterizeTimeCache, pseudoRandom, clamp, sortSegment, sortSegmentV, getBlockAverage, hexToRgb, rgbToHsl, hslToRgb, isPointInFaceBounds, frameHistoryStore, storeFrame, getFrameFromHistory } from "./shared";

registerEffect({
  type: "invert",
  label: "Invert",
  category: "color",
    defaultParams: {},
  paramsConfig: [],
  processor: (data) => {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i];
      data[i + 1] = 255 - data[i + 1];
      data[i + 2] = 255 - data[i + 2];
    }
  },
});

registerEffect({
  type: "vignette",
  label: "Vignette",
  category: "color",
    defaultParams: { intensity: 0.5, radius: 0.8 },
  paramsConfig: [],
  processor: (data, { width, height }, params) => {
    const intensity = (params.intensity as number) || 0.5;
    const radius = (params.radius as number) || 0.8;

    const cx = width / 2;
    const cy = height / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const normalizedDist = dist / maxDist / radius;
        const factor = 1 - Math.pow(Math.min(normalizedDist, 1), 2) * intensity;

        const i = (y * width + x) * 4;
        data[i] = Math.max(0, data[i] * factor);
        data[i + 1] = Math.max(0, data[i + 1] * factor);
        data[i + 2] = Math.max(0, data[i + 2] * factor);
      }
    }
  },
});

registerEffect({
  type: "edge-detect",
  label: "Edge Detect",
  category: "color",
    defaultParams: { threshold: 50, invert: false },
  paramsConfig: [],
  processor: (data, { width, height }, params) => {
    const threshold = (params.threshold as number) || 50;
    const invert = (params.invert as boolean) || false;

    const source = new Uint8ClampedArray(data);
    const sobelX = [
      [-1, 0, 1],
      [-2, 0, 2],
      [-1, 0, 1],
    ];
    const sobelY = [
      [-1, -2, -1],
      [0, 0, 0],
      [1, 2, 1],
    ];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let gx = 0,
          gy = 0;

        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4;
            const lum = (source[idx] + source[idx + 1] + source[idx + 2]) / 3;
            gx += lum * sobelX[ky + 1][kx + 1];
            gy += lum * sobelY[ky + 1][kx + 1];
          }
        }

        const mag = Math.sqrt(gx * gx + gy * gy);
        let edge = mag > threshold ? 255 : 0;
        if (invert) edge = 255 - edge;

        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = edge;
      }
    }
  },
});

registerEffect({
  type: "thermal",
  label: "Thermal",
  category: "color",
    defaultParams: { palette: "thermal" },
  paramsConfig: [],
  processor: (data, config, params) => {
    const palette = (params.palette as string) || "thermal";
    const gradients: Record<string, number[][]> = {
      thermal: [
        [0, 0, 0],
        [30, 0, 100],
        [120, 0, 180],
        [220, 0, 100],
        [255, 50, 0],
        [255, 150, 0],
        [255, 255, 100],
        [255, 255, 255],
      ],
      "night-vision": [
        [0, 0, 0],
        [0, 20, 0],
        [0, 60, 0],
        [0, 120, 0],
        [0, 180, 0],
        [50, 220, 50],
        [150, 255, 150],
        [220, 255, 220],
      ],
      infrared: [
        [0, 0, 50],
        [0, 0, 150],
        [100, 0, 200],
        [200, 0, 150],
        [255, 50, 50],
        [255, 150, 50],
        [255, 220, 150],
        [255, 255, 255],
      ],
    };

    const gradient = gradients[palette] || gradients.thermal;
    const len = gradient.length;

    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3 / 255;
      const pos = lum * (len - 1);
      const idx = Math.min(len - 2, Math.floor(pos));
      const t = pos - idx;

      data[i] =
        gradient[idx][0] + (gradient[idx + 1][0] - gradient[idx][0]) * t;
      data[i + 1] =
        gradient[idx][1] + (gradient[idx + 1][1] - gradient[idx][1]) * t;
      data[i + 2] =
        gradient[idx][2] + (gradient[idx + 1][2] - gradient[idx][2]) * t;
    }
  },
});

registerEffect({
  type: "bloom",
  label: "Bloom",
  category: "color",
    defaultParams: { threshold: 200, intensity: 0.5, radius: 3 },
  paramsConfig: [],
  processor: (data, { width, height }, params) => {
    const threshold = (params.threshold as number) || 200;
    const intensity = (params.intensity as number) || 0.5;
    const radius = (params.radius as number) || 3;

    const brightPixels = new Float32Array(width * height * 3);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const bi = (y * width + x) * 3;
        const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;

        if (lum > threshold) {
          const factor = (lum - threshold) / (255 - threshold);
          brightPixels[bi] = data[i] * factor;
          brightPixels[bi + 1] = data[i + 1] * factor;
          brightPixels[bi + 2] = data[i + 2] * factor;
        }
      }
    }

    const blurred = new Float32Array(brightPixels.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0,
          g = 0,
          b = 0,
          count = 0;

        for (let ky = -radius; ky <= radius; ky++) {
          for (let kx = -radius; kx <= radius; kx++) {
            const ny = y + ky,
              nx = x + kx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              const bi = (ny * width + nx) * 3;
              r += brightPixels[bi];
              g += brightPixels[bi + 1];
              b += brightPixels[bi + 2];
              count++;
            }
          }
        }

        const bi = (y * width + x) * 3;
        blurred[bi] = r / count;
        blurred[bi + 1] = g / count;
        blurred[bi + 2] = b / count;
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const bi = (y * width + x) * 3;
        data[i] = Math.min(255, data[i] + blurred[bi] * intensity);
        data[i + 1] = Math.min(255, data[i + 1] + blurred[bi + 1] * intensity);
        data[i + 2] = Math.min(255, data[i + 2] + blurred[bi + 2] * intensity);
      }
    }
  },
});

registerEffect({
  type: "posterize",
  label: "Posterize",
  category: "color",
    defaultParams: { levels: 8 },
  paramsConfig: [],
  processor: (data, config, params) => {
    const levels = (params.levels as number) || 8;
    const step = 255 / (levels - 1);

    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.round(data[i] / step) * step;
      data[i + 1] = Math.round(data[i + 1] / step) * step;
      data[i + 2] = Math.round(data[i + 2] / step) * step;
    }
  },
});

registerEffect({
  type: "solarize",
  label: "Solarize",
  category: "color",
    defaultParams: { threshold: 128 },
  paramsConfig: [],
  processor: (data, config, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const threshold = 255 - (intensity * 2.55);

    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > threshold) data[i] = 255 - data[i];
      if (data[i + 1] > threshold) data[i + 1] = 255 - data[i + 1];
      if (data[i + 2] > threshold) data[i + 2] = 255 - data[i + 2];
    }
  },
});

registerEffect({
  type: "duotone",
  label: "Duotone",
  category: "color",
    defaultParams: { color1: "#000000", color2: "#00ff88" },
  paramsConfig: [],
  processor: (data, config, params) => {
    const color1 = hexToRgb((params.color1 as string) || "#000000");
    const color2 = hexToRgb((params.color2 as string) || "#ffffff");

    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3 / 255;
      data[i] = color1.r + (color2.r - color1.r) * lum;
      data[i + 1] = color1.g + (color2.g - color1.g) * lum;
      data[i + 2] = color1.b + (color2.b - color1.b) * lum;
    }
  },
});

registerEffect({
  type: "color-shift",
  label: "Color Shift",
  category: "color",
    defaultParams: { speed: 1 },
  paramsConfig: [],
  processor: (data, { time = 0 }, params) => {
    const speed = (params.speed as number) || 1;
    const hueShift = (time * speed) % 360;

    for (let i = 0; i < data.length; i += 4) {
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      const [r, g, b] = hslToRgb((h + hueShift) % 360, s, l);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  },
});

registerEffect({
  type: "channel-swap",
  label: "Channel Swap",
  category: "color",
    defaultParams: { swap: "rg" },
  paramsConfig: [],
  processor: (data, config, params) => {
    const swap = (params.swap as string) || "rg";

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];

      if (swap === "rg") {
        data[i] = g;
        data[i + 1] = r;
      } else if (swap === "rb") {
        data[i] = b;
        data[i + 2] = r;
      } else if (swap === "gb") {
        data[i + 1] = b;
        data[i + 2] = g;
      } else if (swap === "rgb") {
        data[i] = g;
        data[i + 1] = b;
        data[i + 2] = r;
      }
    }
  },
});

registerEffect({
  type: "face-color-replace",
  label: "Face Color Replace",
  category: "color",
    defaultParams: { mode: "solid", color: "#ff00ff" },
  paramsConfig: [],
  processor: (data, { width, height, faceBounds = [] }, params) => {
    const mode = (params.mode as string) || "solid";
    const color = (params.color as string) || "#ff00ff";

    if (faceBounds.length === 0) return;

    const hexToRgb = (hex: string): [number, number, number] => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16),
          ]
        : [255, 0, 255];
    };

    const [r, g, b] = hexToRgb(color);

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
          const origR = data[i];
          const origG = data[i + 1];
          const origB = data[i + 2];

          if (mode === "solid") {
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
          } else if (mode === "gradient") {
            const relX = (x - faceX) / faceW;
            const relY = (y - faceY) / faceH;
            const brightness = (origR + origG + origB) / 3 / 255;

            const gradR = Math.round(r * brightness);
            const gradG = Math.round(g * brightness);
            const gradB = Math.round(b * brightness);

            data[i] = gradR;
            data[i + 1] = gradG;
            data[i + 2] = gradB;
          } else if (mode === "thermal") {
            const brightness = (origR + origG + origB) / 3 / 255;
            const thermalR = Math.round(255 * brightness);
            const thermalG = Math.round(255 * brightness * 0.5);
            const thermalB = Math.round(255 * (1 - brightness));

            data[i] = thermalR;
            data[i + 1] = thermalG;
            data[i + 2] = thermalB;
          }
        }
      }
    }
  },
});

registerEffect({
  type: "rainbow-gradient",
  label: "Rainbow Gradient",
  category: "color",
    defaultParams: {
        speed: 1,
        intensity: 0.5,
        direction: "horizontal",
      },
  paramsConfig: [],
  processor: (data, { width, height, time = 0 }, params) => {
    const speed = (params.speed as number) || 1;
    const intensity = (params.intensity as number) || 0.5;
    const direction = (params.direction as string) || "horizontal";

    const t = time * speed * 0.01;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        let position: number;
        if (direction === "horizontal") {
          position = x / width;
        } else if (direction === "vertical") {
          position = y / height;
        } else if (direction === "diagonal") {
          position = (x / width + y / height) / 2;
        } else {
          // radial
          const centerX = width / 2;
          const centerY = height / 2;
          const dx = x - centerX;
          const dy = y - centerY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);
          position = dist / maxDist;
        }

        // Create rainbow gradient with time animation
        const hue = ((position + t) % 1.0) * 360;
        const [r, g, b] = hslToRgb(hue / 360, 1.0, 0.5);

        // Blend with original
        data[i] = data[i] * (1 - intensity) + r * intensity;
        data[i + 1] = data[i + 1] * (1 - intensity) + g * intensity;
        data[i + 2] = data[i + 2] * (1 - intensity) + b * intensity;
      }
    }
  },
});

registerEffect({
  type: "gradient-flash",
  label: "Gradient Flash",
  category: "color",
    defaultParams: {
        speed: 2,
        intensity: 0.7,
        flashRate: 4,
      },
  paramsConfig: [],
  processor: (data, { width, height, time = 0 }, params) => {
    const speed = (params.speed as number) || 2;
    const intensity = (params.intensity as number) || 0.7;
    const flashRate = (params.flashRate as number) || 4;

    const t = time * speed * 0.02;
    const flash = Math.abs(Math.sin(t * flashRate));

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        const position = (x / width + y / height) / 2;
        const hue = ((position + t) % 1.0) * 360;
        const [r, g, b] = hslToRgb(hue / 360, 1.0, 0.5);

        const flashIntensity = intensity * flash;

        data[i] = data[i] * (1 - flashIntensity) + r * flashIntensity;
        data[i + 1] = data[i + 1] * (1 - flashIntensity) + g * flashIntensity;
        data[i + 2] = data[i + 2] * (1 - flashIntensity) + b * flashIntensity;
      }
    }
  },
});