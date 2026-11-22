import { registerEffect } from "../../effect-registry";
import { clamp, scratchCopy } from "../shared";

registerEffect({
  type: "mirror",
  label: "Mirror",
  category: "distortion",
  defaultParams: { mode: "horizontal" },
  paramsConfig: [
    { key: "mode", label: "Mode", type: "select", options: ["horizontal", "vertical", "quad", "kaleidoscope"], default: "horizontal" },
  ],
  glsl: {
    fragment: `
uniform int u_mode;
void main() {
  vec2 uv = v_texCoord;
  if (u_mode == 0) { // horizontal
    if (uv.x >= 0.5) uv.x = 1.0 - uv.x;
  } else if (u_mode == 1) { // vertical
    if (uv.y >= 0.5) uv.y = 1.0 - uv.y;
  } else if (u_mode == 2) { // quad
    if (uv.x >= 0.5) uv.x = 1.0 - uv.x;
    if (uv.y >= 0.5) uv.y = 1.0 - uv.y;
  } else { // kaleidoscope
    vec2 d = uv - 0.5;
    float dist = length(d);
    float angle = atan(d.y, d.x);
    float segAngle = 6.2832 / 6.0;
    angle = mod(angle, segAngle);
    float sector = floor((atan(d.y, d.x)) / segAngle);
    if (mod(sector, 2.0) == 1.0) angle = segAngle - angle;
    uv = clamp(0.5 + vec2(cos(angle), sin(angle)) * dist, 0.0, 1.0);
  }
  fragColor = texture(u_source, uv);
}`,
    uniforms: { mode: "int" },
    uniformMapper: (p) => ({
      ...p,
      mode: ["horizontal", "vertical", "quad", "kaleidoscope"].indexOf((p.mode as string) || "horizontal"),
    }),
  },
  processor: (data, { width, height }, params) => {
    const mode = (params.mode as string) ?? "horizontal";
    const source = scratchCopy(data, "mirror/source");
    const cx = width / 2;
    const cy = height / 2;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let srcX = x,
          srcY = y;

        if (mode === "horizontal") {
          if (x >= cx) srcX = width - 1 - x;
        } else if (mode === "vertical") {
          if (y >= cy) srcY = height - 1 - y;
        } else if (mode === "quad") {
          if (x >= cx) srcX = width - 1 - x;
          if (y >= cy) srcY = height - 1 - y;
        } else if (mode === "kaleidoscope") {
          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          let angle = Math.atan2(dy, dx);
          const segments = 6;
          const segmentAngle = (Math.PI * 2) / segments;
          angle = Math.abs((angle % segmentAngle) - segmentAngle / 2);
          srcX = clamp(Math.floor(cx + Math.cos(angle) * dist), 0, width - 1);
          srcY = clamp(Math.floor(cy + Math.sin(angle) * dist), 0, height - 1);
        }

        const src = (srcY * width + srcX) * 4;
        const dst = (y * width + x) * 4;
        data[dst] = source[src];
        data[dst + 1] = source[src + 1];
        data[dst + 2] = source[src + 2];
      }
    }
  },
});
