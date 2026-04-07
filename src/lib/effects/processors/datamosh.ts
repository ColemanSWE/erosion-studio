import { registerEffect } from "../effect-registry";
import { bilinearSample } from "./shared";

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
// Faster than full search, good quality for compounding MV fields.
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

  // Coarse pass: jump by step size toward minimum
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

  // Fine pass: small diamond around best candidate
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

  warpMoshBuffer(
    blockSize: number,
    mvScale: number,
    channelShift: number,
    decayFactor: number,
    bleedData: Uint8ClampedArray | null,
    bleedFactor: number
  ): void {
    const { width, height, moshBuffer, iFrame, mvX, mvY } = this;
    if (!moshBuffer || !iFrame || !mvX || !mvY) return;

    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);
    const temp = new Uint8ClampedArray(moshBuffer);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bx = Math.min(blocksX - 1, Math.floor(x / blockSize));
        const by = Math.min(blocksY - 1, Math.floor(y / blockSize));
        const bi = by * blocksX + bx;
        const di = (y * width + x) * 4;

        const baseDx = mvX[bi] * mvScale;
        const baseDy = mvY[bi] * mvScale;

        // Per-channel MV offset for chromatic fringing
        const shift = channelShift;
        const r = bilinearSample(temp, width, height, x + baseDx + shift, y + baseDy, 0);
        const g = bilinearSample(temp, width, height, x + baseDx, y + baseDy, 1);
        const b = bilinearSample(temp, width, height, x + baseDx - shift, y + baseDy, 2);

        const iDecay = decayFactor;
        const sBleed = bleedFactor;
        const keep = 1 - iDecay - sBleed;

        const ir = iFrame[di];
        const ig = iFrame[di + 1];
        const ib = iFrame[di + 2];

        const sr = bleedData ? bleedData[di] : 0;
        const sg = bleedData ? bleedData[di + 1] : 0;
        const sb = bleedData ? bleedData[di + 2] : 0;

        moshBuffer[di]     = Math.round(r * keep + ir * iDecay + sr * sBleed);
        moshBuffer[di + 1] = Math.round(g * keep + ig * iDecay + sg * sBleed);
        moshBuffer[di + 2] = Math.round(b * keep + ib * iDecay + sb * sBleed);
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

    const mvScale = intensity / 50; // 0..2
    const decayFactor = decay * 0.05; // keep small so buffer doesn't collapse
    const searchStep = quality === "fast" ? 4 : quality === "high" ? 1 : 2;

    const secondary = timelineFrames && timelineFrames.length > 0 ? timelineFrames[0] : null;
    const secData = secondary ? secondary.data as Uint8ClampedArray : null;
    const hasSecondary = secData !== null && secData.length === data.length;

    // Transition edge detection: secondary clip just appeared → freeze I-frame
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
      // Estimate MVs: current frame vs previous frame (single-source)
      engine.estimateMVs(
        data, engine.prevFrame!,
        blockSize, searchRange, searchStep,
        momentum
      );
      engine.warpMoshBuffer(
        blockSize, mvScale, channelShift,
        decayFactor,
        null, 0
      );

    } else if (mode === "transition") {
      if (hasSecondary) {
        const ref = engine.prevSecondary ?? engine.prevFrame!;
        engine.estimateMVs(
          secData!, ref,
          blockSize, searchRange, searchStep,
          momentum
        );
        const bleedFactor = (bleed * 0.002); // slow bleed from secondary
        engine.warpMoshBuffer(
          blockSize, mvScale, channelShift,
          decayFactor,
          secData, bleedFactor
        );
        if (!engine.prevSecondary) {
          engine.prevSecondary = new Uint8ClampedArray(secData!);
        } else {
          engine.prevSecondary.set(secData!);
        }
      } else {
        // Outside transition: keep I-frame and mosh buffer current
        engine.iFrame!.set(data);
        engine.moshBuffer!.set(data);
        engine.prevSecondary = null;
      }

    } else if (mode === "bloom") {
      const ref = engine.prevFrame!;
      engine.estimateMVs(
        data, ref,
        blockSize, searchRange, searchStep,
        momentum
      );
      // Continuously bleed live source into mosh buffer
      const bleedFactor = bleed * 0.008;
      engine.warpMoshBuffer(
        blockSize, mvScale, channelShift,
        decayFactor,
        data, bleedFactor
      );

    } else if (mode === "glitch") {
      engine.estimateMVs(
        data, engine.prevFrame!,
        blockSize, searchRange, searchStep,
        momentum
      );
      engine.glitchMVs(blockSize, intensity);
      engine.warpMoshBuffer(
        blockSize, mvScale, channelShift,
        decayFactor,
        null, 0
      );
    }

    data.set(engine.moshBuffer!);
    engine.prevFrame!.set(new Uint8ClampedArray(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
  },
});
