import { registerEffect, ProcessConfig } from "../effect-registry";
import { EffectType, EffectParamConfig } from "../types";
import { FaceBounds, HandBounds, PoseBounds, getEyeLandmarks, getMouthLandmarks, getLandmarkBounds } from "../face-detector";
import { BAYER_MATRIX_4x4, motionSmearState, datamoshState, blockShovingState, bilinearSample, meltState, perlinNoise, posterizeTimeCache, pseudoRandom, clamp, sortSegment, sortSegmentV, getBlockAverage, hexToRgb, rgbToHsl, hslToRgb, isPointInFaceBounds, frameHistoryStore, storeFrame, getFrameFromHistory } from "./shared";

registerEffect({
  type: "invert",
  label: "Invert",
  category: "color",
  defaultParams: {},
  paramsConfig: [],
  glsl: {
    fragment: `
void main() {
  vec4 c = texture(u_source, v_texCoord);
  fragColor = vec4(1.0 - c.rgb, c.a);
}`,
  },
  processor: (data) => {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i];
      data[i + 1] = 255 - data[i + 1];
      data[i + 2] = 255 - data[i + 2];
    }
  },
});

registerEffect({
  type: "vignette",
  label: "Vignette",
  category: "color",
  defaultParams: { intensity: 0.5, radius: 0.8 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_radius;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  vec2 uv = v_texCoord - 0.5;
  float dist = length(uv) / 0.7071; // normalize by max corner distance
  float normalizedDist = dist / u_radius;
  float factor = 1.0 - pow(min(normalizedDist, 1.0), 2.0) * u_intensity;
  fragColor = vec4(max(c.rgb * factor, 0.0), c.a);
}`,
    uniforms: { intensity: "float", radius: "float" },
  },
  processor: (data, { width, height }, params) => {
    const intensity = (params.intensity as number) ?? 0.5;
    const radius = (params.radius as number) ?? 0.8;

    const cx = width / 2;
    const cy = height / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const normalizedDist = dist / maxDist / radius;
        const factor = 1 - Math.pow(Math.min(normalizedDist, 1), 2) * intensity;

        const i = (y * width + x) * 4;
        data[i] = Math.max(0, data[i] * factor);
        data[i + 1] = Math.max(0, data[i + 1] * factor);
        data[i + 2] = Math.max(0, data[i + 2] * factor);
      }
    }
  },
});

registerEffect({
  type: "edge-detect",
  label: "Edge Detect",
  category: "color",
  defaultParams: { threshold: 50, invert: false },
  paramsConfig: [],
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

    const source = new Uint8ClampedArray(data);
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

registerEffect({
  type: "thermal",
  label: "Thermal",
  category: "color",
  defaultParams: { palette: "thermal" },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform int u_palette;
vec3 thermalColor(float t) {
  // 8-stop gradients encoded inline
  vec3 stops[8];
  if (u_palette == 1) { // night-vision
    stops[0]=vec3(0.0,0.0,0.0); stops[1]=vec3(0.0,0.078,0.0);
    stops[2]=vec3(0.0,0.235,0.0); stops[3]=vec3(0.0,0.471,0.0);
    stops[4]=vec3(0.0,0.706,0.0); stops[5]=vec3(0.196,0.863,0.196);
    stops[6]=vec3(0.588,1.0,0.588); stops[7]=vec3(0.863,1.0,0.863);
  } else if (u_palette == 2) { // infrared
    stops[0]=vec3(0.0,0.0,0.196); stops[1]=vec3(0.0,0.0,0.588);
    stops[2]=vec3(0.392,0.0,0.784); stops[3]=vec3(0.784,0.0,0.588);
    stops[4]=vec3(1.0,0.196,0.196); stops[5]=vec3(1.0,0.588,0.196);
    stops[6]=vec3(1.0,0.863,0.588); stops[7]=vec3(1.0,1.0,1.0);
  } else { // thermal (default)
    stops[0]=vec3(0.0,0.0,0.0); stops[1]=vec3(0.118,0.0,0.392);
    stops[2]=vec3(0.471,0.0,0.706); stops[3]=vec3(0.863,0.0,0.392);
    stops[4]=vec3(1.0,0.196,0.0); stops[5]=vec3(1.0,0.588,0.0);
    stops[6]=vec3(1.0,1.0,0.392); stops[7]=vec3(1.0,1.0,1.0);
  }
  float pos = t * 7.0;
  int idx = min(6, int(floor(pos)));
  float frac = fract(pos);
  return mix(stops[idx], stops[idx + 1], frac);
}
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float lum = (c.r + c.g + c.b) / 3.0;
  fragColor = vec4(thermalColor(lum), c.a);
}`,
    uniforms: { palette: "int" },
    uniformMapper: (p) => ({
      ...p,
      palette: ["thermal", "night-vision", "infrared"].indexOf((p.palette as string) || "thermal"),
    }),
  },
  processor: (data, config, params) => {
    const palette = (params.palette as string) ?? "thermal";
    const gradients: Record<string, number[][]> = {
      thermal: [
        [0, 0, 0],
        [30, 0, 100],
        [120, 0, 180],
        [220, 0, 100],
        [255, 50, 0],
        [255, 150, 0],
        [255, 255, 100],
        [255, 255, 255],
      ],
      "night-vision": [
        [0, 0, 0],
        [0, 20, 0],
        [0, 60, 0],
        [0, 120, 0],
        [0, 180, 0],
        [50, 220, 50],
        [150, 255, 150],
        [220, 255, 220],
      ],
      infrared: [
        [0, 0, 50],
        [0, 0, 150],
        [100, 0, 200],
        [200, 0, 150],
        [255, 50, 50],
        [255, 150, 50],
        [255, 220, 150],
        [255, 255, 255],
      ],
    };

    const gradient = gradients[palette] || gradients.thermal;
    const len = gradient.length;

    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3 / 255;
      const pos = lum * (len - 1);
      const idx = Math.min(len - 2, Math.floor(pos));
      const t = pos - idx;

      data[i] =
        gradient[idx][0] + (gradient[idx + 1][0] - gradient[idx][0]) * t;
      data[i + 1] =
        gradient[idx][1] + (gradient[idx + 1][1] - gradient[idx][1]) * t;
      data[i + 2] =
        gradient[idx][2] + (gradient[idx + 1][2] - gradient[idx][2]) * t;
    }
  },
});

