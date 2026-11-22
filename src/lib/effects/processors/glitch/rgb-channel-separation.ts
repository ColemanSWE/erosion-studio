import { registerEffect } from "../../effect-registry";
import { clamp, scratchCopy } from "../shared";

registerEffect({
  type: "rgb-channel-separation",
  label: "RGB Split",
  category: "glitch",
  defaultParams: { rOffset: 5, gOffset: 0, bOffset: -5 },
  paramsConfig: [
    { key: "rOffset", label: "Red Offset", type: "slider", min: -40, max: 40, default: 5 },
    { key: "gOffset", label: "Green Offset", type: "slider", min: -40, max: 40, default: 0 },
    { key: "bOffset", label: "Blue Offset", type: "slider", min: -40, max: 40, default: -5 },
  ],
  glsl: {
    fragment: `
uniform float u_rOffset;
uniform float u_gOffset;
uniform float u_bOffset;
void main() {
  vec2 px = 1.0 / u_resolution;
  float r = sampleClamped(vec2(v_texCoord.x + u_rOffset * px.x, v_texCoord.y)).r;
  float g = sampleClamped(vec2(v_texCoord.x + u_gOffset * px.x, v_texCoord.y)).g;
  float b = sampleClamped(vec2(v_texCoord.x + u_bOffset * px.x, v_texCoord.y)).b;
  fragColor = vec4(r, g, b, 1.0);
}`,
    uniforms: { rOffset: "float", gOffset: "float", bOffset: "float" },
  },
  processor: (data, { width, height }, params) => {
    const rOffset = (params.rOffset as number) ?? 5;
    const gOffset = (params.gOffset as number) ?? 0;
    const bOffset = (params.bOffset as number) ?? -5;

    const source = scratchCopy(data, "rgb-channel-separation/source");

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const rX = clamp(x + rOffset, 0, width - 1);
        const gX = clamp(x + gOffset, 0, width - 1);
        const bX = clamp(x + bOffset, 0, width - 1);

        data[i] = source[(y * width + rX) * 4];
        data[i + 1] = source[(y * width + gX) * 4 + 1];
        data[i + 2] = source[(y * width + bX) * 4 + 2];
      }
    }
  },
});
