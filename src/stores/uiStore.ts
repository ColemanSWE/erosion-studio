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
  effectsSplitSize: number;

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
  setEffectsSplitSize: (size: number) => void;
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

      mediaBrowserSize: 22,
      effectsPanelSize: 30,
      timelineSize: 35,
      effectsSplitSize: 50,

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
      setEffectsSplitSize: (size) => set({ effectsSplitSize: size }),
    }),
    {
      name: "erosion-ui-state",
      version: 2,
      partialize: (state) => ({
        mediaBrowserSize: state.mediaBrowserSize,
        effectsPanelSize: state.effectsPanelSize,
        timelineSize: state.timelineSize,
        effectsSplitSize: state.effectsSplitSize,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<UIState>;
        return {
          ...current,
          mediaBrowserSize: Math.max(12, p.mediaBrowserSize ?? current.mediaBrowserSize),
          effectsPanelSize: Math.max(14, p.effectsPanelSize ?? current.effectsPanelSize),
          timelineSize: Math.max(12, p.timelineSize ?? current.timelineSize),
          effectsSplitSize: Math.min(90, Math.max(10, p.effectsSplitSize ?? current.effectsSplitSize)),
        };
      },
    }
  )
);
