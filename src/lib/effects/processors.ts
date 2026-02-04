import { registerEffect, ProcessConfig } from "./effect-registry";
import {
  FaceBounds,
  getEyeLandmarks,
  getMouthLandmarks,
  getLandmarkBounds,
} from "./face-detector";

const BAYER_MATRIX_4x4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

registerEffect({
  type: "invert",
  label: "Invert",
  category: "color",
  processor: (data) => {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i];
      data[i + 1] = 255 - data[i + 1];
      data[i + 2] = 255 - data[i + 2];
    }
  },
});

registerEffect({
  type: "glitch",
  label: "Digital Glitch",
  category: "glitch",
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

const motionSmearState: {
  prevFrame: Uint8ClampedArray | null;
  meltBuffer: Uint8ClampedArray | null;
  mvX: Float32Array | null;
  mvY: Float32Array | null;
  width: number;
  height: number;
} = {
  prevFrame: null,
  meltBuffer: null,
  mvX: null,
  mvY: null,
  width: 0,
  height: 0,
};

registerEffect({
  type: "motion-smear",
  label: "Motion Smear",
  category: "glitch",
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

const datamoshState: {
  prevInput: Uint8ClampedArray | null;
  moshBuffer: Uint8ClampedArray | null;
  width: number;
  height: number;
  lastUpdate: number;
  mvXBuffer: Float32Array | null;
  mvYBuffer: Float32Array | null;
} = {
  prevInput: null,
  moshBuffer: null,
  width: 0,
  height: 0,
  lastUpdate: 0,
  mvXBuffer: null,
  mvYBuffer: null,
};

const blockShovingState: {
  prevInput: Uint8ClampedArray | null;
  moshBuffer: Uint8ClampedArray | null;
  width: number;
  height: number;
  lastUpdate: number;
  mvXBuffer: Float32Array | null;
  mvYBuffer: Float32Array | null;
} = {
  prevInput: null,
  moshBuffer: null,
  width: 0,
  height: 0,
  lastUpdate: 0,
  mvXBuffer: null,
  mvYBuffer: null,
};

registerEffect({
  type: "block-shoving",
  label: "Block Shoving",
  category: "glitch",
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

function bilinearSample(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number
): number {
  const x1 = Math.floor(x);
  const y1 = Math.floor(y);
  const x2 = x1 + 1;
  const y2 = y1 + 1;

  const wx = x - x1;
  const wy = y - y1;

  // Clamp coordinates
  const sx1 = Math.max(0, Math.min(width - 1, x1));
  const sy1 = Math.max(0, Math.min(height - 1, y1));
  const sx2 = Math.max(0, Math.min(width - 1, x2));
  const sy2 = Math.max(0, Math.min(height - 1, y2));

  const idx11 = (sy1 * width + sx1) * 4 + channel;
  const idx21 = (sy1 * width + sx2) * 4 + channel;
  const idx12 = (sy2 * width + sx1) * 4 + channel;
  const idx22 = (sy2 * width + sx2) * 4 + channel;

  const v11 = data[idx11];
  const v21 = data[idx21];
  const v12 = data[idx12];
  const v22 = data[idx22];

  return (
    (1 - wy) * ((1 - wx) * v11 + wx * v21) + wy * ((1 - wx) * v12 + wx * v22)
  );
}

registerEffect({
  type: "block-corrupt",
  label: "Block Corrupt",
  category: "glitch",
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
  processor: (data, { width, height }, params) => {
    const threshold = (params.threshold as number) || 50;
    const direction = (params.direction as string) || "horizontal";

    if (direction === "horizontal") {
      for (let y = 0; y < height; y++) {
        const rowStart = y * width * 4;
        let segmentStart = -1;

        for (let x = 0; x < width; x++) {
          const i = rowStart + x * 4;
          const bri = (data[i] + data[i + 1] + data[i + 2]) / 3;

          if (bri > threshold) {
            if (segmentStart === -1) segmentStart = x;
          } else {
            if (segmentStart !== -1) {
              sortSegment(data, rowStart, segmentStart, x - 1);
              segmentStart = -1;
            }
          }
        }
        if (segmentStart !== -1)
          sortSegment(data, rowStart, segmentStart, width - 1);
      }
    } else {
      for (let x = 0; x < width; x++) {
        let segmentStart = -1;

        for (let y = 0; y < height; y++) {
          const i = (y * width + x) * 4;
          const bri = (data[i] + data[i + 1] + data[i + 2]) / 3;

          if (bri > threshold) {
            if (segmentStart === -1) segmentStart = y;
          } else {
            if (segmentStart !== -1) {
              sortSegmentV(data, width, x, segmentStart, y - 1);
              segmentStart = -1;
            }
          }
        }
        if (segmentStart !== -1)
          sortSegmentV(data, width, x, segmentStart, height - 1);
      }
    }
  },
});

registerEffect({
  type: "rgb-channel-separation",
  label: "RGB Split",
  category: "glitch",
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
  type: "dither",
  label: "Dither",
  category: "retro",
  processor: (data, { width, height }, params) => {
    const depth = (params.depth as number) || 4;
    const step = 255 / (depth - 1);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const bayerVal = BAYER_MATRIX_4x4[y % 4][x % 4];
        const noise = (bayerVal / 16 - 0.5) * step;

        data[i] = clamp(Math.round((data[i] + noise) / step) * step, 0, 255);
        data[i + 1] = clamp(
          Math.round((data[i + 1] + noise) / step) * step,
          0,
          255
        );
        data[i + 2] = clamp(
          Math.round((data[i + 2] + noise) / step) * step,
          0,
          255
        );
      }
    }
  },
});

registerEffect({
  type: "chromatic-aberration",
  label: "Chromatic Aberration",
  category: "distortion",
  processor: (data, { width, height }, params) => {
    const offset = (params.offset as number) || 5;
    if (offset === 0) return;

    const source = new Uint8ClampedArray(data);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const rX = clamp(x + offset, 0, width - 1);
        const bX = clamp(x - offset, 0, width - 1);

        data[i] = source[(y * width + rX) * 4];
        data[i + 2] = source[(y * width + bX) * 4 + 2];
      }
    }
  },
});

registerEffect({
  type: "vignette",
  label: "Vignette",
  category: "color",
  processor: (data, { width, height }, params) => {
    const intensity = (params.intensity as number) || 0.5;
    const radius = (params.radius as number) || 0.8;

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
  type: "film-grain",
  label: "Film Grain",
  category: "noise",
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) || 30;
    if (intensity === 0) return;

    const strength = intensity * 2.55;
    const seed = Math.floor(time / 2);

    for (let i = 0; i < data.length; i += 4) {
      const noise = (pseudoRandom(seed + i) - 0.5) * strength;
      data[i] = clamp(data[i] + noise, 0, 255);
      data[i + 1] = clamp(data[i + 1] + noise, 0, 255);
      data[i + 2] = clamp(data[i + 2] + noise, 0, 255);
    }
  },
});

registerEffect({
  type: "scanlines",
  label: "Scanlines",
  category: "retro",
  processor: (data, { width, height }, params) => {
    const spacing = (params.spacing as number) || 3;
    const opacity = (params.opacity as number) || 0.4;
    const darken = 1 - opacity;

    for (let y = 0; y < height; y++) {
      if (y % spacing === 0) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          data[i] *= darken;
          data[i + 1] *= darken;
          data[i + 2] *= darken;
        }
      }
    }
  },
});

