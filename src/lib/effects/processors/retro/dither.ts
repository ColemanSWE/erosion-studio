import { registerEffect } from "../../effect-registry";
import { BAYER_MATRIX_4x4, clamp } from "../shared";

registerEffect({
  type: "dither",
  label: "Dither",
  category: "retro",
  defaultParams: { depth: 4 },
  paramsConfig: [
    { key: "depth", label: "Depth", type: "slider", min: 1, max: 8, default: 4 },
  ],
  glsl: {
    fragment: `
uniform float u_depth;
const float bayer[16] = float[](
  0.0, 8.0, 2.0, 10.0,
  12.0, 4.0, 14.0, 6.0,
  3.0, 11.0, 1.0, 9.0,
  15.0, 7.0, 13.0, 5.0
);
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float depth = max(2.0, u_depth);
  float step = 1.0 / (depth - 1.0);
  int bx = int(mod(floor(v_texCoord.x * u_resolution.x), 4.0));
  int by = int(mod(floor(v_texCoord.y * u_resolution.y), 4.0));
  float bayerVal = bayer[by * 4 + bx];
  float noise = (bayerVal / 16.0 - 0.5) * step;
  fragColor = vec4(clamp(floor((c.rgb + noise) / step + 0.5) * step, 0.0, 1.0), c.a);
}`,
    uniforms: { depth: "float" },
  },
  processor: (data, { width, height }, params) => {
    const depth = (params.depth as number) ?? 4;
    const step = 255 / (depth - 1);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const bayerVal = BAYER_MATRIX_4x4[y % 4][x % 4];
        const noise = (bayerVal / 16 - 0.5) * step;

        data[i] = clamp(Math.round((data[i] + noise) / step) * step, 0, 255);
        data[i + 1] = clamp(
          Math.round((data[i + 1] + noise) / step) * step,
          0,
          255
        );
        data[i + 2] = clamp(
          Math.round((data[i + 2] + noise) / step) * step,
          0,
          255
        );
      }
    }
  },
});
