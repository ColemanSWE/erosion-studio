import { registerEffect } from "../../effect-registry";
import { clamp255 } from "../shared";

registerEffect({
  type: "exposure",
  label: "Exposure",
  category: "standard",
  defaultParams: { value: 0 },
  paramsConfig: [
    { key: "value", label: "Exposure", type: "slider", min: -300, max: 300, default: 0 },
  ],
  glsl: {
    fragment: `
uniform float u_value;
void main() {
  float factor = pow(2.0, u_value / 100.0);
  vec4 c = texture(u_source, v_texCoord);
  fragColor = vec4(clamp(c.rgb * factor, 0.0, 1.0), c.a);
}`,
    uniforms: { value: "float" },
  },
  processor: (data, _, params) => {
    const exposure = (params.value as number) ?? 0;
    const factor = Math.pow(2, exposure / 100);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp255(data[i] * factor);
      data[i + 1] = clamp255(data[i + 1] * factor);
      data[i + 2] = clamp255(data[i + 2] * factor);
    }
  },
});
