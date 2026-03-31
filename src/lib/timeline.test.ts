import { describe, it, expect } from "vitest";
import {
  evaluateParamTrack,
  resolveEffectsAtTime,
  snapTime,
  getSnapInterval,
  formatTime,
  applySnap,
  collectSnapTargets,
} from "./timeline";
import type { EffectParamTrack, Effect } from "./effects/types";

// ── evaluateParamTrack ────────────────────────────────────────────────────────

describe("evaluateParamTrack", () => {
  const makeTrack = (keyframes: { time: number; value: number }[]): EffectParamTrack => ({
    id: "t1",
    effectId: "e1",
    paramKey: "intensity",
    keyframes: keyframes.map((k, i) => ({ ...k, id: `k${i}` })),
  });

  it("returns undefined for empty track", () => {
    expect(evaluateParamTrack(makeTrack([]), 1)).toBeUndefined();
  });

  it("returns the single keyframe value regardless of time", () => {
    const track = makeTrack([{ time: 5, value: 0.5 }]);
    expect(evaluateParamTrack(track, 0)).toBe(0.5);
    expect(evaluateParamTrack(track, 10)).toBe(0.5);
  });

  it("clamps to first keyframe before range", () => {
    const track = makeTrack([{ time: 2, value: 0.1 }, { time: 8, value: 0.9 }]);
    expect(evaluateParamTrack(track, 0)).toBe(0.1);
  });

  it("clamps to last keyframe after range", () => {
    const track = makeTrack([{ time: 2, value: 0.1 }, { time: 8, value: 0.9 }]);
    expect(evaluateParamTrack(track, 10)).toBe(0.9);
  });

  it("interpolates linearly between keyframes", () => {
    const track = makeTrack([{ time: 0, value: 0 }, { time: 10, value: 10 }]);
    expect(evaluateParamTrack(track, 5)).toBeCloseTo(5);
    expect(evaluateParamTrack(track, 2.5)).toBeCloseTo(2.5);
  });

  it("handles multiple segments correctly", () => {
    const track = makeTrack([
      { time: 0, value: 0 },
      { time: 5, value: 10 },
      { time: 10, value: 0 },
    ]);
    expect(evaluateParamTrack(track, 2.5)).toBeCloseTo(5);
    expect(evaluateParamTrack(track, 7.5)).toBeCloseTo(5);
  });
});

// ── resolveEffectsAtTime ──────────────────────────────────────────────────────

describe("resolveEffectsAtTime", () => {
  const makeEffect = (overrides: Partial<Effect> = {}): Effect => ({
    id: "e1",
    type: "invert",
    active: true,
    params: { strength: 1.0 },
    ...overrides,
  });

  it("filters inactive effects", () => {
    const effect = makeEffect({ active: false });
    const result = resolveEffectsAtTime([effect], [], 0);
    expect(result).toHaveLength(0);
  });

  it("includes effects with no time window", () => {
    const effect = makeEffect();
    const result = resolveEffectsAtTime([effect], [], 5);
    expect(result).toHaveLength(1);
  });

  it("filters effects outside their time window", () => {
    const effect = makeEffect({ startTime: 2, endTime: 8 });
    expect(resolveEffectsAtTime([effect], [], 1)).toHaveLength(0);
    expect(resolveEffectsAtTime([effect], [], 9)).toHaveLength(0);
  });

  it("includes effects inside their time window", () => {
    const effect = makeEffect({ startTime: 2, endTime: 8 });
    expect(resolveEffectsAtTime([effect], [], 2)).toHaveLength(1);
    expect(resolveEffectsAtTime([effect], [], 5)).toHaveLength(1);
    expect(resolveEffectsAtTime([effect], [], 8)).toHaveLength(1);
  });

  it("applies keyframe param overrides", () => {
    const effect = makeEffect({ params: { strength: 1.0 } });
    const track: EffectParamTrack = {
      id: "t1",
      effectId: "e1",
      paramKey: "strength",
      keyframes: [
        { id: "k0", time: 0, value: 0.2 },
        { id: "k1", time: 10, value: 0.8 },
      ],
    };
    const result = resolveEffectsAtTime([effect], [track], 5);
    expect(result[0].params.strength).toBeCloseTo(0.5);
  });

  it("does not mutate the original effect object", () => {
    const effect = makeEffect({ params: { strength: 1.0 } });
    const track: EffectParamTrack = {
      id: "t1",
      effectId: "e1",
      paramKey: "strength",
      keyframes: [{ id: "k0", time: 0, value: 0.5 }],
    };
    resolveEffectsAtTime([effect], [track], 0);
    expect(effect.params.strength).toBe(1.0);
  });
});

