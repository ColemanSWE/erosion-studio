import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "emoji",
  label: "Emoji",
  category: "style",
  defaultParams: { density: 48, palette: "standard" },
  paramsConfig: [
    {
      key: "density",
      label: "Density",
      type: "slider",
      min: 8,
      max: 128,
      step: 1,
    },
    {
      key: "palette",
      label: "Palette",
      type: "select",
      options: [
        "standard",
        "nature",
        "food",
        "faces",
        "animals",
        "objects",
        "halloween",
        "christmas",
      ],
    },
  ],
  processor: () => {},
});