registerEffect({
  type: "bloom",
  label: "Bloom",
  category: "color",
  defaultParams: { threshold: 200, intensity: 0.5, radius: 3 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_threshold;
uniform float u_intensity;
uniform float u_radius;
void main() {
  vec2 px = 1.0 / u_resolution;
  float thresh = u_threshold / 255.0;
  int r = int(u_radius);
  vec3 bloom = vec3(0.0);
  float count = 0.0;
  for (int ky = -5; ky <= 5; ky++) {
    for (int kx = -5; kx <= 5; kx++) {
      if (abs(float(kx)) > u_radius || abs(float(ky)) > u_radius) continue;
      vec2 uv = v_texCoord + vec2(float(kx), float(ky)) * px;
      vec3 s = texture(u_source, uv).rgb;
      float lum = (s.r + s.g + s.b) / 3.0;
      if (lum > thresh) {
        float factor = (lum - thresh) / (1.0 - thresh);
        bloom += s * factor;
      }
      count += 1.0;
    }
  }
  if (count > 0.0) bloom /= count;
  vec4 c = texture(u_source, v_texCoord);
  fragColor = vec4(clamp(c.rgb + bloom * u_intensity, 0.0, 1.0), c.a);
}`,
    uniforms: { threshold: "float", intensity: "float", radius: "float" },
  },
  processor: (data, { width, height }, params) => {
    const threshold = (params.threshold as number) ?? 200;
    const intensity = (params.intensity as number) ?? 0.5;
    const radius = (params.radius as number) ?? 3;

    const brightPixels = new Float32Array(width * height * 3);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const bi = (y * width + x) * 3;
        const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;

        if (lum > threshold) {
          const factor = (lum - threshold) / (255 - threshold);
          brightPixels[bi] = data[i] * factor;
          brightPixels[bi + 1] = data[i + 1] * factor;
          brightPixels[bi + 2] = data[i + 2] * factor;
        }
      }
    }

    const blurred = new Float32Array(brightPixels.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0,
          g = 0,
          b = 0,
          count = 0;

        for (let ky = -radius; ky <= radius; ky++) {
          for (let kx = -radius; kx <= radius; kx++) {
            const ny = y + ky,
              nx = x + kx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              const bi = (ny * width + nx) * 3;
              r += brightPixels[bi];
              g += brightPixels[bi + 1];
              b += brightPixels[bi + 2];
              count++;
            }
          }
        }

        const bi = (y * width + x) * 3;
        blurred[bi] = r / count;
        blurred[bi + 1] = g / count;
        blurred[bi + 2] = b / count;
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const bi = (y * width + x) * 3;
        data[i] = Math.min(255, data[i] + blurred[bi] * intensity);
        data[i + 1] = Math.min(255, data[i + 1] + blurred[bi + 1] * intensity);
        data[i + 2] = Math.min(255, data[i + 2] + blurred[bi + 2] * intensity);
      }
    }
  },
});

registerEffect({
  type: "posterize",
  label: "Posterize",
  category: "color",
  defaultParams: { levels: 8 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_levels;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float levels = max(2.0, u_levels);
  fragColor = vec4(floor(c.rgb * (levels - 1.0) + 0.5) / (levels - 1.0), c.a);
}`,
    uniforms: { levels: "float" },
  },
  processor: (data, config, params) => {
    const levels = (params.levels as number) ?? 8;
    const step = 255 / (levels - 1);

    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.round(data[i] / step) * step;
      data[i + 1] = Math.round(data[i + 1] / step) * step;
      data[i + 2] = Math.round(data[i + 2] / step) * step;
    }
  },
});

