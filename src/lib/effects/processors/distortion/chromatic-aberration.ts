import { registerEffect } from "../../effect-registry";
import { clamp, scratchCopy } from "../shared";

registerEffect({
  type: "chromatic-aberration",
  label: "Chromatic Aberration",
  category: "distortion",
  defaultParams: { offset: 5 },
  paramsConfig: [
    { key: "offset", label: "Offset", type: "slider", min: 0, max: 40, default: 5 },
  ],
  glsl: {
    fragment: `
uniform float u_offset;
void main() {
  vec2 px = 1.0 / u_resolution;
  float off = u_offset * px.x;
  float r = sampleClamped(vec2(v_texCoord.x + off, v_texCoord.y)).r;
  float g = texture(u_source, v_texCoord).g;
  float b = sampleClamped(vec2(v_texCoord.x - off, v_texCoord.y)).b;
  fragColor = vec4(r, g, b, 1.0);
}`,
    uniforms: { offset: "float" },
  },
  processor: (data, { width, height }, params) => {
    const offset = (params.offset as number) ?? 5;
    if (offset === 0) return;

    const source = scratchCopy(data, "chromatic-aberration/source");

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const rX = clamp(x + offset, 0, width - 1);
        const bX = clamp(x - offset, 0, width - 1);

        data[i] = source[(y * width + rX) * 4];
        data[i + 2] = source[(y * width + bX) * 4 + 2];
      }
    }
  },
});
