import { registerEffect } from "../../effect-registry";
import { clamp, scratchCopy } from "../shared";

registerEffect({
  type: "heavy-distortion",
  label: "Heavy Distortion",
  category: "distortion",
  defaultParams: { intensity: 50, frequency: 0.15, speed: 2 },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 100, default: 50 },
    { key: "frequency", label: "Frequency", type: "slider", min: 0.01, max: 0.5, step: 0.01, default: 0.15 },
    { key: "speed", label: "Speed", type: "slider", min: 0, max: 10, step: 0.1, default: 2 },
  ],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_frequency;
uniform float u_speed;
void main() {
  float t = u_time * u_speed;
  float nx = v_texCoord.x;
  float ny = v_texCoord.y;
  float wave1 = sin(ny * u_resolution.y * u_frequency + t) * u_intensity * 0.8 / u_resolution.x;
  float wave2 = cos(nx * u_resolution.x * u_frequency * 0.7 + t * 1.3) * u_intensity * 0.4 / u_resolution.y;
  float wave3 = sin((nx + ny) * u_resolution.x * u_frequency * 0.3 + t * 0.7) * u_intensity * 0.3 / u_resolution.x;
  float turbX = sin(nx * 20.0 + t) * cos(ny * 15.0 + t * 1.2) * u_intensity * 0.5 / u_resolution.x;
  float offsetX = wave1 + wave3 + turbX;
  float offsetY = wave2 + sin(nx * u_resolution.x * 0.05 + t) * u_intensity * 0.2 / u_resolution.y;
  fragColor = sampleClamped(v_texCoord + vec2(offsetX, offsetY));
}`,
    uniforms: { intensity: "float", frequency: "float", speed: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const frequency = (params.frequency as number) ?? 0.15;
    const speed = (params.speed as number) ?? 2;
    if (intensity === 0) return;

    const source = scratchCopy(data, "heavy-distortion/source");
    const t = time * speed;
    const chaos = Math.random() * 50 * (intensity / 100);

    for (let y = 0; y < height; y++) {
      const rowChaos = Math.random() < intensity / 200;
      const rowJitter = rowChaos ? (Math.random() - 0.5) * 100 : 0;

      for (let x = 0; x < width; x++) {
        const nx = x / width;
        const ny = y / height;

        const wave1 = Math.sin(y * frequency + t + chaos) * intensity * 0.8;
        const wave2 = Math.cos(x * frequency * 0.7 + t * 1.3) * intensity * 0.4;
        const wave3 =
          Math.sin((x + y) * frequency * 0.3 + t * 0.7) * intensity * 0.3;
        const turbulence =
          Math.sin(nx * 20 + t) * Math.cos(ny * 15 + t * 1.2) * intensity * 0.5;

        let offsetX = wave1 + wave3 + turbulence + rowJitter;
        let offsetY = wave2 + Math.sin(x * 0.05 + t) * intensity * 0.2;

        if (Math.random() < intensity / 500) {
          offsetX += (Math.random() - 0.5) * width * 0.3;
          offsetY += (Math.random() - 0.5) * height * 0.1;
        }

        const srcX = clamp(Math.round(x + offsetX), 0, width - 1);
        const srcY = clamp(Math.round(y + offsetY), 0, height - 1);
        const srcIdx = (srcY * width + srcX) * 4;
        const dstIdx = (y * width + x) * 4;

        if (Math.random() < intensity / 300) {
          const rSrcX = clamp(
            srcX + Math.floor((Math.random() - 0.5) * 20),
            0,
            width - 1
          );
          const gSrcX = clamp(
            srcX + Math.floor((Math.random() - 0.5) * 20),
            0,
            width - 1
          );
          const bSrcX = clamp(
            srcX + Math.floor((Math.random() - 0.5) * 20),
            0,
            width - 1
          );
          data[dstIdx] = source[(srcY * width + rSrcX) * 4];
          data[dstIdx + 1] = source[(srcY * width + gSrcX) * 4 + 1];
          data[dstIdx + 2] = source[(srcY * width + bSrcX) * 4 + 2];
        } else {
          data[dstIdx] = source[srcIdx];
          data[dstIdx + 1] = source[srcIdx + 1];
          data[dstIdx + 2] = source[srcIdx + 2];
        }
      }
    }
  },
});
