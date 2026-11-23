import { registerEffect, type ProcessConfig } from "../../effect-registry";

/*
 * Datamosh: an imitation of what happens when a video's keyframes (I-frames)
 * are deleted. A codec then keeps applying each later frame's motion vectors
 * and residuals to whatever pixels it last had, so the picture stops
 * refreshing and the new footage's motion drags the stale pixels around.
 *
 * Per frame we:
 *   1. estimate block motion between the previous and current *input* frames
 *      (on a quarter-resolution luma copy, to keep it cheap),
 *   2. move blocks of the previous *output* by those vectors, and
 *   3. add the residual (current input minus motion-compensated previous
 *      input), scaled by Motion Detail. This is what a codec does, and it is
 *      what lets the new footage's moving parts "draw" onto the old colours.
 *   4. blend a little toward the live frame (Bleed-through), so the real
 *      video gradually shows through the frozen picture.
 *
 * Scene cuts are detected and skipped (no motion, no residual), which gives the
 * classic transition where shot A's last frame is pushed around by shot B's
 * motion, with plain back-to-back clips. When clips overlap on the timeline,
 * the incoming clip (from `timelineFrames`) is used as the source, so the
 * overlap start acts as the cut.
 *
 * State is kept between frames, so this effect is CPU-only and lives in the
 * single persistent effects worker.
 */

/** Luma is analysed at 1/LUMA_SCALE resolution. Block sizes are multiples of 8, so blocks map to whole luma pixels. */
const LUMA_SCALE = 4;
/** A gap larger than this (seek, effect window start, load shedding) drops a fresh keyframe. */
const MAX_GAP_S = 0.5;
/** Frame interval assumed when the source has no media time (webcam). */
const NOMINAL_FRAME_S = 1 / 30;
/** Mean motion-compensated luma difference (0–255) above which a frame can count as a cut... */
const CUT_ABS = 12;
/** ...when it is also this many times the recent average difference. */
const CUT_REL = 3;
/** Per-pixel SAD below which a block is treated as static without searching. */
const STATIC_SAD = 1.5;
/** Bleed-through at 100 blends this fraction toward the live frame each frame. */
const BLEED_MAX_RATE = 0.25;

export type DatamoshTrigger = "effect start" | "every cut";

export interface DatamoshParams {
  trigger: DatamoshTrigger;
  /** Motion vector strength, percent. */
  motion: number;
  /** How fast the frozen picture fades toward the live video, 0–100. */
  bleed: number;
  /** Residual strength: how much of the new footage's movement draws in, 0–100. */
  detail: number;
  /** Seconds before a clean frame is restored; 0 = never. */
  length: number;
  /** Macroblock size in pixels (multiple of 8). */
  blockSize: number;
  /** Motion vector scrambling, 0–100. */
  chaos: number;
  /** Keep re-applying the last motion vectors instead of estimating new ones. */
  repeatMotion: boolean;
}

export interface DatamoshState {
  width: number;
  height: number;
  /** Last output frame. */
  mosh: Uint8ClampedArray | null;
  /** Spare frame buffer; swapped with `mosh` each frame. */
  spare: Uint8ClampedArray | null;
  /** Last input frame. */
  prevSrc: Uint8ClampedArray | null;
  lw: number;
  lh: number;
  curLuma: Uint8Array;
  prevLuma: Uint8Array;
  blockSize: number;
  bw: number;
  bh: number;
  /** Per-block motion vectors in luma pixels, pointing from the current block to its source. */
  mvX: Int16Array;
  mvY: Int16Array;
  lastTime: number | null;
  keyTime: number;
  /** Frames since the last keyframe; seeds the chaos PRNG so output is reproducible. */
  frame: number;
  /** False only in "every cut" mode while waiting for a cut. */
  moshing: boolean;
  /** Running average of the frame-to-frame luma difference. */
  diffAvg: number;
}

