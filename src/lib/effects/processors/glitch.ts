import { registerEffect, ProcessConfig } from "../effect-registry";
import { EffectType, EffectParamConfig } from "../types";
import { FaceBounds, HandBounds, PoseBounds, getEyeLandmarks, getMouthLandmarks, getLandmarkBounds } from "../face-detector";
import { BAYER_MATRIX_4x4, motionSmearState, blockShovingState, bilinearSample, meltState, perlinNoise, posterizeTimeCache, pseudoRandom, clamp, sortSegment, sortSegmentV, getBlockAverage, hexToRgb, rgbToHsl, hslToRgb, isPointInFaceBounds, frameHistoryStore, storeFrame, getFrameFromHistory } from "./shared";

let pixelSortBuffer: Uint8ClampedArray | null = null;

function getPixelSortBuffer(size: number): Uint8ClampedArray {
  if (!pixelSortBuffer || pixelSortBuffer.length !== size) {
    pixelSortBuffer = new Uint8ClampedArray(size);
  }
  return pixelSortBuffer;
}

registerEffect({
  type: "glitch",
  label: "Digital Glitch",
  category: "glitch",
  defaultParams: { intensity: 50, speed: 10 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_speed;
void main() {
  if (u_intensity == 0.0) { fragColor = texture(u_source, v_texCoord); return; }
  float t = u_time * (u_speed / 10.0);
  float seed = floor(t / 5.0);
  int numSlices = int(floor(3.0 + u_intensity / 20.0));
  vec2 uv = v_texCoord;
  float py = floor(uv.y * u_resolution.y);
  int channelShiftApplied = -1;
  float shiftXApplied = 0.0;
  for (int s = 0; s < 10; s++) {
    if (s >= numSlices) break;
    float sliceY = floor(pseudoRandom(seed + float(s) * 1000.0) * u_resolution.y);
    float sliceH = floor(2.0 + pseudoRandom(seed + float(s) * 2000.0) * (u_intensity / 3.0));
    if (py >= sliceY && py < sliceY + sliceH) {
      shiftXApplied = floor((pseudoRandom(seed + float(s) * 3000.0) - 0.5) * u_intensity * 2.0);
      channelShiftApplied = int(floor(pseudoRandom(seed + float(s) * 4000.0) * 3.0));
      break;
    }
  }
  float shiftUV = shiftXApplied / u_resolution.x;
  vec4 original = texture(u_source, uv);
  if (channelShiftApplied == 0) {
    float r = sampleClamped(vec2(uv.x + shiftUV, uv.y)).r;
    fragColor = vec4(r, original.g, original.b, original.a);
  } else if (channelShiftApplied == 1) {
    float g = sampleClamped(vec2(uv.x + shiftUV, uv.y)).g;
    fragColor = vec4(original.r, g, original.b, original.a);
  } else if (channelShiftApplied == 2) {
    float b = sampleClamped(vec2(uv.x + shiftUV, uv.y)).b;
    fragColor = vec4(original.r, original.g, b, original.a);
  } else {
    fragColor = original;
  }
}`,
    uniforms: { intensity: "float", speed: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const speed = (params.speed as number) ?? 10;
    if (intensity === 0) return;

    const source = new Uint8ClampedArray(data);
    const t = time * (speed / 10);
    const seed = Math.floor(t / 5);

    const numSlices = Math.floor(3 + intensity / 20);
    for (let s = 0; s < numSlices; s++) {
      const sliceY = Math.floor(pseudoRandom(seed + s * 1000) * height);
      const sliceHeight = Math.floor(
        2 + pseudoRandom(seed + s * 2000) * (intensity / 3)
      );
      const shiftX = Math.floor(
        (pseudoRandom(seed + s * 3000) - 0.5) * (intensity * 2)
      );
      const channelShift = Math.floor(pseudoRandom(seed + s * 4000) * 3);

      for (let y = sliceY; y < Math.min(sliceY + sliceHeight, height); y++) {
        for (let x = 0; x < width; x++) {
          const srcX = (((x - shiftX) % width) + width) % width;
          const srcIdx = (y * width + srcX) * 4;
          const dstIdx = (y * width + x) * 4;

          if (channelShift === 0) {
            data[dstIdx] = source[srcIdx];
            data[dstIdx + 1] = source[(y * width + x) * 4 + 1];
            data[dstIdx + 2] = source[(y * width + x) * 4 + 2];
          } else if (channelShift === 1) {
            data[dstIdx] = source[(y * width + x) * 4];
            data[dstIdx + 1] = source[srcIdx + 1];
            data[dstIdx + 2] = source[(y * width + x) * 4 + 2];
          } else {
            data[dstIdx] = source[(y * width + x) * 4];
            data[dstIdx + 1] = source[(y * width + x) * 4 + 1];
            data[dstIdx + 2] = source[srcIdx + 2];
          }
        }
      }
    }

    if (intensity > 30) {
      const corruptLines = Math.floor(intensity / 20);
      for (let c = 0; c < corruptLines; c++) {
        const y = Math.floor(pseudoRandom(seed + c * 5000 + t) * height);
        const corruptType = Math.floor(pseudoRandom(seed + c * 6000) * 3);

        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (corruptType === 0) {
            data[i] =
              data[i + 1] =
              data[i + 2] =
                pseudoRandom(seed + x) > 0.5 ? 255 : 0;
          } else if (corruptType === 1) {
            const repeat =
              data[(y * width + Math.floor(x / 8) * 8) * 4 + (x % 3)];
            data[i] = data[i + 1] = data[i + 2] = repeat;
          } else {
            data[i + Math.floor(pseudoRandom(seed + x) * 3)] = 255;
          }
        }
      }
    }
  },
});

registerEffect({
  type: "motion-smear",
  label: "Motion Smear",
  category: "glitch",
    defaultParams: { mode: "melt", intensity: 70, momentum: 0.92, mediaSources: [] },
  paramsConfig: [],
  processor: (data, { width, height, time = 0, timelineFrames }, params) => {
    const mode = (params.mode as string) ?? "melt";
    const intensity = (params.intensity as number) ?? 70;
    const momentum = (params.momentum as number) ?? 0.92;
    if (intensity === 0) return;

    const strength = intensity / 100;
    const blockSize = 16;
    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);
    const totalBlocks = blocksX * blocksY;

    const needsInit =
      motionSmearState.width !== width ||
      motionSmearState.height !== height ||
      !motionSmearState.prevFrame;

    if (needsInit) {
      motionSmearState.prevFrame = new Uint8ClampedArray(data);
      motionSmearState.meltBuffer = new Uint8ClampedArray(data);
      motionSmearState.mvX = new Float32Array(totalBlocks);
      motionSmearState.mvY = new Float32Array(totalBlocks);
      motionSmearState.width = width;
      motionSmearState.height = height;
      return;
    }

    const prev = motionSmearState.prevFrame!;
    const melt = motionSmearState.meltBuffer!;
    const mvX = motionSmearState.mvX!;
    const mvY = motionSmearState.mvY!;

    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        const bi = by * blocksX + bx;
        const startX = bx * blockSize;
        const startY = by * blockSize;
        const endX = Math.min(startX + blockSize, width);
        const endY = Math.min(startY + blockSize, height);

        let bestDx = 0,
          bestDy = 0,
          bestScore = Infinity;
        const search = 16;

        for (let dy = -search; dy <= search; dy += 4) {
          for (let dx = -search; dx <= search; dx += 4) {
            let score = 0;
            let samples = 0;
            for (let py = startY; py < endY; py += 4) {
              for (let px = startX; px < endX; px += 4) {
                const sx = px + dx;
                const sy = py + dy;
                if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
                const ci = (py * width + px) * 4;
                const si = (sy * width + sx) * 4;
                score +=
                  Math.abs(data[ci] - prev[si]) +
                  Math.abs(data[ci + 1] - prev[si + 1]) +
                  Math.abs(data[ci + 2] - prev[si + 2]);
                samples++;
              }
            }
            if (samples > 0) score /= samples;
            if (score < bestScore) {
              bestScore = score;
              bestDx = dx;
              bestDy = dy;
            }
          }
        }

        mvX[bi] = mvX[bi] * momentum + bestDx * (1 - momentum);
        mvY[bi] = mvY[bi] * momentum + bestDy * (1 - momentum);
      }
    }

    const sourceImg =
      timelineFrames && timelineFrames.length > 0 ? timelineFrames[0] : null;
    const output = new Uint8ClampedArray(data.length);

    if (mode === "bloom" && sourceImg) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const bx = Math.floor(x / blockSize);
          const by = Math.floor(y / blockSize);
          const bi = Math.min(by * blocksX + bx, totalBlocks - 1);

          const dx = mvX[bi] * strength * 3;
          const dy = mvY[bi] * strength * 3;

          const srcX = Math.max(
            0,
            Math.min(
              sourceImg.width - 1,
              Math.floor((x / width) * sourceImg.width + dx)
            )
          );
          const srcY = Math.max(
            0,
            Math.min(
              sourceImg.height - 1,
              Math.floor((y / height) * sourceImg.height + dy)
            )
          );
          const srcI = (srcY * sourceImg.width + srcX) * 4;

          output[i] = sourceImg.data[srcI];
          output[i + 1] = sourceImg.data[srcI + 1];
          output[i + 2] = sourceImg.data[srcI + 2];
          output[i + 3] = 255;
        }
      }
    } else {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const bx = Math.floor(x / blockSize);
          const by = Math.floor(y / blockSize);
          const bi = Math.min(by * blocksX + bx, totalBlocks - 1);

          const dx = mvX[bi] * strength * 2;
          const dy = mvY[bi] * strength * 2;

          const srcX = Math.max(0, Math.min(width - 1, Math.round(x + dx)));
          const srcY = Math.max(0, Math.min(height - 1, Math.round(y + dy)));
          const srcI = (srcY * width + srcX) * 4;

          output[i] = melt[srcI];
          output[i + 1] = melt[srcI + 1];
          output[i + 2] = melt[srcI + 2];
          output[i + 3] = 255;
        }
      }

      const blendBack = 1 - (momentum * 0.5 + 0.4);
      for (let i = 0; i < data.length; i += 4) {
        melt[i] = output[i] * (1 - blendBack) + data[i] * blendBack;
        melt[i + 1] = output[i + 1] * (1 - blendBack) + data[i + 1] * blendBack;
        melt[i + 2] = output[i + 2] * (1 - blendBack) + data[i + 2] * blendBack;
      }
    }

    for (let i = 0; i < data.length; i++) {
      data[i] = output[i];
    }

    motionSmearState.prevFrame = new Uint8ClampedArray(data);
  },
});

registerEffect({
  type: "block-shoving",
  label: "Block Shoving",
  category: "glitch",
  defaultParams: {
    style: "block",
    intensity: 50,
    blockSize: 16,
    resetInterval: 0,
  },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 100, step: 1 },
    { key: "blockSize", label: "Block Size", type: "slider", min: 4, max: 64, step: 4 },
    { key: "style", label: "Style", type: "select", options: ["block", "fluid"] },
    { key: "resetInterval", label: "Reset Interval (s, 0=off)", type: "slider", min: 0, max: 30, step: 0.5 },
  ],
  processor: (data, { width, height }, params) => {
    const style = (params.style as string) ?? "block";
    const intensity = (params.intensity as number) ?? 50;
    const blockSize = (params.blockSize as number) ?? 16;
    const resetInterval = (params.resetInterval as number) ?? 0;

    if (intensity === 0) return;

    const strength = intensity / 50;
    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);
    const totalBlocks = blocksX * blocksY;

    const needsInit =
      blockShovingState.width !== width ||
      blockShovingState.height !== height ||
      !blockShovingState.prevInput;

    const currentInput = new Uint8ClampedArray(data);

    if (needsInit) {
      blockShovingState.prevInput = currentInput;
      blockShovingState.moshBuffer = new Uint8ClampedArray(data);
      blockShovingState.width = width;
      blockShovingState.height = height;
      blockShovingState.mvXBuffer = new Float32Array(totalBlocks);
      blockShovingState.mvYBuffer = new Float32Array(totalBlocks);
      blockShovingState.lastResetMs = Date.now();
      return;
    }

    const prevInput = blockShovingState.prevInput!;
    const moshBuffer = blockShovingState.moshBuffer!;

    if (
      !blockShovingState.mvXBuffer ||
      blockShovingState.mvXBuffer.length !== totalBlocks
    ) {
      blockShovingState.mvXBuffer = new Float32Array(totalBlocks);
      blockShovingState.mvYBuffer = new Float32Array(totalBlocks);
    }
    const mvX = blockShovingState.mvXBuffer!;
    const mvY = blockShovingState.mvYBuffer!;

    if (resetInterval > 0 && Date.now() - blockShovingState.lastResetMs >= resetInterval * 1000) {
      moshBuffer.set(currentInput);
      blockShovingState.lastResetMs = Date.now();
    }

    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        const bi = by * blocksX + bx;
        const startX = bx * blockSize;
        const startY = by * blockSize;
        const endX = Math.min(startX + blockSize, width);
        const endY = Math.min(startY + blockSize, height);

        let bestDx = 0,
          bestDy = 0,
          bestScore = Infinity;
        const search = 16;

        for (let dy = -search; dy <= search; dy += 8) {
          for (let dx = -search; dx <= search; dx += 8) {
            let score = 0;
            let samples = 0;
            for (let py = startY; py < endY; py += 8) {
              for (let px = startX; px < endX; px += 8) {
                const sx = px + dx;
                const sy = py + dy;
                if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;

                const ci = (py * width + px) * 4;
                const si = (sy * width + sx) * 4;

                const lumC =
                  currentInput[ci] +
                  currentInput[ci + 1] +
                  currentInput[ci + 2];
                const lumP =
                  prevInput[si] + prevInput[si + 1] + prevInput[si + 2];

                score += Math.abs(lumC - lumP);
                samples++;
              }
            }
            if (samples > 0) score /= samples;
            if (score < bestScore) {
              bestScore = score;
              bestDx = dx;
              bestDy = dy;
            }
          }
        }

        mvX[bi] = mvX[bi] * 0.5 + bestDx * 0.5;
        mvY[bi] = mvY[bi] * 0.5 + bestDy * 0.5;
      }
    }

    const tempBuffer = new Uint8ClampedArray(moshBuffer);

    if (style === "fluid") {
      const smoothMVX = new Float32Array(totalBlocks);
      const smoothMVY = new Float32Array(totalBlocks);

      for (let by = 0; by < blocksY; by++) {
        for (let bx = 0; bx < blocksX; bx++) {
          const bi = by * blocksX + bx;
          let sumX = 0,
            sumY = 0,
            count = 0;

          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const ny = by + ky;
              const nx = bx + kx;
              if (ny >= 0 && ny < blocksY && nx >= 0 && nx < blocksX) {
                const ni = ny * blocksX + nx;
                sumX += mvX[ni];
                sumY += mvY[ni];
                count++;
              }
            }
          }
          smoothMVX[bi] = sumX / count;
          smoothMVY[bi] = sumY / count;
        }
      }

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const bx = Math.min(blocksX - 1, Math.floor(x / blockSize));
          const by = Math.min(blocksY - 1, Math.floor(y / blockSize));
          const bi = by * blocksX + bx;

          const dx = smoothMVX[bi] * strength;
          const dy = smoothMVY[bi] * strength;

          const srcX = x + dx;
          const srcY = y + dy;

          const r = bilinearSample(tempBuffer, width, height, srcX, srcY, 0);
          const g = bilinearSample(tempBuffer, width, height, srcX, srcY, 1);
          const b = bilinearSample(tempBuffer, width, height, srcX, srcY, 2);

          const di = (y * width + x) * 4;
          moshBuffer[di] = r;
          moshBuffer[di + 1] = g;
          moshBuffer[di + 2] = b;
          moshBuffer[di + 3] = 255;
        }
      }
    } else {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const bx = Math.floor(x / blockSize);
          const by = Math.floor(y / blockSize);
          const bi = Math.min(by * blocksX + bx, totalBlocks - 1);

          const dx = mvX[bi] * strength;
          const dy = mvY[bi] * strength;

          const srcX = Math.max(0, Math.min(width - 1, Math.round(x + dx)));
          const srcY = Math.max(0, Math.min(height - 1, Math.round(y + dy)));

          const dstI = (y * width + x) * 4;
          const srcI = (srcY * width + srcX) * 4;

          moshBuffer[dstI] = tempBuffer[srcI];
          moshBuffer[dstI + 1] = tempBuffer[srcI + 1];
          moshBuffer[dstI + 2] = tempBuffer[srcI + 2];
        }
      }
    }

    for (let i = 0; i < data.length; i++) {
      data[i] = moshBuffer[i];
    }

    blockShovingState.prevInput = currentInput;
  },
});


registerEffect({
  type: "block-corrupt",
  label: "Block Corrupt",
  category: "glitch",
  defaultParams: { intensity: 30, blockSize: 16 },
  paramsConfig: [],
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

    const source = new Uint8ClampedArray(data);
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
          (pseudoRandom(seed + i * 600) - 0.5) * blockSize * 2
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
          0
        );
        const avgG = getBlockAverage(
          source,
          width,
          startX,
          startY,
          endX,
          endY,
          1
        );
        const avgB = getBlockAverage(
          source,
          width,
          startX,
          startY,
          endX,
          endY,
          2
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

const PS_DIRECTION_STEPS: Record<string, { dx: number; dy: number }> = {
  horizontal:      { dx:  1, dy:  0 },
  vertical:        { dx:  0, dy:  1 },
  "diagonal-down": { dx:  1, dy:  1 },
  "diagonal-up":   { dx:  1, dy: -1 },
};

const PS_SORT_PASSES_MAX = 2048;

// Flat TypedArray buffers for zero-allocation counting sort
const PS_MAX_DIMENSION = 16384; // Safe margin handling up to 8K resolution diagonals
const _psOffsets = new Uint32Array(PS_MAX_DIMENSION);
const _psPixels = new Uint32Array(PS_MAX_DIMENSION);
const _psKeys = new Uint16Array(PS_MAX_DIMENSION);
const _psCounts = new Uint16Array(766);
const _psStarts = new Uint16Array(766);
const _psSorted = new Uint32Array(PS_MAX_DIMENSION);

registerEffect({
  type: "pixel-sort",
  label: "Pixel Sort",
  category: "glitch",
  defaultParams: { threshold: 80, direction: "horizontal" },
  paramsConfig: [
    { key: "threshold", label: "Threshold", type: "slider", min: 0, max: 255, step: 1, default: 80 },
    {
      key: "direction",
      label: "Direction",
      type: "select",
      options: ["horizontal", "vertical", "diagonal-down", "diagonal-up"],
      default: "horizontal",
    },
  ],
  processor: (data, { width, height }, params) => {
    const threshold = Number(params.threshold ?? 80);
    const dirKey = String(params.direction || "horizontal");
    const { dx, dy } = PS_DIRECTION_STEPS[dirKey] ?? PS_DIRECTION_STEPS.horizontal;

    let segLen = 0;

    const flushSegment = () => {
      if (segLen <= 1) {
        segLen = 0;
        return;
      }
      
      // 1. Reset counts
      _psCounts.fill(0, 0, 766);
      
      // 2. Tally keys
      for (let i = 0; i < segLen; i++) {
        _psCounts[_psKeys[i]]++;
      }
      
      // 3. Prefix sums for start indices
      let currentStart = 0;
      for (let k = 0; k < 766; k++) {
        _psStarts[k] = currentStart;
        currentStart += _psCounts[k];
      }
      
      // 4. Sort pixels by placing them into the correct spots
      for (let i = 0; i < segLen; i++) {
        const key = _psKeys[i];
        const pos = _psStarts[key]++;
        _psSorted[pos] = _psPixels[i];
      }
      
      // 5. Write back to data buffer
      // End index must be 'segLen'
      // Iterate via out++ where out is our segment iterator
      for (let i = 0; i < segLen; i++) {
        const o = _psOffsets[i];
        const rgb = _psSorted[i];
        
        // Extract RGB
        data[o] = (rgb >> 16) & 0xFF;     // R
        data[o + 1] = (rgb >> 8) & 0xFF;  // G
        data[o + 2] = rgb & 0xFF;         // B
      }

      segLen = 0;
    };

    const processLine = (sx: number, sy: number) => {
      segLen = 0;
      let x = sx;
      let y = sy;
      while (x >= 0 && x < width && y >= 0 && y < height) {
        const o = (y * width + x) * 4;
        const r = data[o];
        const gv = data[o + 1];
        const b = data[o + 2];
        const bri = (r + gv + b) / 3;
        
        if (bri > threshold) {
          _psOffsets[segLen] = o;
          _psPixels[segLen] = (r << 16) | (gv << 8) | b;
          _psKeys[segLen] = r + gv + b;
          segLen++;
        } else {
          flushSegment();
        }
        x += dx;
        y += dy;
      }
      flushSegment();
    };

    // Edge Traversal logic
    if (dy === 0) {
      const startX = dx > 0 ? 0 : width - 1;
      for (let y = 0; y < height; y++) processLine(startX, y);
      return;
    }
    if (dx === 0) {
      const startY = dy > 0 ? 0 : height - 1;
      for (let x = 0; x < width; x++) processLine(x, startY);
      return;
    }
    if (dy > 0) {
      for (let x = 0; x < width; x++) processLine(x, 0);
      const sideX = dx > 0 ? 0 : width - 1;
      // Start y=1 to avoid double-processing the corner
      for (let y = 1; y < height; y++) processLine(sideX, y);
    } else {
      for (let x = 0; x < width; x++) processLine(x, height - 1);
      const sideX = dx > 0 ? 0 : width - 1;
      for (let y = 0; y < height - 1; y++) processLine(sideX, y);
    }
  },
});

registerEffect({
  type: "rgb-channel-separation",
  label: "RGB Split",
  category: "glitch",
  defaultParams: { rOffset: 5, gOffset: 0, bOffset: -5 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_rOffset;
uniform float u_gOffset;
uniform float u_bOffset;
void main() {
  vec2 px = 1.0 / u_resolution;
  float r = sampleClamped(vec2(v_texCoord.x + u_rOffset * px.x, v_texCoord.y)).r;
  float g = sampleClamped(vec2(v_texCoord.x + u_gOffset * px.x, v_texCoord.y)).g;
  float b = sampleClamped(vec2(v_texCoord.x + u_bOffset * px.x, v_texCoord.y)).b;
  fragColor = vec4(r, g, b, 1.0);
}`,
    uniforms: { rOffset: "float", gOffset: "float", bOffset: "float" },
  },
  processor: (data, { width, height }, params) => {
    const rOffset = (params.rOffset as number) ?? 5;
    const gOffset = (params.gOffset as number) ?? 0;
    const bOffset = (params.bOffset as number) ?? -5;

    const source = new Uint8ClampedArray(data);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const rX = clamp(x + rOffset, 0, width - 1);
        const gX = clamp(x + gOffset, 0, width - 1);
        const bX = clamp(x + bOffset, 0, width - 1);

        data[i] = source[(y * width + rX) * 4];
        data[i + 1] = source[(y * width + gX) * 4 + 1];
        data[i + 2] = source[(y * width + bX) * 4 + 2];
      }
    }
  },
});

