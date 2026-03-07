import { registerEffect, ProcessConfig } from "../effect-registry";
import { EffectType, EffectParamConfig } from "../types";
import { FaceBounds, HandBounds, PoseBounds, getEyeLandmarks, getMouthLandmarks, getLandmarkBounds } from "../face-detector";
import { BAYER_MATRIX_4x4, motionSmearState, datamoshState, blockShovingState, bilinearSample, meltState, perlinNoise, posterizeTimeCache, pseudoRandom, clamp, sortSegment, sortSegmentV, getBlockAverage, hexToRgb, rgbToHsl, hslToRgb, isPointInFaceBounds, frameHistoryStore, storeFrame, getFrameFromHistory } from "./shared";

registerEffect({
  type: "glitch",
  label: "Digital Glitch",
  category: "glitch",
    defaultParams: { intensity: 50, speed: 10 },
  paramsConfig: [],
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) || 50;
    const speed = (params.speed as number) || 10;
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
    const mode = (params.mode as string) || "melt";
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
        mediaSources: [],
        lastUpdate: 0,
        activeSource: -1,
      },
  paramsConfig: [],
  processor: (data, { width, height }, params) => {
    const style = (params.style as string) || "block";
    const intensity = (params.intensity as number) ?? 50;
    const blockSize = (params.blockSize as number) || 16;
    const activeSource = (params.activeSource as number) ?? -1;
    const lastUpdate = (params.lastUpdate as number) || 0;
    const mediaSources = (params.mediaSources as ImageData[]) || [];

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
      blockShovingState.lastUpdate = lastUpdate;
      blockShovingState.mvXBuffer = new Float32Array(totalBlocks);
      blockShovingState.mvYBuffer = new Float32Array(totalBlocks);
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

    if (lastUpdate > blockShovingState.lastUpdate) {
      blockShovingState.lastUpdate = lastUpdate;

      if (activeSource === -1) {
        for (let i = 0; i < data.length; i++) {
          moshBuffer[i] = currentInput[i];
        }
      } else if (mediaSources[activeSource]) {
        const source = mediaSources[activeSource];
        const srcData = source.data;
        const sw = source.width;
        const sh = source.height;

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const sx = Math.floor(x * (sw / width));
            const sy = Math.floor(y * (sh / height));
            const si = (sy * sw + sx) * 4;
            const di = (y * width + x) * 4;

            moshBuffer[di] = srcData[si];
            moshBuffer[di + 1] = srcData[si + 1];
            moshBuffer[di + 2] = srcData[si + 2];
            moshBuffer[di + 3] = 255;
          }
        }
      }
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
  type: "datamosh",
  label: "Datamosh",
  category: "glitch",
    defaultParams: {
        intensity: 50,
        mediaSources: [],
        lastUpdate: 0,
        activeSource: -1,
      },
  paramsConfig: [],
  processor: (data, { width, height }, params) => {
    const intensity = (params.intensity as number) ?? 50;
    const activeSource = (params.activeSource as number) ?? -1;
    const lastUpdate = (params.lastUpdate as number) || 0;
    const mediaSources = (params.mediaSources as ImageData[]) || [];

    if (intensity === 0) return;

    const needsInit =
      datamoshState.width !== width ||
      datamoshState.height !== height ||
      !datamoshState.prevInput;

    const currentInput = new Uint8ClampedArray(data);

    if (needsInit) {
      datamoshState.prevInput = currentInput;
      datamoshState.moshBuffer = new Uint8ClampedArray(data);
      datamoshState.width = width;
      datamoshState.height = height;
      datamoshState.lastUpdate = lastUpdate;
      datamoshState.mvXBuffer = null;
      datamoshState.mvYBuffer = null;
      return;
    }

    const prevInput = datamoshState.prevInput!;
    const moshBuffer = datamoshState.moshBuffer!;

    if (lastUpdate > datamoshState.lastUpdate) {
      datamoshState.lastUpdate = lastUpdate;

      if (activeSource === -1) {
        for (let i = 0; i < data.length; i++) {
          moshBuffer[i] = currentInput[i];
        }
      } else if (mediaSources[activeSource]) {
        const source = mediaSources[activeSource];
        const srcData = source.data;
        const sw = source.width;
        const sh = source.height;

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const sx = Math.floor(x * (sw / width));
            const sy = Math.floor(y * (sh / height));
            const si = (sy * sw + sx) * 4;
            const di = (y * width + x) * 4;

            moshBuffer[di] = srcData[si];
            moshBuffer[di + 1] = srcData[si + 1];
            moshBuffer[di + 2] = srcData[si + 2];
            moshBuffer[di + 3] = 255;
          }
        }
      }
    }

    const factor = intensity / 100;

    for (let i = 0; i < data.length; i += 4) {
      const deltaR = currentInput[i] - prevInput[i];
      const deltaG = currentInput[i + 1] - prevInput[i + 1];
      const deltaB = currentInput[i + 2] - prevInput[i + 2];

      moshBuffer[i] = Math.max(
        0,
        Math.min(255, moshBuffer[i] + deltaR * factor)
      );
      moshBuffer[i + 1] = Math.max(
        0,
        Math.min(255, moshBuffer[i + 1] + deltaG * factor)
      );
      moshBuffer[i + 2] = Math.max(
        0,
        Math.min(255, moshBuffer[i + 2] + deltaB * factor)
      );

      data[i] = moshBuffer[i];
      data[i + 1] = moshBuffer[i + 1];
      data[i + 2] = moshBuffer[i + 2];
    }

    datamoshState.prevInput = currentInput;
  },
});

