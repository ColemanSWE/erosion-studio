
import { registerEffect } from "./effect-registry";

// Helper function to clamp values between 0 and 255
const clamp = (value: number) => Math.max(0, Math.min(255, value));

registerEffect({
  type: "contrast",
  label: "Contrast",
  category: "standard",
  processor: (data, _, params) => {
    const contrast = (params.value as number) || 100;
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp(factor * (data[i] - 128) + 128);
      data[i + 1] = clamp(factor * (data[i + 1] - 128) + 128);
      data[i + 2] = clamp(factor * (data[i + 2] - 128) + 128);
    }
  },
});

registerEffect({
  type: "brightness",
  label: "Brightness",
  category: "standard",
  processor: (data, _, params) => {
    const brightness = (params.value as number) || 0;

    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp(data[i] + brightness);
      data[i + 1] = clamp(data[i + 1] + brightness);
      data[i + 2] = clamp(data[i + 2] + brightness);
    }
  },
});

registerEffect({
  type: "saturation",
  label: "Saturation",
  category: "standard",
  processor: (data, _, params) => {
    const saturation = (params.value as number) || 100;
    const s = saturation / 100;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const grey = 0.2989 * r + 0.587 * g + 0.114 * b;

      data[i] = clamp(grey + s * (r - grey));
      data[i + 1] = clamp(grey + s * (g - grey));
      data[i + 2] = clamp(grey + s * (b - grey));
    }
  },
});

registerEffect({
  type: "exposure",
  label: "Exposure",
  category: "standard",
  processor: (data, _, params) => {
    const exposure = (params.value as number) || 0;
    const factor = Math.pow(2, exposure / 100);

    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp(data[i] * factor);
      data[i + 1] = clamp(data[i + 1] * factor);
      data[i + 2] = clamp(data[i + 2] * factor);
    }
  },
});

registerEffect({
  type: "grayscale",
  label: "Grayscale",
  category: "standard",
  processor: (data, _, params) => {
    const intensity = (params.value as number) || 100;
    const factor = intensity / 100;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const grey = 0.2989 * r + 0.587 * g + 0.114 * b;

      data[i] = clamp(r * (1 - factor) + grey * factor);
      data[i + 1] = clamp(g * (1 - factor) + grey * factor);
      data[i + 2] = clamp(b * (1 - factor) + grey * factor);
    }
  },
});

registerEffect({
  type: "sepia",
  label: "Sepia",
  category: "standard",
  processor: (data, _, params) => {
    const intensity = (params.value as number) || 100;
    const factor = intensity / 100;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const tr = 0.393 * r + 0.769 * g + 0.189 * b;
      const tg = 0.349 * r + 0.686 * g + 0.168 * b;
      const tb = 0.272 * r + 0.534 * g + 0.131 * b;

      data[i] = clamp(r * (1 - factor) + tr * factor);
      data[i + 1] = clamp(g * (1 - factor) + tg * factor);
      data[i + 2] = clamp(b * (1 - factor) + tb * factor);
    }
  },
});

registerEffect({
  type: "temperature",
  label: "Temperature",
  category: "standard",
  processor: (data, _, params) => {
    const temp = (params.value as number) || 0;
    const adjustment = temp;

    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp(data[i] + adjustment);
      data[i + 2] = clamp(data[i + 2] - adjustment);
    }
  },
});

registerEffect({
  type: "tint",
  label: "Tint",
  category: "standard",
  processor: (data, _, params) => {
    const tint = (params.value as number) || 0;
    const adjustment = tint;

    for (let i = 0; i < data.length; i += 4) {
      data[i + 1] = clamp(data[i + 1] + adjustment);
    }
  },
});
