import { registerEffect } from "../../effect-registry";
import { pseudoRandom, clamp } from "../shared";

registerEffect({
  type: "film-grain",
  label: "Film Grain",
  category: "noise",
  defaultParams: { intensity: 30 },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 100, default: 30 },
  ],
  glsl: {
    fragment: `
uniform float u_intensity;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float strength = u_intensity * 2.55 / 255.0;
  float seed = floor(u_time * 0.5);
  float n = (pseudoRandom(seed + hash2(v_texCoord * u_resolution) * 10000.0) - 0.5) * strength;
  fragColor = vec4(clamp(c.rgb + n, 0.0, 1.0), c.a);
}`,
    uniforms: { intensity: "float" },
  },
  processor: (data, { time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 30;
    if (intensity === 0) return;

    const strength = intensity * 2.55;
    const seed = Math.floor(time / 2);

    for (let i = 0; i < data.length; i += 4) {
      const noise = (pseudoRandom(seed + i) - 0.5) * strength;
      data[i] = clamp(data[i] + noise, 0, 255);
      data[i + 1] = clamp(data[i + 1] + noise, 0, 255);
      data[i + 2] = clamp(data[i + 2] + noise, 0, 255);
    }
  },
});
