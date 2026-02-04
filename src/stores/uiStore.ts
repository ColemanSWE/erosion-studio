import { create } from "zustand";

interface UIState {
  showMediaBrowser: boolean;
  showEffectsPanel: boolean;
  showTimeline: boolean;
  zoomLevel: number;
  appMode: "home" | "editor" | "camera";

  toggleMediaBrowser: () => void;
  toggleEffectsPanel: () => void;
  toggleTimeline: () => void;
  setZoomLevel: (level: number) => void;
  setAppMode: (mode: "home" | "editor" | "camera") => void;
}

export const useUIStore = create<UIState>((set) => ({
  showMediaBrowser: true,
  showEffectsPanel: true,
  showTimeline: true,
  zoomLevel: 1,
  appMode: "home",

  toggleMediaBrowser: () =>
    set((state) => ({ showMediaBrowser: !state.showMediaBrowser })),
  toggleEffectsPanel: () =>
    set((state) => ({ showEffectsPanel: !state.showEffectsPanel })),
  toggleTimeline: () => set((state) => ({ showTimeline: !state.showTimeline })),
  setZoomLevel: (level) => set({ zoomLevel: level }),
  setAppMode: (mode) => set({ appMode: mode }),
}));
