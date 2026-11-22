import { registerEffect } from "../../effect-registry";
import { clamp, hslToRgb, scratchFloats } from "../shared";

// ─── Chrome ────────────────────────────────────────────────────────────────────
// Liquid metal / chrome surface simulation using Sobel normals mapped to
// a metallic environment gradient
registerEffect({
  type: "chrome",
  label: "Chrome",
  category: "style",
  defaultParams: { reflectivity: 0.85, tint: "silver", contrast: 1.5, smoothing: 2 },
  paramsConfig: [
    { key: "reflectivity", label: "Reflectivity", type: "slider", min: 0, max: 1, step: 0.05 },
    { key: "tint", label: "Tint", type: "select", options: ["silver", "gold", "rainbow", "copper"] },
    { key: "contrast", label: "Contrast", type: "slider", min: 0.5, max: 4, step: 0.1 },
    { key: "smoothing", label: "Smoothing", type: "slider", min: 0, max: 5, step: 0.5 },
  ],
  glsl: {
    uniforms: { reflectivity: "float", contrast: "float", tintMode: "int", totalPasses: "int" },
    uniformMapper: (params) => {
      const smoothing = Math.round((params.smoothing as number) ?? 2);
      return {
        reflectivity: params.reflectivity,
        contrast: params.contrast,
        tintMode: params.tint === "gold" ? 1 : params.tint === "rainbow" ? 2 : params.tint === "copper" ? 3 : 0,
        totalPasses: smoothing + 1,
      };
    },
    multiPass: (_, params) => Math.round((params.smoothing as number) ?? 2) + 1,
    fragment: `
uniform float u_reflectivity;
uniform float u_contrast;
uniform int u_tintMode;
uniform int u_totalPasses;
uniform int u_pass;

vec3 chromeTint(float rawT) {
  float t = clamp(rawT * u_contrast - (u_contrast - 1.0) * 0.5, 0.0, 1.0);
  if (u_tintMode == 1) {
    if (t < 0.25) return mix(vec3(50,30,0)/255.0,   vec3(160,110,20)/255.0,  t * 4.0);
    if (t < 0.5)  return mix(vec3(160,110,20)/255.0, vec3(255,220,80)/255.0,  (t-0.25)*4.0);
    if (t < 0.75) return mix(vec3(255,220,80)/255.0, vec3(255,255,180)/255.0, (t-0.5)*4.0);
    return mix(vec3(255,255,180)/255.0, vec3(255,240,120)/255.0, (t-0.75)*4.0);
  }
  if (u_tintMode == 2) return hslToRgb(t * 360.0, 0.9, 0.55 + t * 0.1);
  if (u_tintMode == 3) {
    if (t < 0.25) return mix(vec3(40,15,5)/255.0,    vec3(150,70,30)/255.0,   t * 4.0);
    if (t < 0.5)  return mix(vec3(150,70,30)/255.0,  vec3(220,140,80)/255.0,  (t-0.25)*4.0);
    if (t < 0.75) return mix(vec3(220,140,80)/255.0, vec3(255,200,150)/255.0, (t-0.5)*4.0);
    return mix(vec3(255,200,150)/255.0, vec3(240,180,130)/255.0, (t-0.75)*4.0);
  }
  float hi = t > 0.85 ? (t - 0.85) / 0.15 : 0.0;
  return vec3(t + hi * 0.157, t + hi * 0.157, clamp(t + 0.039 + hi * 0.157, 0.0, 1.0));
}

void main() {
  vec2 tx = 1.0 / u_resolution;

  if (u_pass < u_totalPasses - 1) {
    fragColor = vec4(
      texture(u_source, v_texCoord + vec2(-tx.x,-tx.y)).rgb * 1.0 +
      texture(u_source, v_texCoord + vec2(0.0,  -tx.y)).rgb * 2.0 +
      texture(u_source, v_texCoord + vec2( tx.x,-tx.y)).rgb * 1.0 +
      texture(u_source, v_texCoord + vec2(-tx.x, 0.0 )).rgb * 2.0 +
      texture(u_source, v_texCoord              ).rgb * 4.0 +
      texture(u_source, v_texCoord + vec2( tx.x, 0.0 )).rgb * 2.0 +
      texture(u_source, v_texCoord + vec2(-tx.x, tx.y)).rgb * 1.0 +
      texture(u_source, v_texCoord + vec2(0.0,   tx.y)).rgb * 2.0 +
      texture(u_source, v_texCoord + vec2( tx.x, tx.y)).rgb * 1.0
    , 1.0) / 16.0;
    return;
  }

  vec3 luma = vec3(0.299, 0.587, 0.114);
  float tl = dot(texture(u_source, v_texCoord + vec2(-tx.x,-tx.y)).rgb, luma);
  float tm = dot(texture(u_source, v_texCoord + vec2(0.0,  -tx.y)).rgb, luma);
  float tr = dot(texture(u_source, v_texCoord + vec2( tx.x,-tx.y)).rgb, luma);
  float ml = dot(texture(u_source, v_texCoord + vec2(-tx.x, 0.0 )).rgb, luma);
  float mr = dot(texture(u_source, v_texCoord + vec2( tx.x, 0.0 )).rgb, luma);
  float bl = dot(texture(u_source, v_texCoord + vec2(-tx.x, tx.y)).rgb, luma);
  float bm = dot(texture(u_source, v_texCoord + vec2(0.0,   tx.y)).rgb, luma);
  float br = dot(texture(u_source, v_texCoord + vec2( tx.x, tx.y)).rgb, luma);

  float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
  float gy = -tl - 2.0*tm - tr + bl + 2.0*bm + br;
  float mag = length(vec2(gx, gy));
  float envU = gx / (mag + 0.001);
  float envV = gy / (mag + 0.001);
  float rawT = (envU * 0.5 + envV * 0.5 + 1.0) * 0.5;

  vec3 src = texture(u_source, v_texCoord).rgb;
  fragColor = vec4(mix(src, chromeTint(rawT), u_reflectivity), 1.0);
}`,
  },
  processor: (data, { width, height }, params) => {
    const reflectivity = (params.reflectivity as number) ?? 0.85;
    const tint = (params.tint as string) ?? "silver";
    const contrast = (params.contrast as number) ?? 1.5;
    const smoothing = Math.round((params.smoothing as number) ?? 2);

    let src = data;
    if (smoothing > 0) {
      src = new Uint8ClampedArray(data);
      for (let pass = 0; pass < smoothing; pass++) {
        const blurred = new Uint8ClampedArray(src.length);
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            const i = (y * width + x) * 4;
            for (let c = 0; c < 3; c++) {
              blurred[i + c] = (
                src[((y - 1) * width + x - 1) * 4 + c] + src[((y - 1) * width + x) * 4 + c] * 2 + src[((y - 1) * width + x + 1) * 4 + c] +
                src[(y * width + x - 1) * 4 + c] * 2 + src[i + c] * 4 + src[(y * width + x + 1) * 4 + c] * 2 +
                src[((y + 1) * width + x - 1) * 4 + c] + src[((y + 1) * width + x) * 4 + c] * 2 + src[((y + 1) * width + x + 1) * 4 + c]
              ) / 16;
            }
            blurred[i + 3] = src[i + 3];
          }
        }
        src = blurred;
      }
    }

    const luma = scratchFloats(width * height, "chrome/luma");
    for (let i = 0; i < width * height; i++) {
      luma[i] = (src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114) / 255;
    }

    const nxArr = scratchFloats(width * height, "chrome/nxArr");
    const nyArr = scratchFloats(width * height, "chrome/nyArr");
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const gx = (
          -luma[(y - 1) * width + x - 1] + luma[(y - 1) * width + x + 1] +
          -2 * luma[y * width + x - 1] + 2 * luma[y * width + x + 1] +
          -luma[(y + 1) * width + x - 1] + luma[(y + 1) * width + x + 1]
        );
        const gy = (
          -luma[(y - 1) * width + x - 1] - 2 * luma[(y - 1) * width + x] - luma[(y - 1) * width + x + 1] +
          luma[(y + 1) * width + x - 1] + 2 * luma[(y + 1) * width + x] + luma[(y + 1) * width + x + 1]
        );
        nxArr[idx] = gx;
        nyArr[idx] = gy;
      }
    }

    const getChromeTint = (envU: number, envV: number): [number, number, number] => {
      const t = (envU * 0.5 + envV * 0.5 + 1) * 0.5;
      const tc = clamp(t * contrast - (contrast - 1) * 0.5, 0, 1);

      if (tint === "gold") {
        const stops: [number, number, number][] = [[50, 30, 0], [160, 110, 20], [255, 220, 80], [255, 255, 180], [255, 240, 120]];
        const pos = tc * (stops.length - 1);
        const sidx = Math.min(stops.length - 2, Math.floor(pos));
        const frac = pos - sidx;
        return [
          stops[sidx][0] + (stops[sidx + 1][0] - stops[sidx][0]) * frac,
          stops[sidx][1] + (stops[sidx + 1][1] - stops[sidx][1]) * frac,
          stops[sidx][2] + (stops[sidx + 1][2] - stops[sidx][2]) * frac,
        ];
      } else if (tint === "rainbow") {
        return hslToRgb(tc * 360, 0.9, 0.55 + tc * 0.1);
      } else if (tint === "copper") {
        const stops: [number, number, number][] = [[40, 15, 5], [150, 70, 30], [220, 140, 80], [255, 200, 150], [240, 180, 130]];
        const pos = tc * (stops.length - 1);
        const sidx = Math.min(stops.length - 2, Math.floor(pos));
        const frac = pos - sidx;
        return [
          stops[sidx][0] + (stops[sidx + 1][0] - stops[sidx][0]) * frac,
          stops[sidx][1] + (stops[sidx + 1][1] - stops[sidx][1]) * frac,
          stops[sidx][2] + (stops[sidx + 1][2] - stops[sidx][2]) * frac,
        ];
      } else {
        const v = Math.round(tc * 255);
        const highlight = tc > 0.85 ? (tc - 0.85) / 0.15 : 0;
        return [
          clamp(v + highlight * 40, 0, 255),
          clamp(v + highlight * 40, 0, 255),
          clamp(v + 10 + highlight * 40, 0, 255),
        ];
      }
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const i = idx * 4;
        const mag = Math.sqrt(nxArr[idx] * nxArr[idx] + nyArr[idx] * nyArr[idx]);
        const envU = nxArr[idx] / (mag + 0.001);
        const envV = nyArr[idx] / (mag + 0.001);
        const [cr, cg, cb] = getChromeTint(envU, envV);
        data[i] = data[i] * (1 - reflectivity) + cr * reflectivity;
        data[i + 1] = data[i + 1] * (1 - reflectivity) + cg * reflectivity;
        data[i + 2] = data[i + 2] * (1 - reflectivity) + cb * reflectivity;
      }
    }
  },
});
