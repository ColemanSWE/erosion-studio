import { registerEffect } from "../../effect-registry";
import { scratchCopy } from "../shared";

registerEffect({
  type: "mirror-blend",
  label: "Mirror Blend",
  category: "distortion",
  defaultParams: { mode: "quadrant", blendAmount: 0.5 },
  paramsConfig: [
    { key: "mode", label: "Mode", type: "select", options: ["quadrant", "cross"], default: "quadrant" },
    { key: "blendAmount", label: "Blend Amount", type: "slider", min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  glsl: {
    fragment: `
uniform int u_mode;
uniform float u_blendAmount;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  vec2 uv = v_texCoord;
  if (u_mode == 0) { // quadrant
    vec2 q = vec2(uv.x < 0.5 ? uv.x : 1.0 - uv.x, uv.y < 0.5 ? uv.y : 1.0 - uv.y);
    vec4 mirror = texture(u_source, q);
    fragColor = vec4(mix(c.rgb, mirror.rgb, u_blendAmount), c.a);
  } else {
    vec4 miH = texture(u_source, vec2(1.0 - uv.x, uv.y));
    vec4 miV = texture(u_source, vec2(uv.x, 1.0 - uv.y));
    vec3 avg = (miH.rgb + miV.rgb) * 0.5;
    fragColor = vec4(mix(c.rgb, avg, u_blendAmount), c.a);
  }
}`,
    uniforms: { mode: "int", blendAmount: "float" },
    uniformMapper: (p) => ({
      ...p,
      mode: (p.mode as string) === "quadrant" ? 0 : 1,
    }),
  },
  processor: (data, { width, height }, params) => {
    const mode = (params.mode as string) ?? "quadrant";
    const blendAmount = (params.blendAmount as number) ?? 0.5;

    const source = scratchCopy(data, "mirror-blend/source");

    if (mode === "quadrant") {
      // Mirror into 4 quadrants
      const halfW = Math.floor(width / 2);
      const halfH = Math.floor(height / 2);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;

          const qx = x < halfW ? x : width - 1 - x;
          const qy = y < halfH ? y : height - 1 - y;
          const qi = (qy * width + qx) * 4;

          data[i] = data[i] * (1 - blendAmount) + source[qi] * blendAmount;
          data[i + 1] = data[i + 1] * (1 - blendAmount) + source[qi + 1] * blendAmount;
          data[i + 2] = data[i + 2] * (1 - blendAmount) + source[qi + 2] * blendAmount;
        }
      }
    } else {
      // horizontal and vertical blend
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;

          const mirrorX = width - 1 - x;
          const mirrorY = height - 1 - y;
          const miH = (y * width + mirrorX) * 4;
          const miV = (mirrorY * width + x) * 4;

          data[i] = data[i] * (1 - blendAmount) + (source[miH] + source[miV]) * 0.5 * blendAmount;
          data[i + 1] = data[i + 1] * (1 - blendAmount) + (source[miH + 1] + source[miV + 1]) * 0.5 * blendAmount;
          data[i + 2] = data[i + 2] * (1 - blendAmount) + (source[miH + 2] + source[miV + 2]) * 0.5 * blendAmount;
        }
      }
    }
  },
});
