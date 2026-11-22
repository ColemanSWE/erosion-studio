import { registerEffect } from "../../effect-registry";
import { clamp255 } from "../shared";

registerEffect({
  type: "saturation",
  label: "Saturation",
  category: "standard",
  defaultParams: { value: 100 },
  paramsConfig: [
    { key: "value", label: "Saturation", type: "slider", min: 0, max: 200, default: 100 },
  ],
  glsl: {
    fragment: `
uniform float u_value;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float s = u_value / 100.0;
  float grey = dot(c.rgb, vec3(0.2989, 0.587, 0.114));
  fragColor = vec4(clamp(grey + s * (c.rgb - grey), 0.0, 1.0), c.a);
}`,
    uniforms: { value: "float" },
  },
  processor: (data, _, params) => {
    const saturation = (params.value as number) ?? 100;
    const s = saturation / 100;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const grey = 0.2989 * r + 0.587 * g + 0.114 * b;
      data[i] = clamp255(grey + s * (r - grey));
      data[i + 1] = clamp255(grey + s * (g - grey));
      data[i + 2] = clamp255(grey + s * (b - grey));
    }
  },
});
