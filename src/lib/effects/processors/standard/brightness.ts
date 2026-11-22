import { registerEffect } from "../../effect-registry";
import { clamp255 } from "../shared";

registerEffect({
  type: "brightness",
  label: "Brightness",
  category: "standard",
  defaultParams: { value: 0 },
  paramsConfig: [
    { key: "value", label: "Brightness", type: "slider", min: -255, max: 255, default: 0 },
  ],
  glsl: {
    fragment: `
uniform float u_value;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  fragColor = vec4(clamp(c.rgb + u_value / 255.0, 0.0, 1.0), c.a);
}`,
    uniforms: { value: "float" },
  },
  processor: (data, _, params) => {
    const brightness = (params.value as number) ?? 0;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp255(data[i] + brightness);
      data[i + 1] = clamp255(data[i + 1] + brightness);
      data[i + 2] = clamp255(data[i + 2] + brightness);
    }
  },
});
