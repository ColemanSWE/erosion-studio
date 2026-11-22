import { registerEffect } from "../../effect-registry";
import { hslToRgb } from "../shared";

registerEffect({
  type: "rainbow-gradient",
  label: "Rainbow Gradient",
  category: "color",
  defaultParams: { speed: 1, intensity: 0.5, direction: "horizontal" },
  paramsConfig: [
    { key: "speed", label: "Speed", type: "slider", min: 0, max: 5, step: 0.1, default: 1 },
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "direction", label: "Direction", type: "select", options: ["horizontal", "vertical", "diagonal", "radial"], default: "horizontal" },
  ],
  glsl: {
    fragment: `
uniform float u_speed;
uniform float u_intensity;
uniform int u_direction;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float t = u_time * u_speed * 0.01;
  float pos;
  if (u_direction == 0)      pos = v_texCoord.x;
  else if (u_direction == 1) pos = v_texCoord.y;
  else if (u_direction == 2) pos = (v_texCoord.x + v_texCoord.y) * 0.5;
  else {
    vec2 d = v_texCoord - 0.5;
    pos = length(d) / 0.7071;
  }
  float hue = mod(pos + t, 1.0) * 360.0;
  vec3 rainbow = hslToRgb(hue, 1.0, 0.5);
  fragColor = vec4(mix(c.rgb, rainbow, u_intensity), c.a);
}`,
    uniforms: { speed: "float", intensity: "float", direction: "int" },
    uniformMapper: (p) => ({
      ...p,
      direction: ["horizontal", "vertical", "diagonal", "radial"].indexOf((p.direction as string) || "horizontal"),
    }),
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const speed = (params.speed as number) ?? 1;
    const intensity = (params.intensity as number) ?? 0.5;
    const direction = (params.direction as string) ?? "horizontal";

    const t = time * speed * 0.01;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        let position: number;
        if (direction === "horizontal") {
          position = x / width;
        } else if (direction === "vertical") {
          position = y / height;
        } else if (direction === "diagonal") {
          position = (x / width + y / height) / 2;
        } else {
          // radial
          const centerX = width / 2;
          const centerY = height / 2;
          const dx = x - centerX;
          const dy = y - centerY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);
          position = dist / maxDist;
        }

        // Create rainbow gradient with time animation
        const hue = ((position + t) % 1.0) * 360;
        const [r, g, b] = hslToRgb(hue / 360, 1.0, 0.5);

        // Blend with original
        data[i] = data[i] * (1 - intensity) + r * intensity;
        data[i + 1] = data[i + 1] * (1 - intensity) + g * intensity;
        data[i + 2] = data[i + 2] * (1 - intensity) + b * intensity;
      }
    }
  },
});
