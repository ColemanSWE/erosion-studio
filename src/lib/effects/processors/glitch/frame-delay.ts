import { registerEffect } from "../../effect-registry";
import { HISTORY_GLSL } from "../../gl/shaders";
import { storeFrame, getFrameFromHistory } from "../shared";

registerEffect({
  type: "frame-delay",
  label: "Frame Delay",
  category: "glitch",
  defaultParams: {
    delay: 5,
    blendMode: "replace",
  },
  paramsConfig: [
    { key: "delay", label: "Delay", type: "slider", min: 1, max: 16, default: 5 },
    { key: "blendMode", label: "Blend Mode", type: "select", options: ["replace", "blend", "xor"], default: "replace" },
  ],
  glsl: {
    historyFrames: (p) => ((p.delay as number) ?? 5) + 1,
    fragment: HISTORY_GLSL + `
uniform float u_delay;
uniform int u_blendMode;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  int age = int(u_delay);
  if (age >= u_historyCount) { fragColor = c; return; }
  vec4 d = historyFrame(age);
  if (u_blendMode == 0) {
    fragColor = d;
  } else if (u_blendMode == 1) {
    fragColor = vec4((c.rgb + d.rgb) * 0.5, c.a);
  } else {
    ivec3 x = ivec3(round(c.rgb * 255.0)) ^ ivec3(round(d.rgb * 255.0));
    fragColor = vec4(vec3(x) / 255.0, c.a);
  }
}`,
    uniforms: { delay: "float", blendMode: "int" },
    uniformMapper: (p) => ({
      ...p,
      blendMode: p.blendMode === "replace" ? 0 : p.blendMode === "blend" ? 1 : 2,
    }),
  },
  processor: (data, { width, height }, params) => {
    const delay = (params.delay as number) ?? 5;
    const blendMode = (params.blendMode as string) ?? "replace";

    storeFrame(data, width, height);
    const delayedFrame = getFrameFromHistory(delay);

    if (!delayedFrame) return;

    if (blendMode === "replace") {
      data.set(delayedFrame);
    } else if (blendMode === "blend") {
      for (let i = 0; i < data.length; i += 4) {
        data[i] = (data[i] + delayedFrame[i]) / 2;
        data[i + 1] = (data[i + 1] + delayedFrame[i + 1]) / 2;
        data[i + 2] = (data[i + 2] + delayedFrame[i + 2]) / 2;
      }
    } else {
      // xor
      for (let i = 0; i < data.length; i += 4) {
        data[i] = data[i] ^ delayedFrame[i];
        data[i + 1] = data[i + 1] ^ delayedFrame[i + 1];
        data[i + 2] = data[i + 2] ^ delayedFrame[i + 2];
      }
    }
  },
});