registerEffect({
  type: "screen-tear",
  label: "Screen Tear",
  category: "glitch",
  defaultParams: { intensity: 50, count: 3, offset: 20 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_count;
uniform float u_offset;
void main() {
  float seed = floor(u_time * 3.0);
  float numTears = u_count + floor(pseudoRandom(seed) * u_count * (u_intensity / 30.0));
  float maxOff = u_offset * (u_intensity / 30.0);
  float py = v_texCoord.y * u_resolution.y;
  vec2 uv = v_texCoord;
  for (int t = 0; t < 20; t++) {
    if (float(t) >= numTears) break;
    float tearY = floor(pseudoRandom(seed + float(t) * 100.0) * u_resolution.y);
    float tearH = floor(1.0 + pseudoRandom(seed + float(t) * 200.0) * 40.0 * (u_intensity / 50.0));
    if (py >= tearY && py < tearY + tearH) {
      float tearOff = (pseudoRandom(seed + float(t) * 300.0) - 0.5) * maxOff * 4.0;
      float newX = mod(v_texCoord.x * u_resolution.x + tearOff + u_resolution.x, u_resolution.x);
      uv = vec2(newX / u_resolution.x, v_texCoord.y);
      break;
    }
  }
  fragColor = texture(u_source, uv);
}`,
    uniforms: { intensity: "float", count: "float", offset: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const count = (params.count as number) ?? 3;
    const offset = (params.offset as number) ?? 20;
    if (intensity === 0) return;

    const source = new Uint8ClampedArray(data);
    const chaos = Date.now() % 10000;
    const numTears = Math.floor(
      count + Math.random() * count * (intensity / 30)
    );
    const maxOffset = offset * (intensity / 30);

    for (let t = 0; t < numTears; t++) {
      const tearY = Math.floor(Math.random() * height);
      const tearHeight = Math.floor(
        1 + Math.random() * Math.random() * 40 * (intensity / 50)
      );
      const tearOffset = Math.floor((Math.random() - 0.5) * maxOffset * 4);
      const channelOffset =
        Math.random() > 0.7 ? Math.floor(Math.random() * 3) : -1;
      const smearChance = Math.random();
      const repeatPixel = Math.random() > 0.8;

      for (let y = tearY; y < Math.min(tearY + tearHeight, height); y++) {
        const rowOffset =
          tearOffset +
          (repeatPixel ? 0 : Math.floor((Math.random() - 0.5) * 10));
        let lastPixel = [0, 0, 0];

        for (let x = 0; x < width; x++) {
          const dstIdx = (y * width + x) * 4;

          if (smearChance > 0.85 && x > 0) {
            data[dstIdx] = lastPixel[0];
            data[dstIdx + 1] = lastPixel[1];
            data[dstIdx + 2] = lastPixel[2];
          } else {
            const srcX = (((x + rowOffset) % width) + width) % width;
            const srcIdx = (y * width + srcX) * 4;

            if (channelOffset >= 0) {
              const shiftedX = (((x + rowOffset + 15) % width) + width) % width;
              const shiftedIdx = (y * width + shiftedX) * 4;
              data[dstIdx] =
                channelOffset === 0 ? source[shiftedIdx] : source[srcIdx];
              data[dstIdx + 1] =
                channelOffset === 1
                  ? source[shiftedIdx + 1]
                  : source[srcIdx + 1];
              data[dstIdx + 2] =
                channelOffset === 2
                  ? source[shiftedIdx + 2]
                  : source[srcIdx + 2];
            } else {
              data[dstIdx] = source[srcIdx];
              data[dstIdx + 1] = source[srcIdx + 1];
              data[dstIdx + 2] = source[srcIdx + 2];
            }

            lastPixel = [data[dstIdx], data[dstIdx + 1], data[dstIdx + 2]];
          }
        }
      }
    }
  },
});

registerEffect({
  type: "bitcrush",
  label: "Bitcrush",
  category: "glitch",
  defaultParams: { bits: 4, intensity: 50 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_bits;
uniform float u_intensity;
void main() {
  float seed = floor(u_time * 0.1);
  float py = floor(v_texCoord.y * u_resolution.y);
  float corruptChance = u_intensity / 100.0;
  float rowSeed = pseudoRandom(seed + py * 1.7);
  float localBits = rowSeed < corruptChance * 0.3
    ? max(1.0, u_bits - floor(pseudoRandom(seed + py * 3.1) * 3.0))
    : u_bits;
  float rowShift = rowSeed < corruptChance * 0.3
    ? floor(pseudoRandom(seed + py * 2.3) * u_resolution.x * 0.3)
    : 0.0;
  float levels = pow(2.0, localBits);
  float step = 1.0 / (levels - 1.0);
  float srcX = mod(v_texCoord.x * u_resolution.x + rowShift, u_resolution.x);
  vec4 c = texture(u_source, vec2(srcX / u_resolution.x, v_texCoord.y));
  vec3 crushed = floor(c.rgb / step + 0.5) * step;
  fragColor = vec4(crushed, c.a);
}`,
    uniforms: { bits: "float", intensity: "float" },
  },
  processor: (data, { width, height }, params) => {
    const bits = (params.bits as number) ?? 4;
    const intensity = (params.intensity as number) ?? 50;
    if (intensity === 0) return;

    const source = new Uint8ClampedArray(data);
    const corruptChance = intensity / 100;

    for (let y = 0; y < height; y++) {
      const rowCorrupt = Math.random() < corruptChance * 0.3;
      const rowShift = rowCorrupt ? Math.floor(Math.random() * width * 0.3) : 0;
      const localBits = rowCorrupt
        ? Math.max(1, bits - Math.floor(Math.random() * 3))
        : bits;
      const levels = Math.pow(2, localBits);
      const step = 255 / (levels - 1);

      for (let x = 0; x < width; x++) {
        const srcX = (x + rowShift) % width;
        const srcIdx = (y * width + srcX) * 4;
        const dstIdx = (y * width + x) * 4;

        let r = source[srcIdx];
        let g = source[srcIdx + 1];
        let b = source[srcIdx + 2];

        if (Math.random() < corruptChance * 0.1) {
          const corrupt = Math.floor(Math.random() * 3);
          if (corrupt === 0) r = Math.random() * 255;
          if (corrupt === 1) g = Math.random() * 255;
          if (corrupt === 2) b = Math.random() * 255;
        }

        if (Math.random() < corruptChance * 0.05) {
          r = g = b = Math.random() > 0.5 ? 255 : 0;
        }

        data[dstIdx] = Math.round(r / step) * step;
        data[dstIdx + 1] = Math.round(g / step) * step;
        data[dstIdx + 2] = Math.round(b / step) * step;
      }
    }
  },
});

