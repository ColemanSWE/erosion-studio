import { registerEffect } from "../../effect-registry";
import { scratchCopy } from "../shared";

registerEffect({
  type: "edge-detect",
  label: "Edge Detect",
  category: "color",
  defaultParams: { threshold: 50, invert: false },
  paramsConfig: [
    { key: "threshold", label: "Threshold", type: "slider", min: 0, max: 255, default: 50 },
    { key: "invert", label: "Invert", type: "checkbox", default: false },
  ],
  glsl: {
    fragment: `
uniform float u_threshold;
uniform bool u_invert;
void main() {
  vec2 px = 1.0 / u_resolution;
  float gx = 0.0, gy = 0.0;
  float sobelX[9] = float[](-1.0, 0.0, 1.0, -2.0, 0.0, 2.0, -1.0, 0.0, 1.0);
  float sobelY[9] = float[](-1.0, -2.0, -1.0, 0.0, 0.0, 0.0, 1.0, 2.0, 1.0);
  for (int ky = -1; ky <= 1; ky++) {
    for (int kx = -1; kx <= 1; kx++) {
      vec2 uv = v_texCoord + vec2(float(kx), float(ky)) * px;
      vec3 s = texture(u_source, uv).rgb;
      float lum = (s.r + s.g + s.b) / 3.0;
      int idx = (ky + 1) * 3 + (kx + 1);
      gx += lum * sobelX[idx];
      gy += lum * sobelY[idx];
    }
  }
  float mag = length(vec2(gx, gy));
  float edge = mag * 255.0 > u_threshold ? 1.0 : 0.0;
  if (u_invert) edge = 1.0 - edge;
  fragColor = vec4(vec3(edge), 1.0);
}`,
    uniforms: { threshold: "float", invert: "bool" },
  },
  processor: (data, { width, height }, params) => {
    const threshold = (params.threshold as number) ?? 50;
    const invert = (params.invert as boolean) ?? false;

    const source = scratchCopy(data, "edge-detect/source");
    const sobelX = [
      [-1, 0, 1],
      [-2, 0, 2],
      [-1, 0, 1],
    ];
    const sobelY = [
      [-1, -2, -1],
      [0, 0, 0],
      [1, 2, 1],
    ];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let gx = 0,
          gy = 0;

        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4;
            const lum = (source[idx] + source[idx + 1] + source[idx + 2]) / 3;
            gx += lum * sobelX[ky + 1][kx + 1];
            gy += lum * sobelY[ky + 1][kx + 1];
          }
        }

        const mag = Math.sqrt(gx * gx + gy * gy);
        let edge = mag > threshold ? 255 : 0;
        if (invert) edge = 255 - edge;

        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = edge;
      }
    }
  },
});
