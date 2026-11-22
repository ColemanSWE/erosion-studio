import { registerEffect } from "../../effect-registry";
import { clamp, hslToRgb, scratchCopy, scratchFloats } from "../shared";

// ─── Prism ─────────────────────────────────────────────────────────────────────
// Full ROYGBIV spectrum dispersion from a configurable origin point — each
// spectral band is sampled from a different offset angle, creating prismatic
// rainbow fringing dramatically beyond standard chromatic aberration.

registerEffect({
  type: "prism",
  label: "Prism",
  category: "distortion",
  defaultParams: { spread: 15, angle: 0, bands: 5, origin: "center", falloff: 0.6 },
  paramsConfig: [
    { key: "spread", label: "Spread", type: "slider", min: 1, max: 60, step: 1 },
    { key: "angle", label: "Angle", type: "slider", min: 0, max: 360, step: 5 },
    { key: "bands", label: "Bands", type: "slider", min: 3, max: 7, step: 1 },
    { key: "origin", label: "Origin", type: "select", options: ["center", "top-left", "top-right", "bottom-left", "bottom-right", "top"] },
    { key: "falloff", label: "Falloff", type: "slider", min: 0, max: 1, step: 0.05 },
  ],
  glsl: {
    fragment: `
uniform float u_spread;
uniform float u_angleRad;
uniform int u_bands;
uniform vec2 u_originUV;
uniform float u_falloff;

// ROYGBIV spectral hues (degrees)
const float SPECTRAL_H[7] = float[7](0.0, 30.0, 60.0, 120.0, 200.0, 260.0, 290.0);

void main() {
  vec2 uv = v_texCoord;
  vec2 px = 1.0 / u_resolution;
  float maxDist = length(u_resolution);

  vec3 accRGB = vec3(0.0);
  float accW = 0.0;

  for (int band = 0; band < 7; band++) {
    if (band >= u_bands) break;
    float t = u_bands > 1 ? float(band) / float(u_bands - 1) : 0.5;
    float hue = SPECTRAL_H[band];
    vec3 spectralColor = hslToRgb(hue, 1.0, 0.5);

    float bandAngle = u_angleRad + (t - 0.5) * 3.14159 * 0.8;
    vec2 dir = vec2(cos(bandAngle), sin(bandAngle));

    vec2 delta = (uv - u_originUV) * u_resolution;
    float dist = length(delta);
    float distFactor = u_falloff > 0.0 ? pow(dist / maxDist, u_falloff) : 1.0;
    float offset = (t - 0.5) * u_spread * 2.0 * distFactor;

    vec2 sampleUV = clamp(uv + dir * offset * px, 0.0, 1.0);
    float sampleLum = dot(texture(u_source, sampleUV).rgb, vec3(0.299, 0.587, 0.114));

    accRGB += sampleLum * spectralColor;
    accW += 1.0;
  }

  vec3 col = accRGB / accW * float(u_bands) * 0.7;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`,
    uniforms: { spread: "float", angleRad: "float", bands: "int", originUV: "vec2", falloff: "float" },
    uniformMapper: (p) => {
      const originMap: Record<string, [number, number]> = {
        center: [0.5, 0.5], "top-left": [0, 0], "top-right": [1, 0],
        "bottom-left": [0, 1], "bottom-right": [1, 1], top: [0.5, 0],
      };
      return {
        ...p,
        angleRad: ((p.angle as number) ?? 0) * (Math.PI / 180),
        bands: Math.round(Math.min(Math.max((p.bands as number) ?? 5, 3), 7)),
        originUV: originMap[(p.origin as string) ?? "center"] ?? [0.5, 0.5],
      };
    },
  },
  processor: (data, { width, height }, params) => {
    const spread = (params.spread as number) ?? 15;
    const angle = ((params.angle as number) ?? 0) * (Math.PI / 180);
    const bands = Math.round(clamp((params.bands as number) ?? 5, 3, 7));
    const origin = (params.origin as string) ?? "center";
    const falloff = (params.falloff as number) ?? 0.6;

    const originMap: Record<string, [number, number]> = {
      center: [0.5, 0.5],
      "top-left": [0, 0],
      "top-right": [1, 0],
      "bottom-left": [0, 1],
      "bottom-right": [1, 1],
      top: [0.5, 0],
    };
    const [ox, oy] = originMap[origin] || [0.5, 0.5];
    const originX = ox * width;
    const originY = oy * height;
    const maxDist = Math.sqrt(width * width + height * height);

    // Spectral colors for ROYGBIV
    const spectralHues = [0, 30, 60, 120, 200, 260, 290]; // R O Y G C B V
    const source = scratchCopy(data, "prism/source");

    // Accumulate weighted spectral samples
    const accR = scratchFloats(width * height, "prism/accR");
    const accG = scratchFloats(width * height, "prism/accG");
    const accB = scratchFloats(width * height, "prism/accB");
    const accW = scratchFloats(width * height, "prism/accW");

    for (let band = 0; band < bands; band++) {
      const t = bands > 1 ? band / (bands - 1) : 0.5;
      const hue = spectralHues[Math.min(band, spectralHues.length - 1)];
      const [sr, sg, sb] = hslToRgb(hue, 1.0, 0.5);

      // Offset direction: spread rotates outward from origin
      const bandAngle = angle + (t - 0.5) * Math.PI * 0.8;
      const dirX = Math.cos(bandAngle);
      const dirY = Math.sin(bandAngle);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;

          // Distance from origin drives offset magnitude
          const dx = x - originX;
          const dy = y - originY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const distFactor = falloff > 0 ? Math.pow(dist / maxDist, falloff) : 1;
          const offset = (t - 0.5) * spread * 2 * distFactor;

          const sx = clamp(x + dirX * offset, 0, width - 1);
          const sy = clamp(y + dirY * offset, 0, height - 1);

          const sx0 = Math.floor(sx);
          const sy0 = Math.floor(sy);
          const sx1 = Math.min(sx0 + 1, width - 1);
          const sy1 = Math.min(sy0 + 1, height - 1);
          const fx = sx - sx0;
          const fy = sy - sy0;

          const sampleLum = (
            (source[(sy0 * width + sx0) * 4] * (1 - fx) + source[(sy0 * width + sx1) * 4] * fx) * (1 - fy) +
            (source[(sy1 * width + sx0) * 4] * (1 - fx) + source[(sy1 * width + sx1) * 4] * fx) * fy
          ) / 255;

          accR[idx] += sampleLum * sr;
          accG[idx] += sampleLum * sg;
          accB[idx] += sampleLum * sb;
          accW[idx] += 1;
        }
      }
    }

    for (let idx = 0; idx < width * height; idx++) {
      const i = idx * 4;
      const w = accW[idx];
      if (w > 0) {
        data[i]     = clamp(accR[idx] / w * bands * 0.7, 0, 255);
        data[i + 1] = clamp(accG[idx] / w * bands * 0.7, 0, 255);
        data[i + 2] = clamp(accB[idx] / w * bands * 0.7, 0, 255);
      }
    }
  },
});
