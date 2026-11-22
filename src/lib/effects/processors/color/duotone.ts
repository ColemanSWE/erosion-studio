import { registerEffect } from "../../effect-registry";
import { hexToRgb } from "../shared";

registerEffect({
  type: "duotone",
  label: "Duotone",
  category: "color",
  defaultParams: { color1: "#000000", color2: "#00ff88" },
  paramsConfig: [
    { key: "color1", label: "Shadows", type: "color", default: "#000000" },
    { key: "color2", label: "Highlights", type: "color", default: "#00ff88" },
  ],
  glsl: {
    fragment: `
uniform vec3 u_color1;
uniform vec3 u_color2;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float lum = (c.r + c.g + c.b) / 3.0;
  fragColor = vec4(mix(u_color1, u_color2, lum), c.a);
}`,
    uniforms: { color1: "vec3", color2: "vec3" },
    uniformMapper: (p) => {
      const hex2rgb = (h: string): [number, number, number] => {
        const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
        return r ? [parseInt(r[1], 16) / 255, parseInt(r[2], 16) / 255, parseInt(r[3], 16) / 255] : [0, 0, 0];
      };
      return {
        ...p,
        color1: hex2rgb((p.color1 as string) || "#000000"),
        color2: hex2rgb((p.color2 as string) || "#00ff88"),
      };
    },
  },
  processor: (data, config, params) => {
    const color1 = hexToRgb((params.color1 as string) ?? "#000000");
    const color2 = hexToRgb((params.color2 as string) ?? "#ffffff");

    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3 / 255;
      data[i] = color1.r + (color2.r - color1.r) * lum;
      data[i + 1] = color1.g + (color2.g - color1.g) * lum;
      data[i + 2] = color1.b + (color2.b - color1.b) * lum;
    }
  },
});
