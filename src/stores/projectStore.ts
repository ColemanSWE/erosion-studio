import { create } from "zustand";
import type { ProjectState } from "./projectState";
import { createMediaSlice } from "./slices/mediaSlice";
import { createEffectsSlice } from "./slices/effectsSlice";
import { createTimelineSlice } from "./slices/timelineSlice";
import { createHistorySlice } from "./slices/historySlice";
import { createProjectIOSlice } from "./slices/projectIOSlice";

export const selectCanUndo = (state: ProjectState) => state._historyPast.length > 0;
export const selectCanRedo = (state: ProjectState) => state._historyFuture.length > 0;

export const useProjectStore = create<ProjectState>()((...args) => ({
  ...createMediaSlice(...args),
  ...createEffectsSlice(...args),
  ...createTimelineSlice(...args),
  ...createHistorySlice(...args),
  ...createProjectIOSlice(...args),
}));
