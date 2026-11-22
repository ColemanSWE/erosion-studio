import { registerEffect } from "../../effect-registry";
import { HISTORY_GLSL } from "../../gl/shaders";
import { storeFrame, getFrameFromHistory } from "../shared";

registerEffect({
  type: "feedback-echo",
  label: "Feedback Echo",
  category: "glitch",
  defaultParams: {
    delay: 2,
    feedback: 0.8,
    scale: 0.95,
  },
  paramsConfig: [
    { key: "delay", label: "Delay", type: "slider", min: 1, max: 10, default: 2 },
    { key: "feedback", label: "Feedback", type: "slider", min: 0, max: 0.95, step: 0.01, default: 0.8 },
    { key: "scale", label: "Scale", type: "slider", min: 0.8, max: 1, step: 0.01, default: 0.95 },
  ],
  glsl: {
    historyFrames: (p) => ((p.delay as number) ?? 2) + 1,
    fragment: HISTORY_GLSL + `
uniform float u_delay;
uniform float u_feedback;
uniform float u_scale;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  int age = int(u_delay);
  if (age >= u_historyCount) { fragColor = c; return; }
  // Sample the delayed frame scaled about the centre (matches the CPU path).
  vec2 res = u_resolution;
  vec2 scaled = floor(res * u_scale);
  vec2 offset = floor((res - scaled) * 0.5);
  vec2 p = floor(v_texCoord * res);
  vec2 s = floor((p - offset) * (res / scaled));
  if (any(lessThan(s, vec2(0.0))) || any(greaterThanEqual(s, res))) { fragColor = c; return; }
  vec3 prev = historyFrameAt(age, (s + 0.5) / res).rgb;
  fragColor = vec4(min(mix(c.rgb, prev, u_feedback), 1.0), c.a);
}`,
    uniforms: { delay: "float", feedback: "float", scale: "float" },
  },
  processor: (data, { width, height }, params) => {
    const delay = (params.delay as number) ?? 2;
    const feedback = (params.feedback as number) ?? 0.8;
    const scale = (params.scale as number) ?? 0.95;

    storeFrame(data, width, height);
    const prevFrame = getFrameFromHistory(delay);

    if (!prevFrame) return;

    const scaledW = Math.floor(width * scale);
    const scaledH = Math.floor(height * scale);
    const offsetX = Math.floor((width - scaledW) / 2);
    const offsetY = Math.floor((height - scaledH) / 2);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        // Sample from scaled previous frame
        const sx = Math.floor((x - offsetX) * (width / scaledW));
        const sy = Math.floor((y - offsetY) * (height / scaledH));

        if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
          const si = (sy * width + sx) * 4;

          data[i] = Math.min(
            255,
            data[i] * (1 - feedback) + prevFrame[si] * feedback,
          );
          data[i + 1] = Math.min(
            255,
            data[i + 1] * (1 - feedback) + prevFrame[si + 1] * feedback,
          );
          data[i + 2] = Math.min(
            255,
            data[i + 2] * (1 - feedback) + prevFrame[si + 2] * feedback,
          );
        }
      }
    }
  },
});
