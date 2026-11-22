import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "vignette",
  label: "Vignette",
  category: "color",
  defaultParams: { intensity: 0.5, radius: 0.8 },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "radius", label: "Radius", type: "slider", min: 0.1, max: 1.5, step: 0.01, default: 0.8 },
  ],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_radius;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  vec2 uv = v_texCoord - 0.5;
  float dist = length(uv) / 0.7071; // normalize by max corner distance
  float normalizedDist = dist / u_radius;
  float factor = 1.0 - pow(min(normalizedDist, 1.0), 2.0) * u_intensity;
  fragColor = vec4(max(c.rgb * factor, 0.0), c.a);
}`,
    uniforms: { intensity: "float", radius: "float" },
  },
  processor: (data, { width, height }, params) => {
    const intensity = (params.intensity as number) ?? 0.5;
    const radius = (params.radius as number) ?? 0.8;

    const cx = width / 2;
    const cy = height / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const normalizedDist = dist / maxDist / radius;
        const factor = 1 - Math.pow(Math.min(normalizedDist, 1), 2) * intensity;

        const i = (y * width + x) * 4;
        data[i] = Math.max(0, data[i] * factor);
        data[i + 1] = Math.max(0, data[i + 1] * factor);
        data[i + 2] = Math.max(0, data[i + 2] * factor);
      }
    }
  },
});
