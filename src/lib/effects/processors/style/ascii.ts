import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "ascii",
  label: "ASCII",
  category: "style",
  defaultParams: { density: 80, charset: "standard", colorMode: "colored" },
  paramsConfig: [
    {
      key: "density",
      label: "Density",
      type: "slider",
      min: 16,
      max: 200,
      step: 1,
    },
    {
      key: "charset",
      label: "Character Set",
      type: "select",
      options: ["standard", "blocks", "binary", "dots", "kanji"],
    },
    {
      key: "colorMode",
      label: "Color Mode",
      type: "select",
      options: ["colored", "green", "amber", "white"],
    },
  ],
  processor: () => {},
});