registerEffect({
  type: "fragment-glitch",
  label: "Fragment Glitch",
  category: "glitch",
  defaultParams: { intensity: 50, fragmentSize: 8 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_fragmentSize;
void main() {
  float seed = floor(u_time * 0.5);
  float fsize = u_fragmentSize;
  float bx = floor(v_texCoord.x * u_resolution.x / fsize);
  float by = floor(v_texCoord.y * u_resolution.y / fsize);
  float blockId = bx + by * ceil(u_resolution.x / fsize);
  vec2 lxy = vec2(
    mod(v_texCoord.x * u_resolution.x, fsize),
    mod(v_texCoord.y * u_resolution.y, fsize)
  );
  float corruptProb = (u_intensity / 100.0) * 0.6;
  if (pseudoRandom(seed + blockId * 2.9) < corruptProb) {
    float effect = pseudoRandom(seed + blockId * 5.1);
    if (effect < 0.3) {
      float srcBx = floor(pseudoRandom(seed + blockId * 7.3) * ceil(u_resolution.x / fsize));
      float srcBy = floor(pseudoRandom(seed + blockId * 8.7) * ceil(u_resolution.y / fsize));
      vec2 srcUV = (vec2(srcBx, srcBy) * fsize + lxy) / u_resolution;
      fragColor = sampleClamped(srcUV);
    } else if (effect < 0.5) {
      int channel = int(floor(pseudoRandom(seed + blockId * 9.1) * 3.0));
      float val = pseudoRandom(seed + blockId * 11.3) > 0.5 ? 1.0 : 0.0;
      vec4 c = texture(u_source, v_texCoord);
      if (channel == 0) c.r = val;
      else if (channel == 1) c.g = val;
      else c.b = val;
      fragColor = c;
    } else if (effect < 0.85) {
      float repeatX = pseudoRandom(seed + blockId * 13.7) * u_resolution.x;
      float repeatY = pseudoRandom(seed + blockId * 17.1) * u_resolution.y;
      fragColor = texture(u_source, vec2(repeatX, repeatY) / u_resolution);
    } else {
      vec4 c = texture(u_source, v_texCoord);
      fragColor = vec4(1.0 - c.rgb, c.a);
    }
  } else {
    fragColor = texture(u_source, v_texCoord);
  }
}`,
    uniforms: { intensity: "float", fragmentSize: "float" },
  },
  processor: (data, { width, height }, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const fragmentSize = (params.fragmentSize as number) ?? 8;
    if (intensity === 0) return;

    const source = new Uint8ClampedArray(data);
    const numPasses = Math.ceil(intensity / 25);

    for (let pass = 0; pass < numPasses; pass++) {
      const numFragments = Math.floor(
        50 + Math.random() * 100 * (intensity / 50)
      );

      for (let f = 0; f < numFragments; f++) {
        const size = Math.floor(fragmentSize * (0.5 + Math.random() * 2));
        const fx = Math.floor(Math.random() * (width - size));
        const fy = Math.floor(Math.random() * (height - size));

        const effect = Math.random();

        if (effect < 0.3) {
          const srcFx = Math.floor(Math.random() * (width - size));
          const srcFy = Math.floor(Math.random() * (height - size));
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              if (
                fy + y < height &&
                fx + x < width &&
                srcFy + y < height &&
                srcFx + x < width
              ) {
                const srcIdx = ((srcFy + y) * width + (srcFx + x)) * 4;
                const dstIdx = ((fy + y) * width + (fx + x)) * 4;
                data[dstIdx] = source[srcIdx];
                data[dstIdx + 1] = source[srcIdx + 1];
                data[dstIdx + 2] = source[srcIdx + 2];
              }
            }
          }
        } else if (effect < 0.5) {
          const channel = Math.floor(Math.random() * 3);
          const val = Math.random() > 0.5 ? 255 : 0;
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              if (fy + y < height && fx + x < width) {
                const idx = ((fy + y) * width + (fx + x)) * 4;
                data[idx + channel] = val;
              }
            }
          }
        } else if (effect < 0.7) {
          for (let y = 0; y < size; y++) {
            const srcY = Math.floor(Math.random() * height);
            for (let x = 0; x < size; x++) {
              if (fy + y < height && fx + x < width) {
                const srcIdx = (srcY * width + ((fx + x) % width)) * 4;
                const dstIdx = ((fy + y) * width + (fx + x)) * 4;
                data[dstIdx] = source[srcIdx];
                data[dstIdx + 1] = source[srcIdx + 1];
                data[dstIdx + 2] = source[srcIdx + 2];
              }
            }
          }
        } else if (effect < 0.85) {
          const repeatX = Math.floor(Math.random() * width);
          const repeatY = Math.floor(Math.random() * height);
          const srcIdx = (repeatY * width + repeatX) * 4;
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              if (fy + y < height && fx + x < width) {
                const dstIdx = ((fy + y) * width + (fx + x)) * 4;
                data[dstIdx] = source[srcIdx];
                data[dstIdx + 1] = source[srcIdx + 1];
                data[dstIdx + 2] = source[srcIdx + 2];
              }
            }
          }
        } else {
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              if (fy + y < height && fx + x < width) {
                const idx = ((fy + y) * width + (fx + x)) * 4;
                data[idx] = data[idx] ^ 0xff;
                data[idx + 1] = data[idx + 1] ^ 0xff;
                data[idx + 2] = data[idx + 2] ^ 0xff;
              }
            }
          }
        }
      }
    }
  },
});

registerEffect({
  type: "data-destroy",
  label: "Data Destroy",
  category: "glitch",
  defaultParams: { intensity: 50, corruption: 30 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_corruption;
void main() {
  float seed = floor(u_time * 0.2);
  float pixIdx = floor(v_texCoord.x * u_resolution.x) + floor(v_texCoord.y * u_resolution.y) * u_resolution.x;
  float byteCorruptChance = u_corruption / 1000.0;
  float rowKillChance = u_intensity / 500.0;
  float py = floor(v_texCoord.y * u_resolution.y);
  vec4 c = texture(u_source, v_texCoord);
  // Row kill
  if (pseudoRandom(seed + py * 3.1) < rowKillChance) {
    float killType = pseudoRandom(seed + py * 5.7);
    if (killType < 0.3) {
      float srcRow = floor(pseudoRandom(seed + py * 7.3) * u_resolution.y);
      c = texture(u_source, vec2(v_texCoord.x, srcRow / u_resolution.y));
    } else if (killType < 0.5) {
      c.rgb = vec3(pseudoRandom(seed + py * 9.1), pseudoRandom(seed + py * 11.3), pseudoRandom(seed + py * 13.7));
    } else if (killType < 0.7) {
      c.rgb = 1.0 - c.rgb;
    } else {
      float shiftX = pseudoRandom(seed + py * 15.1) * u_resolution.x;
      c = texture(u_source, vec2(mod(v_texCoord.x * u_resolution.x + shiftX, u_resolution.x) / u_resolution.x, v_texCoord.y));
    }
  }
  // Per-pixel corruption
  if (pseudoRandom(seed + pixIdx * 1.3 + 0.1) < byteCorruptChance) {
    float ct = pseudoRandom(seed + pixIdx * 2.7);
    int channel = int(floor(pseudoRandom(seed + pixIdx * 4.1) * 3.0));
    float corrupt = pseudoRandom(seed + pixIdx * 6.3) > 0.5 ? 1.0 : 0.0;
    if (ct < 0.5) {
      if (channel == 0) c.r = 1.0 - c.r;
      else if (channel == 1) c.g = 1.0 - c.g;
      else c.b = 1.0 - c.b;
    } else {
      if (channel == 0) c.r = corrupt;
      else if (channel == 1) c.g = corrupt;
      else c.b = corrupt;
    }
  }
  fragColor = c;
}`,
    uniforms: { intensity: "float", corruption: "float" },
  },
  processor: (data, { width, height }, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const corruption = (params.corruption as number) ?? 30;
    if (intensity === 0) return;

    const byteCorruptChance = corruption / 1000;
    const rowKillChance = intensity / 500;
    const blockCorruptChance = intensity / 200;

    for (let i = 0; i < data.length; i++) {
      if (i % 4 === 3) continue;

      if (Math.random() < byteCorruptChance) {
        const corruptType = Math.random();
        if (corruptType < 0.3) {
          data[i] = data[i] ^ Math.floor(Math.random() * 256);
        } else if (corruptType < 0.5) {
          data[i] = 255 - data[i];
        } else if (corruptType < 0.7) {
          data[i] = Math.random() > 0.5 ? 255 : 0;
        } else if (corruptType < 0.85) {
          data[i] = (data[i] << 1) & 0xff;
        } else {
          data[i] = (data[i] >> 1) | ((data[i] & 1) << 7);
        }
      }
    }

    for (let y = 0; y < height; y++) {
      if (Math.random() < rowKillChance) {
        const killType = Math.random();
        const rowStart = y * width * 4;

        if (killType < 0.3) {
          const srcRow = Math.floor(Math.random() * height);
          const srcStart = srcRow * width * 4;
          for (let x = 0; x < width * 4; x++) {
            data[rowStart + x] = data[srcStart + x];
          }
        } else if (killType < 0.5) {
          const repeatVal = [
            Math.random() * 255,
            Math.random() * 255,
            Math.random() * 255,
          ];
          for (let x = 0; x < width; x++) {
            data[rowStart + x * 4] = repeatVal[0];
            data[rowStart + x * 4 + 1] = repeatVal[1];
            data[rowStart + x * 4 + 2] = repeatVal[2];
          }
        } else if (killType < 0.7) {
          for (let x = 0; x < width * 4; x++) {
            if (x % 4 !== 3) data[rowStart + x] = data[rowStart + x] ^ 0xff;
          }
        } else {
          const shift = Math.floor(Math.random() * width * 4);
          const temp = new Uint8ClampedArray(width * 4);
          for (let x = 0; x < width * 4; x++) {
            temp[x] = data[rowStart + ((x + shift) % (width * 4))];
          }
          for (let x = 0; x < width * 4; x++) {
            data[rowStart + x] = temp[x];
          }
        }
      }
    }

    const numBlocks = Math.floor(intensity / 10);
    for (let b = 0; b < numBlocks; b++) {
      if (Math.random() < blockCorruptChance) {
        const bx = Math.floor(Math.random() * width);
        const by = Math.floor(Math.random() * height);
        const bw = Math.floor(10 + Math.random() * 50);
        const bh = Math.floor(5 + Math.random() * 30);

        const corruptType = Math.random();
        for (let y = by; y < Math.min(by + bh, height); y++) {
          for (let x = bx; x < Math.min(bx + bw, width); x++) {
            const idx = (y * width + x) * 4;
            if (corruptType < 0.25) {
              data[idx] = data[idx + 1] = data[idx + 2] = Math.random() * 255;
            } else if (corruptType < 0.5) {
              data[idx] ^= 0xff;
              data[idx + 1] ^= 0xff;
              data[idx + 2] ^= 0xff;
            } else if (corruptType < 0.75) {
              const channel = Math.floor(Math.random() * 3);
              data[idx + channel] = Math.random() > 0.5 ? 255 : 0;
            } else {
              data[idx] = data[idx + 2];
              data[idx + 1] = data[idx];
            }
          }
        }
      }
    }
  },
});

