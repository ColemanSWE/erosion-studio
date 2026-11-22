import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "invert",
  label: "Invert",
  category: "color",
  defaultParams: {},
  paramsConfig: [],
  glsl: {
    fragment: `
void main() {
  vec4 c = texture(u_source, v_texCoord);
  fragColor = vec4(1.0 - c.rgb, c.a);
}`,
  },
  processor: (data) => {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i];
      data[i + 1] = 255 - data[i + 1];
      data[i + 2] = 255 - data[i + 2];
    }
  },
});
