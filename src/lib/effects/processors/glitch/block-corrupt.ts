import { registerEffect } from "../../effect-registry";
import { pseudoRandom, getBlockAverage, scratchCopy } from "../shared";

registerEffect({
  type: "block-corrupt",
  label: "Block Corrupt",
  category: "glitch",
  defaultParams: { intensity: 30, blockSize: 16 },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 100, default: 30 },
    { key: "blockSize", label: "Block Size", type: "select", options: ["8", "16", "32", "64"], default: 16 },
  ],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_blockSize;
void main() {
  float seed = floor(u_time / 8.0);
  float blocksX = ceil(u_resolution.x / u_blockSize);
  float blocksY = ceil(u_resolution.y / u_blockSize);
  float bx = floor(v_texCoord.x * u_resolution.x / u_blockSize);
  float by = floor(v_texCoord.y * u_resolution.y / u_blockSize);
  float blockId = bx + by * blocksX;
  float corruptProb = (u_intensity / 100.0) * 0.3;
  if (pseudoRandom(seed + blockId * 3.7) < corruptProb) {
    float effect = floor(pseudoRandom(seed + blockId * 2.3) * 4.0);
    vec2 lx = vec2(mod(v_texCoord.x * u_resolution.x, u_blockSize),
                   mod(v_texCoord.y * u_resolution.y, u_blockSize));
    if (effect < 1.0) {
      float srcBx = floor(pseudoRandom(seed + blockId * 4.1) * blocksX);
      float srcBy = floor(pseudoRandom(seed + blockId * 5.2) * blocksY);
      vec2 srcUV = (vec2(srcBx, srcBy) * u_blockSize + lx) / u_resolution;
      fragColor = sampleClamped(srcUV);
    } else if (effect < 2.0) {
      float shiftX = floor((pseudoRandom(seed + blockId * 6.3) - 0.5) * u_blockSize * 2.0);
      float newX = mod(v_texCoord.x * u_resolution.x + shiftX + u_resolution.x, u_resolution.x);
      fragColor = texture(u_source, vec2(newX / u_resolution.x, v_texCoord.y));
    } else if (effect < 3.0) {
      vec3 avg = vec3(0.0);
      float cnt = 0.0;
      for (int dy = 0; dy < 16; dy++) {
        if (float(dy) >= u_blockSize) break;
        for (int dx = 0; dx < 16; dx++) {
          if (float(dx) >= u_blockSize) break;
          vec2 suv = (vec2(bx, by) * u_blockSize + vec2(float(dx), float(dy))) / u_resolution;
          avg += texture(u_source, clamp(suv, 0.0, 1.0)).rgb;
          cnt += 1.0;
        }
      }
      fragColor = vec4(avg / max(cnt, 1.0), 1.0);
    } else {
      vec2 firstUV = vec2(bx, by) * u_blockSize / u_resolution;
      fragColor = sampleClamped(firstUV);
    }
  } else {
    fragColor = texture(u_source, v_texCoord);
  }
}`,
    uniforms: { intensity: "float", blockSize: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 30;
    const blockSize = (params.blockSize as number) ?? 16;
    if (intensity === 0) return;

    const source = scratchCopy(data, "block-corrupt/source");
    const seed = Math.floor((time || 0) / 8);

    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);
    const numCorrupt = Math.floor(blocksX * blocksY * (intensity / 100) * 0.3);

    for (let i = 0; i < numCorrupt; i++) {
      const bx = Math.floor(pseudoRandom(seed + i * 100) * blocksX);
      const by = Math.floor(pseudoRandom(seed + i * 200) * blocksY);
      const effect = Math.floor(pseudoRandom(seed + i * 300) * 4);

      const startX = bx * blockSize;
      const startY = by * blockSize;
      const endX = Math.min(startX + blockSize, width);
      const endY = Math.min(startY + blockSize, height);

      if (effect === 0) {
        const srcBx = Math.floor(pseudoRandom(seed + i * 400) * blocksX);
        const srcBy = Math.floor(pseudoRandom(seed + i * 500) * blocksY);
        const srcStartX = srcBx * blockSize;
        const srcStartY = srcBy * blockSize;

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const srcX = srcStartX + (x - startX);
            const srcY = srcStartY + (y - startY);
            if (srcX < width && srcY < height) {
              const dstIdx = (y * width + x) * 4;
              const srcIdx = (srcY * width + srcX) * 4;
              data[dstIdx] = source[srcIdx];
              data[dstIdx + 1] = source[srcIdx + 1];
              data[dstIdx + 2] = source[srcIdx + 2];
            }
          }
        }
      } else if (effect === 1) {
        const shiftX = Math.floor(
          (pseudoRandom(seed + i * 600) - 0.5) * blockSize * 2,
        );
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const srcX = (((x + shiftX) % width) + width) % width;
            const dstIdx = (y * width + x) * 4;
            const srcIdx = (y * width + srcX) * 4;
            data[dstIdx] = source[srcIdx];
            data[dstIdx + 1] = source[srcIdx + 1];
            data[dstIdx + 2] = source[srcIdx + 2];
          }
        }
      } else if (effect === 2) {
        const avgR = getBlockAverage(
          source,
          width,
          startX,
          startY,
          endX,
          endY,
          0,
        );
        const avgG = getBlockAverage(
          source,
          width,
          startX,
          startY,
          endX,
          endY,
          1,
        );
        const avgB = getBlockAverage(
          source,
          width,
          startX,
          startY,
          endX,
          endY,
          2,
        );
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const idx = (y * width + x) * 4;
            data[idx] = avgR;
            data[idx + 1] = avgG;
            data[idx + 2] = avgB;
          }
        }
      } else {
        const firstPixelIdx = (startY * width + startX) * 4;
        const repeatR = source[firstPixelIdx];
        const repeatG = source[firstPixelIdx + 1];
        const repeatB = source[firstPixelIdx + 2];
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const idx = (y * width + x) * 4;
            data[idx] = repeatR;
            data[idx + 1] = repeatG;
            data[idx + 2] = repeatB;
          }
        }
      }
    }
  },
});
