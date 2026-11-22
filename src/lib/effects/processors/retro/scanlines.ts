import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "scanlines",
  label: "Scanlines",
  category: "retro",
  defaultParams: { spacing: 3, opacity: 0.4 },
  paramsConfig: [
    { key: "spacing", label: "Spacing", type: "slider", min: 2, max: 12, default: 3 },
    { key: "opacity", label: "Opacity", type: "slider", min: 0, max: 1, step: 0.01, default: 0.4 },
  ],
  glsl: {
    fragment: `
uniform float u_spacing;
uniform float u_opacity;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float y = floor(v_texCoord.y * u_resolution.y);
  float darken = mod(y, u_spacing) == 0.0 ? 1.0 - u_opacity : 1.0;
  fragColor = vec4(c.rgb * darken, c.a);
}`,
    uniforms: { spacing: "float", opacity: "float" },
  },
  processor: (data, { width, height }, params) => {
    const spacing = (params.spacing as number) ?? 3;
    const opacity = (params.opacity as number) ?? 0.4;
    const darken = 1 - opacity;

    for (let y = 0; y < height; y++) {
      if (y % spacing === 0) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          data[i] *= darken;
          data[i + 1] *= darken;
          data[i + 2] *= darken;
        }
      }
    }
  },
});