registerEffect({
  type: "edge-detect",
  label: "Edge Detect",
  category: "color",
  processor: (data, { width, height }, params) => {
    const threshold = (params.threshold as number) || 50;
    const invert = (params.invert as boolean) || false;

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
  processor: (data, config, params) => {
    const palette = (params.palette as string) || "thermal";
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
  type: "mirror",
  label: "Mirror",
  category: "distortion",
  processor: (data, { width, height }, params) => {
    const mode = (params.mode as string) || "horizontal";
    const source = new Uint8ClampedArray(data);
    const cx = width / 2;
    const cy = height / 2;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let srcX = x,
          srcY = y;

        if (mode === "horizontal") {
          if (x >= cx) srcX = width - 1 - x;
        } else if (mode === "vertical") {
          if (y >= cy) srcY = height - 1 - y;
        } else if (mode === "quad") {
          if (x >= cx) srcX = width - 1 - x;
          if (y >= cy) srcY = height - 1 - y;
        } else if (mode === "kaleidoscope") {
          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          let angle = Math.atan2(dy, dx);
          const segments = 6;
          const segmentAngle = (Math.PI * 2) / segments;
          angle = Math.abs((angle % segmentAngle) - segmentAngle / 2);
          srcX = clamp(Math.floor(cx + Math.cos(angle) * dist), 0, width - 1);
          srcY = clamp(Math.floor(cy + Math.sin(angle) * dist), 0, height - 1);
        }

        const src = (srcY * width + srcX) * 4;
        const dst = (y * width + x) * 4;
        data[dst] = source[src];
        data[dst + 1] = source[src + 1];
        data[dst + 2] = source[src + 2];
      }
    }
  },
});

registerEffect({
  type: "bloom",
  label: "Bloom",
  category: "color",
  processor: (data, { width, height }, params) => {
    const threshold = (params.threshold as number) || 200;
    const intensity = (params.intensity as number) || 0.5;
    const radius = (params.radius as number) || 3;

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
  type: "displacement",
  label: "Displacement",
  category: "distortion",
  processor: (data, { width, height, time = 0 }, params) => {
    const scale = (params.scale as number) || 20;
    const animated = (params.animated as boolean) ?? true;

    const source = new Uint8ClampedArray(data);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const lum = (source[i] + source[i + 1] + source[i + 2]) / 3 / 255;

        let wave = 0;
        if (animated) {
          wave = Math.sin(time * 0.05 + y * 0.05) * (scale * 0.3);
        }

        const offsetX = Math.floor((lum - 0.5) * scale + wave);
        const srcX = clamp(x + offsetX, 0, width - 1);

        const src = (y * width + srcX) * 4;
        data[i] = source[src];
        data[i + 1] = source[src + 1];
        data[i + 2] = source[src + 2];
      }
    }
  },
});

registerEffect({
  type: "wave-distortion",
  label: "Wave",
  category: "distortion",
  processor: (data, { width, height, time = 0 }, params) => {
    const amplitude = (params.amplitude as number) || 10;
    const frequency = (params.frequency as number) || 0.1;
    const direction = (params.direction as string) || "horizontal";
    const animated = (params.animated as boolean) ?? true;

    const source = new Uint8ClampedArray(data);
    const phase = animated ? time * 0.1 : 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        let srcX = x,
          srcY = y;

        if (direction === "horizontal") {
          srcX = Math.floor(x + Math.sin(y * frequency + phase) * amplitude);
        } else {
          srcY = Math.floor(y + Math.sin(x * frequency + phase) * amplitude);
        }

        srcX = clamp(srcX, 0, width - 1);
        srcY = clamp(srcY, 0, height - 1);

        const srcIdx = (srcY * width + srcX) * 4;
        data[i] = source[srcIdx];
        data[i + 1] = source[srcIdx + 1];
        data[i + 2] = source[srcIdx + 2];
      }
    }
  },
});

registerEffect({
  type: "twirl",
  label: "Twirl",
  category: "distortion",
  processor: (data, { width, height }, params) => {
    const angle = (params.angle as number) || 0.5;
    const radius = (params.radius as number) || 0.5;

    const source = new Uint8ClampedArray(data);
    const cx = width / 2;
    const cy = height / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const normalizedDist = dist / maxDist;

        if (normalizedDist < radius) {
          const twist = angle * (1 - normalizedDist / radius);
          const a = Math.atan2(dy, dx) + twist;
          const srcX = clamp(Math.floor(cx + Math.cos(a) * dist), 0, width - 1);
          const srcY = clamp(
            Math.floor(cy + Math.sin(a) * dist),
            0,
            height - 1
          );

          const srcIdx = (srcY * width + srcX) * 4;
          data[i] = source[srcIdx];
          data[i + 1] = source[srcIdx + 1];
          data[i + 2] = source[srcIdx + 2];
        }
      }
    }
  },
});

