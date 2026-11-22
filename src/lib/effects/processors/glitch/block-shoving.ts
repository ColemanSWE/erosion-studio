import { registerEffect } from "../../effect-registry";
import { blockShovingState, bilinearSample } from "../shared";

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
    {
      key: "intensity",
      label: "Intensity",
      type: "slider",
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: "blockSize",
      label: "Block Size",
      type: "slider",
      min: 4,
      max: 64,
      step: 4,
    },
    {
      key: "style",
      label: "Style",
      type: "select",
      options: ["block", "fluid"],
    },
    {
      key: "resetInterval",
      label: "Reset Interval (s, 0=off)",
      type: "slider",
      min: 0,
      max: 30,
      step: 0.5,
    },
  ],
  glsl: {
    needsPrevFrame: true,
    uniforms: { intensity: "float", blockSize: "float", styleMode: "int" },
    uniformMapper: (params) => ({
      intensity: params.intensity,
      blockSize: params.blockSize,
      styleMode: (params.style as string) === "fluid" ? 1 : 0,
    }),
    fragment: `
uniform float u_intensity;
uniform float u_blockSize;
uniform int   u_styleMode;
uniform sampler2D u_prevFrame;

void main() {
  if (u_intensity == 0.0) {
    fragColor = texture(u_source, v_texCoord);
    return;
  }

  float strength = u_intensity / 50.0;
  vec2 texel = 1.0 / u_resolution;
  vec3 luma = vec3(0.299, 0.587, 0.114);

  // Snap current UV to block grid center for block-mode
  vec2 blockUV = v_texCoord;
  if (u_styleMode == 0) {
    blockUV = (floor(v_texCoord * u_resolution / u_blockSize) + 0.5) * u_blockSize / u_resolution;
  }

  // Per-pixel optical flow using temporal + spatial gradients (Horn-Schunck estimate)
  vec3 cur  = texture(u_source,   blockUV).rgb;
  vec3 prev = texture(u_prevFrame, blockUV).rgb;

  float It = dot(cur - prev, luma);
  float gx = dot(
    texture(u_source, blockUV + vec2(texel.x * 2.0, 0.0)).rgb -
    texture(u_source, blockUV - vec2(texel.x * 2.0, 0.0)).rgb,
    luma);
  float gy = dot(
    texture(u_source, blockUV + vec2(0.0, texel.y * 2.0)).rgb -
    texture(u_source, blockUV - vec2(0.0, texel.y * 2.0)).rgb,
    luma);

  float denom = gx * gx + gy * gy + 0.002;
  vec2 flow = clamp(
    (-It / denom) * vec2(gx, gy) * (4.0 * texel.x) * strength * 2.0,
    vec2(-0.08) * strength,
    vec2( 0.08) * strength
  );

  vec2 smearedUV = clamp(v_texCoord + flow, vec2(0.0), vec2(1.0));
  vec3 smear = texture(u_prevFrame, smearedUV).rgb;

  float motionMag = clamp(abs(It) * 5.0 * strength, 0.0, 1.0);
  float blend = motionMag * 0.92;
  fragColor = vec4(mix(cur, smear, blend), 1.0);
}`,
  },
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

    if (
      resetInterval > 0 &&
      Date.now() - blockShovingState.lastResetMs >= resetInterval * 1000
    ) {
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
