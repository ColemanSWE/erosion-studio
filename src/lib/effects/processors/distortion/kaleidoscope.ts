import { registerEffect } from "../../effect-registry";
import { scratchCopy } from "../shared";

registerEffect({
  type: "kaleidoscope",
  label: "Kaleidoscope",
  category: "distortion",
  defaultParams: { segments: 6, angle: 0, animated: true },
  paramsConfig: [
    { key: "segments", label: "Segments", type: "slider", min: 2, max: 16, default: 6 },
    { key: "angle", label: "Angle", type: "slider", min: 0, max: 360, default: 0 },
    { key: "animated", label: "Animated", type: "checkbox", default: true },
  ],
  glsl: {
    fragment: `
uniform float u_segments;
uniform float u_angle;
uniform bool u_animated;
void main() {
  float rotation = u_animated ? u_time * 0.01 : u_angle;
  vec2 d = v_texCoord - 0.5;
  float dist = length(d);
  float theta = atan(d.y, d.x) + rotation;
  float segAngle = 6.2832 / u_segments;
  theta = mod(theta, segAngle);
  float sector = floor((atan(d.y, d.x) + rotation) / segAngle);
  if (mod(sector, 2.0) == 1.0) theta = segAngle - theta;
  vec2 srcUV = clamp(0.5 + vec2(cos(theta), sin(theta)) * dist, 0.0, 1.0);
  fragColor = texture(u_source, srcUV);
}`,
    uniforms: { segments: "float", angle: "float", animated: "bool" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const segments = (params.segments as number) ?? 6;
    const angle = (params.angle as number) ?? 0;
    const animated = (params.animated as boolean) !== false;

    const source = scratchCopy(data, "kaleidoscope/source");
    const centerX = width / 2;
    const centerY = height / 2;
    const rotation = animated ? time * 0.01 : angle;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - centerX;
        const dy = y - centerY;

        const dist = Math.sqrt(dx * dx + dy * dy);
        let theta = Math.atan2(dy, dx) + rotation;

        // Mirror across segments
        const segmentAngle = (Math.PI * 2) / segments;
        theta = theta % segmentAngle;
        if (Math.floor((Math.atan2(dy, dx) + rotation) / segmentAngle) % 2 === 1) {
          theta = segmentAngle - theta;
        }

        const srcX = Math.floor(centerX + Math.cos(theta) * dist);
        const srcY = Math.floor(centerY + Math.sin(theta) * dist);

        const i = (y * width + x) * 4;

        if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
          const si = (srcY * width + srcX) * 4;
          data[i] = source[si];
          data[i + 1] = source[si + 1];
          data[i + 2] = source[si + 2];
        }
      }
    }
  },
});
