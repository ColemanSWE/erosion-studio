import { registerEffect } from "../../effect-registry";
import { clamp } from "../shared";

registerEffect({
  type: "scan-sweep",
  label: "Scan Sweep",
  category: "retro",
  defaultParams: { speed: 2, count: 3, thickness: 2, direction: "vertical" },
  paramsConfig: [
    { key: "speed", label: "Speed", type: "slider", min: 0, max: 10, step: 0.1, default: 2 },
    { key: "count", label: "Count", type: "slider", min: 1, max: 10, default: 3 },
    { key: "thickness", label: "Thickness", type: "slider", min: 1, max: 20, default: 2 },
    { key: "direction", label: "Direction", type: "select", options: ["vertical", "horizontal"], default: "vertical" },
  ],
  glsl: {
    fragment: `
uniform float u_speed;
uniform float u_count;
uniform float u_thickness;
uniform int u_direction;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float dim = u_direction == 0 ? u_resolution.x : u_resolution.y;
  float coord = u_direction == 0 ? v_texCoord.x * dim : v_texCoord.y * dim;
  float addBright = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= u_count) break;
    float offset = (float(i) / u_count) * dim;
    float pos = mod(u_time * u_speed * 100.0 + offset, dim);
    for (int t = 0; t < 8; t++) {
      if (float(t) >= u_thickness) break;
      float scanPos = mod(pos + float(t), dim);
      float falloff = 1.0 - (float(t) / u_thickness) * 0.5;
      if (abs(coord - scanPos) < 0.5) addBright += 100.0 / 255.0 * falloff;
    }
  }
  fragColor = vec4(clamp(c.rgb + addBright, 0.0, 1.0), c.a);
}`,
    uniforms: { speed: "float", count: "float", thickness: "float", direction: "int" },
    uniformMapper: (p) => ({
      ...p,
      direction: (p.direction as string) === "vertical" ? 0 : 1,
    }),
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const speed = (params.speed as number) ?? 2;
    const count = (params.count as number) ?? 3;
    const thickness = (params.thickness as number) ?? 2;
    const direction = (params.direction as string) ?? "vertical";

    const isVertical = direction === "vertical";
    const dimension = isVertical ? width : height;

    for (let i = 0; i < count; i++) {
      const offset = (i / count) * dimension;
      const position = (time * speed * 100 + offset) % dimension;

      for (let t = 0; t < thickness; t++) {
        const scanPos = Math.floor(position + t) % dimension;
        const falloff = 1 - (t / thickness) * 0.5;

        if (isVertical) {
          for (let y = 0; y < height; y++) {
            const idx = (y * width + scanPos) * 4;
            data[idx] = clamp(data[idx] + 100 * falloff, 0, 255);
            data[idx + 1] = clamp(data[idx + 1] + 100 * falloff, 0, 255);
            data[idx + 2] = clamp(data[idx + 2] + 100 * falloff, 0, 255);
          }
        } else {
          for (let x = 0; x < width; x++) {
            const idx = (scanPos * width + x) * 4;
            data[idx] = clamp(data[idx] + 100 * falloff, 0, 255);
            data[idx + 1] = clamp(data[idx + 1] + 100 * falloff, 0, 255);
            data[idx + 2] = clamp(data[idx + 2] + 100 * falloff, 0, 255);
          }
        }
      }
    }

    if (Math.random() < 0.05) {
      const glitchPos = Math.floor(Math.random() * dimension);
      const glitchSize = Math.floor(2 + Math.random() * 5);

      for (let t = 0; t < glitchSize; t++) {
        const pos = (glitchPos + t) % dimension;

        if (isVertical) {
          for (let y = 0; y < height; y++) {
            const idx = (y * width + pos) * 4;
            data[idx] = 255;
            data[idx + 1] = 255;
            data[idx + 2] = 255;
          }
        } else {
          for (let x = 0; x < width; x++) {
            const idx = (pos * width + x) * 4;
            data[idx] = 255;
            data[idx + 1] = 255;
            data[idx + 2] = 255;
          }
        }
      }
    }
  },
});
