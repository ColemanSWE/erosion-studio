import { registerEffect } from "../../effect-registry";
import { HISTORY_GLSL } from "../../gl/shaders";
import { frameHistoryStore, storeFrame } from "../shared";

registerEffect({
  type: "alpha-trails",
  label: "Alpha Trails",
  category: "glitch",
  defaultParams: {
    alpha: 0.3,
    maxFrames: 10,
  },
  paramsConfig: [
    { key: "alpha", label: "Alpha", type: "slider", min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: "maxFrames", label: "Max Frames", type: "slider", min: 2, max: 16, default: 10 },
  ],
  glsl: {
    historyFrames: (p) => (p.maxFrames as number) ?? 10,
    fragment: HISTORY_GLSL + `
uniform float u_alpha;
uniform float u_maxFrames;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  int n = min(int(u_maxFrames), u_historyCount);
  vec3 acc = c.rgb;
  for (int f = 1; f < 16; f++) {
    if (f >= n) break;
    float a = u_alpha * pow(0.8, float(f));
    acc = mix(acc, historyFrame(f).rgb, a);
  }
  fragColor = vec4(acc, c.a);
}`,
    uniforms: { alpha: "float", maxFrames: "float" },
  },
  processor: (data, { width, height }, params) => {
    const alpha = (params.alpha as number) ?? 0.3;
    const maxFrames = (params.maxFrames as number) ?? 10;

    storeFrame(data, width, height);

    const numFrames = Math.min(maxFrames, frameHistoryStore.frames.length);
    if (numFrames === 0) return;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      for (let f = 1; f < numFrames; f++) {
        const frame = frameHistoryStore.frames[f];
        const frameAlpha = alpha * Math.pow(0.8, f);

        r = r * (1 - frameAlpha) + frame[i] * frameAlpha;
        g = g * (1 - frameAlpha) + frame[i + 1] * frameAlpha;
        b = b * (1 - frameAlpha) + frame[i + 2] * frameAlpha;
      }

      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  },
});
