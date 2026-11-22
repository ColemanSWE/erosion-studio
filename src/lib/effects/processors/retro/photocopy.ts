import { registerEffect } from "../../effect-registry";
import { BAYER_MATRIX_4x4, clamp, pseudoRandom } from "../shared";

// ─── Photocopy ─────────────────────────────────────────────────────────────────
// Dirty xerox / risograph print simulation: threshold to high-contrast B&W,
// halftone grain, registration offset, optional riso tint

registerEffect({
  type: "photocopy",
  label: "Photocopy",
  category: "retro",
  defaultParams: { threshold: 128, darkness: 0.7, grain: 25, misalign: 2, tint: "black", mode: "xerox" },
  paramsConfig: [
    { key: "threshold", label: "Threshold", type: "slider", min: 40, max: 220, step: 1 },
    { key: "darkness", label: "Darkness", type: "slider", min: 0, max: 1, step: 0.05 },
    { key: "grain", label: "Grain", type: "slider", min: 0, max: 80, step: 1 },
    { key: "misalign", label: "Misalign", type: "slider", min: 0, max: 8, step: 0.5 },
    { key: "tint", label: "Tint", type: "select", options: ["black", "blue", "red", "green", "purple"] },
    { key: "mode", label: "Mode", type: "select", options: ["xerox", "riso"] },
  ],
  glsl: {
    fragment: `
uniform float u_threshold;
uniform float u_darkness;
uniform float u_grain;
uniform float u_misalign;
uniform vec3 u_tintColor;
uniform int u_mode;

const float BAYER[16] = float[16](
   0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
  12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
   3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
  15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
);

void main() {
  vec2 uv = v_texCoord;
  vec2 px = 1.0 / u_resolution;
  vec4 src = texture(u_source, uv);
  float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114)) * 255.0;

  int bx = int(mod(uv.x * u_resolution.x, 4.0));
  int by = int(mod(uv.y * u_resolution.y, 4.0));
  float bayerDot = BAYER[by * 4 + bx];
  float dotGrain = u_grain > 0.0 ? bayerDot * u_grain : 0.0;

  float seed = floor(u_time * 5.0);
  float r = pseudoRandom(seed + uv.x * u_resolution.x * 7.0 + uv.y * u_resolution.y * 13.0);
  float val = lum + dotGrain + (r - 0.5) * u_grain * 0.5;
  bool isInk = val < u_threshold;

  vec3 col;
  if (u_mode == 1) { // riso
    float tone = clamp(1.0 - (val - u_threshold * 0.5) / (u_threshold * 0.5 + 1.0), 0.0, 1.0);
    vec3 paperColor = vec3(245.0, 237.0, 225.0) / 255.0;
    col = mix(paperColor, u_tintColor * u_darkness, tone);
  } else { // xerox
    float r2 = pseudoRandom(seed + uv.x * u_resolution.x * 3.0 + uv.y * u_resolution.y * 17.0);
    float inkDarkness = u_darkness * (0.85 + r2 * 0.15);
    float paperTone = 240.0 + r2 * 15.0;
    col = isInk ? u_tintColor * inkDarkness : vec3(paperTone / 255.0);

      // Registration misalignment ghost layer
    if (u_misalign > 0.0 && isInk) {
      vec2 shiftUV = clamp(uv + vec2(u_misalign * px.x, u_misalign * 0.5 * px.y), 0.0, 1.0);
      float shiftLum = dot(texture(u_source, shiftUV).rgb, vec3(0.299, 0.587, 0.114));
      if (shiftLum < 0.314) {
        vec3 ghostColor = u_tintColor + vec3(80.0 / 255.0);
        col = mix(col, ghostColor, 0.25);
      }
    }
  }
  fragColor = vec4(col, 1.0);
}`,
    uniforms: { threshold: "float", darkness: "float", grain: "float", misalign: "float", tintColor: "vec3", mode: "int" },
    uniformMapper: (p) => {
      const tintMap: Record<string, [number, number, number]> = {
        black: [20/255, 20/255, 20/255],
        blue: [30/255, 60/255, 180/255],
        red: [200/255, 30/255, 40/255],
        green: [30/255, 150/255, 60/255],
        purple: [100/255, 20/255, 160/255],
      };
      return {
        ...p,
        tintColor: tintMap[(p.tint as string) ?? "black"] ?? tintMap.black,
        mode: (p.mode as string) === "riso" ? 1 : 0,
      };
    },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const threshold = (params.threshold as number) ?? 128;
    const darkness = (params.darkness as number) ?? 0.7;
    const grain = (params.grain as number) ?? 25;
    const misalign = (params.misalign as number) ?? 2;
    const tint = (params.tint as string) ?? "black";
    const mode = (params.mode as string) ?? "xerox";

    const tintColors: Record<string, [number, number, number]> = {
      black: [20, 20, 20],
      blue: [30, 60, 180],
      red: [200, 30, 40],
      green: [30, 150, 60],
      purple: [100, 20, 160],
    };
    const [tr, tg, tb] = tintColors[tint] || tintColors.black;

    const seed = Math.floor(time * 5);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

        // Halftone dot pattern
        const bx = x % 4;
        const by = y % 4;
        const bayerDot = BAYER_MATRIX_4x4[by][bx] / 16;
        const dotGrain = grain > 0 ? bayerDot * grain : 0;

        // Threshold + grain to binary
        const val = lum + dotGrain + (pseudoRandom(seed + x * 7 + y * 13) - 0.5) * grain * 0.5;
        const isInk = val < threshold;

        if (isInk) {
          const inkDarkness = darkness * (0.85 + pseudoRandom(seed + i) * 0.15);
          data[i] = tr * inkDarkness;
          data[i + 1] = tg * inkDarkness;
          data[i + 2] = tb * inkDarkness;
        } else {
          const paperTone = mode === "riso" ? 245 + pseudoRandom(seed + i * 3) * 10 : 240 + pseudoRandom(seed + i * 3) * 15;
          data[i] = paperTone;
          data[i + 1] = paperTone * (mode === "riso" ? 0.97 : 1);
          data[i + 2] = paperTone * (mode === "riso" ? 0.93 : 1);
        }
      }
    }

    // Registration misalignment: draw an offset ghost layer in secondary color
    if (misalign > 0) {
      const shiftX = Math.round(misalign);
      const shiftY = Math.round(misalign * 0.5);
      const [gr, gg, gb] = tint === "black" ? [tr + 80, tg + 80, tb + 80] as [number,number,number] : [tr, tg, tb] as [number,number,number];

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const srcX = clamp(x + shiftX, 0, width - 1);
          const srcY = clamp(y + shiftY, 0, height - 1);
          const srcI = (srcY * width + srcX) * 4;
          const dstI = (y * width + x) * 4;

          const srcLum = data[srcI] * 0.299 + data[srcI + 1] * 0.587 + data[srcI + 2] * 0.114;
          if (srcLum < 80) {
            const alpha = 0.25 * (mode === "riso" ? 1 : 0.5);
            data[dstI] = data[dstI] * (1 - alpha) + gr * alpha;
            data[dstI + 1] = data[dstI + 1] * (1 - alpha) + gg * alpha;
            data[dstI + 2] = data[dstI + 2] * (1 - alpha) + gb * alpha;
          }
        }
      }
    }
  },
});
