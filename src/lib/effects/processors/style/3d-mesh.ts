import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "3d-mesh",
  label: "3D Mesh",
  category: "style",
  defaultParams: {
    density: 2,
    displacementScale: 3,
    wireframe: true,
    mode: "mesh",
    pointSize: 0.08,
  },
  paramsConfig: [
    {
      key: "density",
      label: "Density",
      type: "slider",
      min: 0.5,
      max: 10,
      step: 0.1,
    },
    {
      key: "displacementScale",
      label: "Displacement",
      type: "slider",
      min: 0,
      max: 10,
      step: 0.1,
    },
    { key: "wireframe", label: "Wireframe", type: "checkbox" },
    { key: "mode", label: "Mode", type: "select", options: ["mesh", "points"] },
    {
      key: "pointSize",
      label: "Point Size",
      type: "slider",
      min: 0.01,
      max: 0.5,
      step: 0.01,
    },
  ],
  processor: () => {},
});
