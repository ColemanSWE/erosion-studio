import type { StateCreator } from "zustand";
import type { MediaItem } from "../../lib/project";
import type { ProjectState } from "../projectState";
import { withHistory } from "../projectUtils";

export type MediaSlice = {
  media: MediaItem[];
  selectedMediaId?: string;
  addMedia: (item: MediaItem) => void;
  removeMedia: (id: string) => void;
  selectMedia: (id: string) => void;
};

export const createMediaSlice: StateCreator<ProjectState, [], [], MediaSlice> = (set) => ({
  media: [],
  selectedMediaId: undefined,

  addMedia: (item) =>
    set((state) => ({
      ...withHistory(state),
      media: [...state.media, item],
      selectedMediaId: state.selectedMediaId || item.id,
    })),

  removeMedia: (id) =>
    set((state) => {
      const item = state.media.find((m) => m.id === id);
      if (item?.path.startsWith("blob:")) URL.revokeObjectURL(item.path);
      return {
        ...withHistory(state),
        media: state.media.filter((m) => m.id !== id),
        selectedMediaId: state.selectedMediaId === id ? undefined : state.selectedMediaId,
        clips: state.clips.filter((c) => c.mediaId !== id),
      };
    }),

  selectMedia: (id) => set({ selectedMediaId: id }),
});
