import { describe, it, expect } from "vitest";
import { createDatamoshState, datamoshStep, type DatamoshState } from "./datamosh";

const W = 64;
const H = 48;
const FRAME = 1 / 30;

/**
 * Deterministic smooth frame (like real footage, unlike white noise): a sum of
 * waves whose frequencies and phases come from `seed`, panned right by `offsetX`.
 */
function texture(seed: number, offsetX = 0): Uint8ClampedArray {
  const r = (k: number) => {
    const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const waves = Array.from({ length: 4 }, (_, k) => ({
    fx: (0.15 + r(k * 4) * 0.25) * (r(k * 4 + 1) < 0.5 ? -1 : 1),
    fy: (0.15 + r(k * 4 + 2) * 0.25) * (k % 2 ? -1 : 1),
    phase: r(k * 4 + 3) * Math.PI * 2,
  }));
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Coordinates outside the frame are clamped, matching edge handling in the effect.
      const sx = Math.max(0, Math.min(W - 1, x - offsetX));
      const v = waves.map((w) => Math.sin(sx * w.fx + y * w.fy + w.phase));
      const i = (y * W + x) * 4;
      data[i] = 128 + 60 * v[0] + 40 * v[1];
      data[i + 1] = 128 + 60 * v[1] + 40 * v[2];
      data[i + 2] = 128 + 60 * v[2] + 40 * v[3];
      data[i + 3] = 255;
    }
  }
  return data;
}

function step(state: DatamoshState, frame: Uint8ClampedArray, t: number | undefined, params: Record<string, unknown> = {}) {
  const data = new Uint8ClampedArray(frame);
  datamoshStep(state, data, { width: W, height: H, mediaTime: t }, { bleed: 0, ...params });
  return data;
}

/** Fraction of RGB bytes that differ by more than `tol`. */
function mismatch(a: Uint8ClampedArray, b: Uint8ClampedArray, tol = 2): number {
  let bad = 0;
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    if ((i & 3) === 3) continue;
    total++;
    if (Math.abs(a[i] - b[i]) > tol) bad++;
  }
  return bad / total;
}

