import { registerEffect } from "../../effect-registry";
import { HISTORY_GLSL } from "../../gl/shaders";
import { frameHistoryStore, storeFrame } from "../shared";

registerEffect({
  type: "frame-trails",
  label: "Frame Trails",
  category: "glitch",
  defaultParams: {
    intensity: 0.7,
    decay: 0.9,
    maxFrames: 8,
  },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 1, step: 0.01, default: 0.7 },
    { key: "decay", label: "Decay", type: "slider", min: 0.5, max: 0.99, step: 0.01, default: 0.9 },
    { key: "maxFrames", label: "Max Frames", type: "slider", min: 2, max: 16, default: 8 },
  ],
  glsl: {
    historyFrames: (p) => (p.maxFrames as number) ?? 8,
    fragment: HISTORY_GLSL + `
uniform float u_intensity;
uniform float u_decay;
uniform float u_maxFrames;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  int n = min(int(u_maxFrames), u_historyCount);
  vec3 acc = c.rgb * (1.0 - u_intensity);
  for (int f = 0; f < 16; f++) {
    if (f >= n) break;
    acc += historyFrame(f).rgb * u_intensity * pow(u_decay, float(f));
  }
  fragColor = vec4(min(acc, 1.0), c.a);
}`,
    uniforms: { intensity: "float", decay: "float", maxFrames: "float" },
  },
  processor: (data, { width, height }, params) => {
    const intensity = (params.intensity as number) ?? 0.7;
    const decay = (params.decay as number) ?? 0.9;
    const maxFrames = (params.maxFrames as number) ?? 8;

    storeFrame(data, width, height);

    const numFrames = Math.min(maxFrames, frameHistoryStore.frames.length);
    if (numFrames === 0) return;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i] * (1 - intensity);
      let g = data[i + 1] * (1 - intensity);
      let b = data[i + 2] * (1 - intensity);

      const weight = intensity;
      for (let f = 0; f < numFrames; f++) {
        const frame = frameHistoryStore.frames[f];
        const frameWeight = weight * Math.pow(decay, f);

        r += frame[i] * frameWeight;
        g += frame[i + 1] * frameWeight;
        b += frame[i + 2] * frameWeight;
      }

      data[i] = Math.min(255, r);
      data[i + 1] = Math.min(255, g);
      data[i + 2] = Math.min(255, b);
    }
  },
});
