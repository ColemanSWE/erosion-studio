import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "3d-sphere",
  label: "3D Sphere",
  category: "style",
  defaultParams: {
    zoom: 1.0,
    rotationSpeed: 0.5,
    tilt: 15,
    mode: "solid",
    roughness: 0.4,
    metalness: 0.1,
  },
  paramsConfig: [
    {
      key: "zoom",
      label: "Zoom",
      type: "slider",
      min: 0.3,
      max: 3,
      step: 0.05,
    },
    {
      key: "rotationSpeed",
      label: "Rotation Speed",
      type: "slider",
      min: 0,
      max: 3,
      step: 0.05,
    },
    { key: "tilt", label: "Tilt", type: "slider", min: -45, max: 45, step: 1 },
    {
      key: "mode",
      label: "Mode",
      type: "select",
      options: ["solid", "wireframe", "points"],
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