registerEffect({
  type: "ripple",
  label: "Ripple",
  category: "distortion",
  processor: (data, { width, height, time = 0 }, params) => {
    const amplitude = (params.amplitude as number) || 20;
    const frequency = (params.frequency as number) || 0.05;
    const centerX = (params.centerX as number) || 0.5;
    const centerY = (params.centerY as number) || 0.5;

    const source = new Uint8ClampedArray(data);
    const cx = centerX * width;
    const cy = centerY * height;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ripple = Math.sin(dist * frequency - time * 0.1) * amplitude;

        const angle = Math.atan2(dy, dx);
        const srcX = clamp(
          Math.floor(x + Math.cos(angle) * ripple),
          0,
          width - 1
        );
        const srcY = clamp(
          Math.floor(y + Math.sin(angle) * ripple),
          0,
          height - 1
        );

        const srcIdx = (srcY * width + srcX) * 4;
        data[i] = source[srcIdx];
        data[i + 1] = source[srcIdx + 1];
        data[i + 2] = source[srcIdx + 2];
      }
    }
  },
});

registerEffect({
  type: "vhs",
  label: "VHS",
  category: "retro",
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) || 50;
    if (intensity === 0) return;

    const source = new Uint8ClampedArray(data);
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

registerEffect({
  type: "crt",
  label: "CRT",
  category: "retro",
  processor: (data, { width, height }, params) => {
    const curvature = (params.curvature as number) || 0.2;
    const scanlineIntensity = (params.scanlines as number) || 0.3;

    const source = new Uint8ClampedArray(data);
    const cx = width / 2;
    const cy = height / 2;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const dx = (x - cx) / width;
        const dy = (y - cy) / height;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const curve = 1 + curvature * dist * dist;
        const srcX = clamp(Math.floor(cx + dx * width * curve), 0, width - 1);
        const srcY = clamp(Math.floor(cy + dy * height * curve), 0, height - 1);

        if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) {
          data[i] = data[i + 1] = data[i + 2] = 0;
        } else {
          const srcIdx = (srcY * width + srcX) * 4;
          data[i] = source[srcIdx];
          data[i + 1] = source[srcIdx + 1];
          data[i + 2] = source[srcIdx + 2];
        }

        const scanline = y % 3 === 0 ? 1 - scanlineIntensity : 1;
        data[i] *= scanline;
        data[i + 1] *= scanline;
        data[i + 2] *= scanline;
      }
    }
  },
});

