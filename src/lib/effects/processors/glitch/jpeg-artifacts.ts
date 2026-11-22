import { registerEffect } from "../../effect-registry";
import { scratchCopy } from "../shared";

registerEffect({
  type: "jpeg-artifacts",
  label: "JPEG Artifacts",
  category: "glitch",
  defaultParams: { quality: 30, blockiness: 50, colorBanding: 50 },
  paramsConfig: [
    { key: "quality", label: "Quality", type: "slider", min: 0, max: 100, default: 30 },
    { key: "blockiness", label: "Blockiness", type: "slider", min: 0, max: 100, default: 50 },
    { key: "colorBanding", label: "Color Banding", type: "slider", min: 0, max: 100, default: 50 },
  ],
  glsl: {
    fragment: `
uniform float u_quality;
uniform float u_blockiness;
uniform float u_colorBanding;
void main() {
  float seed = floor(u_time * 0.3);
  float compressionFactor = (1.0 - u_quality / 100.0) * 0.8;
  float chromaStep = 1.0 / pow(2.0, max(1.0, 4.0 - u_quality / 25.0));
  float bx = floor(v_texCoord.x * u_resolution.x / 8.0);
  float by = floor(v_texCoord.y * u_resolution.y / 8.0);
  // Approximate block avg using center of block
  vec2 centerUV = (vec2(bx, by) * 8.0 + 4.0) / u_resolution;
  vec3 avg = sampleClamped(centerUV).rgb;
  vec3 quantized = floor(avg / chromaStep + 0.5) * chromaStep;
  vec4 c = texture(u_source, v_texCoord);
  vec3 result = mix(c.rgb, quantized, compressionFactor);
  // Block edges
  if (u_blockiness > 30.0) {
    vec2 lxy = vec2(mod(v_texCoord.x * u_resolution.x, 8.0), mod(v_texCoord.y * u_resolution.y, 8.0));
    float edgeIntensity = (u_blockiness / 100.0) * 40.0 / 255.0;
    if (lxy.x < 1.0 || lxy.y < 1.0) result = max(result - edgeIntensity, 0.0);
  }
  // Color banding noise
  if (u_colorBanding > 30.0 && compressionFactor > 0.3) {
    float n = (pseudoRandom(seed + bx * 7.1 + by * 13.3) - 0.5) * (u_colorBanding / 100.0) * 20.0 / 255.0;
    result = clamp(result + n, 0.0, 1.0);
  }
  fragColor = vec4(result, c.a);
}`,
    uniforms: { quality: "float", blockiness: "float", colorBanding: "float" },
  },
  processor: (data, { width, height }, params) => {
    const quality = Math.max(
      1,
      Math.min(100, (params.quality as number) ?? 30),
    );
    const blockiness = (params.blockiness as number) ?? 50;
    const colorBanding = (params.colorBanding as number) ?? 50;

    const source = scratchCopy(data, "jpeg-artifacts/source");
    const blockSize = 8;
    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);

    const compressionFactor = 1 - quality / 100;
    const colorQuantization = Math.max(2, Math.floor(8 - quality / 15));
    const chromaQuantization = Math.max(1, Math.floor(colorQuantization / 2));

    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        const startX = bx * blockSize;
        const startY = by * blockSize;
        const endX = Math.min(startX + blockSize, width);
        const endY = Math.min(startY + blockSize, height);

        let avgR = 0,
          avgG = 0,
          avgB = 0;
        let count = 0;

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const idx = (y * width + x) * 4;
            avgR += source[idx];
            avgG += source[idx + 1];
            avgB += source[idx + 2];
            count++;
          }
        }

        avgR /= count;
        avgG /= count;
        avgB /= count;

        const _lumaStep = 256 / Math.pow(2, colorQuantization);
        const chromaStep = 256 / Math.pow(2, chromaQuantization);

        avgR = Math.round(avgR / chromaStep) * chromaStep;
        avgG = Math.round(avgG / chromaStep) * chromaStep;
        avgB = Math.round(avgB / chromaStep) * chromaStep;

        const blendFactor = compressionFactor * 0.8;

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const idx = (y * width + x) * 4;
            const origR = source[idx];
            const origG = source[idx + 1];
            const origB = source[idx + 2];

            data[idx] = origR * (1 - blendFactor) + avgR * blendFactor;
            data[idx + 1] = origG * (1 - blendFactor) + avgG * blendFactor;
            data[idx + 2] = origB * (1 - blendFactor) + avgB * blendFactor;
          }
        }

        if (blockiness > 30) {
          const edgeIntensity = (blockiness / 100) * 40;
          for (let x = startX; x < endX; x++) {
            if (startY < height) {
              const idx = (startY * width + x) * 4;
              data[idx] = Math.max(0, data[idx] - edgeIntensity);
              data[idx + 1] = Math.max(0, data[idx + 1] - edgeIntensity);
              data[idx + 2] = Math.max(0, data[idx + 2] - edgeIntensity);
            }
          }
          for (let y = startY; y < endY; y++) {
            if (startX < width) {
              const idx = (y * width + startX) * 4;
              data[idx] = Math.max(0, data[idx] - edgeIntensity);
              data[idx + 1] = Math.max(0, data[idx + 1] - edgeIntensity);
              data[idx + 2] = Math.max(0, data[idx + 2] - edgeIntensity);
            }
          }
        }
      }
    }

    if (colorBanding > 30 && compressionFactor > 0.3) {
      const bandingIntensity = colorBanding / 100;
      for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * bandingIntensity * 20;
        data[i] = Math.max(0, Math.min(255, data[i] + noise));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
      }
    }
  },
});
