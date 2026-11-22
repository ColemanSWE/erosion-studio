import { create } from "zustand";
import type { ProjectState } from "./projectState";
import { createMediaSlice } from "./slices/mediaSlice";
import { createEffectsSlice } from "./slices/effectsSlice";
import { createTimelineSlice } from "./slices/timelineSlice";
import { createHistorySlice } from "./slices/historySlice";
import { createProjectIOSlice } from "./slices/projectIOSlice";
import { playbackClock } from "../lib/engine/clock";

export const selectCanUndo = (state: ProjectState) => state._historyPast.length > 0;
export const selectCanRedo = (state: ProjectState) => state._historyFuture.length > 0;

export const useProjectStore = create<ProjectState>()((...args) => ({
  ...createMediaSlice(...args),
  ...createEffectsSlice(...args),
  ...createTimelineSlice(...args),
  ...createHistorySlice(...args),
  ...createProjectIOSlice(...args),
}));

// Mirror every committed time change (seek, stop, load, end-of-playback) into the
// live playback clock. During playback the clock runs ahead of the store on its
// own; the store only catches up on pause.
useProjectStore.subscribe((state, prev) => {
  if (state.currentTime !== prev.currentTime) playbackClock.seek(state.currentTime);
});