registerEffect({
  type: "posterize",
  label: "Posterize",
  category: "color",
  processor: (data, config, params) => {
    const levels = (params.levels as number) || 8;
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
  processor: (data, config, params) => {
    const color1 = hexToRgb((params.color1 as string) || "#000000");
    const color2 = hexToRgb((params.color2 as string) || "#ffffff");

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
  processor: (data, { time = 0 }, params) => {
    const speed = (params.speed as number) || 1;
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
  processor: (data, config, params) => {
    const swap = (params.swap as string) || "rg";

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
  type: "noise",
  label: "Static Noise",
  category: "noise",
  processor: (data, { time = 0 }, params) => {
    const intensity = (params.intensity as number) || 20;
    const colored = (params.colored as boolean) || false;
    if (intensity === 0) return;

    const noiseAmount = intensity / 100;
    const seed = Math.floor(time * 1000);

    for (let i = 0; i < data.length; i += 4) {
      const r = pseudoRandom(seed + i * 7 + 0);
      if (r < noiseAmount) {
        const noiseStrength = r / noiseAmount;
        if (colored) {
          const noiseR = (pseudoRandom(seed + i * 7 + 1) - 0.5) * 2;
          const noiseG = (pseudoRandom(seed + i * 7 + 2) - 0.5) * 2;
          const noiseB = (pseudoRandom(seed + i * 7 + 3) - 0.5) * 2;
          data[i] = clamp(data[i] + noiseR * noiseStrength * 255, 0, 255);
          data[i + 1] = clamp(
            data[i + 1] + noiseG * noiseStrength * 255,
            0,
            255
          );
          data[i + 2] = clamp(
            data[i + 2] + noiseB * noiseStrength * 255,
            0,
            255
          );
        } else {
          const noise = (pseudoRandom(seed + i * 7 + 1) - 0.5) * 2;
          const noiseValue = noise * noiseStrength * 255;
          data[i] = clamp(data[i] + noiseValue, 0, 255);
          data[i + 1] = clamp(data[i + 1] + noiseValue, 0, 255);
          data[i + 2] = clamp(data[i + 2] + noiseValue, 0, 255);
        }
      }
    }
  },
});

registerEffect({
  type: "screen-tear",
  label: "Screen Tear",
  category: "glitch",
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
  type: "heavy-distortion",
  label: "Heavy Distortion",
  category: "distortion",
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) || 50;
    const frequency = (params.frequency as number) || 0.15;
    const speed = (params.speed as number) || 2;
    if (intensity === 0) return;

    const source = new Uint8ClampedArray(data);
    const t = time * speed;
    const chaos = Math.random() * 50 * (intensity / 100);

    for (let y = 0; y < height; y++) {
      const rowChaos = Math.random() < intensity / 200;
      const rowJitter = rowChaos ? (Math.random() - 0.5) * 100 : 0;

      for (let x = 0; x < width; x++) {
        const nx = x / width;
        const ny = y / height;

        const wave1 = Math.sin(y * frequency + t + chaos) * intensity * 0.8;
        const wave2 = Math.cos(x * frequency * 0.7 + t * 1.3) * intensity * 0.4;
        const wave3 =
          Math.sin((x + y) * frequency * 0.3 + t * 0.7) * intensity * 0.3;
        const turbulence =
          Math.sin(nx * 20 + t) * Math.cos(ny * 15 + t * 1.2) * intensity * 0.5;

        let offsetX = wave1 + wave3 + turbulence + rowJitter;
        let offsetY = wave2 + Math.sin(x * 0.05 + t) * intensity * 0.2;

        if (Math.random() < intensity / 500) {
          offsetX += (Math.random() - 0.5) * width * 0.3;
          offsetY += (Math.random() - 0.5) * height * 0.1;
        }

        const srcX = clamp(Math.round(x + offsetX), 0, width - 1);
        const srcY = clamp(Math.round(y + offsetY), 0, height - 1);
        const srcIdx = (srcY * width + srcX) * 4;
        const dstIdx = (y * width + x) * 4;

        if (Math.random() < intensity / 300) {
          const rSrcX = clamp(
            srcX + Math.floor((Math.random() - 0.5) * 20),
            0,
            width - 1
          );
          const gSrcX = clamp(
            srcX + Math.floor((Math.random() - 0.5) * 20),
            0,
            width - 1
          );
          const bSrcX = clamp(
            srcX + Math.floor((Math.random() - 0.5) * 20),
            0,
            width - 1
          );
          data[dstIdx] = source[(srcY * width + rSrcX) * 4];
          data[dstIdx + 1] = source[(srcY * width + gSrcX) * 4 + 1];
          data[dstIdx + 2] = source[(srcY * width + bSrcX) * 4 + 2];
        } else {
          data[dstIdx] = source[srcIdx];
          data[dstIdx + 1] = source[srcIdx + 1];
          data[dstIdx + 2] = source[srcIdx + 2];
        }
      }
    }
  },
});

registerEffect({
  type: "data-destroy",
  label: "Data Destroy",
  category: "glitch",
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

const meltState = new Map<string, Uint8ClampedArray>();

registerEffect({
  type: "melt",
  label: "Melt",
  category: "distortion",
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) || 50;
    const direction = (params.direction as string) || "down";
    if (intensity === 0) return;

    const key = `${width}x${height}`;
    let meltBuffer = meltState.get(key);

    if (!meltBuffer || meltBuffer.length !== data.length) {
      meltBuffer = new Uint8ClampedArray(data);
      meltState.set(key, meltBuffer);
    }

    const source = new Uint8ClampedArray(data);
    const meltSpeed = intensity / 20;
    const drip = intensity / 100;

    for (let x = 0; x < width; x++) {
      const columnNoise = Math.sin(x * 0.1 + time) * 0.5 + 0.5;
      const meltAmount = Math.floor(
        meltSpeed * (1 + columnNoise * 2) + Math.random() * 3
      );

      if (direction === "down") {
        for (let y = height - 1; y >= meltAmount; y--) {
          const dstIdx = (y * width + x) * 4;
          const srcY = y - meltAmount;
          const srcIdx = (srcY * width + x) * 4;

          const blend = 0.7 + Math.random() * 0.3;
          data[dstIdx] =
            meltBuffer[srcIdx] * blend + source[dstIdx] * (1 - blend);
          data[dstIdx + 1] =
            meltBuffer[srcIdx + 1] * blend + source[dstIdx + 1] * (1 - blend);
          data[dstIdx + 2] =
            meltBuffer[srcIdx + 2] * blend + source[dstIdx + 2] * (1 - blend);
        }

        for (let y = 0; y < meltAmount && y < height; y++) {
          const idx = (y * width + x) * 4;
          const blend = 0.3 + Math.random() * 0.4;
          data[idx] = source[idx] * blend + meltBuffer[idx] * (1 - blend);
          data[idx + 1] =
            source[idx + 1] * blend + meltBuffer[idx + 1] * (1 - blend);
          data[idx + 2] =
            source[idx + 2] * blend + meltBuffer[idx + 2] * (1 - blend);
        }
      } else {
        for (let y = 0; y < height - meltAmount; y++) {
          const dstIdx = (y * width + x) * 4;
          const srcY = y + meltAmount;
          const srcIdx = (srcY * width + x) * 4;

          const blend = 0.7 + Math.random() * 0.3;
          data[dstIdx] =
            meltBuffer[srcIdx] * blend + source[dstIdx] * (1 - blend);
          data[dstIdx + 1] =
            meltBuffer[srcIdx + 1] * blend + source[dstIdx + 1] * (1 - blend);
          data[dstIdx + 2] =
            meltBuffer[srcIdx + 2] * blend + source[dstIdx + 2] * (1 - blend);
        }
      }
    }

    if (Math.random() < drip) {
      const dripX = Math.floor(Math.random() * width);
      const dripLen = Math.floor(20 + Math.random() * 100);
      const dripColor = [
        data[(Math.floor(Math.random() * height) * width + dripX) * 4],
        data[(Math.floor(Math.random() * height) * width + dripX) * 4 + 1],
        data[(Math.floor(Math.random() * height) * width + dripX) * 4 + 2],
      ];

      const startY = direction === "down" ? 0 : height - 1;
      for (let i = 0; i < dripLen; i++) {
        const y = direction === "down" ? startY + i : startY - i;
        if (y >= 0 && y < height) {
          const idx = (y * width + dripX) * 4;
          const fade = 1 - (i / dripLen) * 0.5;
          data[idx] = dripColor[0] * fade;
          data[idx + 1] = dripColor[1] * fade;
          data[idx + 2] = dripColor[2] * fade;
        }
      }
    }

    for (let i = 0; i < data.length; i++) {
      meltBuffer[i] = data[i];
    }
  },
});

registerEffect({
  type: "chaos",
  label: "Chaos",
  category: "glitch",
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

const perlinNoise = (() => {
  const permutation = new Array(256)
    .fill(0)
    .map(() => Math.floor(Math.random() * 256));
  const p = [...permutation, ...permutation];

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (t: number, a: number, b: number) => a + t * (b - a);
  const grad = (hash: number, x: number, y: number) => {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };

  return (x: number, y: number): number => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];
    return lerp(
      v,
      lerp(u, grad(aa, xf, yf), grad(ba, xf - 1, yf)),
      lerp(u, grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1))
    );
  };
})();

registerEffect({
  type: "perlin-distort",
  label: "Perlin Distort",
  category: "distortion",
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) || 50;
    const scale = (params.scale as number) || 0.01;
    const speed = (params.speed as number) || 1;
    if (intensity === 0) return;

    const source = new Uint8ClampedArray(data);
    const t = time * speed;
    const amp = intensity * 0.5;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = x * scale;
        const ny = y * scale;

        const noiseX = perlinNoise(nx + t, ny);
        const noiseY = perlinNoise(nx, ny + t);

        const offsetX = Math.floor(noiseX * amp);
        const offsetY = Math.floor(noiseY * amp);

        const srcX = clamp(x + offsetX, 0, width - 1);
        const srcY = clamp(y + offsetY, 0, height - 1);

        const srcIdx = (srcY * width + srcX) * 4;
        const dstIdx = (y * width + x) * 4;

        data[dstIdx] = source[srcIdx];
        data[dstIdx + 1] = source[srcIdx + 1];
        data[dstIdx + 2] = source[srcIdx + 2];
      }
    }
  },
});