registerEffect({
  type: "chaos",
  label: "Chaos",
  category: "glitch",
  defaultParams: { intensity: 50, layers: 3 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_layers;
void main() {
  float seed = floor(u_time * 2.0);
  vec2 uv = v_texCoord;
  float py = uv.y * u_resolution.y;
  float px = uv.x * u_resolution.x;
  int numLayers = int(u_layers);
  for (int layer = 0; layer < 4; layer++) {
    if (layer >= numLayers) break;
    float lseed = seed + float(layer) * 100.0;
    float effect = floor(pseudoRandom(lseed) * 5.0);
    float li = u_intensity * (0.5 + pseudoRandom(lseed + 1.0) * 0.5);
    if (effect < 1.0) {
      // Slice shift
      float numSlices = floor(5.0 + pseudoRandom(lseed + 2.0) * 20.0);
      for (int s = 0; s < 20; s++) {
        if (float(s) >= numSlices) break;
        float sy = pseudoRandom(lseed + float(s) * 200.0) * u_resolution.y;
        float sh = 1.0 + pseudoRandom(lseed + float(s) * 300.0) * 10.0;
        if (py >= sy && py < sy + sh) {
          float off = (pseudoRandom(lseed + float(s) * 400.0) - 0.5) * li * 2.0;
          uv.x = mod(px + off + u_resolution.x, u_resolution.x) / u_resolution.x;
          break;
        }
      }
    } else if (effect < 2.0) {
      // RGB separation
      float rgbOff = floor(li / 5.0) / u_resolution.x;
      uv.x = clamp(uv.x + (pseudoRandom(lseed + 10.0) - 0.5) * rgbOff * 4.0, 0.0, 1.0);
    } else if (effect < 3.0) {
      // Wave distortion
      float amp = li / 2.0;
      uv.x = clamp(uv.x + sin(py * 0.1 + u_time) * amp / u_resolution.x, 0.0, 1.0);
    }
  }
  vec4 c = texture(u_source, uv);
  fragColor = c;
}`,
    uniforms: { intensity: "float", layers: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const layers = (params.layers as number) ?? 3;
    if (intensity === 0) return;

    const source = new Uint8ClampedArray(data);

    for (let layer = 0; layer < layers; layer++) {
      const effect = Math.floor(Math.random() * 10);
      const layerIntensity = intensity * (0.5 + Math.random() * 0.5);

      if (effect === 0) {
        const numSlices = Math.floor(5 + Math.random() * 20);
        for (let s = 0; s < numSlices; s++) {
          const sliceY = Math.floor(Math.random() * height);
          const sliceH = Math.floor(1 + Math.random() * 10);
          const offset = Math.floor((Math.random() - 0.5) * layerIntensity * 2);

          for (let y = sliceY; y < Math.min(sliceY + sliceH, height); y++) {
            for (let x = 0; x < width; x++) {
              const srcX = (((x + offset) % width) + width) % width;
              const srcIdx = (y * width + srcX) * 4;
              const dstIdx = (y * width + x) * 4;
              data[dstIdx] = source[srcIdx];
              data[dstIdx + 1] = source[srcIdx + 1];
              data[dstIdx + 2] = source[srcIdx + 2];
            }
          }
        }
      } else if (effect === 1) {
        const rgbOffset = Math.floor(layerIntensity / 5);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const rX = clamp(
              x - rgbOffset + Math.floor(Math.random() * 4),
              0,
              width - 1
            );
            const bX = clamp(
              x + rgbOffset + Math.floor(Math.random() * 4),
              0,
              width - 1
            );
            data[idx] = source[(y * width + rX) * 4];
            data[idx + 2] = source[(y * width + bX) * 4 + 2];
          }
        }
      } else if (effect === 2) {
        const blockSize = Math.floor(8 + Math.random() * 32);
        const numBlocks = Math.floor(layerIntensity / 5);
        for (let b = 0; b < numBlocks; b++) {
          const bx = Math.floor(Math.random() * width);
          const by = Math.floor(Math.random() * height);
          const srcBx = Math.floor(Math.random() * width);
          const srcBy = Math.floor(Math.random() * height);

          for (let y = 0; y < blockSize; y++) {
            for (let x = 0; x < blockSize; x++) {
              if (
                by + y < height &&
                bx + x < width &&
                srcBy + y < height &&
                srcBx + x < width
              ) {
                const srcIdx = ((srcBy + y) * width + (srcBx + x)) * 4;
                const dstIdx = ((by + y) * width + (bx + x)) * 4;
                data[dstIdx] = source[srcIdx];
                data[dstIdx + 1] = source[srcIdx + 1];
                data[dstIdx + 2] = source[srcIdx + 2];
              }
            }
          }
        }
      } else if (effect === 3) {
        for (let i = 0; i < data.length; i += 4) {
          if (Math.random() < layerIntensity / 200) {
            data[i] = Math.random() * 255;
            data[i + 1] = Math.random() * 255;
            data[i + 2] = Math.random() * 255;
          }
        }
      } else if (effect === 4) {
        const amplitude = layerIntensity / 2;
        for (let y = 0; y < height; y++) {
          const offset = Math.floor(
            Math.sin(y * 0.1 + Math.random() * 10) * amplitude
          );
          for (let x = 0; x < width; x++) {
            const srcX = clamp(x + offset, 0, width - 1);
            const srcIdx = (y * width + srcX) * 4;
            const dstIdx = (y * width + x) * 4;
            data[dstIdx] = source[srcIdx];
            data[dstIdx + 1] = source[srcIdx + 1];
            data[dstIdx + 2] = source[srcIdx + 2];
          }
        }
      } else if (effect === 5) {
        const rows = Math.floor(layerIntensity / 10);
        for (let r = 0; r < rows; r++) {
          const y = Math.floor(Math.random() * height);
          const channel = Math.floor(Math.random() * 3);
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            data[idx + channel] = Math.random() > 0.5 ? 255 : 0;
          }
        }
      } else if (effect === 6) {
        const regions = Math.floor(layerIntensity / 15);
        for (let r = 0; r < regions; r++) {
          const rx = Math.floor(Math.random() * width);
          const ry = Math.floor(Math.random() * height);
          const rw = Math.floor(20 + Math.random() * 80);
          const rh = Math.floor(10 + Math.random() * 40);

          for (let y = ry; y < Math.min(ry + rh, height); y++) {
            for (let x = rx; x < Math.min(rx + rw, width); x++) {
              const idx = (y * width + x) * 4;
              data[idx] = 255 - data[idx];
              data[idx + 1] = 255 - data[idx + 1];
              data[idx + 2] = 255 - data[idx + 2];
            }
          }
        }
      } else if (effect === 7) {
        for (let y = 0; y < height; y++) {
          if (Math.random() < layerIntensity / 100) {
            const stretch = Math.floor(Math.random() * 20);
            for (let x = 0; x < width; x++) {
              const srcX = Math.floor(x / (1 + stretch * 0.1)) % width;
              const srcIdx = (y * width + srcX) * 4;
              const dstIdx = (y * width + x) * 4;
              data[dstIdx] = source[srcIdx];
              data[dstIdx + 1] = source[srcIdx + 1];
              data[dstIdx + 2] = source[srcIdx + 2];
            }
          }
        }
      } else if (effect === 8) {
        const numCorrupt = Math.floor(layerIntensity);
        for (let c = 0; c < numCorrupt; c++) {
          const idx = Math.floor((Math.random() * data.length) / 4) * 4;
          const len = Math.floor(Math.random() * 100) * 4;
          const val = [
            Math.random() * 255,
            Math.random() * 255,
            Math.random() * 255,
          ];
          for (let i = idx; i < Math.min(idx + len, data.length); i += 4) {
            data[i] = val[0];
            data[i + 1] = val[1];
            data[i + 2] = val[2];
          }
        }
      } else {
        const numLines = Math.floor(layerIntensity / 5);
        for (let l = 0; l < numLines; l++) {
          const x = Math.floor(Math.random() * width);
          const color = [
            Math.random() * 255,
            Math.random() * 255,
            Math.random() * 255,
          ];
          for (let y = 0; y < height; y++) {
            if (Math.random() < 0.8) {
              const idx = (y * width + x) * 4;
              data[idx] = color[0];
              data[idx + 1] = color[1];
              data[idx + 2] = color[2];
            }
          }
        }
      }

      for (let i = 0; i < source.length; i++) {
        source[i] = data[i];
      }
    }
  },
});


registerEffect({
  type: "jpeg-artifacts",
  label: "JPEG Artifacts",
  category: "glitch",
  defaultParams: { quality: 30, blockiness: 50, colorBanding: 50 },
  paramsConfig: [],
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
      Math.min(100, (params.quality as number) ?? 30)
    );
    const blockiness = (params.blockiness as number) ?? 50;
    const colorBanding = (params.colorBanding as number) ?? 50;

    const source = new Uint8ClampedArray(data);
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

        const lumaStep = 256 / Math.pow(2, colorQuantization);
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

registerEffect({
  type: "codec-damage",
  label: "Codec Damage",
  category: "glitch",
  defaultParams: { intensity: 50, blockSize: 16, colorBleed: 50, temporal: true },
  paramsConfig: [],
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
    uniforms: { intensity: "float", blockSize: "float", colorBleed: "float", temporal: "bool" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const blockSize = (params.blockSize as number) ?? 16;
    const colorBleed = (params.colorBleed as number) ?? 50;
    const temporal = (params.temporal as boolean) ?? true;

    if (intensity === 0) return;

    const source = new Uint8ClampedArray(data);
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
          (pseudoRandom(seed + i * 600) - 0.5) * blockSize * 0.5
        );
        const shiftY = Math.floor(
          (pseudoRandom(seed + i * 700) - 0.5) * blockSize * 0.5
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

registerEffect({
  type: "xor-blend",
  label: "XOR Blend",
  category: "glitch",
    defaultParams: {
        intensity: 0.5,
        frameHistory: 1,
      },
  paramsConfig: [],
  processor: (data, { width, height }, params) => {
    const intensity = (params.intensity as number) ?? 0.5;
    const frameHistory = (params.frameHistory as number) ?? 1;

    storeFrame(data, width, height);
    const prevFrame = getFrameFromHistory(frameHistory);

    if (!prevFrame) return;

    for (let i = 0; i < data.length; i += 4) {
      const xorR = data[i] ^ prevFrame[i];
      const xorG = data[i + 1] ^ prevFrame[i + 1];
      const xorB = data[i + 2] ^ prevFrame[i + 2];

      data[i] = data[i] * (1 - intensity) + xorR * intensity;
      data[i + 1] = data[i + 1] * (1 - intensity) + xorG * intensity;
      data[i + 2] = data[i + 2] * (1 - intensity) + xorB * intensity;
    }
  },
});

registerEffect({
  type: "rgb-vertical-xor",
  label: "RGB Vertical XOR",
  category: "glitch",
  defaultParams: { speed: 2, amplitude: 1.0 },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_speed;
uniform float u_amplitude;
void main() {
  float t = u_time * u_speed * 0.1;
  float y = v_texCoord.y * u_resolution.y;
  float offR = sin(y * 0.1 + t) * 10.0 * u_amplitude / u_resolution.x;
  float offG = sin(y * 0.1 + t + 2.094) * 10.0 * u_amplitude / u_resolution.x;
  float offB = sin(y * 0.1 + t + 4.189) * 10.0 * u_amplitude / u_resolution.x;
  float r = sampleClamped(vec2(v_texCoord.x + offR, v_texCoord.y)).r;
  float g = sampleClamped(vec2(v_texCoord.x + offG, v_texCoord.y)).g;
  float b = sampleClamped(vec2(v_texCoord.x + offB, v_texCoord.y)).b;
  fragColor = vec4(r, g, b, 1.0);
}`,
    uniforms: { speed: "float", amplitude: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const speed = (params.speed as number) ?? 2;
    const amplitude = (params.amplitude as number) ?? 1.0;

    const source = new Uint8ClampedArray(data);
    const t = time * speed * 0.1;

    for (let y = 0; y < height; y++) {
      const offsetR = Math.floor(Math.sin(y * 0.1 + t) * 10 * amplitude);
      const offsetG = Math.floor(Math.sin(y * 0.1 + t + Math.PI * 0.666) * 10 * amplitude);
      const offsetB = Math.floor(Math.sin(y * 0.1 + t + Math.PI * 1.333) * 10 * amplitude);

      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        const xR = (x + offsetR + width) % width;
        const xG = (x + offsetG + width) % width;
        const xB = (x + offsetB + width) % width;

        const iR = (y * width + xR) * 4;
        const iG = (y * width + xG) * 4;
        const iB = (y * width + xB) * 4;

        data[i] = source[i] ^ source[iR];
        data[i + 1] = source[i + 1] ^ source[iG + 1];
        data[i + 2] = source[i + 2] ^ source[iB + 2];
      }
    }
  },
});

