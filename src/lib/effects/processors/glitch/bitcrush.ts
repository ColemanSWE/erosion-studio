import { registerEffect } from "../../effect-registry";
import { scratchCopy } from "../shared";

registerEffect({
  type: "bitcrush",
  label: "Bitcrush",
  category: "glitch",
  defaultParams: { bits: 4, intensity: 50 },
  paramsConfig: [
    { key: "bits", label: "Bits", type: "slider", min: 1, max: 8, default: 4 },
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 100, default: 50 },
  ],
  glsl: {
    fragment: `
uniform float u_bits;
uniform float u_intensity;
void main() {
  float seed = floor(u_time * 0.1);
  float py = floor(v_texCoord.y * u_resolution.y);
  float corruptChance = u_intensity / 100.0;
  float rowSeed = pseudoRandom(seed + py * 1.7);
  float localBits = rowSeed < corruptChance * 0.3
    ? max(1.0, u_bits - floor(pseudoRandom(seed + py * 3.1) * 3.0))
    : u_bits;
  float rowShift = rowSeed < corruptChance * 0.3
    ? floor(pseudoRandom(seed + py * 2.3) * u_resolution.x * 0.3)
    : 0.0;
  float levels = pow(2.0, localBits);
  float step = 1.0 / (levels - 1.0);
  float srcX = mod(v_texCoord.x * u_resolution.x + rowShift, u_resolution.x);
  vec4 c = texture(u_source, vec2(srcX / u_resolution.x, v_texCoord.y));
  vec3 crushed = floor(c.rgb / step + 0.5) * step;
  fragColor = vec4(crushed, c.a);
}`,
    uniforms: { bits: "float", intensity: "float" },
  },
  processor: (data, { width, height }, params) => {
    const bits = (params.bits as number) ?? 4;
    const intensity = (params.intensity as number) ?? 50;
    if (intensity === 0) return;

    const source = scratchCopy(data, "bitcrush/source");
    const corruptChance = intensity / 100;

    for (let y = 0; y < height; y++) {
      const rowCorrupt = Math.random() < corruptChance * 0.3;
      const rowShift = rowCorrupt ? Math.floor(Math.random() * width * 0.3) : 0;
      const localBits = rowCorrupt
        ? Math.max(1, bits - Math.floor(Math.random() * 3))
        : bits;
      const levels = Math.pow(2, localBits);
      const step = 255 / (levels - 1);

      for (let x = 0; x < width; x++) {
        const srcX = (x + rowShift) % width;
        const srcIdx = (y * width + srcX) * 4;
        const dstIdx = (y * width + x) * 4;

        let r = source[srcIdx];
        let g = source[srcIdx + 1];
        let b = source[srcIdx + 2];

        if (Math.random() < corruptChance * 0.1) {
          const corrupt = Math.floor(Math.random() * 3);
          if (corrupt === 0) r = Math.random() * 255;
          if (corrupt === 1) g = Math.random() * 255;
          if (corrupt === 2) b = Math.random() * 255;
        }

        if (Math.random() < corruptChance * 0.05) {
          r = g = b = Math.random() > 0.5 ? 255 : 0;
        }

        data[dstIdx] = Math.round(r / step) * step;
        data[dstIdx + 1] = Math.round(g / step) * step;
        data[dstIdx + 2] = Math.round(b / step) * step;
      }
    }
  },
});
