import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "3d-crystal",
  label: "3D Crystal",
  category: "style",
  defaultParams: {
    facets: 1,
    rotationSpeed: 0.5,
    scale: 1.0,
    mode: "solid",
    geometry: "icosahedron",
    roughness: 0.05,
    metalness: 0.1,
  },
  paramsConfig: [
    { key: "facets", label: "Detail", type: "slider", min: 0, max: 3, step: 1 },
    {
      key: "rotationSpeed",
      label: "Rotation Speed",
      type: "slider",
      min: 0,
      max: 3,
      step: 0.05,
    },
    {
      key: "scale",
      label: "Scale",
      type: "slider",
      min: 0.3,
      max: 2,
      step: 0.05,
    },
    {
      key: "mode",
      label: "Mode",
      type: "select",
      options: ["solid", "wireframe", "points"],
    },
    {
      key: "geometry",
      label: "Shape",
      type: "select",
      options: ["icosahedron", "dodecahedron", "octahedron", "tetrahedron"],
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
