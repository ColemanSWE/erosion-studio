import { registerEffect } from "../../effect-registry";
import { clamp255 } from "../shared";

registerEffect({
  type: "contrast",
  label: "Contrast",
  category: "standard",
  defaultParams: { value: 100 },
  paramsConfig: [
    { key: "value", label: "Contrast", type: "slider", min: 0, max: 200, default: 100 },
  ],
  glsl: {
    fragment: `
uniform float u_value;
void main() {
  float contrast = u_value;
  float factor = (259.0 * (contrast + 255.0)) / (255.0 * (259.0 - contrast));
  vec4 c = texture(u_source, v_texCoord);
  fragColor = vec4(clamp(factor * (c.rgb - 0.502) + 0.502, 0.0, 1.0), c.a);
}`,
    uniforms: { value: "float" },
  },
  processor: (data, _, params) => {
    const contrast = (params.value as number) ?? 100;
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp255(factor * (data[i] - 128) + 128);
      data[i + 1] = clamp255(factor * (data[i + 1] - 128) + 128);
      data[i + 2] = clamp255(factor * (data[i + 2] - 128) + 128);
    }
  },
});
