import { create } from "zustand";

interface UIState {
  showMediaBrowser: boolean;
  showEffectsPanel: boolean;
  showTimeline: boolean;
  zoomLevel: number;

  toggleMediaBrowser: () => void;
  toggleEffectsPanel: () => void;
  toggleTimeline: () => void;
  setZoomLevel: (level: number) => void;
}

export const useUIStore = create<UIState>((set) => ({
  showMediaBrowser: true,
  showEffectsPanel: true,
  showTimeline: true,
  zoomLevel: 1,

  toggleMediaBrowser: () =>
    set((state) => ({ showMediaBrowser: !state.showMediaBrowser })),
  toggleEffectsPanel: () =>
    set((state) => ({ showEffectsPanel: !state.showEffectsPanel })),
  toggleTimeline: () => set((state) => ({ showTimeline: !state.showTimeline })),
  setZoomLevel: (level) => set({ zoomLevel: level }),
}));
