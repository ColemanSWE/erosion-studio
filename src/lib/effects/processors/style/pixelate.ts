import { registerEffect } from "../../effect-registry";

// ─── Register style effects that are rendered by effects-renderer.ts ────────
// These effects don't have pixel processors — they are handled by the renderer
// via styleEffectToRenderMode(). We register them so they appear in the panel.

registerEffect({
  type: "pixelate",
  label: "Pixelate",
  category: "style",
  defaultParams: { density: 64 },
  paramsConfig: [
    {
      key: "density",
      label: "Density",
      type: "slider",
      min: 8,
      max: 200,
      step: 1,
    },
  ],
  processor: () => {}, // handled by renderer
});
