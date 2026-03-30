import { create } from "zustand";
import type {
  Effect,
  EffectType,
  Region,
  Overlay,
  TimelineClip,
  TimelineTrack,
  EffectParamTrack,
  Keyframe,
} from "../lib/effects/types";
import type { MediaItem, Resolution } from "../lib/project";
import { DEFAULT_RESOLUTION } from "../lib/project";
import { getEffectDefinition } from "../lib/effects/effect-registry";

function getDefaultParams(type: EffectType): Record<string, unknown> {
  const def = getEffectDefinition(type);
  return def ? { ...def.defaultParams } : {};
}

interface ProjectState {
  projectName: string;
  media: MediaItem[];
  selectedMediaId?: string;
  effects: Effect[];
  regions: Region[];
  overlays: Overlay[];
  resolution: Resolution;
  currentTime: number;
  duration: number;
  isPlaying: boolean;

  /** Timeline clips (media placed on the timeline) */
  clips: TimelineClip[];
  /** Per-effect param animation tracks */
  effectParamTracks: EffectParamTrack[];
  /** Named rows in the media section of the timeline */
  mediaTracks: TimelineTrack[];
  /** Named rows in the overlay section of the timeline */
  overlayTracks: TimelineTrack[];

  setProjectName: (name: string) => void;
  setResolution: (resolution: Resolution) => void;
  addMedia: (item: MediaItem) => void;
  removeMedia: (id: string) => void;
  selectMedia: (id: string) => void;

  addEffect: (type: EffectType, regionId?: string, overlayId?: string) => void;
  updateEffect: (id: string, updates: Partial<Effect>) => void;
  removeEffect: (id: string) => void;
  reorderEffect: (id: string, newIndex: number) => void;

  addRegion: (region: Region) => void;
  removeRegion: (id: string) => void;
  updateRegion: (id: string, updates: Partial<Region>) => void;

  addOverlay: (overlay: Overlay) => void;
  removeOverlay: (id: string) => void;
  updateOverlay: (id: string, updates: Partial<Overlay>) => void;

  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;

  // Timeline clip actions
  addClip: (clip: TimelineClip) => void;
  removeClip: (id: string) => void;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;

  // Media track management
  addMediaTrack: () => void;
  removeMediaTrack: (id: string) => void;
  renameMediaTrack: (id: string, name: string) => void;

  // Overlay track management
  addOverlayTrack: () => void;
  removeOverlayTrack: (id: string) => void;
  renameOverlayTrack: (id: string, name: string) => void;

  // Effect param track actions
  addEffectParamTrack: (track: EffectParamTrack) => void;
  removeEffectParamTrack: (id: string) => void;
  addKeyframe: (trackId: string, keyframe: Keyframe) => void;
  updateKeyframe: (trackId: string, keyframeId: string, updates: Partial<Keyframe>) => void;
  removeKeyframe: (trackId: string, keyframeId: string) => void;

  saveProject: () => Promise<void>;
  loadProject: () => Promise<void>;
}

let effectIdCounter = 0;
let trackIdCounter = 0;

