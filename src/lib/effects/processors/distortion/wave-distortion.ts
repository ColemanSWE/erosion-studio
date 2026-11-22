import { registerEffect } from "../../effect-registry";
import { clamp, scratchCopy } from "../shared";

registerEffect({
  type: "wave-distortion",
  label: "Wave",
  category: "distortion",
  defaultParams: { amplitude: 10, frequency: 0.1, direction: "horizontal", animated: true },
  paramsConfig: [
    { key: "amplitude", label: "Amplitude", type: "slider", min: 0, max: 60, default: 10 },
    { key: "frequency", label: "Frequency", type: "slider", min: 0.01, max: 0.5, step: 0.01, default: 0.1 },
    { key: "direction", label: "Direction", type: "select", options: ["horizontal", "vertical"], default: "horizontal" },
    { key: "animated", label: "Animated", type: "checkbox", default: true },
  ],
  glsl: {
    fragment: `
uniform float u_amplitude;
uniform float u_frequency;
uniform int u_direction;
uniform bool u_animated;
void main() {
  float phase = u_animated ? u_time * 0.1 : 0.0;
  vec2 uv = v_texCoord;
  if (u_direction == 0) { // horizontal
    float shift = sin(uv.y * u_resolution.y * u_frequency + phase) * u_amplitude / u_resolution.x;
    uv.x += shift;
  } else { // vertical
    float shift = sin(uv.x * u_resolution.x * u_frequency + phase) * u_amplitude / u_resolution.y;
    uv.y += shift;
  }
  fragColor = sampleClamped(uv);
}`,
    uniforms: { amplitude: "float", frequency: "float", direction: "int", animated: "bool" },
    uniformMapper: (p) => ({
      ...p,
      direction: (p.direction as string) === "horizontal" ? 0 : 1,
    }),
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const amplitude = (params.amplitude as number) ?? 10;
    const frequency = (params.frequency as number) ?? 0.1;
    const direction = (params.direction as string) ?? "horizontal";
    const animated = (params.animated as boolean) ?? true;

    const source = scratchCopy(data, "wave-distortion/source");
    const phase = animated ? time * 0.1 : 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        let srcX = x,
          srcY = y;

        if (direction === "horizontal") {
          srcX = Math.floor(x + Math.sin(y * frequency + phase) * amplitude);
        } else {
          srcY = Math.floor(y + Math.sin(x * frequency + phase) * amplitude);
        }

        srcX = clamp(srcX, 0, width - 1);
        srcY = clamp(srcY, 0, height - 1);

        const srcIdx = (srcY * width + srcX) * 4;
        data[i] = source[srcIdx];
        data[i + 1] = source[srcIdx + 1];
        data[i + 2] = source[srcIdx + 2];
      }
    }
  },
});
