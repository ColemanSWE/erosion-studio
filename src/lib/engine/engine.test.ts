import { describe, it, expect, vi } from "vitest";
import { PlaybackClock } from "./clock";
import { isAnimatedEffectType, effectsNeedAnimation } from "./effect-traits";
import { resolveRenderSources, renderSourcesKey } from "./sources";
import { getAllEffects } from "../effects/effect-registry";
import type { Effect, TimelineClip, Overlay } from "../effects/types";
import type { MediaItem } from "../project";
import "../effects/processors";

describe("PlaybackClock", () => {
  it("notifies listeners with the seek flag and skips no-op updates", () => {
    const clock = new PlaybackClock();
    const listener = vi.fn();
    const unsubscribe = clock.subscribe(listener);

    clock.advance(1);
    clock.seek(5);
    clock.seek(5);
    expect(listener.mock.calls).toEqual([
      [1, false],
      [5, true],
    ]);
    expect(clock.time).toBe(5);

    unsubscribe();
    clock.advance(6);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("isAnimatedEffectType", () => {
  it("detects time-driven effects", () => {
    for (const type of ["film-grain", "noise", "glitch", "vhs"]) {
      expect(isAnimatedEffectType(type), type).toBe(true);
    }
  });

  it("treats pure per-pixel color effects as static", () => {
    for (const type of ["invert", "grayscale", "sepia", "posterize", "scanlines"]) {
      expect(isAnimatedEffectType(type), type).toBe(false);
    }
  });

  it("is defined for every registered effect", () => {
    for (const def of getAllEffects()) {
      expect(typeof isAnimatedEffectType(def.type)).toBe("boolean");
    }
  });

  it("ignores inactive effects", () => {
    const effects = [{ id: "a", type: "film-grain", active: false, params: {} }] as unknown as Effect[];
    expect(effectsNeedAnimation(effects)).toBe(false);
  });
});

describe("renderSourcesKey", () => {
  const media: MediaItem[] = [
    { id: "m1", type: "video", name: "a.mp4", path: "/a.mp4" },
    { id: "m2", type: "video", name: "b.mp4", path: "/b.mp4" },
  ] as MediaItem[];
  const clips: TimelineClip[] = [
    { id: "c1", mediaId: "m1", startTime: 0, endTime: 5 },
    { id: "c2", mediaId: "m2", startTime: 5, endTime: 10 },
  ] as TimelineClip[];
  const overlays: Overlay[] = [];

  const keyAt = (t: number) => renderSourcesKey(resolveRenderSources(clips, media, overlays, t, undefined));

  it("is stable within a clip and changes at a boundary", () => {
    expect(keyAt(1)).toBe(keyAt(4));
    expect(keyAt(1)).not.toBe(keyAt(7));
  });
});