registerEffect({
  type: "block-corrupt",
  label: "Block Corrupt",
  category: "glitch",
    defaultParams: { intensity: 30, blockSize: 16 },
  paramsConfig: [],
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) || 30;
    const blockSize = (params.blockSize as number) || 16;
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

registerEffect({
  type: "pixel-sort",
  label: "Pixel Sort",
  category: "glitch",
    defaultParams: { threshold: 50, direction: "horizontal" },
  paramsConfig: [],
  processor: (data, { width, height }, params) => {
    const threshold = (params.threshold as number) || 50;
    const angle = (params.angle as number) || 0;

    const src = new Uint8ClampedArray(data);
    const angleNorm = ((angle % 360) + 360) % 360;
    const angleRad = (angleNorm * Math.PI) / 180;

    const gcd = (a: number, b: number): number => {
      let x = Math.abs(a);
      let y = Math.abs(b);
      while (y !== 0) {
        const t = x % y;
        x = y;
        y = t;
      }
      return x;
    };

    const quantizeStep = (): { dx: number; dy: number } => {
      const scale = 8;
      let dx = Math.round(Math.cos(angleRad) * scale);
      let dy = Math.round(Math.sin(angleRad) * scale);
      if (dx === 0 && dy === 0) dx = 1;
      const g = gcd(dx, dy) || 1;
      dx = dx / g;
      dy = dy / g;
      return { dx, dy };
    };

    const { dx, dy } = quantizeStep();

    const flushSegment = (
      segmentOffsets: number[],
      buckets: number[][],
      usedKeys: number[]
    ) => {
      if (segmentOffsets.length <= 1) {
        segmentOffsets.length = 0;
        return;
      }

      usedKeys.sort((a, b) => a - b);

      let out = 0;
      for (let k = 0; k < usedKeys.length; k++) {
        const key = usedKeys[k];
        const arr = buckets[key];
        for (let j = 0; j < arr.length; j += 3) {
          const o = segmentOffsets[out++];
          data[o] = arr[j];
          data[o + 1] = arr[j + 1];
          data[o + 2] = arr[j + 2];
        }
        arr.length = 0;
      }

      usedKeys.length = 0;
      segmentOffsets.length = 0;
    };

    const processLine = (sx: number, sy: number) => {
      const buckets: number[][] = new Array(766);
      for (let i = 0; i < 766; i++) buckets[i] = [];
      const usedKeys: number[] = [];
      const segmentOffsets: number[] = [];

      let x = sx;
      let y = sy;

      while (x >= 0 && x < width && y >= 0 && y < height) {
        const o = (y * width + x) * 4;
        const r = src[o];
        const g = src[o + 1];
        const b = src[o + 2];
        const bri = (r + g + b) / 3;

        if (bri > threshold) {
          segmentOffsets.push(o);
          const key = (r + g + b) | 0;
          if (buckets[key].length === 0) usedKeys.push(key);
          buckets[key].push(r, g, b);
        } else {
          flushSegment(segmentOffsets, buckets, usedKeys);
        }

        x += dx;
        y += dy;
      }

      flushSegment(segmentOffsets, buckets, usedKeys);
    };

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
  processor: (data, { width, height }, params) => {
    const rOffset = (params.rOffset as number) || 5;
    const gOffset = (params.gOffset as number) || 0;
    const bOffset = (params.bOffset as number) || -5;

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
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) || 50;
    const count = (params.count as number) || 3;
    const offset = (params.offset as number) || 20;
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
  processor: (data, { width, height }, params) => {
    const bits = (params.bits as number) || 4;
    const intensity = (params.intensity as number) || 50;
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
  processor: (data, { width, height }, params) => {
    const intensity = (params.intensity as number) || 50;
    const fragmentSize = (params.fragmentSize as number) || 8;
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
  processor: (data, { width, height }, params) => {
    const intensity = (params.intensity as number) || 50;
    const corruption = (params.corruption as number) || 30;
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
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) || 50;
    const layers = (params.layers as number) || 3;
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
  type: "face-pixelate",
  label: "Face Pixelate",
  category: "glitch",
    defaultParams: { blockSize: 16 },
  paramsConfig: [],
  processor: (data, { width, height, faceBounds = [] }, params) => {
    const blockSize = (params.blockSize as number) || 16;

    if (faceBounds.length === 0) return;

    const source = new Uint8ClampedArray(data);

    for (const face of faceBounds) {
      const faceX = Math.floor(face.x * width);
      const faceY = Math.floor(face.y * height);
      const faceW = Math.floor(face.width * width);
      const faceH = Math.floor(face.height * height);

      const startX = Math.max(0, faceX);
      const startY = Math.max(0, faceY);
      const endX = Math.min(width, faceX + faceW);
      const endY = Math.min(height, faceY + faceH);

      for (let by = startY; by < endY; by += blockSize) {
        for (let bx = startX; bx < endX; bx += blockSize) {
          const blockEndX = Math.min(bx + blockSize, endX);
          const blockEndY = Math.min(by + blockSize, endY);

          let rSum = 0;
          let gSum = 0;
          let bSum = 0;
          let count = 0;

          for (let y = by; y < blockEndY; y++) {
            for (let x = bx; x < blockEndX; x++) {
              if (isPointInFaceBounds(x, y, width, height, face)) {
                const i = (y * width + x) * 4;
                rSum += source[i];
                gSum += source[i + 1];
                bSum += source[i + 2];
                count++;
              }
            }
          }

          if (count > 0) {
            const r = Math.round(rSum / count);
            const g = Math.round(gSum / count);
            const b = Math.round(bSum / count);

            for (let y = by; y < blockEndY; y++) {
              for (let x = bx; x < blockEndX; x++) {
                if (isPointInFaceBounds(x, y, width, height, face)) {
                  const i = (y * width + x) * 4;
                  data[i] = r;
                  data[i + 1] = g;
                  data[i + 2] = b;
                }
              }
            }
          }
        }
      }
    }
  },
});

registerEffect({
  type: "face-blur",
  label: "Face Blur",
  category: "glitch",
    defaultParams: { radius: 20 },
  paramsConfig: [],
  processor: (data, { width, height, faceBounds = [] }, params) => {
    const radius = (params.radius as number) || 20;

    if (faceBounds.length === 0 || radius <= 0) return;

    const source = new Uint8ClampedArray(data);
    const boxPasses = 3;
    const boxRadius = Math.ceil(radius / boxPasses);

    for (const face of faceBounds) {
      const padding = 0.15;
      const faceX = Math.floor((face.x - face.width * padding) * width);
      const faceY = Math.floor((face.y - face.height * padding) * height);
      const faceW = Math.floor(face.width * (1 + padding * 2) * width);
      const faceH = Math.floor(face.height * (1 + padding * 2) * height);

      const startX = Math.max(0, faceX);
      const startY = Math.max(0, faceY);
      const endX = Math.min(width, faceX + faceW);
      const endY = Math.min(height, faceY + faceH);
      const regionW = endX - startX;
      const regionH = endY - startY;

      if (regionW <= 0 || regionH <= 0) continue;

      const regionSize = regionW * regionH * 4;
      let current = new Uint8ClampedArray(regionSize);
      let temp = new Uint8ClampedArray(regionSize);

      for (let y = 0; y < regionH; y++) {
        for (let x = 0; x < regionW; x++) {
          const srcI = ((startY + y) * width + (startX + x)) * 4;
          const dstI = (y * regionW + x) * 4;
          current[dstI] = source[srcI];
          current[dstI + 1] = source[srcI + 1];
          current[dstI + 2] = source[srcI + 2];
          current[dstI + 3] = source[srcI + 3];
        }
      }

      for (let pass = 0; pass < boxPasses; pass++) {
        for (let y = 0; y < regionH; y++) {
          for (let x = 0; x < regionW; x++) {
            let rSum = 0,
              gSum = 0,
              bSum = 0,
              count = 0;
            const minKX = Math.max(0, x - boxRadius);
            const maxKX = Math.min(regionW - 1, x + boxRadius);

            for (let kx = minKX; kx <= maxKX; kx++) {
              const i = (y * regionW + kx) * 4;
              rSum += current[i];
              gSum += current[i + 1];
              bSum += current[i + 2];
              count++;
            }

            const i = (y * regionW + x) * 4;
            temp[i] = Math.round(rSum / count);
            temp[i + 1] = Math.round(gSum / count);
            temp[i + 2] = Math.round(bSum / count);
            temp[i + 3] = current[i + 3];
          }
        }

        for (let y = 0; y < regionH; y++) {
          for (let x = 0; x < regionW; x++) {
            let rSum = 0,
              gSum = 0,
              bSum = 0,
              count = 0;
            const minKY = Math.max(0, y - boxRadius);
            const maxKY = Math.min(regionH - 1, y + boxRadius);

            for (let ky = minKY; ky <= maxKY; ky++) {
              const i = (ky * regionW + x) * 4;
              rSum += temp[i];
              gSum += temp[i + 1];
              bSum += temp[i + 2];
              count++;
            }

            const i = (y * regionW + x) * 4;
            current[i] = Math.round(rSum / count);
            current[i + 1] = Math.round(gSum / count);
            current[i + 2] = Math.round(bSum / count);
          }
        }
      }

      for (let y = 0; y < regionH; y++) {
        for (let x = 0; x < regionW; x++) {
          const globalX = startX + x;
          const globalY = startY + y;

          if (isPointInFaceBounds(globalX, globalY, width, height, face)) {
            const srcI = (y * regionW + x) * 4;
            const dstI = (globalY * width + globalX) * 4;
            data[dstI] = current[srcI];
            data[dstI + 1] = current[srcI + 1];
            data[dstI + 2] = current[srcI + 2];
          }
        }
      }
    }
  },
});

registerEffect({
  type: "jpeg-artifacts",
  label: "JPEG Artifacts",
  category: "glitch",
    defaultParams: {
        quality: 30,
        blockiness: 50,
        colorBanding: 50,
      },
  paramsConfig: [],
  processor: (data, { width, height }, params) => {
    const quality = Math.max(
      1,
      Math.min(100, (params.quality as number) || 30)
    );
    const blockiness = (params.blockiness as number) || 50;
    const colorBanding = (params.colorBanding as number) || 50;

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
    defaultParams: {
        intensity: 50,
        blockSize: 16,
        colorBleed: 50,
        temporal: true,
      },
  paramsConfig: [],
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) || 50;
    const blockSize = (params.blockSize as number) || 16;
    const colorBleed = (params.colorBleed as number) || 50;
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
    const intensity = (params.intensity as number) || 0.5;
    const frameHistory = (params.frameHistory as number) || 1;

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
    defaultParams: {
        speed: 2,
        amplitude: 1.0,
      },
  paramsConfig: [],
  processor: (data, { width, height, time = 0 }, params) => {
    const speed = (params.speed as number) || 2;
    const amplitude = (params.amplitude as number) || 1.0;

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
    const intensity = (params.intensity as number) || 0.7;
    const decay = (params.decay as number) || 0.9;
    const maxFrames = (params.maxFrames as number) || 8;

    storeFrame(data, width, height);

    const numFrames = Math.min(maxFrames, frameHistoryStore.frames.length);
    if (numFrames === 0) return;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i] * (1 - intensity);
      let g = data[i + 1] * (1 - intensity);
      let b = data[i + 2] * (1 - intensity);

      let weight = intensity;
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
    const rDecay = (params.rDecay as number) || 0.95;
    const gDecay = (params.gDecay as number) || 0.9;
    const bDecay = (params.bDecay as number) || 0.85;
    const maxFrames = (params.maxFrames as number) || 6;

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
    const delay = (params.delay as number) || 2;
    const feedback = (params.feedback as number) || 0.8;
    const scale = (params.scale as number) || 0.95;

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
    const delay = (params.delay as number) || 5;
    const blendMode = (params.blendMode as string) || "replace";

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
    const alpha = (params.alpha as number) || 0.3;
    const maxFrames = (params.maxFrames as number) || 10;

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
    defaultParams: {
        gridSize: 4,
        swapPattern: "random",
        animated: true,
      },
  paramsConfig: [],
  processor: (data, { width, height, time = 0 }, params) => {
    const gridSize = (params.gridSize as number) || 4;
    const swapPattern = (params.swapPattern as string) || "random";
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