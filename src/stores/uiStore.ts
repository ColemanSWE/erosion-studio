import { create } from "zustand";

interface UIState {
  showMediaBrowser: boolean;
  showEffectsPanel: boolean;
  zoomLevel: number;
  activeRegionId: string | null;
  isDrawingRegion: boolean;

  toggleMediaBrowser: () => void;
  toggleEffectsPanel: () => void;
  setZoomLevel: (level: number) => void;
  setActiveRegionId: (id: string | null) => void;
  setIsDrawingRegion: (isDrawing: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  showMediaBrowser: true,
  showEffectsPanel: true,
  zoomLevel: 1,
  activeRegionId: null,
  isDrawingRegion: false,

  toggleMediaBrowser: () =>
    set((state) => ({ showMediaBrowser: !state.showMediaBrowser })),
  toggleEffectsPanel: () =>
    set((state) => ({ showEffectsPanel: !state.showEffectsPanel })),
  setZoomLevel: (level) => set({ zoomLevel: level }),
  setActiveRegionId: (id) => set({ activeRegionId: id }),
  setIsDrawingRegion: (isDrawing) => set({ isDrawingRegion: isDrawing }),
}));
