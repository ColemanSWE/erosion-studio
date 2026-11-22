import { registerEffect } from "../../effect-registry";
import { perlinNoise, clamp, scratchCopy } from "../shared";

registerEffect({
  type: "perlin-distort",
  label: "Perlin Distort",
  category: "distortion",
  defaultParams: { intensity: 50, scale: 0.01, speed: 1 },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 100, default: 50 },
    { key: "scale", label: "Scale", type: "slider", min: 0.001, max: 0.05, step: 0.001, default: 0.01 },
    { key: "speed", label: "Speed", type: "slider", min: 0, max: 5, step: 0.1, default: 1 },
  ],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_scale;
uniform float u_speed;
void main() {
  float t = u_time * u_speed;
  float amp = u_intensity * 0.5;
  vec2 p = v_texCoord * u_resolution;
  float noiseX = perlinNoise(vec2(p.x * u_scale + t, p.y * u_scale));
  float noiseY = perlinNoise(vec2(p.x * u_scale, p.y * u_scale + t));
  vec2 offset = vec2(noiseX, noiseY) * amp / u_resolution;
  fragColor = sampleClamped(v_texCoord + offset);
}`,
    uniforms: { intensity: "float", scale: "float", speed: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const scale = (params.scale as number) ?? 0.01;
    const speed = (params.speed as number) ?? 1;
    if (intensity === 0) return;

    const source = scratchCopy(data, "perlin-distort/source");
    const t = time * speed;
    const amp = intensity * 0.5;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = x * scale;
        const ny = y * scale;

        const noiseX = perlinNoise(nx + t, ny);
        const noiseY = perlinNoise(nx, ny + t);

        const offsetX = Math.floor(noiseX * amp);
        const offsetY = Math.floor(noiseY * amp);

        const srcX = clamp(x + offsetX, 0, width - 1);
        const srcY = clamp(y + offsetY, 0, height - 1);

        const srcIdx = (srcY * width + srcX) * 4;
        const dstIdx = (y * width + x) * 4;

        data[dstIdx] = source[srcIdx];
        data[dstIdx + 1] = source[srcIdx + 1];
        data[dstIdx + 2] = source[srcIdx + 2];
      }
    }
  },
});