registerEffect({
  type: "scan-sweep",
  label: "Scan Sweep",
  category: "retro",
  processor: (data, { width, height, time = 0 }, params) => {
    const speed = (params.speed as number) || 2;
    const count = (params.count as number) || 3;
    const thickness = (params.thickness as number) || 2;
    const direction = (params.direction as string) || "vertical";

    const isVertical = direction === "vertical";
    const dimension = isVertical ? width : height;

    for (let i = 0; i < count; i++) {
      const offset = (i / count) * dimension;
      const position = (time * speed * 100 + offset) % dimension;

      for (let t = 0; t < thickness; t++) {
        const scanPos = Math.floor(position + t) % dimension;
        const falloff = 1 - (t / thickness) * 0.5;

        if (isVertical) {
          for (let y = 0; y < height; y++) {
            const idx = (y * width + scanPos) * 4;
            data[idx] = clamp(data[idx] + 100 * falloff, 0, 255);
            data[idx + 1] = clamp(data[idx + 1] + 100 * falloff, 0, 255);
            data[idx + 2] = clamp(data[idx + 2] + 100 * falloff, 0, 255);
          }
        } else {
          for (let x = 0; x < width; x++) {
            const idx = (scanPos * width + x) * 4;
            data[idx] = clamp(data[idx] + 100 * falloff, 0, 255);
            data[idx + 1] = clamp(data[idx + 1] + 100 * falloff, 0, 255);
            data[idx + 2] = clamp(data[idx + 2] + 100 * falloff, 0, 255);
          }
        }
      }
    }

    if (Math.random() < 0.05) {
      const glitchPos = Math.floor(Math.random() * dimension);
      const glitchSize = Math.floor(2 + Math.random() * 5);

      for (let t = 0; t < glitchSize; t++) {
        const pos = (glitchPos + t) % dimension;

        if (isVertical) {
          for (let y = 0; y < height; y++) {
            const idx = (y * width + pos) * 4;
            data[idx] = 255;
            data[idx + 1] = 255;
            data[idx + 2] = 255;
          }
        } else {
          for (let x = 0; x < width; x++) {
            const idx = (pos * width + x) * 4;
            data[idx] = 255;
            data[idx + 1] = 255;
            data[idx + 2] = 255;
          }
        }
      }
    }
  },
});

const posterizeTimeCache = new Map<
  string,
  { lastUpdateTime: number; cachedFrame: Uint8ClampedArray | null }
>();

registerEffect({
  type: "posterize-time",
  label: "Posterize Time",
  category: "retro",
  processor: (data, { width, height, time = 0 }, params) => {
    const fps = (params.fps as number) || 12;
    const cacheKey = `${width}x${height}`;

    if (!posterizeTimeCache.has(cacheKey)) {
      posterizeTimeCache.set(cacheKey, {
        lastUpdateTime: 0,
        cachedFrame: null,
      });
    }

    const cache = posterizeTimeCache.get(cacheKey)!;
    const frameInterval = 60 / fps;
    const timeSinceLastUpdate = time - cache.lastUpdateTime;

    if (timeSinceLastUpdate >= frameInterval || cache.cachedFrame === null) {
      cache.cachedFrame = new Uint8ClampedArray(data);
      cache.lastUpdateTime = time;
    } else if (cache.cachedFrame) {
      data.set(cache.cachedFrame);
    }
  },
});

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function sortSegment(
  data: Uint8ClampedArray,
  rowStart: number,
  startX: number,
  endX: number
): void {
  const pixels = [];
  for (let x = startX; x <= endX; x++) {
    const i = rowStart + x * 4;
    pixels.push({
      r: data[i],
      g: data[i + 1],
      b: data[i + 2],
      bri: data[i] + data[i + 1] + data[i + 2],
    });
  }
  pixels.sort((a, b) => a.bri - b.bri);
  for (let x = startX; x <= endX; x++) {
    const i = rowStart + x * 4;
    const p = pixels[x - startX];
    data[i] = p.r;
    data[i + 1] = p.g;
    data[i + 2] = p.b;
  }
}

function sortSegmentV(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  startY: number,
  endY: number
): void {
  const pixels = [];
  for (let y = startY; y <= endY; y++) {
    const i = (y * width + x) * 4;
    pixels.push({
      r: data[i],
      g: data[i + 1],
      b: data[i + 2],
      bri: data[i] + data[i + 1] + data[i + 2],
    });
  }
  pixels.sort((a, b) => a.bri - b.bri);
  for (let y = startY; y <= endY; y++) {
    const i = (y * width + x) * 4;
    const p = pixels[y - startY];
    data[i] = p.r;
    data[i + 1] = p.g;
    data[i + 2] = p.b;
  }
}

function getBlockAverage(
  data: Uint8ClampedArray,
  width: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  channel: number
): number {
  let sum = 0,
    count = 0;
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      sum += data[(y * width + x) * 4 + channel];
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function isPointInFaceBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  face: FaceBounds
): boolean {
  const padding = 0.1;
  const faceX = (face.x - face.width * padding) * width;
  const faceY = (face.y - face.height * padding) * height;
  const faceW = face.width * (1 + padding * 2) * width;
  const faceH = face.height * (1 + padding * 2) * height;
  return x >= faceX && x < faceX + faceW && y >= faceY && y < faceY + faceH;
}

