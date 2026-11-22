import { registerEffect } from "../../effect-registry";
import { HISTORY_GLSL } from "../../gl/shaders";
import { frameHistoryStore, storeFrame } from "../shared";

registerEffect({
  type: "rgb-color-trails",
  label: "RGB Color Trails",
  category: "glitch",
  defaultParams: {
    rDecay: 0.95,
    gDecay: 0.9,
    bDecay: 0.85,
    maxFrames: 6,
  },
  paramsConfig: [
    { key: "rDecay", label: "Red Decay", type: "slider", min: 0.5, max: 0.99, step: 0.01, default: 0.95 },
    { key: "gDecay", label: "Green Decay", type: "slider", min: 0.5, max: 0.99, step: 0.01, default: 0.9 },
    { key: "bDecay", label: "Blue Decay", type: "slider", min: 0.5, max: 0.99, step: 0.01, default: 0.85 },
    { key: "maxFrames", label: "Max Frames", type: "slider", min: 2, max: 12, default: 6 },
  ],
  glsl: {
    historyFrames: (p) => (p.maxFrames as number) ?? 6,
    fragment: HISTORY_GLSL + `
uniform float u_rDecay;
uniform float u_gDecay;
uniform float u_bDecay;
uniform float u_maxFrames;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  int n = min(int(u_maxFrames), u_historyCount);
  vec3 acc = c.rgb;
  for (int f = 1; f < 16; f++) {
    if (f >= n) break;
    vec3 h = historyFrame(f).rgb;
    float ff = float(f);
    acc = max(acc, h * vec3(pow(u_rDecay, ff), pow(u_gDecay, ff), pow(u_bDecay, ff)));
  }
  fragColor = vec4(acc, c.a);
}`,
    uniforms: { rDecay: "float", gDecay: "float", bDecay: "float", maxFrames: "float" },
  },
  processor: (data, { width, height }, params) => {
    const rDecay = (params.rDecay as number) ?? 0.95;
    const gDecay = (params.gDecay as number) ?? 0.9;
    const bDecay = (params.bDecay as number) ?? 0.85;
    const maxFrames = (params.maxFrames as number) ?? 6;

    storeFrame(data, width, height);

    const numFrames = Math.min(maxFrames, frameHistoryStore.frames.length);
    if (numFrames === 0) return;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      for (let f = 1; f < numFrames; f++) {
        const frame = frameHistoryStore.frames[f];
        r = Math.max(r, frame[i] * Math.pow(rDecay, f));
        g = Math.max(g, frame[i + 1] * Math.pow(gDecay, f));
        b = Math.max(b, frame[i + 2] * Math.pow(bDecay, f));
      }

      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  },
});
