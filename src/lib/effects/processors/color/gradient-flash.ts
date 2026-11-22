import { registerEffect } from "../../effect-registry";
import { hslToRgb } from "../shared";

registerEffect({
  type: "gradient-flash",
  label: "Gradient Flash",
  category: "color",
  defaultParams: { speed: 2, intensity: 0.7, flashRate: 4 },
  paramsConfig: [
    { key: "speed", label: "Speed", type: "slider", min: 0, max: 5, step: 0.1, default: 2 },
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 1, step: 0.01, default: 0.7 },
    { key: "flashRate", label: "Flash Rate", type: "slider", min: 1, max: 20, default: 4 },
  ],
  glsl: {
    fragment: `
uniform float u_speed;
uniform float u_intensity;
uniform float u_flashRate;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float t = u_time * u_speed * 0.02;
  float flash = abs(sin(t * u_flashRate));
  float pos = (v_texCoord.x + v_texCoord.y) * 0.5;
  float hue = mod(pos + t, 1.0) * 360.0;
  vec3 rainbow = hslToRgb(hue, 1.0, 0.5);
  float fi = u_intensity * flash;
  fragColor = vec4(mix(c.rgb, rainbow, fi), c.a);
}`,
    uniforms: { speed: "float", intensity: "float", flashRate: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const speed = (params.speed as number) ?? 2;
    const intensity = (params.intensity as number) ?? 0.7;
    const flashRate = (params.flashRate as number) ?? 4;

    const t = time * speed * 0.02;
    const flash = Math.abs(Math.sin(t * flashRate));

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        const position = (x / width + y / height) / 2;
        const hue = ((position + t) % 1.0) * 360;
        const [r, g, b] = hslToRgb(hue / 360, 1.0, 0.5);

        const flashIntensity = intensity * flash;

        data[i] = data[i] * (1 - flashIntensity) + r * flashIntensity;
        data[i + 1] = data[i + 1] * (1 - flashIntensity) + g * flashIntensity;
        data[i + 2] = data[i + 2] * (1 - flashIntensity) + b * flashIntensity;
      }
    }
  },
});
