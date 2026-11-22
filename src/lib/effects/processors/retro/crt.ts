import { registerEffect } from "../../effect-registry";
import { clamp, scratchCopy } from "../shared";

registerEffect({
  type: "crt",
  label: "CRT",
  category: "retro",
  defaultParams: { curvature: 0.2, scanlines: 0.3 },
  paramsConfig: [
    { key: "curvature", label: "Curvature", type: "slider", min: 0, max: 1, step: 0.01, default: 0.2 },
    { key: "scanlines", label: "Scanlines", type: "slider", min: 0, max: 1, step: 0.01, default: 0.3 },
  ],
  glsl: {
    fragment: `
uniform float u_curvature;
uniform float u_scanlines;
void main() {
  vec2 d = v_texCoord - 0.5;
  float dist = length(d);
  float curve = 1.0 + u_curvature * dist * dist;
  vec2 srcUV = 0.5 + d * curve;
  if (srcUV.x < 0.0 || srcUV.x > 1.0 || srcUV.y < 0.0 || srcUV.y > 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec4 c = texture(u_source, srcUV);
  float scanline = mod(floor(v_texCoord.y * u_resolution.y), 3.0) == 0.0 ? 1.0 - u_scanlines : 1.0;
  fragColor = vec4(c.rgb * scanline, c.a);
}`,
    uniforms: { curvature: "float", scanlines: "float" },
  },
  processor: (data, { width, height }, params) => {
    const curvature = (params.curvature as number) ?? 0.2;
    const scanlineIntensity = (params.scanlines as number) ?? 0.3;

    const source = scratchCopy(data, "crt/source");
    const cx = width / 2;
    const cy = height / 2;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const dx = (x - cx) / width;
        const dy = (y - cy) / height;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const curve = 1 + curvature * dist * dist;
        const srcX = clamp(Math.floor(cx + dx * width * curve), 0, width - 1);
        const srcY = clamp(Math.floor(cy + dy * height * curve), 0, height - 1);

        if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) {
          data[i] = data[i + 1] = data[i + 2] = 0;
        } else {
          const srcIdx = (srcY * width + srcX) * 4;
          data[i] = source[srcIdx];
          data[i + 1] = source[srcIdx + 1];
          data[i + 2] = source[srcIdx + 2];
        }

        const scanline = y % 3 === 0 ? 1 - scanlineIntensity : 1;
        data[i] *= scanline;
        data[i + 1] *= scanline;
        data[i + 2] *= scanline;
      }
    }
  },
});
