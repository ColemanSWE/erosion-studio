import { registerEffect } from "../../effect-registry";

registerEffect({
  type: "bloom",
  label: "Bloom",
  category: "color",
  defaultParams: { threshold: 200, intensity: 0.5, radius: 3 },
  paramsConfig: [
    { key: "threshold", label: "Threshold", type: "slider", min: 0, max: 255, default: 200 },
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 2, step: 0.01, default: 0.5 },
    { key: "radius", label: "Radius", type: "slider", min: 1, max: 12, default: 3 },
  ],
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
