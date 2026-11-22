import { registerEffect } from "../../effect-registry";
import { clamp, rgbToHsl, hslToRgb } from "../shared";

registerEffect({
  type: "neon-crush",
  label: "Neon Crush",
  category: "glitch",
  defaultParams: { bits: 1, saturationBoost: 80, ditherAmount: 20 },
  paramsConfig: [
    {
      key: "bits",
      label: "Bits Per Channel",
      type: "slider",
      min: 1,
      max: 4,
      step: 1,
    },
    {
      key: "saturationBoost",
      label: "Saturation Boost",
      type: "slider",
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: "ditherAmount",
      label: "Dither",
      type: "slider",
      min: 0,
      max: 100,
      step: 1,
    },
  ],
  glsl: {
    fragment: `
uniform float u_bits;
uniform float u_saturationBoost;
uniform float u_ditherAmount;

const float BAYER[16] = float[16](
   0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
  12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
   3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
  15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
);

void main() {
  vec4 col = texture(u_source, v_texCoord);
  vec3 hsl = rgbToHsl(col.rgb);
  float boostedSat = clamp(hsl.y + u_saturationBoost / 100.0, 0.0, 1.0);
  col.rgb = hslToRgb(hsl.x, boostedSat, hsl.z);

  int bx = int(mod(gl_FragCoord.x, 4.0));
  int by = int(mod(gl_FragCoord.y, 4.0));
  float dither = BAYER[by * 4 + bx] * (u_ditherAmount / 100.0);

  float levels = pow(2.0, u_bits) - 1.0;
  col.r = floor((col.r + dither / levels) * levels + 0.5) / levels;
  col.g = floor((col.g + dither / levels) * levels + 0.5) / levels;
  col.b = floor((col.b + dither / levels) * levels + 0.5) / levels;

  fragColor = vec4(clamp(col.rgb, 0.0, 1.0), col.a);
}`,
    uniforms: {
      bits: "float",
      saturationBoost: "float",
      ditherAmount: "float",
    },
  },
  processor: (data, { width, height }, params) => {
    const bits = Math.round((params.bits as number) ?? 1);
    const saturationBoost = (params.saturationBoost as number) ?? 80;
    const ditherAmount = (params.ditherAmount as number) ?? 20;

    const BAYER = [
      0 / 16,
      8 / 16,
      2 / 16,
      10 / 16,
      12 / 16,
      4 / 16,
      14 / 16,
      6 / 16,
      3 / 16,
      11 / 16,
      1 / 16,
      9 / 16,
      15 / 16,
      7 / 16,
      13 / 16,
      5 / 16,
    ];

    const levels = Math.pow(2, bits) - 1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx] / 255;
        const g = data[idx + 1] / 255;
        const b = data[idx + 2] / 255;

        const [h, s, l] = rgbToHsl(r, g, b);
        const boostedSat = Math.min(1, s + saturationBoost / 100);
        const [br, bg, bb] = hslToRgb(h, boostedSat, l);

        const dither = BAYER[(y % 4) * 4 + (x % 4)] * (ditherAmount / 100);

        data[idx] = clamp(
          (Math.round((br + dither / levels) * levels + 0.5) / levels) * 255,
          0,
          255,
        );
        data[idx + 1] = clamp(
          (Math.round((bg + dither / levels) * levels + 0.5) / levels) * 255,
          0,
          255,
        );
        data[idx + 2] = clamp(
          (Math.round((bb + dither / levels) * levels + 0.5) / levels) * 255,
          0,
          255,
        );
      }
    }
  },
});
