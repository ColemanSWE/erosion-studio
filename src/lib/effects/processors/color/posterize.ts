import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "posterize",
  label: "Posterize",
  category: "color",
  defaultParams: { levels: 8 },
  paramsConfig: [
    { key: "levels", label: "Levels", type: "slider", min: 2, max: 32, default: 8 },
  ],
  glsl: {
    fragment: `
uniform float u_levels;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float levels = max(2.0, u_levels);
  fragColor = vec4(floor(c.rgb * (levels - 1.0) + 0.5) / (levels - 1.0), c.a);
}`,
    uniforms: { levels: "float" },
  },
  processor: (data, config, params) => {
    const levels = (params.levels as number) ?? 8;
    const step = 255 / (levels - 1);

    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.round(data[i] / step) * step;
      data[i + 1] = Math.round(data[i + 1] / step) * step;
      data[i + 2] = Math.round(data[i + 2] / step) * step;
    }
  },
});
