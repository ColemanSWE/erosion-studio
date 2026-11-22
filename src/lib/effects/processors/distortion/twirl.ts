import { registerEffect } from "../../effect-registry";
import { clamp, scratchCopy } from "../shared";

registerEffect({
  type: "twirl",
  label: "Twirl",
  category: "distortion",
  defaultParams: { angle: 0.5, radius: 0.5 },
  paramsConfig: [
    { key: "angle", label: "Angle", type: "slider", min: -6.28, max: 6.28, step: 0.01, default: 0.5 },
    { key: "radius", label: "Radius", type: "slider", min: 0.05, max: 1, step: 0.01, default: 0.5 },
  ],
  glsl: {
    fragment: `
uniform float u_angle;
uniform float u_radius;
void main() {
  vec2 d = v_texCoord - 0.5;
  // Correct for aspect ratio to make distance uniform
  float aspect = u_resolution.x / u_resolution.y;
  vec2 da = d * vec2(aspect, 1.0);
  float dist = length(da) / (0.5 * aspect); // normalized 0-1
  vec2 uv = v_texCoord;
  if (dist < u_radius) {
    float twist = u_angle * (1.0 - dist / u_radius);
    float a = atan(d.y, d.x) + twist;
    float r = length(d);
    uv = clamp(0.5 + vec2(cos(a), sin(a)) * r, 0.0, 1.0);
  }
  fragColor = texture(u_source, uv);
}`,
    uniforms: { angle: "float", radius: "float" },
  },
  processor: (data, { width, height }, params) => {
    const angle = (params.angle as number) ?? 0.5;
    const radius = (params.radius as number) ?? 0.5;

    const source = scratchCopy(data, "twirl/source");
    const cx = width / 2;
    const cy = height / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const normalizedDist = dist / maxDist;

        if (normalizedDist < radius) {
          const twist = angle * (1 - normalizedDist / radius);
          const a = Math.atan2(dy, dx) + twist;
          const srcX = clamp(Math.floor(cx + Math.cos(a) * dist), 0, width - 1);
          const srcY = clamp(
            Math.floor(cy + Math.sin(a) * dist),
            0,
            height - 1
          );

          const srcIdx = (srcY * width + srcX) * 4;
          data[i] = source[srcIdx];
          data[i + 1] = source[srcIdx + 1];
          data[i + 2] = source[srcIdx + 2];
        }
      }
    }
  },
});