registerEffect({
  type: "solarize",
  label: "Solarize",
  category: "color",
  defaultParams: { threshold: 128 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_intensity;
void main() {
  float intensity = u_intensity;
  // default intensity param is unused in cpu code (uses intensity directly, not threshold param)
  float thresh = (255.0 - intensity * 2.55) / 255.0;
  vec4 c = texture(u_source, v_texCoord);
  vec3 sol = mix(c.rgb, 1.0 - c.rgb, step(thresh, c.rgb));
  fragColor = vec4(sol, c.a);
}`,
    uniforms: { intensity: "float" },
    uniformMapper: (p) => ({
      ...p,
      intensity: (p.intensity as number) ?? 50,
    }),
  },
  processor: (data, config, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const threshold = 255 - (intensity * 2.55);

    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > threshold) data[i] = 255 - data[i];
      if (data[i + 1] > threshold) data[i + 1] = 255 - data[i + 1];
      if (data[i + 2] > threshold) data[i + 2] = 255 - data[i + 2];
    }
  },
});

registerEffect({
  type: "duotone",
  label: "Duotone",
  category: "color",
  defaultParams: { color1: "#000000", color2: "#00ff88" },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform vec3 u_color1;
uniform vec3 u_color2;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float lum = (c.r + c.g + c.b) / 3.0;
  fragColor = vec4(mix(u_color1, u_color2, lum), c.a);
}`,
    uniforms: { color1: "vec3", color2: "vec3" },
    uniformMapper: (p) => {
      const hex2rgb = (h: string): [number, number, number] => {
        const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
        return r ? [parseInt(r[1], 16) / 255, parseInt(r[2], 16) / 255, parseInt(r[3], 16) / 255] : [0, 0, 0];
      };
      return {
        ...p,
        color1: hex2rgb((p.color1 as string) || "#000000"),
        color2: hex2rgb((p.color2 as string) || "#00ff88"),
      };
    },
  },
  processor: (data, config, params) => {
    const color1 = hexToRgb((params.color1 as string) ?? "#000000");
    const color2 = hexToRgb((params.color2 as string) ?? "#ffffff");

    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3 / 255;
      data[i] = color1.r + (color2.r - color1.r) * lum;
      data[i + 1] = color1.g + (color2.g - color1.g) * lum;
      data[i + 2] = color1.b + (color2.b - color1.b) * lum;
    }
  },
});

registerEffect({
  type: "color-shift",
  label: "Color Shift",
  category: "color",
  defaultParams: { speed: 1 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_speed;
void main() {
  float hueShift = mod(u_time * u_speed, 360.0);
  vec4 c = texture(u_source, v_texCoord);
  vec3 hsl = rgbToHsl(c.rgb);
  vec3 rgb = hslToRgb(mod(hsl.x + hueShift, 360.0), hsl.y, hsl.z);
  fragColor = vec4(rgb, c.a);
}`,
    uniforms: { speed: "float" },
  },
  processor: (data, { time = 0 }, params) => {
    const speed = (params.speed as number) ?? 1;
    const hueShift = (time * speed) % 360;

    for (let i = 0; i < data.length; i += 4) {
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      const [r, g, b] = hslToRgb((h + hueShift) % 360, s, l);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  },
});

registerEffect({
  type: "channel-swap",
  label: "Channel Swap",
  category: "color",
  defaultParams: { swap: "rg" },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform int u_swap;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float r = c.r, g = c.g, b = c.b;
  if (u_swap == 0)      { c.r = g; c.g = r; }
  else if (u_swap == 1) { c.r = b; c.b = r; }
  else if (u_swap == 2) { c.g = b; c.b = g; }
  else                  { c.r = g; c.g = b; c.b = r; }
  fragColor = c;
}`,
    uniforms: { swap: "int" },
    uniformMapper: (p) => ({
      ...p,
      swap: ["rg", "rb", "gb", "rgb"].indexOf((p.swap as string) || "rg"),
    }),
  },
  processor: (data, config, params) => {
    const swap = (params.swap as string) ?? "rg";

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];

      if (swap === "rg") {
        data[i] = g;
        data[i + 1] = r;
      } else if (swap === "rb") {
        data[i] = b;
        data[i + 2] = r;
      } else if (swap === "gb") {
        data[i + 1] = b;
        data[i + 2] = g;
      } else if (swap === "rgb") {
        data[i] = g;
        data[i + 1] = b;
        data[i + 2] = r;
      }
    }
  },
});