registerEffect({
  type: "frame-trails",
  label: "Frame Trails",
  category: "glitch",
    defaultParams: {
        intensity: 0.7,
        decay: 0.9,
        maxFrames: 8,
      },
  paramsConfig: [],
  processor: (data, { width, height }, params) => {
    const intensity = (params.intensity as number) ?? 0.7;
    const decay = (params.decay as number) ?? 0.9;
    const maxFrames = (params.maxFrames as number) ?? 8;

    storeFrame(data, width, height);

    const numFrames = Math.min(maxFrames, frameHistoryStore.frames.length);
    if (numFrames === 0) return;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i] * (1 - intensity);
      let g = data[i + 1] * (1 - intensity);
      let b = data[i + 2] * (1 - intensity);

      const weight = intensity;
      for (let f = 0; f < numFrames; f++) {
        const frame = frameHistoryStore.frames[f];
        const frameWeight = weight * Math.pow(decay, f);

        r += frame[i] * frameWeight;
        g += frame[i + 1] * frameWeight;
        b += frame[i + 2] * frameWeight;
      }

      data[i] = Math.min(255, r);
      data[i + 1] = Math.min(255, g);
      data[i + 2] = Math.min(255, b);
    }
  },
});

registerEffect({
  type: "rgb-color-trails",
  label: "RGB Color Trails",
  category: "glitch",
    defaultParams: {
        rDecay: 0.95,
        gDecay: 0.9,
        bDecay: 0.85,
        maxFrames: 6,
      },
  paramsConfig: [],
  processor: (data, { width, height }, params) => {
    const rDecay = (params.rDecay as number) ?? 0.95;
    const gDecay = (params.gDecay as number) ?? 0.9;
    const bDecay = (params.bDecay as number) ?? 0.85;
    const maxFrames = (params.maxFrames as number) ?? 6;

    storeFrame(data, width, height);

    const numFrames = Math.min(maxFrames, frameHistoryStore.frames.length);
    if (numFrames === 0) return;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      for (let f = 1; f < numFrames; f++) {
        const frame = frameHistoryStore.frames[f];
        r = Math.max(r, frame[i] * Math.pow(rDecay, f));
        g = Math.max(g, frame[i + 1] * Math.pow(gDecay, f));
        b = Math.max(b, frame[i + 2] * Math.pow(bDecay, f));
      }

      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  },
});

