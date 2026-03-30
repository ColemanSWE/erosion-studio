import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  showMediaBrowser: boolean;
  showEffectsPanel: boolean;
  showTimeline: boolean;
  zoomLevel: number;
  activeRegionId: string | null;
  activeOverlayId: string | null;
  isDrawingRegion: boolean;

  // Panel sizes (percentages for react-resizable-panels)
  mediaBrowserSize: number;
  effectsPanelSize: number;
  timelineSize: number;

  toggleMediaBrowser: () => void;
  toggleEffectsPanel: () => void;
  toggleTimeline: () => void;
  setShowMediaBrowser: (show: boolean) => void;
  setShowEffectsPanel: (show: boolean) => void;
  setShowTimeline: (show: boolean) => void;
  setZoomLevel: (level: number) => void;
  setActiveRegionId: (id: string | null) => void;
  setActiveOverlayId: (id: string | null) => void;
  setIsDrawingRegion: (isDrawing: boolean) => void;
  setMediaBrowserSize: (size: number) => void;
  setEffectsPanelSize: (size: number) => void;
  setTimelineSize: (size: number) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      showMediaBrowser: true,
      showEffectsPanel: true,
      showTimeline: true,
      zoomLevel: 1,
      activeRegionId: null,
      activeOverlayId: null,
      isDrawingRegion: false,

      mediaBrowserSize: 16,
      effectsPanelSize: 20,
      timelineSize: 25,

      toggleMediaBrowser: () =>
        set((state) => ({ showMediaBrowser: !state.showMediaBrowser })),
      toggleEffectsPanel: () =>
        set((state) => ({ showEffectsPanel: !state.showEffectsPanel })),
      toggleTimeline: () =>
        set((state) => ({ showTimeline: !state.showTimeline })),
      setShowMediaBrowser: (show) => set({ showMediaBrowser: show }),
      setShowEffectsPanel: (show) => set({ showEffectsPanel: show }),
      setShowTimeline: (show) => set({ showTimeline: show }),
      setZoomLevel: (level) => set({ zoomLevel: level }),
      setActiveRegionId: (id) =>
        set({ activeRegionId: id, activeOverlayId: null }),
      setActiveOverlayId: (id) =>
        set({ activeOverlayId: id, activeRegionId: null }),
      setIsDrawingRegion: (isDrawing) => set({ isDrawingRegion: isDrawing }),
      setMediaBrowserSize: (size) => set({ mediaBrowserSize: size }),
      setEffectsPanelSize: (size) => set({ effectsPanelSize: size }),
      setTimelineSize: (size) => set({ timelineSize: size }),
    }),
    {
      name: "erosion-ui-state",
      partialize: (state) => ({
        mediaBrowserSize: state.mediaBrowserSize,
        effectsPanelSize: state.effectsPanelSize,
        timelineSize: state.timelineSize,
      }),
    }
  )
);
