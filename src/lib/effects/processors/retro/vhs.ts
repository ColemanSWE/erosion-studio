import { registerEffect } from "../../effect-registry";
import { clamp, pseudoRandom, scratchCopy } from "../shared";

registerEffect({
  type: "vhs",
  label: "VHS",
  category: "retro",
  defaultParams: { intensity: 50 },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 100, default: 50 },
  ],
  glsl: {
    fragment: `
uniform float u_intensity;
void main() {
  float seed = floor(u_time / 3.0);
  vec2 px = 1.0 / u_resolution;
  float y = v_texCoord.y;
  float wobblePhase = sin(u_time * 0.017) * 3.14159;
  float wobbleFreq = 0.008 + sin(u_time * 0.023) * 0.003;
  float wobbleAmp = (u_intensity / 30.0) * (0.8 + sin(u_time * 0.031) * 0.4);
  float trackingOffset = sin(y * u_resolution.y * wobbleFreq + wobblePhase) * wobbleAmp
    + sin(y * u_resolution.y * wobbleFreq * 2.3 + u_time * 0.07) * (u_intensity / 80.0);
  float jitterSeed = floor(y * u_resolution.y / 10.0);
  float jitter = pseudoRandom(seed + y * u_resolution.y) < 0.02
    ? (pseudoRandom(seed + y * u_resolution.y * 2.0) - 0.5) * u_intensity * px.x
    : 0.0;
  float totalOffset = (trackingOffset + jitter) * px.x;
  int chromaOffset = int(u_intensity / 20.0);
  float chromaUV = float(chromaOffset) * px.x;
  float rX = clamp(v_texCoord.x + totalOffset + chromaUV, 0.0, 1.0);
  float gX = clamp(v_texCoord.x + totalOffset, 0.0, 1.0);
  float bX = clamp(v_texCoord.x + totalOffset - chromaUV, 0.0, 1.0);
  float r = texture(u_source, vec2(rX, y)).r;
  float g = texture(u_source, vec2(gX, y)).g;
  float b = texture(u_source, vec2(bX, y)).b;
  float noiseIntensity = u_intensity / 200.0;
  float pixIdx = floor(v_texCoord.x * u_resolution.x) + floor(y * u_resolution.y) * u_resolution.x;
  float addNoise = pseudoRandom(seed + pixIdx) < noiseIntensity
    ? (pseudoRandom(seed + pixIdx + 1.0) - 0.5) * 100.0 / 255.0
    : 0.0;
  fragColor = vec4(clamp(vec3(r, g, b) + addNoise, 0.0, 1.0), 1.0);
}`,
    uniforms: { intensity: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 50;
    if (intensity === 0) return;

    const source = scratchCopy(data, "vhs/source");
    const seed = Math.floor(time / 3);

    const wobblePhase = Math.sin(time * 0.017) * Math.PI;
    const wobbleFreq = 0.008 + Math.sin(time * 0.023) * 0.003;
    const wobbleAmp = (intensity / 30) * (0.8 + Math.sin(time * 0.031) * 0.4);

    for (let y = 0; y < height; y++) {
      const trackingOffset =
        Math.sin(y * wobbleFreq + wobblePhase) * wobbleAmp +
        Math.sin(y * wobbleFreq * 2.3 + time * 0.07) * (intensity / 80) +
        pseudoRandom(seed + Math.floor(y / 10)) * (intensity / 150);
      const jitter =
        pseudoRandom(seed + y) < 0.02
          ? Math.floor((pseudoRandom(seed + y * 2) - 0.5) * intensity)
          : 0;

      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const srcX = clamp(
          Math.floor(x + trackingOffset + jitter),
          0,
          width - 1
        );

        const chromaOffset = Math.floor(intensity / 20);
        const rX = clamp(srcX + chromaOffset, 0, width - 1);
        const bX = clamp(srcX - chromaOffset, 0, width - 1);

        data[i] = source[(y * width + rX) * 4];
        data[i + 1] = source[(y * width + srcX) * 4 + 1];
        data[i + 2] = source[(y * width + bX) * 4 + 2];
      }
    }

    const noiseIntensity = intensity / 200;
    for (let i = 0; i < data.length; i += 4) {
      if (pseudoRandom(seed + i) < noiseIntensity) {
        const noise = (pseudoRandom(seed + i + 1) - 0.5) * 100;
        data[i] = clamp(data[i] + noise, 0, 255);
        data[i + 1] = clamp(data[i + 1] + noise, 0, 255);
        data[i + 2] = clamp(data[i + 2] + noise, 0, 255);
      }
    }

    const numTrackingLines = Math.floor(intensity / 30);
    for (let t = 0; t < numTrackingLines; t++) {
      const lineY = Math.floor(pseudoRandom(seed + t * 1000) * height);
      const lineThickness = 1 + Math.floor(pseudoRandom(seed + t * 2000) * 3);

      for (let dy = 0; dy < lineThickness && lineY + dy < height; dy++) {
        for (let x = 0; x < width; x++) {
          const i = ((lineY + dy) * width + x) * 4;
          const brightness = 0.3 + pseudoRandom(seed + x + t) * 0.4;
          data[i] *= brightness;
          data[i + 1] *= brightness;
          data[i + 2] *= brightness;
        }
      }
    }
  },
});