registerEffect({
  type: "feedback-echo",
  label: "Feedback Echo",
  category: "glitch",
    defaultParams: {
        delay: 2,
        feedback: 0.8,
        scale: 0.95,
      },
  paramsConfig: [],
  processor: (data, { width, height }, params) => {
    const delay = (params.delay as number) ?? 2;
    const feedback = (params.feedback as number) ?? 0.8;
    const scale = (params.scale as number) ?? 0.95;

    storeFrame(data, width, height);
    const prevFrame = getFrameFromHistory(delay);

    if (!prevFrame) return;

    const scaledW = Math.floor(width * scale);
    const scaledH = Math.floor(height * scale);
    const offsetX = Math.floor((width - scaledW) / 2);
    const offsetY = Math.floor((height - scaledH) / 2);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        // Sample from scaled previous frame
        const sx = Math.floor((x - offsetX) * (width / scaledW));
        const sy = Math.floor((y - offsetY) * (height / scaledH));

        if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
          const si = (sy * width + sx) * 4;

          data[i] = Math.min(255, data[i] * (1 - feedback) + prevFrame[si] * feedback);
          data[i + 1] = Math.min(255, data[i + 1] * (1 - feedback) + prevFrame[si + 1] * feedback);
          data[i + 2] = Math.min(255, data[i + 2] * (1 - feedback) + prevFrame[si + 2] * feedback);
        }
      }
    }
  },
});

registerEffect({
  type: "frame-delay",
  label: "Frame Delay",
  category: "glitch",
    defaultParams: {
        delay: 5,
        blendMode: "replace",
      },
  paramsConfig: [],
  processor: (data, { width, height }, params) => {
    const delay = (params.delay as number) ?? 5;
    const blendMode = (params.blendMode as string) ?? "replace";

    storeFrame(data, width, height);
    const delayedFrame = getFrameFromHistory(delay);

    if (!delayedFrame) return;

    if (blendMode === "replace") {
      data.set(delayedFrame);
    } else if (blendMode === "blend") {
      for (let i = 0; i < data.length; i += 4) {
        data[i] = (data[i] + delayedFrame[i]) / 2;
        data[i + 1] = (data[i + 1] + delayedFrame[i + 1]) / 2;
        data[i + 2] = (data[i + 2] + delayedFrame[i + 2]) / 2;
      }
    } else {
      // xor
      for (let i = 0; i < data.length; i += 4) {
        data[i] = data[i] ^ delayedFrame[i];
        data[i + 1] = data[i + 1] ^ delayedFrame[i + 1];
        data[i + 2] = data[i + 2] ^ delayedFrame[i + 2];
      }
    }
  },
});

registerEffect({
  type: "alpha-trails",
  label: "Alpha Trails",
  category: "glitch",
    defaultParams: {
        alpha: 0.3,
        maxFrames: 10,
      },
  paramsConfig: [],
  processor: (data, { width, height }, params) => {
    const alpha = (params.alpha as number) ?? 0.3;
    const maxFrames = (params.maxFrames as number) ?? 10;

    storeFrame(data, width, height);

    const numFrames = Math.min(maxFrames, frameHistoryStore.frames.length);
    if (numFrames === 0) return;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      for (let f = 1; f < numFrames; f++) {
        const frame = frameHistoryStore.frames[f];
        const frameAlpha = alpha * Math.pow(0.8, f);

        r = r * (1 - frameAlpha) + frame[i] * frameAlpha;
        g = g * (1 - frameAlpha) + frame[i + 1] * frameAlpha;
        b = b * (1 - frameAlpha) + frame[i + 2] * frameAlpha;
      }

      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  },
});

registerEffect({
  type: "square-swap",
  label: "Square Swap",
  category: "glitch",
  defaultParams: { gridSize: 4, swapPattern: "random", animated: true },
  paramsConfig: [],
  glsl: {
    fragment: `
uniform float u_gridSize;
uniform int u_swapPattern;
uniform bool u_animated;
void main() {
  float seed = u_animated ? floor(u_time / 10.0) : 0.0;
  float g = u_gridSize;
  float gx = floor(v_texCoord.x * g);
  float gy = floor(v_texCoord.y * g);
  float tgx, tgy;
  if (u_swapPattern == 0) { // random
    tgx = floor(pseudoRandom(seed + gy * g + gx) * g);
    tgy = floor(pseudoRandom(seed + 1000.0 + gy * g + gx) * g);
  } else if (u_swapPattern == 1) { // flip
    tgx = g - 1.0 - gx;
    tgy = g - 1.0 - gy;
  } else { // rotate
    tgx = gy;
    tgy = g - 1.0 - gx;
  }
  vec2 lxy = vec2(mod(v_texCoord.x * g, 1.0), mod(v_texCoord.y * g, 1.0));
  vec2 srcUV = (vec2(tgx, tgy) + lxy) / g;
  fragColor = sampleClamped(srcUV);
}`,
    uniforms: { gridSize: "float", swapPattern: "int", animated: "bool" },
    uniformMapper: (p) => ({
      ...p,
      swapPattern: ["random", "flip", "rotate"].indexOf((p.swapPattern as string) || "random"),
    }),
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const gridSize = (params.gridSize as number) ?? 4;
    const swapPattern = (params.swapPattern as string) ?? "random";
    const animated = (params.animated as boolean) !== false;

    const source = new Uint8ClampedArray(data);
    const cellW = Math.floor(width / gridSize);
    const cellH = Math.floor(height / gridSize);

    const seed = animated ? Math.floor(time / 10) : 0;

    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        let targetGx, targetGy;

        if (swapPattern === "random") {
          targetGx = Math.floor(pseudoRandom(seed + gy * gridSize + gx) * gridSize);
          targetGy = Math.floor(pseudoRandom(seed + 1000 + gy * gridSize + gx) * gridSize);
        } else if (swapPattern === "flip") {
          targetGx = gridSize - 1 - gx;
          targetGy = gridSize - 1 - gy;
        } else {
          // rotate
          targetGx = gy;
          targetGy = gridSize - 1 - gx;
        }

        const srcX = gx * cellW;
        const srcY = gy * cellH;
        const dstX = targetGx * cellW;
        const dstY = targetGy * cellH;

        for (let y = 0; y < cellH; y++) {
          for (let x = 0; x < cellW; x++) {
            const sy = srcY + y;
            const sx = srcX + x;
            const dy = dstY + y;
            const dx = dstX + x;

            if (sy < height && sx < width && dy < height && dx < width) {
              const si = (sy * width + sx) * 4;
              const di = (dy * width + dx) * 4;

              data[di] = source[si];
              data[di + 1] = source[si + 1];
              data[di + 2] = source[si + 2];
            }
          }
        }
      }
    }
  },
});

registerEffect({
  type: "buffer-corrupt",
  label: "Buffer Corrupt",
  category: "glitch",
  defaultParams: { strideOffset: 30, channelSplit: 40, wrapMode: "repeat" },
  paramsConfig: [
    { key: "strideOffset", label: "Stride Offset", type: "slider", min: -100, max: 100, step: 1 },
    { key: "channelSplit", label: "Channel Split", type: "slider", min: 0, max: 100, step: 1 },
    { key: "wrapMode", label: "Wrap Mode", type: "select", options: ["repeat", "mirror", "clamp"] },
  ],
  glsl: {
    fragment: `
uniform float u_strideOffset;
uniform float u_channelSplit;
uniform float u_wrapMode;

float stridedRead(float flatIdx, float stride) {
  float row = floor(flatIdx / stride);
  float col = mod(flatIdx, stride);
  return col / u_resolution.x * 1.0 + row / u_resolution.y * 1.0;
}

vec2 corruptedUV(vec2 uv, float strideDelta) {
  float px = uv.x * u_resolution.x;
  float py = uv.y * u_resolution.y;
  float flatIdx = py * u_resolution.x + px;
  float corruptedWidth = u_resolution.x + strideDelta;
  if (corruptedWidth <= 0.0) corruptedWidth = 1.0;
  float newRow = floor(flatIdx / corruptedWidth);
  float newCol = mod(flatIdx, corruptedWidth);
  vec2 newUV = vec2(newCol / u_resolution.x, newRow / u_resolution.y);
  if (u_wrapMode < 0.5) {
    newUV = fract(newUV);
  } else if (u_wrapMode < 1.5) {
    vec2 wrapped = fract(newUV * 0.5) * 2.0;
    newUV = vec2(wrapped.x > 1.0 ? 2.0 - wrapped.x : wrapped.x,
                 wrapped.y > 1.0 ? 2.0 - wrapped.y : wrapped.y);
  } else {
    newUV = clamp(newUV, 0.0, 1.0);
  }
  return newUV;
}

void main() {
  if (u_strideOffset == 0.0 && u_channelSplit == 0.0) {
    fragColor = texture(u_source, v_texCoord);
    return;
  }
  float splitAmount = u_channelSplit * 0.5;
  vec2 uvR = corruptedUV(v_texCoord, u_strideOffset + splitAmount);
  vec2 uvG = corruptedUV(v_texCoord, u_strideOffset);
  vec2 uvB = corruptedUV(v_texCoord, u_strideOffset - splitAmount);
  float r = texture(u_source, uvR).r;
  float g = texture(u_source, uvG).g;
  float b = texture(u_source, uvB).b;
  fragColor = vec4(r, g, b, 1.0);
}`,
    uniforms: { strideOffset: "float", channelSplit: "float", wrapMode: "float" },
    uniformMapper: (params) => ({
      strideOffset: params.strideOffset,
      channelSplit: params.channelSplit,
      wrapMode: params.wrapMode === "repeat" ? 0 : params.wrapMode === "mirror" ? 1 : 2,
    }),
  },
  processor: (data, { width, height }, params) => {
    const strideOffset = (params.strideOffset as number) ?? 30;
    const channelSplit = (params.channelSplit as number) ?? 40;
    const wrapMode = (params.wrapMode as string) ?? "repeat";
    if (strideOffset === 0 && channelSplit === 0) return;

    const source = new Uint8ClampedArray(data);

    const wrapCoord = (col: number, row: number, w: number, h: number): [number, number] => {
      let c = col, r = row;
      if (wrapMode === "repeat") {
        c = ((c % w) + w) % w;
        r = ((r % h) + h) % h;
      } else if (wrapMode === "mirror") {
        const mc = ((c % (w * 2)) + w * 2) % (w * 2);
        const mr = ((r % (h * 2)) + h * 2) % (h * 2);
        c = mc >= w ? w * 2 - 1 - mc : mc;
        r = mr >= h ? h * 2 - 1 - mr : mr;
      } else {
        c = clamp(c, 0, w - 1);
        r = clamp(r, 0, h - 1);
      }
      return [c, r];
    };

    const splitAmount = channelSplit * 0.5;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const flatIdx = y * width + x;
        const dstIdx = flatIdx * 4;

        const readChannel = (stride: number, ch: number) => {
          const corruptedWidth = width + stride;
          if (corruptedWidth <= 0) return source[dstIdx + ch];
          const newRow = Math.floor(flatIdx / corruptedWidth);
          const newCol = Math.floor(flatIdx % corruptedWidth);
          const [wc, wr] = wrapCoord(newCol, newRow, width, height);
          return source[(wr * width + wc) * 4 + ch];
        };

        data[dstIdx]     = readChannel(strideOffset + splitAmount, 0);
        data[dstIdx + 1] = readChannel(strideOffset, 1);
        data[dstIdx + 2] = readChannel(strideOffset - splitAmount, 2);
      }
    }
  },
});

