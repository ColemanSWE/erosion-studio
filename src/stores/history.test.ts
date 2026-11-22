import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useProjectStore } from "./projectStore";
import type { TimelineClip } from "../lib/effects/types";

const clip: TimelineClip = { id: "c1", mediaId: "m1", startTime: 0, endTime: 5 } as TimelineClip;

describe("undo history coalescing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useProjectStore.getState().newProject("Test");
    useProjectStore.getState().addClip(clip);
  });
  afterEach(() => vi.useRealTimers());

  const pastLength = () => useProjectStore.getState()._historyPast.length;

  it("folds a continuous drag on one clip into a single undo step", () => {
    const before = pastLength();
    for (let i = 1; i <= 30; i++) {
      useProjectStore.getState().updateClip("c1", { startTime: i * 0.1 });
      vi.advanceTimersByTime(16);
    }
    expect(pastLength()).toBe(before + 1);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().clips[0].startTime).toBe(0);
  });

  it("starts a new step after a pause or on a different object", () => {
    const before = pastLength();
    useProjectStore.getState().updateClip("c1", { startTime: 1 });
    vi.advanceTimersByTime(2000);
    useProjectStore.getState().updateClip("c1", { startTime: 2 });
    expect(pastLength()).toBe(before + 2);

    useProjectStore.getState().addClip({ ...clip, id: "c2" });
    useProjectStore.getState().updateClip("c2", { startTime: 3 });
    expect(pastLength()).toBe(before + 4);
  });
});
