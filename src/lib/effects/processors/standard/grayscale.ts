import { registerEffect } from "../../effect-registry";
import { clamp255 } from "../shared";

registerEffect({
  type: "grayscale",
  label: "Grayscale",
  category: "standard",
  defaultParams: { value: 100 },
  paramsConfig: [
    { key: "value", label: "Amount", type: "slider", min: 0, max: 100, default: 100 },
  ],
  glsl: {
    fragment: `
uniform float u_value;
void main() {
  float factor = u_value / 100.0;
  vec4 c = texture(u_source, v_texCoord);
  float grey = dot(c.rgb, vec3(0.2989, 0.587, 0.114));
  fragColor = vec4(mix(c.rgb, vec3(grey), factor), c.a);
}`,
    uniforms: { value: "float" },
  },
  processor: (data, _, params) => {
    const intensity = (params.value as number) ?? 100;
    const factor = intensity / 100;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const grey = 0.2989 * r + 0.587 * g + 0.114 * b;
      data[i] = clamp255(r * (1 - factor) + grey * factor);
      data[i + 1] = clamp255(g * (1 - factor) + grey * factor);
      data[i + 2] = clamp255(b * (1 - factor) + grey * factor);
    }
  },
});
