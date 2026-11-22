import { registerEffect } from "../../effect-registry";
import { rgbToHsl, hslToRgb } from "../shared";

registerEffect({
  type: "color-shift",
  label: "Color Shift",
  category: "color",
  defaultParams: { speed: 1 },
  paramsConfig: [
    { key: "speed", label: "Speed", type: "slider", min: 0, max: 10, step: 0.1, default: 1 },
  ],
  glsl: {
    fragment: `
uniform float u_speed;
void main() {
  float hueShift = mod(u_time * u_speed, 360.0);
  vec4 c = texture(u_source, v_texCoord);
  vec3 hsl = rgbToHsl(c.rgb);
  vec3 rgb = hslToRgb(mod(hsl.x + hueShift, 360.0), hsl.y, hsl.z);
  fragColor = vec4(rgb, c.a);
}`,
    uniforms: { speed: "float" },
  },
  processor: (data, { time = 0 }, params) => {
    const speed = (params.speed as number) ?? 1;
    const hueShift = (time * speed) % 360;

    for (let i = 0; i < data.length; i += 4) {
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      const [r, g, b] = hslToRgb((h + hueShift) % 360, s, l);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  },
});