// ── snapTime ──────────────────────────────────────────────────────────────────

describe("snapTime", () => {
  it("rounds to nearest interval", () => {
    expect(snapTime(1.4, 1)).toBe(1);
    expect(snapTime(1.6, 1)).toBe(2);
    expect(snapTime(0.55, 0.5)).toBe(0.5);
  });
});

// ── getSnapInterval ───────────────────────────────────────────────────────────

describe("getSnapInterval", () => {
  it("returns frame-level interval at high zoom", () => {
    expect(getSnapInterval(200)).toBeCloseTo(1 / 30);
    expect(getSnapInterval(500)).toBeCloseTo(1 / 30);
  });

  it("returns 0.1s at medium-high zoom", () => {
    expect(getSnapInterval(60)).toBe(0.1);
    expect(getSnapInterval(100)).toBe(0.1);
  });

  it("returns 0.5s at medium zoom", () => {
    expect(getSnapInterval(20)).toBe(0.5);
    expect(getSnapInterval(50)).toBe(0.5);
  });

  it("returns 1s at low zoom", () => {
    expect(getSnapInterval(10)).toBe(1);
  });
});

// ── formatTime ────────────────────────────────────────────────────────────────

describe("formatTime", () => {
  it("formats zero correctly", () => {
    expect(formatTime(0)).toBe("0:00.0");
  });

  it("formats whole seconds", () => {
    expect(formatTime(65)).toBe("1:05.0");
  });

  it("formats fractional seconds", () => {
    expect(formatTime(1.5)).toBe("0:01.5");
  });

  it("formats large values", () => {
    expect(formatTime(3661.9)).toBe("61:01.9");
  });
});

// ── applySnap ─────────────────────────────────────────────────────────────────

describe("applySnap", () => {
  it("clamps negative time to 0", () => {
    const { snappedTime } = applySnap(-1, [], 50, false);
    expect(snappedTime).toBe(0);
  });

  it("returns time unchanged when snapping disabled", () => {
    const { snappedTime, magnetTime } = applySnap(3.7, [], 50, false);
    expect(snappedTime).toBe(3.7);
    expect(magnetTime).toBeNull();
  });

  it("snaps magnetically to a nearby target", () => {
    // At zoom=200, threshold is 8/200 = 0.04s; 5.02 is within range
    const targets = [{ time: 5, type: "clip-start" as const }];
    const { snappedTime, magnetTime } = applySnap(5.02, targets, 200, true);
    expect(snappedTime).toBe(5);
    expect(magnetTime).toBe(5);
  });

  it("falls back to grid snap when no magnetic target is nearby", () => {
    const { magnetTime } = applySnap(1.7, [], 50, true);
    expect(magnetTime).toBeNull();
  });
});

// ── collectSnapTargets ────────────────────────────────────────────────────────

describe("collectSnapTargets", () => {
  it("always includes the playhead", () => {
    const targets = collectSnapTargets([], [], 3.5);
    expect(targets).toContainEqual({ time: 3.5, type: "playhead" });
  });

  it("includes clip start/end times", () => {
    const clip = { id: "c1", mediaId: "m1", startTime: 1, endTime: 5, trackIndex: 0 };
    const targets = collectSnapTargets([clip], [], 0);
    expect(targets).toContainEqual({ time: 1, type: "clip-start" });
    expect(targets).toContainEqual({ time: 5, type: "clip-end" });
  });

  it("excludes the specified clip", () => {
    const clip = { id: "c1", mediaId: "m1", startTime: 1, endTime: 5, trackIndex: 0 };
    const targets = collectSnapTargets([clip], [], 0, "c1");
    const times = targets.map((t) => t.time);
    expect(times).not.toContain(1);
    expect(times).not.toContain(5);
  });
});
