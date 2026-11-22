import { registerEffect } from "../../effect-registry";
import { clamp255 } from "../shared";

registerEffect({
  type: "sepia",
  label: "Sepia",
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
  float r = c.r, g = c.g, b = c.b;
  vec3 sepia = vec3(
    r * 0.393 + g * 0.769 + b * 0.189,
    r * 0.349 + g * 0.686 + b * 0.168,
    r * 0.272 + g * 0.534 + b * 0.131
  );
  fragColor = vec4(clamp(mix(c.rgb, sepia, factor), 0.0, 1.0), c.a);
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
      const tr = 0.393 * r + 0.769 * g + 0.189 * b;
      const tg = 0.349 * r + 0.686 * g + 0.168 * b;
      const tb = 0.272 * r + 0.534 * g + 0.131 * b;
      data[i] = clamp255(r * (1 - factor) + tr * factor);
      data[i + 1] = clamp255(g * (1 - factor) + tg * factor);
      data[i + 2] = clamp255(b * (1 - factor) + tb * factor);
    }
  },
});
