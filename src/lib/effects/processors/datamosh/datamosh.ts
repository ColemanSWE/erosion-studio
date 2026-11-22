import { registerEffect } from "../../effect-registry";
import { bilinearSample } from "../shared";

// ─── Motion estimation ────────────────────────────────────────────────────────

function blockScore(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  dx: number,
  dy: number,
  step: number
): number {
  let score = 0;
  let samples = 0;
  for (let py = startY; py < endY; py += step) {
    for (let px = startX; px < endX; px += step) {
      const sx = px + dx;
      const sy = py + dy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
      const ci = (py * width + px) * 4;
      const si = (sy * width + sx) * 4;
      score +=
        Math.abs(a[ci] - b[si]) +
        Math.abs(a[ci + 1] - b[si + 1]) +
        Math.abs(a[ci + 2] - b[si + 2]);
      samples++;
    }
  }
  return samples > 0 ? score / samples : Infinity;
}

// Diamond search: large diamond → small diamond refinement.
function diamondSearch(
  current: Uint8ClampedArray,
  reference: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  searchRange: number,
  step: number,
  predictDx: number,
  predictDy: number
): { dx: number; dy: number } {
  const LARGE_DIAMOND = [
    { dx: 0, dy: 0 },
    { dx: 2, dy: 0 },
    { dx: -2, dy: 0 },
    { dx: 0, dy: 2 },
    { dx: 0, dy: -2 },
    { dx: 1, dy: 1 },
    { dx: -1, dy: 1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: -1 },
  ];
  const SMALL_DIAMOND = [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  let cx = Math.round(predictDx);
  let cy = Math.round(predictDy);

  for (let radius = searchRange; radius >= step * 2; radius = Math.floor(radius / 2)) {
    let bestScore = Infinity;
    let bestDx = cx;
    let bestDy = cy;
    for (const pt of LARGE_DIAMOND) {
      const tdx = cx + pt.dx * radius;
      const tdy = cy + pt.dy * radius;
      if (Math.abs(tdx) > searchRange || Math.abs(tdy) > searchRange) continue;
      const s = blockScore(current, reference, width, height, startX, startY, endX, endY, tdx, tdy, step);
      if (s < bestScore) { bestScore = s; bestDx = tdx; bestDy = tdy; }
    }
    cx = bestDx;
    cy = bestDy;
  }

  {
    let bestScore = blockScore(current, reference, width, height, startX, startY, endX, endY, cx, cy, 1);
    let bestDx = cx;
    let bestDy = cy;
    for (const pt of SMALL_DIAMOND) {
      if (pt.dx === 0 && pt.dy === 0) continue;
      const tdx = cx + pt.dx;
      const tdy = cy + pt.dy;
      if (Math.abs(tdx) > searchRange || Math.abs(tdy) > searchRange) continue;
      const s = blockScore(current, reference, width, height, startX, startY, endX, endY, tdx, tdy, 1);
      if (s < bestScore) { bestScore = s; bestDx = tdx; bestDy = tdy; }
    }
    return { dx: bestDx, dy: bestDy };
  }
}

// ─── Engine ───────────────────────────────────────────────────────────────────

class DatamoshEngine {
  iFrame: Uint8ClampedArray | null = null;
  moshBuffer: Uint8ClampedArray | null = null;
  prevFrame: Uint8ClampedArray | null = null;
  prevSecondary: Uint8ClampedArray | null = null;
  mvX: Float32Array | null = null;
  mvY: Float32Array | null = null;
  width = 0;
  height = 0;
  hadSecondary = false;

  reset(data: Uint8ClampedArray, width: number, height: number, totalBlocks: number): void {
    this.iFrame = new Uint8ClampedArray(data);
    this.moshBuffer = new Uint8ClampedArray(data);
    this.prevFrame = new Uint8ClampedArray(data);
    this.prevSecondary = null;
    this.mvX = new Float32Array(totalBlocks);
    this.mvY = new Float32Array(totalBlocks);
    this.width = width;
    this.height = height;
    this.hadSecondary = false;
  }

  needsInit(width: number, height: number): boolean {
    return this.width !== width || this.height !== height || !this.moshBuffer;
  }

  estimateMVs(
    current: Uint8ClampedArray,
    reference: Uint8ClampedArray,
    blockSize: number,
    searchRange: number,
    searchStep: number,
    momentum: number
  ): void {
    const { width, height, mvX, mvY } = this;
    if (!mvX || !mvY) return;
    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);
    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        const bi = by * blocksX + bx;
        const startX = bx * blockSize;
        const startY = by * blockSize;
        const endX = Math.min(startX + blockSize, width);
        const endY = Math.min(startY + blockSize, height);
        const { dx, dy } = diamondSearch(
          current, reference,
          width, height,
          startX, startY, endX, endY,
          searchRange, searchStep,
          mvX[bi], mvY[bi]
        );
        mvX[bi] = mvX[bi] * momentum + dx * (1 - momentum);
        mvY[bi] = mvY[bi] * momentum + dy * (1 - momentum);
      }
    }
  }

  // Bilinearly interpolate motion vector at pixel (x, y) across block centers.
  // Block center for block (bx, by) is at pixel (bx*bs + bs/2, by*bs + bs/2).
  // This eliminates the hard 16x16 grid boundaries that create the mosaic look.
  sampleMV(x: number, y: number, blockSize: number): { vx: number; vy: number } {
    const { width, height, mvX, mvY } = this;
    if (!mvX || !mvY) return { vx: 0, vy: 0 };

    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);
    const half = blockSize * 0.5;

    // Position in block-center space
    const fx = (x - half) / blockSize;
    const fy = (y - half) / blockSize;

    const bx0 = Math.floor(fx);
    const by0 = Math.floor(fy);
    const bx1 = bx0 + 1;
    const by1 = by0 + 1;

    const wx = fx - bx0;
    const wy = fy - by0;

    const clampBx = (v: number) => Math.max(0, Math.min(blocksX - 1, v));
    const clampBy = (v: number) => Math.max(0, Math.min(blocksY - 1, v));

    const i00 = clampBy(by0) * blocksX + clampBx(bx0);
    const i10 = clampBy(by0) * blocksX + clampBx(bx1);
    const i01 = clampBy(by1) * blocksX + clampBx(bx0);
    const i11 = clampBy(by1) * blocksX + clampBx(bx1);

    const vx = (1 - wy) * ((1 - wx) * mvX[i00] + wx * mvX[i10])
             + wy       * ((1 - wx) * mvX[i01] + wx * mvX[i11]);
    const vy = (1 - wy) * ((1 - wx) * mvY[i00] + wx * mvY[i10])
             + wy       * ((1 - wx) * mvY[i01] + wx * mvY[i11]);

    return { vx, vy };
  }

  // Direct warp: sample moshBuffer displaced by interpolated MVs, write result
  // back. Used by transition mode -- the secondary clip's motion animates the
  // primary clip's pixels without any pixel blending from the secondary source.
  warpDirect(
    blockSize: number,
    mvScale: number,
    channelShift: number,
    decayFactor: number
  ): void {
    const { width, height, moshBuffer, iFrame } = this;
    if (!moshBuffer || !iFrame) return;
    const temp = new Uint8ClampedArray(moshBuffer);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const di = (y * width + x) * 4;
        const { vx, vy } = this.sampleMV(x, y, blockSize);
        const dx = vx * mvScale;
        const dy = vy * mvScale;

        const shift = channelShift;
        const r = bilinearSample(temp, width, height, x + dx + shift, y + dy, 0);
        const g = bilinearSample(temp, width, height, x + dx,         y + dy, 1);
        const b = bilinearSample(temp, width, height, x + dx - shift, y + dy, 2);

        if (decayFactor > 0) {
          const t = 1 - decayFactor;
          moshBuffer[di]     = Math.round(r * t + iFrame[di]     * decayFactor);
          moshBuffer[di + 1] = Math.round(g * t + iFrame[di + 1] * decayFactor);
          moshBuffer[di + 2] = Math.round(b * t + iFrame[di + 2] * decayFactor);
        } else {
          moshBuffer[di]     = Math.round(r);
          moshBuffer[di + 1] = Math.round(g);
          moshBuffer[di + 2] = Math.round(b);
        }
        moshBuffer[di + 3] = 255;
      }
    }
  }

  // Warp with optional bleed from an external source buffer (smear/bloom modes).
  warpMoshBuffer(
    blockSize: number,
    mvScale: number,
    channelShift: number,
    decayFactor: number,
    bleedData: Uint8ClampedArray | null,
    bleedFactor: number
  ): void {
    const { width, height, moshBuffer, iFrame } = this;
    if (!moshBuffer || !iFrame) return;
    const temp = new Uint8ClampedArray(moshBuffer);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const di = (y * width + x) * 4;
        const { vx, vy } = this.sampleMV(x, y, blockSize);
        const dx = vx * mvScale;
        const dy = vy * mvScale;

        const shift = channelShift;
        const r = bilinearSample(temp, width, height, x + dx + shift, y + dy, 0);
        const g = bilinearSample(temp, width, height, x + dx,         y + dy, 1);
        const b = bilinearSample(temp, width, height, x + dx - shift, y + dy, 2);

        const keep = 1 - decayFactor - bleedFactor;

        moshBuffer[di]     = Math.round(r * keep + iFrame[di]     * decayFactor + (bleedData ? bleedData[di]     : 0) * bleedFactor);
        moshBuffer[di + 1] = Math.round(g * keep + iFrame[di + 1] * decayFactor + (bleedData ? bleedData[di + 1] : 0) * bleedFactor);
        moshBuffer[di + 2] = Math.round(b * keep + iFrame[di + 2] * decayFactor + (bleedData ? bleedData[di + 2] : 0) * bleedFactor);
        moshBuffer[di + 3] = 255;
      }
    }
  }

  glitchMVs(blockSize: number, intensity: number): void {
    const { width, height, mvX, mvY } = this;
    if (!mvX || !mvY) return;
    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);
    const totalBlocks = blocksX * blocksY;
    const jitterAmt = intensity * 0.3;

    for (let bi = 0; bi < totalBlocks; bi++) {
      const r = Math.random();
      if (r < 0.15) {
        mvX[bi] = -mvX[bi];
        mvY[bi] = -mvY[bi];
      } else if (r < 0.25) {
        const swap = Math.floor(Math.random() * totalBlocks);
        const tx = mvX[bi]; mvX[bi] = mvX[swap]; mvX[swap] = tx;
        const ty = mvY[bi]; mvY[bi] = mvY[swap]; mvY[swap] = ty;
      } else {
        mvX[bi] += (Math.random() - 0.5) * jitterAmt;
        mvY[bi] += (Math.random() - 0.5) * jitterAmt;
      }
    }
  }
}

