import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "channel-swap",
  label: "Channel Swap",
  category: "color",
  defaultParams: { swap: "rg" },
  paramsConfig: [
    { key: "swap", label: "Swap", type: "select", options: ["rg", "rb", "gb", "rgb"], default: "rg" },
  ],
  glsl: {
    fragment: `
uniform int u_swap;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float r = c.r, g = c.g, b = c.b;
  if (u_swap == 0)      { c.r = g; c.g = r; }
  else if (u_swap == 1) { c.r = b; c.b = r; }
  else if (u_swap == 2) { c.g = b; c.b = g; }
  else                  { c.r = g; c.g = b; c.b = r; }
  fragColor = c;
}`,
    uniforms: { swap: "int" },
    uniformMapper: (p) => ({
      ...p,
      swap: ["rg", "rb", "gb", "rgb"].indexOf((p.swap as string) || "rg"),
    }),
  },
  processor: (data, config, params) => {
    const swap = (params.swap as string) ?? "rg";

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];

      if (swap === "rg") {
        data[i] = g;
        data[i + 1] = r;
      } else if (swap === "rb") {
        data[i] = b;
        data[i + 2] = r;
      } else if (swap === "gb") {
        data[i + 1] = b;
        data[i + 2] = g;
      } else if (swap === "rgb") {
        data[i] = g;
        data[i + 1] = b;
        data[i + 2] = r;
      }
    }
  },
});
