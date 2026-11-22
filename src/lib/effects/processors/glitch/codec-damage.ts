import { registerEffect } from "../../effect-registry";
import { scratchCopy } from "../shared";

registerEffect({
  type: "codec-damage",
  label: "Codec Damage",
  category: "glitch",
  defaultParams: {
    intensity: 50,
    blockSize: 16,
    colorBleed: 50,
    temporal: true,
  },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 100, default: 50 },
    { key: "blockSize", label: "Block Size", type: "select", options: ["8", "16", "32"], default: 16 },
    { key: "colorBleed", label: "Color Bleed", type: "slider", min: 0, max: 100, default: 50 },
    { key: "temporal", label: "Temporal", type: "checkbox", default: true },
  ],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_blockSize;
uniform float u_colorBleed;
uniform bool u_temporal;
void main() {
  float seed = u_temporal ? floor(u_time / 10.0) : 0.0;
  float blocksX = ceil(u_resolution.x / u_blockSize);
  float blocksY = ceil(u_resolution.y / u_blockSize);
  float bx = floor(v_texCoord.x * u_resolution.x / u_blockSize);
  float by = floor(v_texCoord.y * u_resolution.y / u_blockSize);
  float blockId = bx + by * blocksX;
  float corruptProb = (u_intensity / 100.0) * 0.5;
  vec2 lxy = vec2(mod(v_texCoord.x * u_resolution.x, u_blockSize), mod(v_texCoord.y * u_resolution.y, u_blockSize));
  vec4 c;
  if (pseudoRandom(seed + blockId * 3.7) < corruptProb) {
    float ct = floor(pseudoRandom(seed + blockId * 2.1) * 3.0);
    if (ct < 1.0) {
      float sbx = floor(pseudoRandom(seed + blockId * 4.3) * blocksX);
      float sby = floor(pseudoRandom(seed + blockId * 5.7) * blocksY);
      vec2 srcUV = (vec2(sbx, sby) * u_blockSize + lxy) / u_resolution;
      c = sampleClamped(srcUV);
    } else if (ct < 2.0) {
      // Average block color
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
      c = vec4(avg / max(cnt, 1.0), 1.0);
    } else {
      float shiftX = (pseudoRandom(seed + blockId * 6.9) - 0.5) * u_blockSize * 0.5;
      float shiftY = (pseudoRandom(seed + blockId * 8.1) - 0.5) * u_blockSize * 0.5;
      vec2 srcUV = mod(v_texCoord * u_resolution + vec2(shiftX, shiftY), u_resolution) / u_resolution;
      c = texture(u_source, srcUV);
    }
  } else {
    c = texture(u_source, v_texCoord);
  }
  // Color bleed
  if (u_colorBleed > 20.0) {
    float bleed = u_colorBleed / 100.0;
    float cbs = u_blockSize * 2.0;
    float cbx = floor(v_texCoord.x * u_resolution.x / cbs);
    float cby = floor(v_texCoord.y * u_resolution.y / cbs);
    float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    vec3 chroma = c.rgb - luma;
    // Approximate block average chroma using center sample
    vec2 centerUV = (vec2(cbx, cby) * cbs + cbs * 0.5) / u_resolution;
    vec3 center = sampleClamped(centerUV).rgb;
    float centerLuma = dot(center, vec3(0.299, 0.587, 0.114));
    vec3 centerChroma = center - centerLuma;
    c.rgb = clamp(vec3(luma) + mix(chroma, centerChroma, bleed), 0.0, 1.0);
  }
  fragColor = c;
}`,
    uniforms: {
      intensity: "float",
      blockSize: "float",
      colorBleed: "float",
      temporal: "bool",
    },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const blockSize = (params.blockSize as number) ?? 16;
    const colorBleed = (params.colorBleed as number) ?? 50;
    const temporal = (params.temporal as boolean) ?? true;

    if (intensity === 0) return;

    const source = scratchCopy(data, "codec-damage/source");
    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);

    const seed = temporal ? Math.floor(time / 10) : 0;

    const pseudoRandom = (s: number): number => {
      const x = Math.sin(s * 12.9898 + 78.233) * 43758.5453;
      return x - Math.floor(x);
    };

    const maxBlocks = Math.min(100, blocksX * blocksY);
    const numCorrupt = Math.floor(maxBlocks * (intensity / 100) * 0.5);

    for (let i = 0; i < numCorrupt; i++) {
      const bx = Math.floor(pseudoRandom(seed + i * 100) * blocksX);
      const by = Math.floor(pseudoRandom(seed + i * 200) * blocksY);
      const corruptType = Math.floor(pseudoRandom(seed + i * 300) * 3);

      const startX = bx * blockSize;
      const startY = by * blockSize;
      const endX = Math.min(startX + blockSize, width);
      const endY = Math.min(startY + blockSize, height);

      if (corruptType === 0) {
        const srcBx = Math.floor(pseudoRandom(seed + i * 400) * blocksX);
        const srcBy = Math.floor(pseudoRandom(seed + i * 500) * blocksY);
        const srcStartX = srcBx * blockSize;
        const srcStartY = srcBy * blockSize;

        for (let y = startY; y < endY; y++) {
          const rowOffset = y - startY;
          const srcY = srcStartY + rowOffset;
          if (srcY >= height) continue;

          const dstRowIdx = y * width * 4;
          const srcRowIdx = srcY * width * 4;

          for (let x = startX; x < endX; x++) {
            const srcX = srcStartX + (x - startX);
            if (srcX < width) {
              const dstIdx = dstRowIdx + x * 4;
              const srcIdx = srcRowIdx + srcX * 4;
              data[dstIdx] = source[srcIdx];
              data[dstIdx + 1] = source[srcIdx + 1];
              data[dstIdx + 2] = source[srcIdx + 2];
            }
          }
        }
      } else if (corruptType === 1) {
        let blockR = 0,
          blockG = 0,
          blockB = 0;
        const sampleStep = 2;
        let count = 0;

        for (let y = startY; y < endY; y += sampleStep) {
          for (let x = startX; x < endX; x += sampleStep) {
            const idx = (y * width + x) * 4;
            blockR += source[idx];
            blockG += source[idx + 1];
            blockB += source[idx + 2];
            count++;
          }
        }

        if (count > 0) {
          blockR /= count;
          blockG /= count;
          blockB /= count;

          for (let y = startY; y < endY; y++) {
            const rowIdx = y * width * 4;
            for (let x = startX; x < endX; x++) {
              const idx = rowIdx + x * 4;
              data[idx] = blockR;
              data[idx + 1] = blockG;
              data[idx + 2] = blockB;
            }
          }
        }
      } else if (corruptType === 2) {
        const shiftX = Math.floor(
          (pseudoRandom(seed + i * 600) - 0.5) * blockSize * 0.5,
        );
        const shiftY = Math.floor(
          (pseudoRandom(seed + i * 700) - 0.5) * blockSize * 0.5,
        );

        for (let y = startY; y < endY; y++) {
          let srcY = y + shiftY;
          if (srcY < 0) srcY += height;
          if (srcY >= height) srcY -= height;

          const dstRowIdx = y * width * 4;
          const srcRowIdx = srcY * width * 4;

          for (let x = startX; x < endX; x++) {
            let srcX = x + shiftX;
            if (srcX < 0) srcX += width;
            if (srcX >= width) srcX -= width;

            const dstIdx = dstRowIdx + x * 4;
            const srcIdx = srcRowIdx + srcX * 4;
            data[dstIdx] = source[srcIdx];
            data[dstIdx + 1] = source[srcIdx + 1];
            data[dstIdx + 2] = source[srcIdx + 2];
          }
        }
      }
    }

    if (colorBleed > 20) {
      const bleedIntensity = colorBleed / 100;
      const chromaBlockSize = blockSize * 2;
      const chromaBlocksX = Math.ceil(width / chromaBlockSize);
      const chromaBlocksY = Math.ceil(height / chromaBlockSize);

      for (let by = 0; by < chromaBlocksY; by++) {
        for (let bx = 0; bx < chromaBlocksX; bx++) {
          const startX = bx * chromaBlockSize;
          const startY = by * chromaBlockSize;
          const endX = Math.min(startX + chromaBlockSize, width);
          const endY = Math.min(startY + chromaBlockSize, height);

          let avgR = 0,
            avgG = 0,
            avgB = 0,
            count = 0;

          for (let y = startY; y < endY; y++) {
            const rowIdx = y * width * 4;
            for (let x = startX; x < endX; x++) {
              const idx = rowIdx + x * 4;
              avgR += data[idx];
              avgG += data[idx + 1];
              avgB += data[idx + 2];
              count++;
            }
          }

          avgR /= count;
          avgG /= count;
          avgB /= count;

          const boost = 1 + bleedIntensity * 0.3;
          avgR = Math.min(255, avgR * boost);
          avgG = Math.min(255, avgG * boost);
          avgB = Math.min(255, avgB * boost);

          for (let y = startY; y < endY; y++) {
            const rowIdx = y * width * 4;
            for (let x = startX; x < endX; x++) {
              const idx = rowIdx + x * 4;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];

              const luma = r * 0.299 + g * 0.587 + b * 0.114;
              const chromaR = r - luma;
              const chromaG = g - luma;
              const chromaB = b - luma;

              const avgChromaR =
                avgR - (avgR * 0.299 + avgG * 0.587 + avgB * 0.114);
              const avgChromaG =
                avgG - (avgR * 0.299 + avgG * 0.587 + avgB * 0.114);
              const avgChromaB =
                avgB - (avgR * 0.299 + avgG * 0.587 + avgB * 0.114);

              const newR =
                luma +
                chromaR * (1 - bleedIntensity) +
                avgChromaR * bleedIntensity;
              const newG =
                luma +
                chromaG * (1 - bleedIntensity) +
                avgChromaG * bleedIntensity;
              const newB =
                luma +
                chromaB * (1 - bleedIntensity) +
                avgChromaB * bleedIntensity;

              data[idx] = Math.max(0, Math.min(255, newR));
              data[idx + 1] = Math.max(0, Math.min(255, newG));
              data[idx + 2] = Math.max(0, Math.min(255, newB));
            }
          }
        }
      }
    }
  },
});
