import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "3d-shatter",
  label: "3D Shatter",
  category: "style",
  defaultParams: {
    fragments: 6,
    force: 1.0,
    progress: 0.5,
    rotateShards: true,
    mode: "explode",
    roughness: 0.3,
    metalness: 0.5,
  },
  paramsConfig: [
    {
      key: "fragments",
      label: "Fragments",
      type: "slider",
      min: 2,
      max: 12,
      step: 1,
    },
    { key: "force", label: "Force", type: "slider", min: 0, max: 3, step: 0.1 },
    {
      key: "progress",
      label: "Progress",
      type: "slider",
      min: 0,
      max: 1,
      step: 0.01,
    },
    { key: "rotateShards", label: "Rotate Shards", type: "checkbox" },
    {
      key: "mode",
      label: "Mode",
      type: "select",
      options: ["explode", "implode", "float"],
    },
    {
      key: "roughness",
      label: "Roughness",
      type: "slider",
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      key: "metalness",
      label: "Metalness",
      type: "slider",
      min: 0,
      max: 1,
      step: 0.01,
    },
  ],
  processor: () => {},
});