const engine = new DatamoshEngine();

// ─── Effect registration ──────────────────────────────────────────────────────

registerEffect({
  type: "datamosh",
  label: "Datamosh",
  category: "glitch",
  defaultParams: {
    mode: "smear",
    intensity: 60,
    blockSize: 16,
    searchRange: 16,
    momentum: 70,
    decay: 10,
    bleed: 20,
    channelShift: 0,
    freeze: false,
    quality: "balanced",
  },
  paramsConfig: [
    { key: "mode", label: "Mode", type: "select", options: ["smear", "transition", "bloom", "glitch"] },
    { key: "intensity", label: "Intensity", type: "slider", min: 0, max: 100, step: 1 },
    { key: "blockSize", label: "Block Size", type: "slider", min: 4, max: 64, step: 4 },
    { key: "searchRange", label: "Search Range", type: "slider", min: 4, max: 48, step: 2 },
    { key: "momentum", label: "Momentum", type: "slider", min: 0, max: 100, step: 1 },
    { key: "decay", label: "I-frame Decay", type: "slider", min: 0, max: 100, step: 1 },
    { key: "bleed", label: "Source Bleed", type: "slider", min: 0, max: 100, step: 1 },
    { key: "channelShift", label: "Channel Shift", type: "slider", min: 0, max: 50, step: 1 },
    { key: "freeze", label: "Freeze I-frame", type: "checkbox" },
    { key: "quality", label: "Quality", type: "select", options: ["fast", "balanced", "high"] },
  ],
  glsl: {
    // "transition" and "bloom" modes depend on timelineFrames (secondary video source) — fall back to CPU
    skipGL: (params) => params.mode === "transition" || params.mode === "bloom",
    needsPrevFrame: true,
    uniforms: { intensity: "float", momentum: "float", decay: "float", bleed: "float", channelShift: "float" },
    uniformMapper: (params) => ({
      intensity: params.intensity,
      momentum: (params.momentum as number) / 100,
      decay: (params.decay as number) / 100 * 0.05,
      bleed: (params.bleed as number) / 100,
      channelShift: (params.channelShift as number),
    }),
    fragment: `
uniform float u_intensity;
uniform float u_momentum;
uniform float u_decay;
uniform float u_bleed;
uniform float u_channelShift;
uniform sampler2D u_prevFrame;

void main() {
  if (u_intensity == 0.0) {
    fragColor = texture(u_source, v_texCoord);
    return;
  }

  float mvScale = u_intensity / 50.0;
  vec2 texel = 1.0 / u_resolution;
  vec3 luma = vec3(0.299, 0.587, 0.114);

  vec3 cur  = texture(u_source,   v_texCoord).rgb;
  vec3 prev = texture(u_prevFrame, v_texCoord).rgb;

  float It = dot(cur - prev, luma);
  float gx = dot(
    texture(u_source, v_texCoord + vec2(texel.x * 2.0, 0.0)).rgb -
    texture(u_source, v_texCoord - vec2(texel.x * 2.0, 0.0)).rgb,
    luma);
  float gy = dot(
    texture(u_source, v_texCoord + vec2(0.0, texel.y * 2.0)).rgb -
    texture(u_source, v_texCoord - vec2(0.0, texel.y * 2.0)).rgb,
    luma);

  float denom = gx * gx + gy * gy + 0.002;
  vec2 flow = clamp(
    (-It / denom) * vec2(gx, gy) * (4.0 * texel.x) * mvScale * 2.0,
    vec2(-0.06) * mvScale,
    vec2( 0.06) * mvScale
  );

  vec2 moshUV = clamp(v_texCoord + flow, vec2(0.0), vec2(1.0));
  vec3 mosh = texture(u_prevFrame, moshUV).rgb;

  // Channel shift (RGB aberration)
  if (u_channelShift > 0.0) {
    float cs = u_channelShift / u_resolution.x;
    mosh.r = texture(u_prevFrame, clamp(moshUV + vec2(cs, 0.0), vec2(0.0), vec2(1.0))).r;
    mosh.b = texture(u_prevFrame, clamp(moshUV - vec2(cs, 0.0), vec2(0.0), vec2(1.0))).b;
  }

  float motionMag = clamp(abs(It) * 5.0 * mvScale, 0.0, 1.0);
  float moshBlend = motionMag * u_momentum;

  // I-frame decay: gradually blend mosh buffer toward current frame
  vec3 decayed = mix(mosh, cur, u_decay);

  // Source bleed
  vec3 result = mix(decayed, cur, u_bleed * 0.02);

  fragColor = vec4(mix(cur, result, moshBlend), 1.0);
}`,
  },
  processor: (data, { width, height, timelineFrames }, params) => {
    const mode         = (params.mode as string) ?? "smear";
    const intensity    = (params.intensity as number) ?? 60;
    const blockSize    = (params.blockSize as number) ?? 16;
    const searchRange  = (params.searchRange as number) ?? 16;
    const momentum     = (params.momentum as number) / 100;
    const decay        = (params.decay as number) / 100;
    const bleed        = (params.bleed as number) / 100;
    const channelShift = (params.channelShift as number) ?? 0;
    const freeze       = !!(params.freeze);
    const quality      = (params.quality as string) ?? "balanced";

    if (intensity === 0) return;

    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);
    const totalBlocks = blocksX * blocksY;

    if (engine.needsInit(width, height)) {
      engine.reset(data, width, height, totalBlocks);
      return;
    }

    const mvScale    = intensity / 50;
    const decayFactor = decay * 0.05;
    const searchStep  = quality === "fast" ? 4 : quality === "high" ? 1 : 2;

    const secondary = timelineFrames && timelineFrames.length > 0 ? timelineFrames[0] : null;
    const secData = secondary ? secondary.data as Uint8ClampedArray : null;
    const hasSecondary = secData !== null && secData.length === data.length;

    const justStartedTransition = hasSecondary && !engine.hadSecondary;
    if (justStartedTransition || freeze) {
      engine.iFrame!.set(data);
      if (engine.moshBuffer) engine.moshBuffer.set(data);
      if (engine.mvX) engine.mvX.fill(0);
      if (engine.mvY) engine.mvY.fill(0);
    }
    engine.hadSecondary = hasSecondary;

    // ── Mode dispatch ────────────────────────────────────────────────────────

    if (mode === "smear") {
      engine.estimateMVs(
        data, engine.prevFrame!,
        blockSize, searchRange, searchStep, momentum
      );
      engine.warpMoshBuffer(blockSize, mvScale, channelShift, decayFactor, null, 0);

    } else if (mode === "transition") {
      if (hasSecondary) {
        // Drive warping from secondary clip's own motion. The secondary clip's
        // MVs are applied to the primary clip's pixels -- the secondary "emerges"
        // through its own movement patterns without direct pixel blending.
        const ref = engine.prevSecondary ?? engine.prevFrame!;
        engine.estimateMVs(
          secData!, ref,
          blockSize, searchRange, searchStep, momentum
        );
        // Direct warp: no three-way blend. Optional bleed adds a faint ghost of
        // the secondary for artistic control (default bleed=0.2 → 0.02 per frame).
        engine.warpDirect(blockSize, mvScale, channelShift, decayFactor);
        if (bleed > 0) {
          // Light additive ghost from secondary on top of the warped buffer
          const bleedAmt = bleed * 0.02;
          const mb = engine.moshBuffer!;
          for (let i = 0; i < mb.length - 3; i += 4) {
            mb[i]     = Math.min(255, Math.round(mb[i]     * (1 - bleedAmt) + secData![i]     * bleedAmt));
            mb[i + 1] = Math.min(255, Math.round(mb[i + 1] * (1 - bleedAmt) + secData![i + 1] * bleedAmt));
            mb[i + 2] = Math.min(255, Math.round(mb[i + 2] * (1 - bleedAmt) + secData![i + 2] * bleedAmt));
          }
        }
        if (!engine.prevSecondary) {
          engine.prevSecondary = new Uint8ClampedArray(secData!);
        } else {
          engine.prevSecondary.set(secData!);
        }
      } else {
        // No secondary: keep mosh buffer current so it's ready when overlap begins
        engine.iFrame!.set(data);
        engine.moshBuffer!.set(data);
        engine.prevSecondary = null;
      }

    } else if (mode === "bloom") {
      engine.estimateMVs(
        data, engine.prevFrame!,
        blockSize, searchRange, searchStep, momentum
      );
      // Tuned bleed rate: at default bleed=0.2, bleedFactor=0.016 per frame,
      // which is perceptible over ~60 frames without overwhelming the warp.
      const bleedFactor = bleed * 0.08;
      engine.warpMoshBuffer(blockSize, mvScale, channelShift, decayFactor, data, bleedFactor);

    } else if (mode === "glitch") {
      engine.estimateMVs(
        data, engine.prevFrame!,
        blockSize, searchRange, searchStep, momentum
      );
      engine.glitchMVs(blockSize, intensity);
      engine.warpMoshBuffer(blockSize, mvScale, channelShift, decayFactor, null, 0);
    }

    data.set(engine.moshBuffer!);
    engine.prevFrame!.set(new Uint8ClampedArray(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
  },
});
