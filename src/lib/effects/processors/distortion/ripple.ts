import { registerEffect } from "../../effect-registry";
import { clamp, scratchCopy } from "../shared";

registerEffect({
  type: "ripple",
  label: "Ripple",
  category: "distortion",
  defaultParams: { amplitude: 20, frequency: 0.05, centerX: 0.5, centerY: 0.5 },
  paramsConfig: [
    { key: "amplitude", label: "Amplitude", type: "slider", min: 0, max: 60, default: 20 },
    { key: "frequency", label: "Frequency", type: "slider", min: 0.005, max: 0.2, step: 0.005, default: 0.05 },
    { key: "centerX", label: "Center X", type: "slider", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "centerY", label: "Center Y", type: "slider", min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  glsl: {
    fragment: `
uniform float u_amplitude;
uniform float u_frequency;
uniform float u_centerX;
uniform float u_centerY;
void main() {
  vec2 center = vec2(u_centerX, u_centerY);
  vec2 d = v_texCoord - center;
  // Scale d by resolution to get pixel distances
  vec2 dp = d * u_resolution;
  float dist = length(dp);
  float ripple = sin(dist * u_frequency - u_time * 0.1) * u_amplitude;
  float angle = atan(dp.y, dp.x);
  vec2 offset = vec2(cos(angle), sin(angle)) * ripple / u_resolution;
  fragColor = sampleClamped(v_texCoord + offset);
}`,
    uniforms: { amplitude: "float", frequency: "float", centerX: "float", centerY: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const amplitude = (params.amplitude as number) ?? 20;
    const frequency = (params.frequency as number) ?? 0.05;
    const centerX = (params.centerX as number) ?? 0.5;
    const centerY = (params.centerY as number) ?? 0.5;

    const source = scratchCopy(data, "ripple/source");
    const cx = centerX * width;
    const cy = centerY * height;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ripple = Math.sin(dist * frequency - time * 0.1) * amplitude;

        const angle = Math.atan2(dy, dx);
        const srcX = clamp(
          Math.floor(x + Math.cos(angle) * ripple),
          0,
          width - 1
        );
        const srcY = clamp(
          Math.floor(y + Math.sin(angle) * ripple),
          0,
          height - 1
        );

        const srcIdx = (srcY * width + srcX) * 4;
        data[i] = source[srcIdx];
        data[i + 1] = source[srcIdx + 1];
        data[i + 2] = source[srcIdx + 2];
      }
    }
  },
});