registerEffect({
  type: "face-pixelate",
  label: "Face Pixelate",
  category: "glitch",
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
  type: "face-color-replace",
  label: "Face Color Replace",
  category: "color",
  processor: (data, { width, height, faceBounds = [] }, params) => {
    const mode = (params.mode as string) || "solid";
    const color = (params.color as string) || "#ff00ff";

    if (faceBounds.length === 0) return;

    const hexToRgb = (hex: string): [number, number, number] => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16),
          ]
        : [255, 0, 255];
    };

    const [r, g, b] = hexToRgb(color);

    for (const face of faceBounds) {
      const faceX = Math.floor(face.x * width);
      const faceY = Math.floor(face.y * height);
      const faceW = Math.floor(face.width * width);
      const faceH = Math.floor(face.height * height);

      const startX = Math.max(0, faceX);
      const startY = Math.max(0, faceY);
      const endX = Math.min(width, faceX + faceW);
      const endY = Math.min(height, faceY + faceH);

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          if (!isPointInFaceBounds(x, y, width, height, face)) continue;

          const i = (y * width + x) * 4;
          const origR = data[i];
          const origG = data[i + 1];
          const origB = data[i + 2];

          if (mode === "solid") {
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
          } else if (mode === "gradient") {
            const relX = (x - faceX) / faceW;
            const relY = (y - faceY) / faceH;
            const brightness = (origR + origG + origB) / 3 / 255;

            const gradR = Math.round(r * brightness);
            const gradG = Math.round(g * brightness);
            const gradB = Math.round(b * brightness);

            data[i] = gradR;
            data[i + 1] = gradG;
            data[i + 2] = gradB;
          } else if (mode === "thermal") {
            const brightness = (origR + origG + origB) / 3 / 255;
            const thermalR = Math.round(255 * brightness);
            const thermalG = Math.round(255 * brightness * 0.5);
            const thermalB = Math.round(255 * (1 - brightness));

            data[i] = thermalR;
            data[i + 1] = thermalG;
            data[i + 2] = thermalB;
          }
        }
      }
    }
  },
});

registerEffect({
  type: "face-eye-censor",
  label: "Eye Censor Bar",
  category: "face",
  processor: (data, { width, height, faceBounds = [] }, params) => {
    const style = (params.style as string) || "solid";
    const color = (params.color as string) || "#000000";
    const thickness = (params.thickness as number) || 1.5;

    if (faceBounds.length === 0) return;

    const hexToRgb = (hex: string): [number, number, number] => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16),
          ]
        : [0, 0, 0];
    };

    const [r, g, b] = hexToRgb(color);
    const source = new Uint8ClampedArray(data);

    for (const face of faceBounds) {
      if (!face.landmarks || face.landmarks.length === 0) continue;

      const { leftEye, rightEye } = getEyeLandmarks(face.landmarks);

      if (leftEye.length === 0 && rightEye.length === 0) continue;

      let combinedBounds = null;

      if (leftEye.length > 0 && rightEye.length > 0) {
        const leftBounds = getLandmarkBounds(leftEye);
        const rightBounds = getLandmarkBounds(rightEye);

        combinedBounds = {
          minX: Math.min(leftBounds.minX, rightBounds.minX),
          maxX: Math.max(leftBounds.maxX, rightBounds.maxX),
          minY: Math.min(leftBounds.minY, rightBounds.minY),
          maxY: Math.max(leftBounds.maxY, rightBounds.maxY),
        };
      } else if (leftEye.length > 0) {
        combinedBounds = getLandmarkBounds(leftEye);
      } else if (rightEye.length > 0) {
        combinedBounds = getLandmarkBounds(rightEye);
      }

      if (!combinedBounds) continue;

      const eyeWidth = (combinedBounds.maxX - combinedBounds.minX) * width;
      const eyeHeight = (combinedBounds.maxY - combinedBounds.minY) * height;

      const barHeight = Math.max(eyeHeight * thickness, 8);
      const padding = eyeWidth * 0.1;

      const startX = Math.max(
        0,
        Math.floor(combinedBounds.minX * width - padding)
      );
      const endX = Math.min(
        width,
        Math.ceil(combinedBounds.maxX * width + padding)
      );
      const centerY = Math.floor(
        ((combinedBounds.minY + combinedBounds.maxY) / 2) * height
      );
      const startY = Math.max(0, Math.floor(centerY - barHeight / 2));
      const endY = Math.min(height, Math.ceil(centerY + barHeight / 2));

      if (style === "solid") {
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const i = (y * width + x) * 4;
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
          }
        }
      } else if (style === "pixelated") {
        const blockSize = Math.max(4, Math.floor(barHeight / 3));
        for (let by = startY; by < endY; by += blockSize) {
          for (let bx = startX; bx < endX; bx += blockSize) {
            const blockEndX = Math.min(bx + blockSize, endX);
            const blockEndY = Math.min(by + blockSize, endY);

            let rSum = 0,
              gSum = 0,
              bSum = 0,
              count = 0;
            for (let y = by; y < blockEndY; y++) {
              for (let x = bx; x < blockEndX; x++) {
                const i = (y * width + x) * 4;
                rSum += source[i];
                gSum += source[i + 1];
                bSum += source[i + 2];
                count++;
              }
            }

            if (count > 0) {
              const avgR = Math.round(rSum / count);
              const avgG = Math.round(gSum / count);
              const avgB = Math.round(bSum / count);

              for (let y = by; y < blockEndY; y++) {
                for (let x = bx; x < blockEndX; x++) {
                  const i = (y * width + x) * 4;
                  data[i] = avgR;
                  data[i + 1] = avgG;
                  data[i + 2] = avgB;
                }
              }
            }
          }
        }
      } else if (style === "blurred") {
        const radius = Math.max(3, Math.floor(barHeight / 4));
        const kernel: number[] = [];
        let kernelSum = 0;

        for (let i = -radius; i <= radius; i++) {
          const value = Math.exp(-(i * i) / (2 * radius * radius));
          kernel.push(value);
          kernelSum += value;
        }

        for (let i = 0; i < kernel.length; i++) {
          kernel[i] /= kernelSum;
        }

        const temp = new Uint8ClampedArray(data.length);

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            let rSum = 0,
              gSum = 0,
              bSum = 0,
              weightSum = 0;

            for (let ky = -radius; ky <= radius; ky++) {
              const sy = y + ky;
              if (sy < startY || sy >= endY) continue;

              const weight = kernel[ky + radius];
              const i = (sy * width + x) * 4;
              rSum += source[i] * weight;
              gSum += source[i + 1] * weight;
              bSum += source[i + 2] * weight;
              weightSum += weight;
            }

            if (weightSum > 0) {
              const i = (y * width + x) * 4;
              temp[i] = Math.round(rSum / weightSum);
              temp[i + 1] = Math.round(gSum / weightSum);
              temp[i + 2] = Math.round(bSum / weightSum);
            }
          }
        }

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            let rSum = 0,
              gSum = 0,
              bSum = 0,
              weightSum = 0;

            for (let kx = -radius; kx <= radius; kx++) {
              const sx = x + kx;
              if (sx < startX || sx >= endX) continue;

              const weight = kernel[kx + radius];
              const i = (y * width + sx) * 4;
              rSum += temp[i] * weight;
              gSum += temp[i + 1] * weight;
              bSum += temp[i + 2] * weight;
              weightSum += weight;
            }

            if (weightSum > 0) {
              const i = (y * width + x) * 4;
              data[i] = Math.round(rSum / weightSum);
              data[i + 1] = Math.round(gSum / weightSum);
              data[i + 2] = Math.round(bSum / weightSum);
            }
          }
        }
      }
    }
  },
});