function defaultMediaTrack(): TimelineTrack {
  return { id: `mt-${trackIdCounter++}`, name: "Video", type: "media" };
}
function defaultOverlayTrack(): TimelineTrack {
  return { id: `ot-${trackIdCounter++}`, name: "Overlays", type: "overlay" };
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projectName: "Untitled Project",
  media: [],
  selectedMediaId: undefined,
  effects: [],
  regions: [],
  overlays: [],
  resolution: DEFAULT_RESOLUTION,
  currentTime: 0,
  duration: 10,
  isPlaying: false,
  clips: [],
  effectParamTracks: [],
  mediaTracks: [defaultMediaTrack()],
  overlayTracks: [defaultOverlayTrack()],

  setProjectName: (name) => set({ projectName: name }),
  setResolution: (resolution) => set({ resolution }),

  addMedia: (item) =>
    set((state) => ({
      media: [...state.media, item],
      selectedMediaId: state.selectedMediaId || item.id,
    })),

  removeMedia: (id) =>
    set((state) => {
      const item = state.media.find((m) => m.id === id);
      if (item?.path.startsWith("blob:")) {
        URL.revokeObjectURL(item.path);
      }
      return {
        media: state.media.filter((m) => m.id !== id),
        selectedMediaId:
          state.selectedMediaId === id ? undefined : state.selectedMediaId,
        clips: state.clips.filter((c) => c.mediaId !== id),
      };
    }),

  selectMedia: (id) => set({ selectedMediaId: id }),

  addEffect: (type, regionId, overlayId) => {
    const newEffect: Effect = {
      id: `effect-${effectIdCounter++}`,
      type,
      active: true,
      params: getDefaultParams(type),
      regionId,
      overlayId,
    };

    set((state) => ({
      effects: [...state.effects, newEffect],
    }));

    if (type === "emoji") {
      (async () => {
        try {
          const { initializeEmojiPalette } =
            await import("../lib/effects/effects-renderer");
          const { PALETTES } = await import("../lib/effects/palettes");
          const palette = (newEffect.params.palette as string) || "standard";

          if (palette in PALETTES) {
            await initializeEmojiPalette(palette as any);
          } else {
            console.warn(`Invalid palette "${palette}", using standard`);
            await initializeEmojiPalette("standard");
          }
        } catch (error) {
          console.error("Failed to initialize emoji palette:", error);
        }
      })();
    }
  },

  updateEffect: (id, updates) => {
    set((state) => ({
      effects: state.effects.map((e) =>
        e.id === id ? { ...e, ...updates } : e,
      ),
    }));

    const effect = useProjectStore.getState().effects.find((e) => e.id === id);
    if (
      effect?.type === "emoji" &&
      updates.params &&
      "palette" in updates.params
    ) {
      (async () => {
        try {
          const { initializeEmojiPalette } =
            await import("../lib/effects/effects-renderer");
          const { PALETTES } = await import("../lib/effects/palettes");
          const palette = updates.params!.palette as string;

          if (palette in PALETTES) {
            await initializeEmojiPalette(palette as any);
          } else {
            console.warn(`Invalid palette "${palette}", using standard`);
            await initializeEmojiPalette("standard");
          }
        } catch (error) {
          console.error("Failed to initialize emoji palette:", error);
        }
      })();
    }
  },

  removeEffect: (id) =>
    set((state) => ({
      effects: state.effects.filter((e) => e.id !== id),
      effectParamTracks: state.effectParamTracks.filter((t) => t.effectId !== id),
    })),

  reorderEffect: (id, newIndex) =>
    set((state) => {
      const effects = [...state.effects];
      const oldIndex = effects.findIndex((e) => e.id === id);
      if (oldIndex === -1) return state;

      const [effect] = effects.splice(oldIndex, 1);
      effects.splice(newIndex, 0, effect);

      return { effects };
    }),

  addRegion: (region) =>
    set((state) => ({
      regions: [...state.regions, region],
    })),

  removeRegion: (id) =>
    set((state) => ({
      regions: state.regions.filter((r) => r.id !== id),
      effects: state.effects.filter((e) => e.regionId !== id),
    })),

  updateRegion: (id, updates) =>
    set((state) => ({
      regions: state.regions.map((r) =>
        r.id === id ? { ...r, ...updates } : r,
      ),
    })),

  addOverlay: (overlay) =>
    set((state) => ({
      overlays: [...state.overlays, overlay],
    })),

  removeOverlay: (id) =>
    set((state) => ({
      overlays: state.overlays.filter((o) => o.id !== id),
      effects: state.effects.filter((e) => e.overlayId !== id),
    })),

  updateOverlay: (id, updates) =>
    set((state) => ({
      overlays: state.overlays.map((o) =>
        o.id === id ? { ...o, ...updates } : o,
      ),
    })),

  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  stop: () => set({ isPlaying: false, currentTime: 0 }),

  // Timeline clips
  addClip: (clip) =>
    set((state) => ({ clips: [...state.clips, clip] })),
  removeClip: (id) =>
    set((state) => ({ clips: state.clips.filter((c) => c.id !== id) })),
  updateClip: (id, updates) =>
    set((state) => ({
      clips: state.clips.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    })),

  // Media track management
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
          .map((c) => c.trackIndex > idx ? { ...c, trackIndex: c.trackIndex - 1 } : c),
      };
    }),

  renameMediaTrack: (id, name) =>
    set((state) => ({
      mediaTracks: state.mediaTracks.map((t) => (t.id === id ? { ...t, name } : t)),
    })),

  // Overlay track management
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
          .map((o) => o.trackIndex > idx ? { ...o, trackIndex: o.trackIndex - 1 } : o),
      };
    }),

  renameOverlayTrack: (id, name) =>
    set((state) => ({
      overlayTracks: state.overlayTracks.map((t) => (t.id === id ? { ...t, name } : t)),
    })),

  // Effect param tracks
  addEffectParamTrack: (track) =>
    set((state) => ({ effectParamTracks: [...state.effectParamTracks, track] })),
  removeEffectParamTrack: (id) =>
    set((state) => ({
      effectParamTracks: state.effectParamTracks.filter((t) => t.id !== id),
    })),
  addKeyframe: (trackId, keyframe) =>
    set((state) => ({
      effectParamTracks: state.effectParamTracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              keyframes: [...t.keyframes, keyframe].sort((a, b) => a.time - b.time),
            }
          : t,
      ),
    })),
  updateKeyframe: (trackId, keyframeId, updates) =>
    set((state) => ({
      effectParamTracks: state.effectParamTracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              keyframes: t.keyframes
                .map((k) => (k.id === keyframeId ? { ...k, ...updates } : k))
                .sort((a, b) => a.time - b.time),
            }
          : t,
      ),
    })),
  removeKeyframe: (trackId, keyframeId) =>
    set((state) => ({
      effectParamTracks: state.effectParamTracks.map((t) =>
        t.id === trackId
          ? { ...t, keyframes: t.keyframes.filter((k) => k.id !== keyframeId) }
          : t,
      ),
    })),

  saveProject: async () => {
    const state = get();
    const result = await window.electron.saveFile({
      title: "Save Project",
      defaultPath: `${state.projectName || "project"}.eron`,
      filters: [{ name: "Erosion Project", extensions: ["eron"] }],
    });
    if (result.canceled || !result.filePath) return;

    const projectData = {
      version: 1,
      projectName: state.projectName,
      resolution: state.resolution,
      duration: state.duration,
      media: state.media,
      effects: state.effects,
      regions: state.regions,
      overlays: state.overlays,
      clips: state.clips,
      effectParamTracks: state.effectParamTracks,
      mediaTracks: state.mediaTracks,
      overlayTracks: state.overlayTracks,
    };

    const res = await window.electron.file.writeText(
      result.filePath,
      JSON.stringify(projectData, null, 2),
    );
    if (!res.success) {
      console.error("Failed to save project:", res.error);
    }
  },

  loadProject: async () => {
    const result = await window.electron.openFile({
      title: "Open Project",
      filters: [{ name: "Erosion Project", extensions: ["eron"] }],
    });
    if (result.canceled || !result.filePaths.length) return;

    const res = await window.electron.file.readText(result.filePaths[0]);
    if (!res.success || !res.data) {
      console.error("Failed to load project:", res.error);
      return;
    }

    try {
      const projectData = JSON.parse(res.data);
      const currentState = get();
      for (const m of currentState.media) {
        if (m.path.startsWith("blob:")) {
          URL.revokeObjectURL(m.path);
        }
      }

      const loadedClips: TimelineClip[] = projectData.clips || [];
      const loadedOverlays: Overlay[] = projectData.overlays || [];

      // Migrate: if no saved tracks, auto-create enough rows to cover existing clips/overlays
      let loadedMediaTracks: TimelineTrack[] = projectData.mediaTracks || [];
      if (loadedMediaTracks.length === 0) {
        const maxIdx = loadedClips.reduce((m: number, c: TimelineClip) => Math.max(m, c.trackIndex), 0);
        loadedMediaTracks = Array.from({ length: Math.max(1, maxIdx + 1) }, (_, i) => ({
          id: `mt-${trackIdCounter++}`,
          name: i === 0 ? "Video" : `Track ${i + 1}`,
          type: "media" as const,
        }));
      }

      let loadedOverlayTracks: TimelineTrack[] = projectData.overlayTracks || [];
      if (loadedOverlayTracks.length === 0) {
        const maxIdx = loadedOverlays.reduce((m: number, o: Overlay) => Math.max(m, o.trackIndex), 0);
        loadedOverlayTracks = Array.from({ length: Math.max(1, maxIdx + 1) }, (_, i) => ({
          id: `ot-${trackIdCounter++}`,
          name: i === 0 ? "Overlays" : `Overlay ${i + 1}`,
          type: "overlay" as const,
        }));
      }

      set({
        projectName: projectData.projectName || "Untitled Project",
        resolution: projectData.resolution || DEFAULT_RESOLUTION,
        duration: projectData.duration || 10,
        media: projectData.media || [],
        effects: projectData.effects || [],
        regions: projectData.regions || [],
        overlays: loadedOverlays,
        clips: loadedClips,
        effectParamTracks: projectData.effectParamTracks || [],
        mediaTracks: loadedMediaTracks,
        overlayTracks: loadedOverlayTracks,

        currentTime: 0,
        isPlaying: false,
        selectedMediaId: undefined,
      });

      const effects = projectData.effects || [];
      for (const effect of effects) {
        if (effect.type === "emoji") {
          try {
            const { initializeEmojiPalette } = await import(
              "../lib/effects/effects-renderer"
            );
            const { PALETTES } = await import("../lib/effects/palettes");
            const palette = (effect.params?.palette as string) || "standard";
            if (palette in PALETTES) {
              await initializeEmojiPalette(palette as any);
            } else {
              await initializeEmojiPalette("standard");
            }
          } catch (e) {
            console.error("Failed to re-initialize emoji palette:", e);
          }
        }
      }
    } catch (e) {
      console.error("Failed to parse project file:", e);
    }
  },
}));
