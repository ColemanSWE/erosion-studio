import { registerEffect } from "../../effect-registry";
import { motionSmearState } from "../shared";

registerEffect({
  type: "motion-smear",
  label: "Motion Smear",
  category: "glitch",
  defaultParams: {
    mode: "melt",
    intensity: 70,
    momentum: 0.92,
    mediaSources: [],
  },
  paramsConfig: [
    { key: "mode", label: "Mode", type: "select", options: ["melt", "bloom"], default: "melt" },
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 100, default: 70 },
    { key: "momentum", label: "Momentum", type: "slider", min: 0, max: 0.99, step: 0.01, default: 0.92 },
  ],
  glsl: {
    // "bloom" mode needs a secondary source texture — fall back to CPU for that mode.
    skipGL: (params) => params.mode === "bloom",
    needsPrevFrame: true,
    uniforms: { intensity: "float", momentum: "float" },
    fragment: `
uniform float u_intensity;
uniform float u_momentum;
uniform sampler2D u_prevFrame;

void main() {
  float strength = u_intensity / 100.0;
  if (strength == 0.0) {
    fragColor = texture(u_source, v_texCoord);
    return;
  }

  vec2 texel = 1.0 / u_resolution;
  vec3 luma = vec3(0.299, 0.587, 0.114);

  vec3 cur  = texture(u_source,    v_texCoord).rgb;
  vec3 prev = texture(u_prevFrame, v_texCoord).rgb;

  // Temporal gradient (signed luminance delta)
  float It = dot(cur - prev, luma);

  // Spatial gradient of the current frame (2-texel central difference)
  float gx = dot(
    texture(u_source, v_texCoord + vec2(texel.x * 2.0, 0.0)).rgb -
    texture(u_source, v_texCoord - vec2(texel.x * 2.0, 0.0)).rgb,
    luma
  );
  float gy = dot(
    texture(u_source, v_texCoord + vec2(0.0, texel.y * 2.0)).rgb -
    texture(u_source, v_texCoord - vec2(0.0, texel.y * 2.0)).rgb,
    luma
  );

  // Per-pixel optical flow (Horn-Schunck single-pixel estimate):
  //   flow = -It / (gx^2 + gy^2 + eps) * (gx, gy)
  // Scaled to UV space and clamped to a sane displacement range.
  float denom = gx * gx + gy * gy + 0.002;
  vec2 flow = clamp(
    (-It / denom) * vec2(gx, gy) * (4.0 * texel.x) * strength * 2.0,
    vec2(-0.04) * strength,
    vec2( 0.04) * strength
  );

  // Sample the previous accumulated smear frame at the displaced position
  vec2 smearedUV = clamp(v_texCoord + flow, vec2(0.0), vec2(1.0));
  vec3 smear = texture(u_prevFrame, smearedUV).rgb;

  // Motion magnitude drives blend strength; momentum caps temporal persistence
  float motionMag = clamp(abs(It) * 5.0 * strength, 0.0, 1.0);
  float blend = motionMag * u_momentum;

  fragColor = vec4(mix(cur, smear, blend), 1.0);
}`,
  },
  processor: (data, { width, height, timelineFrames }, params) => {
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
              Math.floor((x / width) * sourceImg.width + dx),
            ),
          );
          const srcY = Math.max(
            0,
            Math.min(
              sourceImg.height - 1,
              Math.floor((y / height) * sourceImg.height + dy),
            ),
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
