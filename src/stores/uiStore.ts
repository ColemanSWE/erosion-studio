import { create } from "zustand";

interface UIState {
  showMediaBrowser: boolean;
  showEffectsPanel: boolean;
  showTimeline: boolean;
  zoomLevel: number;
  activeRegionId: string | null;
  activeOverlayId: string | null;
  isDrawingRegion: boolean;

  toggleMediaBrowser: () => void;
  toggleEffectsPanel: () => void;
  toggleTimeline: () => void;
  setZoomLevel: (level: number) => void;
  setActiveRegionId: (id: string | null) => void;
  setActiveOverlayId: (id: string | null) => void;
  setIsDrawingRegion: (isDrawing: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  showMediaBrowser: true,
  showEffectsPanel: true,
  showTimeline: true,
  zoomLevel: 1,
  activeRegionId: null,
  activeOverlayId: null,
  isDrawingRegion: false,

  toggleMediaBrowser: () =>
    set((state) => ({ showMediaBrowser: !state.showMediaBrowser })),
  toggleEffectsPanel: () =>
    set((state) => ({ showEffectsPanel: !state.showEffectsPanel })),
  toggleTimeline: () =>
    set((state) => ({ showTimeline: !state.showTimeline })),
  setZoomLevel: (level) => set({ zoomLevel: level }),
  setActiveRegionId: (id) => set({ activeRegionId: id, activeOverlayId: null }),
  setActiveOverlayId: (id) => set({ activeOverlayId: id, activeRegionId: null }),
  setIsDrawingRegion: (isDrawing) => set({ isDrawingRegion: isDrawing }),
}));