registerEffect({
  type: "neon-crush",
  label: "Neon Crush",
  category: "glitch",
  defaultParams: { bits: 1, saturationBoost: 80, ditherAmount: 20 },
  paramsConfig: [
    { key: "bits", label: "Bits Per Channel", type: "slider", min: 1, max: 4, step: 1 },
    { key: "saturationBoost", label: "Saturation Boost", type: "slider", min: 0, max: 100, step: 1 },
    { key: "ditherAmount", label: "Dither", type: "slider", min: 0, max: 100, step: 1 },
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
    uniforms: { bits: "float", saturationBoost: "float", ditherAmount: "float" },
  },
  processor: (data, { width, height }, params) => {
    const bits = Math.round((params.bits as number) ?? 1);
    const saturationBoost = (params.saturationBoost as number) ?? 80;
    const ditherAmount = (params.ditherAmount as number) ?? 20;

    const BAYER = [
       0/16,  8/16,  2/16, 10/16,
      12/16,  4/16, 14/16,  6/16,
       3/16, 11/16,  1/16,  9/16,
      15/16,  7/16, 13/16,  5/16,
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

        data[idx]     = clamp(Math.round((br + dither / levels) * levels + 0.5) / levels * 255, 0, 255);
        data[idx + 1] = clamp(Math.round((bg + dither / levels) * levels + 0.5) / levels * 255, 0, 255);
        data[idx + 2] = clamp(Math.round((bb + dither / levels) * levels + 0.5) / levels * 255, 0, 255);
      }
    }
  },
});

registerEffect({
  type: "line-massacre",
  label: "Line Massacre",
  category: "glitch",
  defaultParams: { intensity: 60, colorFill: 30, speed: 5 },
  paramsConfig: [
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 100, step: 1 },
    { key: "colorFill", label: "Color Fill", type: "slider", min: 0, max: 100, step: 1 },
    { key: "speed", label: "Speed", type: "slider", min: 1, max: 20, step: 1 },
  ],
  glsl: {
    fragment: `
uniform float u_intensity;
uniform float u_colorFill;
uniform float u_speed;

vec3 neonPalette(float idx) {
  int i = int(mod(idx * 6.0, 6.0));
  if (i == 0) return vec3(1.0, 0.0, 0.0);
  if (i == 1) return vec3(0.0, 1.0, 0.0);
  if (i == 2) return vec3(0.0, 0.0, 1.0);
  if (i == 3) return vec3(0.0, 1.0, 1.0);
  if (i == 4) return vec3(1.0, 0.0, 1.0);
  return vec3(1.0, 1.0, 0.0);
}

void main() {
  if (u_intensity == 0.0) { fragColor = texture(u_source, v_texCoord); return; }
  float seed = floor(u_time * u_speed);
  float py = v_texCoord.y;
  float rowHash = pseudoRandom(seed + floor(py * u_resolution.y) * 7.3);
  float affectThresh = u_intensity / 100.0 * 0.7;

  if (rowHash < affectThresh) {
    float fillHash = pseudoRandom(seed + floor(py * u_resolution.y) * 13.1);
    if (fillHash < u_colorFill / 100.0) {
      fragColor = vec4(neonPalette(pseudoRandom(seed + floor(py * u_resolution.y) * 31.7)), 1.0);
      return;
    }
    float dispR = (pseudoRandom(seed + floor(py * u_resolution.y) * 17.3) - 0.5) * u_intensity * 2.0;
    float dispG = (pseudoRandom(seed + floor(py * u_resolution.y) * 19.7) - 0.5) * u_intensity * 2.0;
    float dispB = (pseudoRandom(seed + floor(py * u_resolution.y) * 23.1) - 0.5) * u_intensity * 2.0;
    vec2 uvR = vec2(fract(v_texCoord.x + dispR / u_resolution.x), py);
    vec2 uvG = vec2(fract(v_texCoord.x + dispG / u_resolution.x), py);
    vec2 uvB = vec2(fract(v_texCoord.x + dispB / u_resolution.x), py);
    float r = texture(u_source, uvR).r;
    float g = texture(u_source, uvG).g;
    float b = texture(u_source, uvB).b;
    fragColor = vec4(r, g, b, 1.0);
  } else {
    fragColor = texture(u_source, v_texCoord);
  }
}`,
    uniforms: { intensity: "float", colorFill: "float", speed: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) ?? 60;
    const colorFill = (params.colorFill as number) ?? 30;
    const speed = (params.speed as number) ?? 5;
    if (intensity === 0) return;

    const source = new Uint8ClampedArray(data);
    const seed = Math.floor(time * speed);
    const affectThresh = (intensity / 100) * 0.7;

    const neonColors = [
      [255, 0, 0], [0, 255, 0], [0, 0, 255],
      [0, 255, 255], [255, 0, 255], [255, 255, 0],
    ];

    for (let y = 0; y < height; y++) {
      const rowHash = pseudoRandom(seed + y * 7.3);
      if (rowHash >= affectThresh) continue;

      const fillHash = pseudoRandom(seed + y * 13.1);
      if (fillHash < colorFill / 100) {
        const colorIdx = Math.floor(pseudoRandom(seed + y * 31.7) * 6);
        const [nr, ng, nb] = neonColors[colorIdx];
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          data[idx] = nr; data[idx + 1] = ng; data[idx + 2] = nb;
        }
        continue;
      }

      const dispR = Math.floor((pseudoRandom(seed + y * 17.3) - 0.5) * intensity * 2);
      const dispG = Math.floor((pseudoRandom(seed + y * 19.7) - 0.5) * intensity * 2);
      const dispB = Math.floor((pseudoRandom(seed + y * 23.1) - 0.5) * intensity * 2);

      for (let x = 0; x < width; x++) {
        const dst = (y * width + x) * 4;
        const xR = ((x + dispR) % width + width) % width;
        const xG = ((x + dispG) % width + width) % width;
        const xB = ((x + dispB) % width + width) % width;
        data[dst]     = source[(y * width + xR) * 4];
        data[dst + 1] = source[(y * width + xG) * 4 + 1];
        data[dst + 2] = source[(y * width + xB) * 4 + 2];
      }
    }
  },
});

registerEffect({
  type: "vsync-destroy",
  label: "VSync Destroy",
  category: "glitch",
  defaultParams: { barCount: 12, barWidth: 20, opacity: 80, speed: 4 },
  paramsConfig: [
    { key: "barCount", label: "Bar Count", type: "slider", min: 1, max: 50, step: 1 },
    { key: "barWidth", label: "Bar Width", type: "slider", min: 1, max: 100, step: 1 },
    { key: "opacity", label: "Opacity", type: "slider", min: 0, max: 100, step: 1 },
    { key: "speed", label: "Speed", type: "slider", min: 1, max: 20, step: 1 },
  ],
  glsl: {
    fragment: `
uniform float u_barCount;
uniform float u_barWidth;
uniform float u_opacity;
uniform float u_speed;

vec3 neonBar(float seed) {
  int i = int(mod(seed * 6.0, 6.0));
  if (i == 0) return vec3(1.0, 0.0, 0.0);
  if (i == 1) return vec3(0.0, 1.0, 0.0);
  if (i == 2) return vec3(0.0, 0.0, 1.0);
  if (i == 3) return vec3(0.0, 1.0, 1.0);
  if (i == 4) return vec3(1.0, 0.0, 1.0);
  return vec3(1.0, 1.0, 0.0);
}

void main() {
  vec4 original = texture(u_source, v_texCoord);
  float seed = floor(u_time * u_speed * 0.5);
  float px = v_texCoord.x * u_resolution.x;

  for (int i = 0; i < 50; i++) {
    if (float(i) >= u_barCount) break;
    float barX = pseudoRandom(seed + float(i) * 37.1) * u_resolution.x;
    float barW = u_barWidth * (0.5 + pseudoRandom(seed + float(i) * 53.7) * 1.5);
    if (px >= barX && px < barX + barW) {
      vec3 neon = neonBar(pseudoRandom(seed + float(i) * 79.3));
      float alpha = u_opacity / 100.0;
      fragColor = vec4(mix(original.rgb, neon, alpha), 1.0);
      return;
    }
  }
  fragColor = original;
}`,
    uniforms: { barCount: "float", barWidth: "float", opacity: "float", speed: "float" },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const barCount = Math.round((params.barCount as number) ?? 12);
    const barWidth = (params.barWidth as number) ?? 20;
    const opacity = (params.opacity as number) / 100 || 0.8;
    const speed = (params.speed as number) ?? 4;

    const neonColors = [
      [255, 0, 0], [0, 255, 0], [0, 0, 255],
      [0, 255, 255], [255, 0, 255], [255, 255, 0],
    ];

    const seed = Math.floor(time * speed * 0.5);

    const barRegions: Array<{ x: number; w: number; color: number[] }> = [];
    for (let i = 0; i < barCount; i++) {
      const bx = Math.floor(pseudoRandom(seed + i * 37.1) * width);
      const bw = Math.floor(barWidth * (0.5 + pseudoRandom(seed + i * 53.7) * 1.5));
      const colorIdx = Math.floor(pseudoRandom(seed + i * 79.3) * 6);
      barRegions.push({ x: bx, w: bw, color: neonColors[colorIdx] });
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        for (const bar of barRegions) {
          if (x >= bar.x && x < bar.x + bar.w) {
            data[idx]     = Math.round(data[idx]     * (1 - opacity) + bar.color[0] * opacity);
            data[idx + 1] = Math.round(data[idx + 1] * (1 - opacity) + bar.color[1] * opacity);
            data[idx + 2] = Math.round(data[idx + 2] * (1 - opacity) + bar.color[2] * opacity);
            break;
          }
        }
      }
    }
  },
});

