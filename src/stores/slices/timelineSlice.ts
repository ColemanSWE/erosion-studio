import type { StateCreator } from "zustand";
import type { Region, Overlay, TimelineClip, TimelineTrack } from "../../lib/effects/types";
import type { ProjectState } from "../projectState";
import { withHistory } from "../projectUtils";

let trackIdCounter = 0;

export function defaultMediaTrack(): TimelineTrack {
  return { id: `mt-${trackIdCounter++}`, name: "Video", type: "media" };
}
export function defaultOverlayTrack(): TimelineTrack {
  return { id: `ot-${trackIdCounter++}`, name: "Overlays", type: "overlay" };
}

export type TimelineSlice = {
  clips: TimelineClip[];
  regions: Region[];
  overlays: Overlay[];
  mediaTracks: TimelineTrack[];
  overlayTracks: TimelineTrack[];

  addClip: (clip: TimelineClip) => void;
  removeClip: (id: string) => void;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;

  addRegion: (region: Region) => void;
  removeRegion: (id: string) => void;
  updateRegion: (id: string, updates: Partial<Region>) => void;

  addOverlay: (overlay: Overlay) => void;
  removeOverlay: (id: string) => void;
  updateOverlay: (id: string, updates: Partial<Overlay>) => void;

  addMediaTrack: () => void;
  removeMediaTrack: (id: string) => void;
  renameMediaTrack: (id: string, name: string) => void;

  addOverlayTrack: () => void;
  removeOverlayTrack: (id: string) => void;
  renameOverlayTrack: (id: string, name: string) => void;
};

export const createTimelineSlice: StateCreator<ProjectState, [], [], TimelineSlice> = (set) => ({
  clips: [],
  regions: [],
  overlays: [],
  mediaTracks: [defaultMediaTrack()],
  overlayTracks: [defaultOverlayTrack()],

  addClip: (clip) =>
    set((state) => ({ ...withHistory(state), clips: [...state.clips, clip] })),

  removeClip: (id) =>
    set((state) => ({ ...withHistory(state), clips: state.clips.filter((c) => c.id !== id) })),

  updateClip: (id, updates) =>
    set((state) => ({
      ...withHistory(state),
      clips: state.clips.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    })),

  addRegion: (region) =>
    set((state) => ({ ...withHistory(state), regions: [...state.regions, region] })),

  removeRegion: (id) =>
    set((state) => ({
      ...withHistory(state),
      regions: state.regions.filter((r) => r.id !== id),
      effects: state.effects.filter((e) => e.regionId !== id),
    })),

  updateRegion: (id, updates) =>
    set((state) => ({
      regions: state.regions.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    })),

  addOverlay: (overlay) =>
    set((state) => ({ ...withHistory(state), overlays: [...state.overlays, overlay] })),

  removeOverlay: (id) =>
    set((state) => ({
      ...withHistory(state),
      overlays: state.overlays.filter((o) => o.id !== id),
      effects: state.effects.filter((e) => e.overlayId !== id),
    })),

  updateOverlay: (id, updates) =>
    set((state) => ({
      overlays: state.overlays.map((o) => (o.id === id ? { ...o, ...updates } : o)),
    })),

  addMediaTrack: () =>
    set((state) => ({
      mediaTracks: [
        ...state.mediaTracks,
        { id: `mt-${trackIdCounter++}`, name: `Track ${state.mediaTracks.length + 1}`, type: "media" as const },
      ],
    })),

  removeMediaTrack: (id) =>
    set((state) => {
      if (state.mediaTracks.length <= 1) return state;
      const idx = state.mediaTracks.findIndex((t) => t.id === id);
      if (idx === -1) return state;
      return {
        mediaTracks: state.mediaTracks.filter((t) => t.id !== id),
        clips: state.clips
          .filter((c) => c.trackIndex !== idx)
          .map((c) => (c.trackIndex > idx ? { ...c, trackIndex: c.trackIndex - 1 } : c)),
      };
    }),

  renameMediaTrack: (id, name) =>
    set((state) => ({
      mediaTracks: state.mediaTracks.map((t) => (t.id === id ? { ...t, name } : t)),
    })),

  addOverlayTrack: () =>
    set((state) => ({
      overlayTracks: [
        ...state.overlayTracks,
        { id: `ot-${trackIdCounter++}`, name: `Overlay ${state.overlayTracks.length + 1}`, type: "overlay" as const },
      ],
    })),

  removeOverlayTrack: (id) =>
    set((state) => {
      if (state.overlayTracks.length <= 1) return state;
      const idx = state.overlayTracks.findIndex((t) => t.id === id);
      if (idx === -1) return state;
      return {
        overlayTracks: state.overlayTracks.filter((t) => t.id !== id),
        overlays: state.overlays
          .filter((o) => o.trackIndex !== idx)
          .map((o) => (o.trackIndex > idx ? { ...o, trackIndex: o.trackIndex - 1 } : o)),
      };
    }),

  renameOverlayTrack: (id, name) =>
    set((state) => ({
      overlayTracks: state.overlayTracks.map((t) => (t.id === id ? { ...t, name } : t)),
    })),
});