registerEffect({
  type: "face-mouth-censor",
  label: "Mouth Censor Bar",
  category: "face",
  processor: (data, { width, height, faceBounds = [] }, params) => {
    const style = (params.style as string) || "solid";
    const color = (params.color as string) || "#000000";
    const thickness = (params.thickness as number) || 1.2;

    if (faceBounds.length === 0) return;

    const hexToRgb = (hex: string): [number, number, number] => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16),
          ]
        : [0, 0, 0];
    };

    const [r, g, b] = hexToRgb(color);
    const source = new Uint8ClampedArray(data);

    for (const face of faceBounds) {
      if (!face.landmarks || face.landmarks.length === 0) continue;

      const mouthLandmarks = getMouthLandmarks(face.landmarks);
      if (mouthLandmarks.length === 0) continue;

      const bounds = getLandmarkBounds(mouthLandmarks);
      const mouthWidth = (bounds.maxX - bounds.minX) * width;
      const mouthHeight = (bounds.maxY - bounds.minY) * height;

      const barHeight = Math.max(mouthHeight * thickness, 10);
      const padding = mouthWidth * 0.05;

      const startX = Math.max(0, Math.floor(bounds.minX * width - padding));
      const endX = Math.min(width, Math.ceil(bounds.maxX * width + padding));
      const centerY = Math.floor(((bounds.minY + bounds.maxY) / 2) * height);
      const startY = Math.max(0, Math.floor(centerY - barHeight / 2));
      const endY = Math.min(height, Math.ceil(centerY + barHeight / 2));

      if (style === "solid") {
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const i = (y * width + x) * 4;
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
          }
        }
      } else if (style === "pixelated") {
        const blockSize = Math.max(4, Math.floor(barHeight / 3));
        for (let by = startY; by < endY; by += blockSize) {
          for (let bx = startX; bx < endX; bx += blockSize) {
            const blockEndX = Math.min(bx + blockSize, endX);
            const blockEndY = Math.min(by + blockSize, endY);

            let rSum = 0,
              gSum = 0,
              bSum = 0,
              count = 0;
            for (let y = by; y < blockEndY; y++) {
              for (let x = bx; x < blockEndX; x++) {
                const i = (y * width + x) * 4;
                rSum += source[i];
                gSum += source[i + 1];
                bSum += source[i + 2];
                count++;
              }
            }

            if (count > 0) {
              const avgR = Math.round(rSum / count);
              const avgG = Math.round(gSum / count);
              const avgB = Math.round(bSum / count);

              for (let y = by; y < blockEndY; y++) {
                for (let x = bx; x < blockEndX; x++) {
                  const i = (y * width + x) * 4;
                  data[i] = avgR;
                  data[i + 1] = avgG;
                  data[i + 2] = avgB;
                }
              }
            }
          }
        }
      } else if (style === "blurred") {
        const radius = Math.max(3, Math.floor(barHeight / 4));
        const kernel: number[] = [];
        let kernelSum = 0;

        for (let i = -radius; i <= radius; i++) {
          const value = Math.exp(-(i * i) / (2 * radius * radius));
          kernel.push(value);
          kernelSum += value;
        }

        for (let i = 0; i < kernel.length; i++) {
          kernel[i] /= kernelSum;
        }

        const temp = new Uint8ClampedArray(data.length);

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            let rSum = 0,
              gSum = 0,
              bSum = 0,
              weightSum = 0;

            for (let ky = -radius; ky <= radius; ky++) {
              const sy = y + ky;
              if (sy < startY || sy >= endY) continue;

              const weight = kernel[ky + radius];
              const i = (sy * width + x) * 4;
              rSum += source[i] * weight;
              gSum += source[i + 1] * weight;
              bSum += source[i + 2] * weight;
              weightSum += weight;
            }

            if (weightSum > 0) {
              const i = (y * width + x) * 4;
              temp[i] = Math.round(rSum / weightSum);
              temp[i + 1] = Math.round(gSum / weightSum);
              temp[i + 2] = Math.round(bSum / weightSum);
            }
          }
        }

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            let rSum = 0,
              gSum = 0,
              bSum = 0,
              weightSum = 0;

            for (let kx = -radius; kx <= radius; kx++) {
              const sx = x + kx;
              if (sx < startX || sx >= endX) continue;

              const weight = kernel[kx + radius];
              const i = (y * width + sx) * 4;
              rSum += temp[i] * weight;
              gSum += temp[i + 1] * weight;
              bSum += temp[i + 2] * weight;
              weightSum += weight;
            }

            if (weightSum > 0) {
              const i = (y * width + x) * 4;
              data[i] = Math.round(rSum / weightSum);
              data[i + 1] = Math.round(gSum / weightSum);
              data[i + 2] = Math.round(bSum / weightSum);
            }
          }
        }
      }
    }
  },
});

