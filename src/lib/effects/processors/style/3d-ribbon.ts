import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "3d-ribbon",
  label: "3D Ribbon",
  category: "style",
  defaultParams: {
    twist: 1.0,
    amplitude: 1.0,
    speed: 1.0,
    segments: 120,
    mode: "ribbon",
    roughness: 0.3,
    metalness: 0.2,
  },
  paramsConfig: [
    { key: "twist", label: "Twist", type: "slider", min: 0, max: 4, step: 0.1 },
    {
      key: "amplitude",
      label: "Amplitude",
      type: "slider",
      min: 0,
      max: 3,
      step: 0.1,
    },
    { key: "speed", label: "Speed", type: "slider", min: 0, max: 4, step: 0.1 },
    {
      key: "segments",
      label: "Segments",
      type: "slider",
      min: 30,
      max: 200,
      step: 10,
    },
    {
      key: "mode",
      label: "Mode",
      type: "select",
      options: ["ribbon", "helix", "wave"],
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