registerEffect({
  type: "rainbow-gradient",
  label: "Rainbow Gradient",
  category: "color",
  defaultParams: { speed: 1, intensity: 0.5, direction: "horizontal" },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_speed;
uniform float u_intensity;
uniform int u_direction;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float t = u_time * u_speed * 0.01;
  float pos;
  if (u_direction == 0)      pos = v_texCoord.x;
  else if (u_direction == 1) pos = v_texCoord.y;
  else if (u_direction == 2) pos = (v_texCoord.x + v_texCoord.y) * 0.5;
  else {
    vec2 d = v_texCoord - 0.5;
    pos = length(d) / 0.7071;
  }
  float hue = mod(pos + t, 1.0) * 360.0;
  vec3 rainbow = hslToRgb(hue, 1.0, 0.5);
  fragColor = vec4(mix(c.rgb, rainbow, u_intensity), c.a);
}`,
    uniforms: { speed: "float", intensity: "float", direction: "int" },
    uniformMapper: (p) => ({
      ...p,
      direction: ["horizontal", "vertical", "diagonal", "radial"].indexOf((p.direction as string) || "horizontal"),
    }),
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const speed = (params.speed as number) ?? 1;
    const intensity = (params.intensity as number) ?? 0.5;
    const direction = (params.direction as string) ?? "horizontal";

    const t = time * speed * 0.01;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        let position: number;
        if (direction === "horizontal") {
          position = x / width;
        } else if (direction === "vertical") {
          position = y / height;
        } else if (direction === "diagonal") {
          position = (x / width + y / height) / 2;
        } else {
          // radial
          const centerX = width / 2;
          const centerY = height / 2;
          const dx = x - centerX;
          const dy = y - centerY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);
          position = dist / maxDist;
        }

        // Create rainbow gradient with time animation
        const hue = ((position + t) % 1.0) * 360;
        const [r, g, b] = hslToRgb(hue / 360, 1.0, 0.5);

        // Blend with original
        data[i] = data[i] * (1 - intensity) + r * intensity;
        data[i + 1] = data[i + 1] * (1 - intensity) + g * intensity;
        data[i + 2] = data[i + 2] * (1 - intensity) + b * intensity;
      }
    }
  },
});

registerEffect({
  type: "gradient-flash",
  label: "Gradient Flash",
  category: "color",
  defaultParams: { speed: 2, intensity: 0.7, flashRate: 4 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_speed;
uniform float u_intensity;
uniform float u_flashRate;
void main() {
  vec4 c = texture(u_source, v_texCoord);
  float t = u_time * u_speed * 0.02;
  float flash = abs(sin(t * u_flashRate));
  float pos = (v_texCoord.x + v_texCoord.y) * 0.5;
  float hue = mod(pos + t, 1.0) * 360.0;
  vec3 rainbow = hslToRgb(hue, 1.0, 0.5);
  float fi = u_intensity * flash;
  fragColor = vec4(mix(c.rgb, rainbow, fi), c.a);
}`,
    uniforms: { speed: "float", intensity: "float", flashRate: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const speed = (params.speed as number) ?? 2;
    const intensity = (params.intensity as number) ?? 0.7;
    const flashRate = (params.flashRate as number) ?? 4;

    const t = time * speed * 0.02;
    const flash = Math.abs(Math.sin(t * flashRate));

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        const position = (x / width + y / height) / 2;
        const hue = ((position + t) % 1.0) * 360;
        const [r, g, b] = hslToRgb(hue / 360, 1.0, 0.5);

        const flashIntensity = intensity * flash;

        data[i] = data[i] * (1 - flashIntensity) + r * flashIntensity;
        data[i + 1] = data[i + 1] * (1 - flashIntensity) + g * flashIntensity;
        data[i + 2] = data[i + 2] * (1 - flashIntensity) + b * flashIntensity;
      }
    }
  },
});