registerEffect({
  type: "nerve-damage",
  label: "Nerve Damage",
  category: "glitch",
  defaultParams: {
    destruction: 75,
    strideCorruption: 60,
    colorCrush: 80,
    lineDisplacement: 70,
    syncBars: 60,
    gridDensity: 16,
    speed: 6,
  },
  paramsConfig: [
    { key: "destruction", label: "Destruction", type: "slider", min: 0, max: 100, step: 1 },
    { key: "strideCorruption", label: "Stride Corruption", type: "slider", min: 0, max: 100, step: 1 },
    { key: "colorCrush", label: "Color Crush", type: "slider", min: 0, max: 100, step: 1 },
    { key: "lineDisplacement", label: "Line Displacement", type: "slider", min: 0, max: 100, step: 1 },
    { key: "syncBars", label: "Sync Bars", type: "slider", min: 0, max: 100, step: 1 },
    { key: "gridDensity", label: "Grid Density", type: "slider", min: 0, max: 50, step: 1 },
    { key: "speed", label: "Speed", type: "slider", min: 1, max: 20, step: 1 },
  ],
  glsl: {
    fragment: `
uniform float u_destruction;
uniform float u_strideCorruption;
uniform float u_colorCrush;
uniform float u_lineDisplacement;
uniform float u_syncBars;
uniform float u_gridDensity;
uniform float u_speed;

const float BAYER[16] = float[16](
   0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
  12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
   3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
  15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
);

vec3 neonPick(float h) {
  int i = int(mod(floor(h * 6.0), 6.0));
  if (i == 0) return vec3(1.0, 0.0, 0.0);
  if (i == 1) return vec3(0.0, 1.0, 0.0);
  if (i == 2) return vec3(0.0, 0.0, 1.0);
  if (i == 3) return vec3(0.0, 1.0, 1.0);
  if (i == 4) return vec3(1.0, 0.0, 1.0);
  return vec3(1.0, 1.0, 0.0);
}

void main() {
  float D = u_destruction / 100.0;
  float seed = floor(u_time * u_speed);
  vec2 uv = v_texCoord;
  float px = uv.x * u_resolution.x;
  float py = uv.y * u_resolution.y;

  // ── 1. Stride corruption ───────────────────────────────────────────────────
  float stridePower = u_strideCorruption * D;
  if (stridePower > 0.0) {
    float flatIdx = py * u_resolution.x + px;
    float strideR = u_resolution.x + stridePower * 0.8;
    float strideB = u_resolution.x - stridePower * 0.6;
    uv.x = mod(mod(flatIdx, strideR) / u_resolution.x, 1.0);
  }

  // ── 2. Line massacre ───────────────────────────────────────────────────────
  float linePower = u_lineDisplacement * D;
  if (linePower > 0.0) {
    float rowHash = pseudoRandom(seed + py * 7.3);
    if (rowHash < linePower / 100.0 * 0.7) {
      float fillHash = pseudoRandom(seed + py * 13.1);
      if (fillHash < 0.25) {
        fragColor = vec4(neonPick(pseudoRandom(seed + py * 31.7)), 1.0);
        return;
      }
      float dispR = (pseudoRandom(seed + py * 17.3) - 0.5) * linePower * 2.0;
      float dispG = (pseudoRandom(seed + py * 19.7) - 0.5) * linePower * 2.0;
      float dispB = (pseudoRandom(seed + py * 23.1) - 0.5) * linePower * 2.0;
      float r = texture(u_source, vec2(fract(uv.x + dispR / u_resolution.x), uv.y)).r;
      float g = texture(u_source, vec2(fract(uv.x + dispG / u_resolution.x), uv.y)).g;
      float b = texture(u_source, vec2(fract(uv.x + dispB / u_resolution.x), uv.y)).b;
      // ── 3. Neon crush on displaced rows ─────────────────────────────────────
      vec3 col = vec3(r, g, b);
      if (u_colorCrush > 0.0) {
        int bx = int(mod(gl_FragCoord.x, 4.0));
        int by2 = int(mod(gl_FragCoord.y, 4.0));
        float dither = BAYER[by2 * 4 + bx] * (u_colorCrush / 200.0);
        col.r = floor((col.r + dither) * 2.0 + 0.5) / 2.0;
        col.g = floor((col.g + dither) * 2.0 + 0.5) / 2.0;
        col.b = floor((col.b + dither) * 2.0 + 0.5) / 2.0;
      }
      fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      return;
    }
  }

  vec4 col = texture(u_source, uv);

  // ── 3. Neon crush (global) ─────────────────────────────────────────────────
  float crushPower = u_colorCrush * D;
  if (crushPower > 0.0) {
    vec3 hsl = rgbToHsl(col.rgb);
    hsl.y = clamp(hsl.y + crushPower / 100.0, 0.0, 1.0);
    col.rgb = hslToRgb(hsl.x, hsl.y, hsl.z);
    int bx = int(mod(gl_FragCoord.x, 4.0));
    int by2 = int(mod(gl_FragCoord.y, 4.0));
    float dither = BAYER[by2 * 4 + bx] * (crushPower / 300.0);
    float levels = 1.0;
    col.r = floor((col.r + dither / levels) * levels + 0.5) / levels;
    col.g = floor((col.g + dither / levels) * levels + 0.5) / levels;
    col.b = floor((col.b + dither / levels) * levels + 0.5) / levels;
  }

  // ── 4. VSync bars ─────────────────────────────────────────────────────────
  float barPower = u_syncBars * D;
  if (barPower > 0.0) {
    float barSeed = floor(u_time * u_speed * 0.5);
    int numBars = int(barPower / 10.0);
    for (int i = 0; i < 20; i++) {
      if (i >= numBars) break;
      float barX = pseudoRandom(barSeed + float(i) * 37.1) * u_resolution.x;
      float barW = 10.0 + pseudoRandom(barSeed + float(i) * 53.7) * barPower * 0.4;
      if (px >= barX && px < barX + barW) {
        vec3 neon = neonPick(pseudoRandom(barSeed + float(i) * 79.3));
        col.rgb = mix(col.rgb, neon, barPower / 100.0);
        break;
      }
    }
  }

  // ── 5. Grid overlay ───────────────────────────────────────────────────────
  if (u_gridDensity > 0.0) {
    float gx = mod(px, u_gridDensity);
    float gy = mod(py, u_gridDensity);
    if (gx < 1.0 || gy < 1.0) {
      col.rgb = vec3(0.0);
    }
  }

  fragColor = vec4(clamp(col.rgb, 0.0, 1.0), col.a);
}`,
    uniforms: {
      destruction: "float",
      strideCorruption: "float",
      colorCrush: "float",
      lineDisplacement: "float",
      syncBars: "float",
      gridDensity: "float",
      speed: "float",
    },
  },
  processor: (data, { width, height, time = 0 }, params) => {
    const destruction = (params.destruction as number) / 100 || 0.75;
    const strideCorruption = (params.strideCorruption as number) ?? 60;
    const colorCrushParam = (params.colorCrush as number) ?? 80;
    const lineDisplacement = (params.lineDisplacement as number) ?? 70;
    const syncBars = (params.syncBars as number) ?? 60;
    const gridDensity = (params.gridDensity as number) ?? 16;
    const speed = (params.speed as number) ?? 6;

    const source = new Uint8ClampedArray(data);
    const seed = Math.floor(time * speed);
    const barSeed = Math.floor(time * speed * 0.5);

    const BAYER = [
       0/16,  8/16,  2/16, 10/16,
      12/16,  4/16, 14/16,  6/16,
       3/16, 11/16,  1/16,  9/16,
      15/16,  7/16, 13/16,  5/16,
    ];

    const neonColors = [
      [255, 0, 0], [0, 255, 0], [0, 0, 255],
      [0, 255, 255], [255, 0, 255], [255, 255, 0],
    ];

    const numBars = Math.floor((syncBars * destruction) / 10);
    const barRegions: Array<{ x: number; w: number; color: number[] }> = [];
    for (let i = 0; i < numBars; i++) {
      barRegions.push({
        x: Math.floor(pseudoRandom(barSeed + i * 37.1) * width),
        w: Math.floor(10 + pseudoRandom(barSeed + i * 53.7) * syncBars * destruction * 0.4),
        color: neonColors[Math.floor(pseudoRandom(barSeed + i * 79.3) * 6)],
      });
    }

    const stridePower = strideCorruption * destruction;
    const linePower = lineDisplacement * destruction;
    const crushPower = colorCrushParam * destruction;

    for (let y = 0; y < height; y++) {
      const rowHash = pseudoRandom(seed + y * 7.3);
      const lineMassacre = rowHash < (linePower / 100) * 0.7;

      for (let x = 0; x < width; x++) {
        const dst = (y * width + x) * 4;

        let r: number, g: number, b: number;

        if (lineMassacre) {
          const fillHash = pseudoRandom(seed + y * 13.1);
          if (fillHash < 0.25) {
            const nc = neonColors[Math.floor(pseudoRandom(seed + y * 31.7) * 6)];
            data[dst] = nc[0]; data[dst + 1] = nc[1]; data[dst + 2] = nc[2]; data[dst + 3] = 255;
            continue;
          }
          const dispR = Math.floor((pseudoRandom(seed + y * 17.3) - 0.5) * linePower * 2);
          const dispG = Math.floor((pseudoRandom(seed + y * 19.7) - 0.5) * linePower * 2);
          const dispB = Math.floor((pseudoRandom(seed + y * 23.1) - 0.5) * linePower * 2);
          r = source[(y * width + ((x + dispR + width * 2) % width)) * 4];
          g = source[(y * width + ((x + dispG + width * 2) % width)) * 4 + 1];
          b = source[(y * width + ((x + dispB + width * 2) % width)) * 4 + 2];
        } else if (stridePower > 0) {
          const flatIdx = y * width + x;
          const strideR = width + stridePower * 0.8;
          const newRowR = Math.floor(flatIdx / strideR);
          const newColR = Math.floor(flatIdx % strideR) % width;
          const srcR = Math.min(newRowR, height - 1) * width + newColR;
          r = source[srcR * 4];

          const strideB = Math.max(1, width - stridePower * 0.6);
          const newRowB = Math.floor(flatIdx / strideB);
          const newColB = Math.floor(flatIdx % strideB) % width;
          const srcB = Math.min(newRowB, height - 1) * width + newColB;
          b = source[srcB * 4 + 2];
          g = source[dst + 1];
        } else {
          r = source[dst]; g = source[dst + 1]; b = source[dst + 2];
        }

        // Neon crush
        if (crushPower > 0) {
          const [h, s, l] = rgbToHsl(r / 255, g / 255, b / 255);
          const boostedSat = Math.min(1, s + crushPower / 100);
          const [cr, cg, cb] = hslToRgb(h, boostedSat, l);
          const dither = BAYER[(y % 4) * 4 + (x % 4)] * (crushPower / 300);
          r = clamp(Math.round((cr + dither) * 2 + 0.5) / 2 * 255, 0, 255);
          g = clamp(Math.round((cg + dither) * 2 + 0.5) / 2 * 255, 0, 255);
          b = clamp(Math.round((cb + dither) * 2 + 0.5) / 2 * 255, 0, 255);
        }

        // VSync bars
        for (const bar of barRegions) {
          if (x >= bar.x && x < bar.x + bar.w) {
            const alpha = (syncBars * destruction) / 100;
            r = Math.round(r * (1 - alpha) + bar.color[0] * alpha);
            g = Math.round(g * (1 - alpha) + bar.color[1] * alpha);
            b = Math.round(b * (1 - alpha) + bar.color[2] * alpha);
            break;
          }
        }

        // Grid overlay
        if (gridDensity > 0 && (x % gridDensity < 1 || y % gridDensity < 1)) {
          r = 0; g = 0; b = 0;
        }

        data[dst] = r; data[dst + 1] = g; data[dst + 2] = b; data[dst + 3] = 255;
      }
    }
  },
});