describe("datamosh", () => {
  it("passes the first frame through and does not drift on a static source", () => {
    const state = createDatamoshState();
    const a = texture(1);
    expect(mismatch(step(state, a, 0), a)).toBe(0);
    let out = a;
    for (let f = 1; f <= 20; f++) out = step(state, a, f * FRAME, { bleed: 5 });
    expect(mismatch(out, a)).toBe(0);
  });

  it("moves the held picture with the source's motion", () => {
    const state = createDatamoshState();
    const a = texture(1);
    step(state, a, 0);
    // Source pans right by 8 px; the held picture (A) should pan with it.
    const out = step(state, texture(1, 8), FRAME);
    expect(state.mvX.filter((v) => v === -2).length).toBeGreaterThan(state.mvX.length * 0.6);
    expect(mismatch(out, texture(1, 8))).toBeLessThan(0.1);
  });

  it("holds the old picture across a cut and pushes it with the new shot's motion", () => {
    const state = createDatamoshState();
    const a = texture(1);
    step(state, a, 0);
    step(state, a, FRAME);
    const c = texture(99);
    const atCut = step(state, c, 2 * FRAME);
    expect(mismatch(atCut, a)).toBe(0);
    expect(mismatch(atCut, c)).toBeGreaterThan(0.5);
    // C pans right by 8 px: the output is A panned, not C.
    const after = step(state, texture(99, 8), 3 * FRAME);
    expect(mismatch(after, texture(1, 8))).toBeLessThan(0.1);
  });

  it("in 'every cut' mode, plays clean until a cut and then holds", () => {
    const state = createDatamoshState();
    const params = { trigger: "every cut" };
    step(state, texture(1), 0, params);
    const moving = texture(1, 8);
    expect(mismatch(step(state, moving, FRAME, params), moving)).toBe(0);
    const c = texture(42);
    expect(mismatch(step(state, c, 2 * FRAME, params), moving)).toBe(0);
    expect(state.moshing).toBe(true);
  });

  it("re-outputs the held frame on a paused re-render without advancing", () => {
    const state = createDatamoshState();
    step(state, texture(1), 0);
    const held = step(state, texture(1, 8), FRAME);
    const frameCount = state.frame;
    const again = step(state, texture(5), FRAME);
    expect(mismatch(again, held)).toBe(0);
    expect(state.frame).toBe(frameCount);
  });

  it("re-keys after a backwards seek or a large gap", () => {
    const state = createDatamoshState();
    step(state, texture(1), 1);
    step(state, texture(1, 8), 1 + FRAME);
    const back = texture(7);
    expect(mismatch(step(state, back, 0.2), back)).toBe(0);
    const later = texture(8);
    expect(mismatch(step(state, later, 5), later)).toBe(0);
  });

  it("restores a clean frame once Length has elapsed", () => {
    const state = createDatamoshState();
    const params = { length: 0.1 };
    step(state, texture(1), 0, params);
    step(state, texture(1, 4), FRAME, params);
    step(state, texture(1, 8), 2 * FRAME, params);
    const fresh = texture(1, 12);
    expect(mismatch(step(state, fresh, 4 * FRAME, params), fresh)).toBe(0);
    expect(state.keyTime).toBeCloseTo(4 * FRAME);
  });

  it("produces identical output for identical input with chaos on", () => {
    const run = () => {
      const state = createDatamoshState();
      const outs: Uint8ClampedArray[] = [];
      for (let f = 0; f < 6; f++) outs.push(step(state, texture(1, f * 4), f * FRAME, { chaos: 80, bleed: 10 }));
      return outs;
    };
    const a = run();
    const b = run();
    a.forEach((frame, i) => expect(mismatch(frame, b[i], 0)).toBe(0));
  });

  it("Bleed-through reveals the new shot underneath the frozen picture", () => {
    const a = texture(1);
    const c = texture(99);
    const hold = (state: DatamoshState, params: Record<string, unknown>) => {
      step(state, a, 0, params);
      step(state, a, FRAME, params);
      step(state, c, 2 * FRAME, params); // cut: holds A
    };

    // Strong bleed: C is fully visible within a second.
    const fast = createDatamoshState();
    hold(fast, { bleed: 100 });
    let out = a;
    for (let f = 3; f < 33; f++) out = step(fast, c, f * FRAME, { bleed: 100 });
    expect(mismatch(out, c)).toBe(0);

    // Gentle bleed still converges all the way (no rounding stall a few levels short).
    const slow = createDatamoshState();
    hold(slow, { bleed: 10 });
    for (let f = 3; f < 603; f++) out = step(slow, c, f * FRAME, { bleed: 10 });
    expect(mismatch(out, c, 3)).toBeLessThan(0.01);

    // No bleed: the old picture stays.
    const none = createDatamoshState();
    hold(none, { bleed: 0 });
    for (let f = 3; f < 33; f++) out = step(none, c, f * FRAME, { bleed: 0 });
    expect(mismatch(out, a)).toBe(0);
  });

  it("Motion Detail draws the new shot's changes onto the old picture", () => {
    const a = texture(1);
    const c = texture(99);
    // C with a brightened square appearing in the middle.
    const c2 = new Uint8ClampedArray(c);
    const inSquare = (x: number, y: number) => x >= 24 && x < 40 && y >= 16 && y < 32;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!inSquare(x, y)) continue;
      const i = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) c2[i + ch] = Math.min(255, c[i + ch] + 60);
    }
    const squareGain = (out: Uint8ClampedArray) => {
      let sum = 0;
      let n = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!inSquare(x, y)) continue;
        const i = (y * W + x) * 4;
        for (let ch = 0; ch < 3; ch++) sum += out[i + ch] - a[i + ch];
        n += 3;
      }
      return sum / n;
    };
    const run = (detail: number) => {
      const state = createDatamoshState();
      step(state, a, 0, { detail });
      step(state, a, FRAME, { detail });
      step(state, c, 2 * FRAME, { detail });
      return squareGain(step(state, c2, 3 * FRAME, { detail }));
    };
    expect(run(100)).toBeGreaterThan(40);
    expect(Math.abs(run(0))).toBeLessThan(2);
  });

  it("moshes from the incoming clip while clips overlap", () => {
    const state = createDatamoshState();
    const a = texture(1);
    const frames = (f: Uint8ClampedArray) => [{ data: f, width: W, height: H } as unknown as ImageData];
    const run = (incoming: Uint8ClampedArray | null, t: number, params: Record<string, unknown> = {}) => {
      // The primary (data) stays clip A throughout, as the engine renders the earliest clip.
      const data = new Uint8ClampedArray(a);
      datamoshStep(
        state, data,
        { width: W, height: H, mediaTime: t, timelineFrames: incoming ? frames(incoming) : undefined },
        { bleed: 0, ...params },
      );
      return data;
    };
    run(null, 0);
    run(null, FRAME);
    // Overlap starts: acts as the cut, so A is held...
    expect(mismatch(run(texture(99), 2 * FRAME), a)).toBe(0);
    // ...and pushed by the incoming clip's motion.
    expect(mismatch(run(texture(99, 8), 3 * FRAME), texture(1, 8))).toBeLessThan(0.1);
    // Bleed-through reveals the incoming clip.
    let out = a;
    for (let f = 4; f < 34; f++) out = run(texture(99, 8), f * FRAME, { bleed: 100 });
    expect(mismatch(out, texture(99, 8))).toBe(0);
  });

  it("advances every call when there is no media time (webcam)", () => {
    const state = createDatamoshState();
    step(state, texture(1), undefined);
    step(state, texture(1, 8), undefined);
    expect(state.frame).toBe(1);
  });
});