export function createDatamoshState(): DatamoshState {
  return {
    width: 0,
    height: 0,
    mosh: null,
    spare: null,
    prevSrc: null,
    lw: 0,
    lh: 0,
    curLuma: new Uint8Array(0),
    prevLuma: new Uint8Array(0),
    blockSize: 0,
    bw: 0,
    bh: 0,
    mvX: new Int16Array(0),
    mvY: new Int16Array(0),
    lastTime: null,
    keyTime: 0,
    frame: 0,
    moshing: true,
    diffAvg: 0,
  };
}

export const DEFAULT_DATAMOSH_PARAMS: DatamoshParams = {
  trigger: "effect start",
  motion: 100,
  bleed: 10,
  detail: 70,
  length: 0,
  blockSize: 16,
  chaos: 0,
  repeatMotion: false,
};

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function readDatamoshParams(params: Record<string, unknown>): DatamoshParams {
  const d = DEFAULT_DATAMOSH_PARAMS;
  const blockSize = Math.max(8, Math.round(num(params.blockSize, d.blockSize) / 8) * 8);
  return {
    trigger: params.trigger === "every cut" ? "every cut" : "effect start",
    motion: Math.max(0, num(params.motion, d.motion)),
    bleed: Math.min(100, Math.max(0, num(params.bleed, d.bleed))),
    detail: Math.min(100, Math.max(0, num(params.detail, d.detail))),
    length: Math.max(0, num(params.length, d.length)),
    blockSize,
    chaos: Math.min(100, Math.max(0, num(params.chaos, d.chaos))),
    repeatMotion: !!params.repeatMotion,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** mulberry32: tiny seeded PRNG, so chaos is identical between preview and export. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Quarter-resolution luma: average of four samples per 4×4 cell. */
function computeLuma(data: Uint8ClampedArray, width: number, height: number, out: Uint8Array, lw: number, lh: number): void {
  const xMax = width - 1;
  const yMax = height - 1;
  for (let ly = 0; ly < lh; ly++) {
    const y0 = Math.min(ly * LUMA_SCALE + 1, yMax) * width;
    const y1 = Math.min(ly * LUMA_SCALE + 3, yMax) * width;
    for (let lx = 0; lx < lw; lx++) {
      const x0 = Math.min(lx * LUMA_SCALE + 1, xMax);
      const x1 = Math.min(lx * LUMA_SCALE + 3, xMax);
      let i = (y0 + x0) * 4;
      let sum = data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29;
      i = (y0 + x1) * 4;
      sum += data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29;
      i = (y1 + x0) * 4;
      sum += data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29;
      i = (y1 + x1) * 4;
      sum += data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29;
      out[ly * lw + lx] = sum >> 10;
    }
  }
}

function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return a.length > 0 ? sum / a.length : 0;
}

/** Sum of absolute luma differences between a current block and the reference shifted by (dx, dy), edges clamped. */
function blockSAD(
  cur: Uint8Array,
  ref: Uint8Array,
  lw: number,
  lh: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  dx: number,
  dy: number,
): number {
  let sad = 0;
  const xMax = lw - 1;
  const yMax = lh - 1;
  for (let y = y0; y < y1; y++) {
    let sy = y + dy;
    sy = sy < 0 ? 0 : sy > yMax ? yMax : sy;
    const curRow = y * lw;
    const refRow = sy * lw;
    for (let x = x0; x < x1; x++) {
      let sx = x + dx;
      sx = sx < 0 ? 0 : sx > xMax ? xMax : sx;
      sad += Math.abs(cur[curRow + x] - ref[refRow + sx]);
    }
  }
  return sad;
}

const REFINE_STEPS = [4, 2, 1];
const REFINE_ITERS = 4;
const DIAMOND_X = [1, -1, 0, 0];
const DIAMOND_Y = [0, 0, 1, -1];

/**
 * Block matching on the luma planes; writes new vectors into state.mvX / mvY.
 * Returns the mean per-pixel difference that remains after motion compensation:
 * low for pans and moving subjects, high for a scene cut.
 */
function estimateMotion(state: DatamoshState): number {
  const { curLuma, prevLuma, lw, lh, bw, bh, mvX, mvY } = state;
  const lb = state.blockSize / LUMA_SCALE;
  const range = Math.max(4, Math.min(16, lb * 2));
  let totalSad = 0;
  let totalPixels = 0;

  for (let by = 0; by < bh; by++) {
    const y0 = by * lb;
    const y1 = Math.min(y0 + lb, lh);
    for (let bx = 0; bx < bw; bx++) {
      const bi = by * bw + bx;
      const x0 = bx * lb;
      const x1 = Math.min(x0 + lb, lw);
      if (x0 >= x1 || y0 >= y1) {
        mvX[bi] = 0;
        mvY[bi] = 0;
        continue;
      }
      const pixels = (x1 - x0) * (y1 - y0);

      // Zero vector first: it wins ties, which keeps flat areas from drifting.
      let best = blockSAD(curLuma, prevLuma, lw, lh, x0, y0, x1, y1, 0, 0);
      let bdx = 0;
      let bdy = 0;
      totalPixels += pixels;
      if (best / pixels < STATIC_SAD) {
        totalSad += best;
        mvX[bi] = 0;
        mvY[bi] = 0;
        continue;
      }

      // Predictors: this block's previous vector, and the left/top neighbours' new ones.
      const tryCandidate = (dx: number, dy: number) => {
        if ((dx === bdx && dy === bdy) || Math.abs(dx) > range || Math.abs(dy) > range) return;
        const s = blockSAD(curLuma, prevLuma, lw, lh, x0, y0, x1, y1, dx, dy);
        if (s < best) {
          best = s;
          bdx = dx;
          bdy = dy;
        }
      };
      tryCandidate(mvX[bi], mvY[bi]);
      if (bx > 0) tryCandidate(mvX[bi - 1], mvY[bi - 1]);
      if (by > 0) tryCandidate(mvX[bi - bw], mvY[bi - bw]);

      // Diamond refinement at shrinking step sizes.
      for (const step of REFINE_STEPS) {
        for (let iter = 0; iter < REFINE_ITERS; iter++) {
          const cx = bdx;
          const cy = bdy;
          for (let k = 0; k < 4; k++) tryCandidate(cx + DIAMOND_X[k] * step, cy + DIAMOND_Y[k] * step);
          if (bdx === cx && bdy === cy) break;
        }
      }

      totalSad += best;
      mvX[bi] = bdx;
      mvY[bi] = bdy;
    }
  }
  return totalPixels > 0 ? totalSad / totalPixels : 0;
}

/** Randomly negate, swap or jitter block vectors. */
function scrambleMotion(state: DatamoshState, chaos: number): void {
  const { mvX, mvY } = state;
  const total = mvX.length;
  if (total === 0) return;
  const lb = state.blockSize / LUMA_SCALE;
  const range = Math.max(4, Math.min(16, lb * 2));
  const limit = range * 2;
  const chance = (chaos / 100) * 0.5;
  const jitter = 1 + (chaos / 100) * range;
  const rand = mulberry32((state.frame + 1) * 0x9e3779b1);

  const clampMV = (v: number) => (v < -limit ? -limit : v > limit ? limit : v);
  for (let i = 0; i < total; i++) {
    if (rand() >= chance) continue;
    const r = rand();
    if (r < 0.33) {
      mvX[i] = -mvX[i];
      mvY[i] = -mvY[i];
    } else if (r < 0.66) {
      const j = Math.floor(rand() * total);
      const tx = mvX[i];
      mvX[i] = mvX[j];
      mvX[j] = tx;
      const ty = mvY[i];
      mvY[i] = mvY[j];
      mvY[j] = ty;
    } else {
      mvX[i] = clampMV(Math.round(mvX[i] + (rand() * 2 - 1) * jitter));
      mvY[i] = clampMV(Math.round(mvY[i] + (rand() * 2 - 1) * jitter));
    }
  }
}

/**
 * Per block, with src = pixel + motion:
 *   w   = mosh[src] + detail · (cur − prevSrc[src])     (codec residual)
 *   out = w + bleed · (cur − w)                         (fade toward the live frame)
 *
 * This is the hot loop: integer maths on whole 0xAABBGGRR pixels, and a plain
 * 32-bit copy when both terms are off. The bleed term uses dithered rounding:
 * with plain rounding a small per-frame blend stalls once the remaining
 * difference is a few levels, and the picture never fully comes back.
 */
function warp(
  state: DatamoshState,
  cur: Uint8ClampedArray,
  out: Uint8ClampedArray,
  motionScale: number,
  detail: number,
  bleedRate: number,
): void {
  const { width, height, mosh, prevSrc, bw, bh, blockSize, mvX, mvY } = state;
  if (!mosh || !prevSrc) return;
  const xMax = width - 1;
  const yMax = height - 1;
  const vecScale = LUMA_SCALE * motionScale;
  // 8.8 fixed point.
  const kr = Math.round(detail * 256);
  const ka = Math.round(bleedRate * 256);
  const seed = Math.imul(state.frame + 1, 0x85ebca6b);
  const mosh32 = new Uint32Array(mosh.buffer, mosh.byteOffset, mosh.length >> 2);
  const out32 = new Uint32Array(out.buffer, out.byteOffset, out.length >> 2);
  const cur32 = new Uint32Array(cur.buffer, cur.byteOffset, cur.length >> 2);
  const prev32 = new Uint32Array(prevSrc.buffer, prevSrc.byteOffset, prevSrc.length >> 2);

  for (let by = 0; by < bh; by++) {
    const y0 = by * blockSize;
    const y1 = Math.min(y0 + blockSize, height);
    for (let bx = 0; bx < bw; bx++) {
      const bi = by * bw + bx;
      const dx = Math.round(mvX[bi] * vecScale);
      const dy = Math.round(mvY[bi] * vecScale);
      const x0 = bx * blockSize;
      const x1 = Math.min(x0 + blockSize, width);
      // Columns whose source lies inside the frame need no per-pixel clamping.
      const xa = Math.min(x1, Math.max(x0, -dx));
      const xb = Math.max(xa, Math.min(x1, xMax - dx + 1));
      for (let y = y0; y < y1; y++) {
        let sy = y + dy;
        sy = sy < 0 ? 0 : sy > yMax ? yMax : sy;
        const outRow = y * width;
        const srcRow = sy * width;

        if (kr === 0 && ka === 0) {
          for (let x = x0; x < xa; x++) out32[outRow + x] = mosh32[srcRow];
          let o = outRow + xa;
          let si = srcRow + xa + dx;
          for (let x = xa; x < xb; x++) out32[o++] = mosh32[si++];
          for (let x = xb; x < x1; x++) out32[outRow + x] = mosh32[srcRow + xMax];
          continue;
        }

        for (let x = x0; x < x1; x++) {
          let sx = x + dx;
          sx = sx < 0 ? 0 : sx > xMax ? xMax : sx;
          const o = outRow + x;
          const si = srcRow + sx;
          const m = mosh32[si];
          const c = cur32[o];
          let r = m & 255;
          let g = (m >>> 8) & 255;
          let b = (m >>> 16) & 255;
          const cr = c & 255;
          const cg = (c >>> 8) & 255;
          const cb = (c >>> 16) & 255;

          if (kr !== 0) {
            const p = prev32[si];
            if (p !== c) {
              r += (kr * (cr - (p & 255)) + 128) >> 8;
              g += (kr * (cg - ((p >>> 8) & 255)) + 128) >> 8;
              b += (kr * (cb - ((p >>> 16) & 255)) + 128) >> 8;
              r = r < 0 ? 0 : r > 255 ? 255 : r;
              g = g < 0 ? 0 : g > 255 ? 255 : g;
              b = b < 0 ? 0 : b > 255 ? 255 : b;
            }
          }
          if (ka !== 0) {
            // 0–255 dither, different per pixel and per frame.
            const d = Math.imul(o ^ seed, 0x9e3779b1) >>> 24;
            r += (ka * (cr - r) + d) >> 8;
            g += (ka * (cg - g) + d) >> 8;
            b += (ka * (cb - b) + d) >> 8;
          }
          out32[o] = (c & 0xff000000) | (b << 16) | (g << 8) | r;
        }
      }
    }
  }
}

// ─── State management ───────────────────────────────────────────────────────

function allocate(state: DatamoshState, width: number, height: number): void {
  const size = width * height * 4;
  state.width = width;
  state.height = height;
  state.mosh = new Uint8ClampedArray(size);
  state.spare = new Uint8ClampedArray(size);
  state.prevSrc = new Uint8ClampedArray(size);
  state.lw = Math.max(1, Math.ceil(width / LUMA_SCALE));
  state.lh = Math.max(1, Math.ceil(height / LUMA_SCALE));
  state.curLuma = new Uint8Array(state.lw * state.lh);
  state.prevLuma = new Uint8Array(state.lw * state.lh);
  state.blockSize = 0; // forces vector reallocation
}

function ensureBlocks(state: DatamoshState, blockSize: number): void {
  if (state.blockSize === blockSize) return;
  state.blockSize = blockSize;
  state.bw = Math.ceil(state.width / blockSize);
  state.bh = Math.ceil(state.height / blockSize);
  state.mvX = new Int16Array(state.bw * state.bh);
  state.mvY = new Int16Array(state.bw * state.bh);
}

/**
 * The frame to mosh from. When clips overlap on the timeline, the engine
 * passes the other clips' frames; the latest-starting one is the incoming shot.
 */
function pickInput(data: Uint8ClampedArray, frames: ProcessConfig["timelineFrames"]): Uint8ClampedArray {
  const incoming = frames?.[frames.length - 1];
  return incoming && incoming.data.length === data.length ? incoming.data : data;
}

/** Drop a keyframe: the current input becomes the picture everything is moshed from. */
function rekey(state: DatamoshState, data: Uint8ClampedArray, t: number, trigger: DatamoshTrigger): void {
  state.mosh!.set(data);
  state.prevSrc!.set(data);
  computeLuma(data, state.width, state.height, state.prevLuma, state.lw, state.lh);
  state.mvX.fill(0);
  state.mvY.fill(0);
  state.keyTime = t;
  state.lastTime = t;
  state.frame = 0;
  state.moshing = trigger === "effect start";
  state.diffAvg = 0;
}

/** Pass the frame through unchanged, but remember it as the picture to hold at the next cut. */
function passThrough(state: DatamoshState, data: Uint8ClampedArray): void {
  state.mosh!.set(data);
  state.prevSrc!.set(data);
  const tmp = state.prevLuma;
  state.prevLuma = state.curLuma;
  state.curLuma = tmp;
}

/**
 * Process one frame in place. `config.mediaTime` (seconds) drives keyframing:
 * an unchanged time re-outputs the last frame, and a jump re-keys.
 */
export function datamoshStep(
  state: DatamoshState,
  data: Uint8ClampedArray,
  config: Pick<ProcessConfig, "width" | "height" | "mediaTime" | "timelineFrames">,
  rawParams: Record<string, unknown>,
): void {
  const { width, height } = config;
  if (width <= 0 || height <= 0 || data.length !== width * height * 4) return;
  const p = readDatamoshParams(rawParams);
  const input = pickInput(data, config.timelineFrames);
  const emit = (frame: Uint8ClampedArray) => {
    if (frame !== data) data.set(frame);
  };

  const t = config.mediaTime ?? (state.lastTime ?? 0) + NOMINAL_FRAME_S;

  if (!state.mosh || state.width !== width || state.height !== height) {
    allocate(state, width, height);
    ensureBlocks(state, p.blockSize);
    rekey(state, input, t, p.trigger);
    emit(input);
    return;
  }
  ensureBlocks(state, p.blockSize);

  const dt = t - (state.lastTime ?? t);
  if (Math.abs(dt) < 1e-6) {
    // Same frame again (paused re-render): show the held picture, don't advance.
    data.set(state.mosh);
    return;
  }
  if (dt < 0 || dt > MAX_GAP_S) {
    rekey(state, input, t, p.trigger);
    emit(input);
    return;
  }
  state.lastTime = t;

  // Trigger switched to "effect start" while waiting for a cut.
  if (p.trigger === "effect start" && !state.moshing) {
    rekey(state, input, t, p.trigger);
    emit(input);
    return;
  }

  // Length elapsed: restore a clean picture.
  if (state.moshing && p.length > 0 && t - state.keyTime >= p.length - 1e-6) {
    if (p.trigger === "effect start") {
      rekey(state, input, t, p.trigger);
      emit(input);
      return;
    }
    state.moshing = false;
  }

  computeLuma(input, width, height, state.curLuma, state.lw, state.lh);
  // Repeat motion keeps its old vectors, so fall back to the raw frame difference.
  const diff = p.repeatMotion ? meanAbsDiff(state.curLuma, state.prevLuma) : estimateMotion(state);
  const isCut = diff > CUT_ABS && diff > CUT_REL * Math.max(state.diffAvg, 2);
  if (!isCut) state.diffAvg = state.diffAvg * 0.9 + diff * 0.1;

  if (!state.moshing) {
    if (!isCut) {
      passThrough(state, input);
      emit(input);
      return;
    }
    state.moshing = true;
    state.keyTime = t;
    state.frame = 0;
  } else if (isCut && p.trigger === "every cut") {
    state.keyTime = t; // Each cut extends the mosh.
  }

  const out = state.spare!;
  if (isCut) {
    // The cut frame itself is an I-frame we're dropping: hold the old picture.
    out.set(state.mosh);
    state.mvX.fill(0);
    state.mvY.fill(0);
  } else {
    if (p.chaos > 0) scrambleMotion(state, p.chaos);
    // Repeat motion's vectors no longer describe the footage, so its residual would be noise.
    const detail = p.repeatMotion ? 0 : p.detail / 100;
    warp(state, input, out, p.motion / 100, detail, (p.bleed / 100) * BLEED_MAX_RATE);
  }

  state.prevSrc!.set(input);
  state.spare = state.mosh;
  state.mosh = out;
  const tmp = state.prevLuma;
  state.prevLuma = state.curLuma;
  state.curLuma = tmp;
  state.frame++;
  data.set(out);
}

// ─── Effect registration ────────────────────────────────────────────────────

const state = createDatamoshState();

registerEffect({
  type: "datamosh",
  label: "Datamosh",
  category: "glitch",
  description:
    "Freezes the picture and lets the video's motion drag it around. Starts when the effect starts, after a seek, or at a cut (or where an overlapping clip begins). Press play; it needs motion.",
  animated: true,
  defaultParams: { ...DEFAULT_DATAMOSH_PARAMS },
  paramsConfig: [
    { key: "trigger", label: "Mosh At", type: "select", options: ["effect start", "every cut"] },
    { key: "motion", label: "Motion %", type: "slider", min: 0, max: 200, step: 5 },
    { key: "bleed", label: "Bleed-through", type: "slider", min: 0, max: 100, step: 1 },
    { key: "detail", label: "Motion Detail", type: "slider", min: 0, max: 100, step: 1 },
    { key: "length", label: "Length (s, 0 = never refresh)", type: "slider", min: 0, max: 20, step: 0.5 },
    { key: "blockSize", label: "Block Size", type: "slider", min: 8, max: 64, step: 8 },
    { key: "chaos", label: "Chaos", type: "slider", min: 0, max: 100, step: 1 },
    { key: "repeatMotion", label: "Repeat Motion (bloom)", type: "checkbox" },
  ],
  processor: (data, config, params) => datamoshStep(state, data, config, params),
});
