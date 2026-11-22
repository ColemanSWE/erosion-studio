import { registerEffect } from "../../effect-registry";
import { clamp255 } from "../shared";

registerEffect({
  type: "temperature",
  label: "Temperature",
  category: "standard",
  defaultParams: { value: 0 },
  paramsConfig: [
    { key: "value", label: "Temperature", type: "slider", min: -100, max: 100, default: 0 },
  ],
  glsl: {
    fragment: `
uniform float u_value;
void main() {
  float adj = u_value / 255.0;
  vec4 c = texture(u_source, v_texCoord);
  fragColor = vec4(clamp(c.r + adj, 0.0, 1.0), c.g, clamp(c.b - adj, 0.0, 1.0), c.a);
}`,
    uniforms: { value: "float" },
  },
  processor: (data, _, params) => {
    const temp = (params.value as number) ?? 0;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp255(data[i] + temp);
      data[i + 2] = clamp255(data[i + 2] - temp);
    }
  },
});
