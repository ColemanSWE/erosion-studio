import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "matrix",
  label: "Matrix",
  category: "style",
  defaultParams: { density: 64 },
  paramsConfig: [
    {
      key: "density",
      label: "Density",
      type: "slider",
      min: 16,
      max: 200,
      step: 1,
    },
  ],
  processor: () => {},
});