registerEffect({
  type: "face-landmark-glitch",
  label: "Landmark Glitch",
  category: "face",
  processor: (data, { width, height, faceBounds = [], time = 0 }, params) => {
    const intensity = (params.intensity as number) || 50;
    const lineCount = (params.lineCount as number) || 15;
    const color = (params.color as string) || "#00ff88";

    if (faceBounds.length === 0) return;

    const hexToRgb = (hex: string): [number, number, number] => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16),
          ]
        : [0, 255, 136];
    };

    const [r, g, b] = hexToRgb(color);
    const seed = Math.floor(time / 3);

    const pseudoRandom = (s: number): number => {
      const x = Math.sin(s * 12.9898 + 78.233) * 43758.5453;
      return x - Math.floor(x);
    };

    const drawLine = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      thickness: number
    ) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const steps = Math.max(Math.abs(dx), Math.abs(dy));

      if (steps === 0) return;

      const xStep = dx / steps;
      const yStep = dy / steps;

      for (let i = 0; i <= steps; i++) {
        const x = Math.round(x1 + xStep * i);
        const y = Math.round(y1 + yStep * i);

        for (let ty = -thickness; ty <= thickness; ty++) {
          for (let tx = -thickness; tx <= thickness; tx++) {
            const px = x + tx;
            const py = y + ty;
            if (px >= 0 && px < width && py >= 0 && py < height) {
              const idx = (py * width + px) * 4;
              const dist = Math.sqrt(tx * tx + ty * ty);
              const alpha = Math.max(0, 1 - dist / thickness);
              data[idx] = Math.round(data[idx] * (1 - alpha) + r * alpha);
              data[idx + 1] = Math.round(
                data[idx + 1] * (1 - alpha) + g * alpha
              );
              data[idx + 2] = Math.round(
                data[idx + 2] * (1 - alpha) + b * alpha
              );
            }
          }
        }
      }
    };

    for (const face of faceBounds) {
      if (!face.landmarks || face.landmarks.length < 10) continue;

      const numLines = Math.floor(lineCount * (intensity / 100));

      for (let i = 0; i < numLines; i++) {
        const idx1 = Math.floor(
          pseudoRandom(seed + i * 100) * face.landmarks.length
        );
        const idx2 = Math.floor(
          pseudoRandom(seed + i * 200) * face.landmarks.length
        );

        if (idx1 === idx2) continue;

        const p1 = face.landmarks[idx1];
        const p2 = face.landmarks[idx2];

        const x1 = Math.round(p1.x * width);
        const y1 = Math.round(p1.y * height);
        const x2 = Math.round(p2.x * width);
        const y2 = Math.round(p2.y * height);

        const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const maxDist = Math.sqrt(width * width + height * height);
        const distFactor = 1 - dist / maxDist;

        if (pseudoRandom(seed + i * 300) < (intensity / 100) * distFactor) {
          const thickness = Math.max(
            1,
            Math.floor(pseudoRandom(seed + i * 400) * 2)
          );
          drawLine(x1, y1, x2, y2, thickness);
        }
      }
    }
  },
});

registerEffect({
  type: "detection-labels",
  label: "Detection Labels",
  category: "style",
  processor: (
    data,
    { width, height, faceBounds = [], handBounds = [], poseBounds = [] },
    params
  ) => {
    const showFaces = (params.showFaces as boolean) ?? true;
    const showHands = (params.showHands as boolean) ?? true;
    const showPose = (params.showPose as boolean) ?? true;
    const boxThickness = (params.boxThickness as number) || 2;
    const labelSize = (params.labelSize as number) || 14;

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) return;

    const imgData = ctx.createImageData(width, height);
    imgData.data.set(data);
    ctx.putImageData(imgData, 0, 0);

    ctx.lineWidth = boxThickness;
    ctx.font = `bold ${labelSize}px -apple-system, BlinkMacSystemFont, sans-serif`;

    const drawBoxWithLabel = (
      x: number,
      y: number,
      w: number,
      h: number,
      label: string,
      color: string
    ) => {
      ctx.strokeStyle = color;
      ctx.strokeRect(x, y, w, h);

      const padding = 6;
      const metrics = ctx.measureText(label);
      const labelWidth = metrics.width + padding * 2;
      const labelHeight = labelSize + padding * 2;

      const labelX = Math.max(2, Math.min(x, width - labelWidth - 2));
      const labelY = Math.max(labelHeight + 2, y - 8);

      ctx.fillStyle = color;
      ctx.fillRect(labelX, labelY - labelHeight, labelWidth, labelHeight);

      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "top";
      ctx.fillText(label, labelX + padding, labelY - labelHeight + padding);

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(labelX + labelWidth / 2, labelY);
      ctx.lineTo(x, y);
      ctx.stroke();
    };

    if (showFaces && faceBounds.length > 0) {
      for (let i = 0; i < faceBounds.length; i++) {
        const face = faceBounds[i];
        const x = Math.floor(face.x * width);
        const y = Math.floor(face.y * height);
        const w = Math.floor(face.width * width);
        const h = Math.floor(face.height * height);

        drawBoxWithLabel(x, y, w, h, `Face ${i + 1}`, "#FF6B6B");
      }
    }

    if (showHands && handBounds.length > 0) {
      for (const hand of handBounds) {
        const isLeft = hand.label.includes("Left");
        const color = isLeft ? "#4ECDC4" : "#45B7D1";

        const x = Math.floor(hand.x * width);
        const y = Math.floor(hand.y * height);
        const w = Math.floor(hand.width * width);
        const h = Math.floor(hand.height * height);

        drawBoxWithLabel(x, y, w, h, hand.label, color);
      }
    }

    if (showPose && poseBounds.length > 0) {
      for (const pose of poseBounds) {
        const x = Math.floor(pose.x * width);
        const y = Math.floor(pose.y * height);
        const w = Math.floor(pose.width * width);
        const h = Math.floor(pose.height * height);

        drawBoxWithLabel(x, y, w, h, pose.label, "#96CEB4");
      }
    }

    const resultData = ctx.getImageData(0, 0, width, height);
    data.set(resultData.data);
  },
});

registerEffect({
  type: "jpeg-artifacts",
  label: "JPEG Artifacts",
  category: "glitch",
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
