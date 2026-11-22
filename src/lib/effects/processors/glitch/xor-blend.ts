import { registerEffect } from "../../effect-registry";
import { HISTORY_GLSL } from "../../gl/shaders";
import { storeFrame, getFrameFromHistory } from "../shared";

registerEffect({
  type: "xor-blend",
  label: "XOR Blend",
  category: "glitch",
  defaultParams: {
    intensity: 0.5,
    frameHistory: 1,
  },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "frameHistory", label: "Frame Delay", type: "slider", min: 1, max: 8, default: 1 },
  ],
  glsl: {
    historyFrames: (p) => ((p.frameHistory as number) ?? 1) + 1,
    fragment: HISTORY_GLSL + `
uniform float u_intensity;
uniform float u_frameHistory;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  int age = int(u_frameHistory);
  if (age >= u_historyCount) { fragColor = c; return; }
  ivec3 a = ivec3(round(c.rgb * 255.0));
  ivec3 b = ivec3(round(historyFrame(age).rgb * 255.0));
  vec3 x = vec3(a ^ b) / 255.0;
  fragColor = vec4(mix(c.rgb, x, u_intensity), c.a);
}`,
    uniforms: { intensity: "float", frameHistory: "float" },
  },
  processor: (data, { width, height }, params) => {
    const intensity = (params.intensity as number) ?? 0.5;
    const frameHistory = (params.frameHistory as number) ?? 1;

    storeFrame(data, width, height);
    const prevFrame = getFrameFromHistory(frameHistory);

    if (!prevFrame) return;

    for (let i = 0; i < data.length; i += 4) {
      const xorR = data[i] ^ prevFrame[i];
      const xorG = data[i + 1] ^ prevFrame[i + 1];
      const xorB = data[i + 2] ^ prevFrame[i + 2];

      data[i] = data[i] * (1 - intensity) + xorR * intensity;
      data[i + 1] = data[i + 1] * (1 - intensity) + xorG * intensity;
      data[i + 2] = data[i + 2] * (1 - intensity) + xorB * intensity;
    }
  },
});
