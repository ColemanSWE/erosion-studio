import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "solarize",
  label: "Solarize",
  category: "color",
  defaultParams: { threshold: 128 },
  paramsConfig: [
    { key: "threshold", label: "Threshold", type: "slider", min: 0, max: 255, default: 128 },
  ],
  glsl: {
    fragment: `
uniform float u_intensity;
void main() {
  float intensity = u_intensity;
  // default intensity param is unused in cpu code (uses intensity directly, not threshold param)
  float thresh = (255.0 - intensity * 2.55) / 255.0;
  vec4 c = texture(u_source, v_texCoord);
  vec3 sol = mix(c.rgb, 1.0 - c.rgb, step(thresh, c.rgb));
  fragColor = vec4(sol, c.a);
}`,
    uniforms: { intensity: "float" },
    uniformMapper: (p) => ({
      ...p,
      intensity: (p.intensity as number) ?? 50,
    }),
  },
  processor: (data, config, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const threshold = 255 - (intensity * 2.55);

    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > threshold) data[i] = 255 - data[i];
      if (data[i + 1] > threshold) data[i + 1] = 255 - data[i + 1];
      if (data[i + 2] > threshold) data[i + 2] = 255 - data[i + 2];
    }
  },
});
