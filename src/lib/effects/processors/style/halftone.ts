import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "halftone",
  label: "Halftone",
  category: "style",
  defaultParams: {
    density: 64,
    dotScale: 1.0,
    shape: "circle",
    angle: 0,
    colorMode: "colored",
  },
  paramsConfig: [
    {
      key: "density",
      label: "Density",
      type: "slider",
      min: 8,
      max: 200,
      step: 1,
    },
    {
      key: "dotScale",
      label: "Dot Scale",
      type: "slider",
      min: 0.1,
      max: 3.0,
      step: 0.05,
    },
    {
      key: "shape",
      label: "Dot Shape",
      type: "select",
      options: ["circle", "square", "diamond", "line"],
    },
    { key: "angle", label: "Angle", type: "slider", min: 0, max: 360, step: 5 },
    {
      key: "colorMode",
      label: "Color Mode",
      type: "select",
      options: ["colored", "mono", "cmyk"],
    },
  ],
  processor: () => {},
});
