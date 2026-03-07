import { create } from "zustand";
import type {
  Effect,
  EffectType,
  Region,
  TimelineClip,
  EffectParamTrack,
  Keyframe,
} from "../lib/effects/types";
import type { MediaItem } from "../lib/project";
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
  currentTime: number;
  duration: number;
  isPlaying: boolean;

  /** Timeline clips (media placed on the timeline) */
  clips: TimelineClip[];
  /** Per-effect param animation tracks */
  effectParamTracks: EffectParamTrack[];

  setProjectName: (name: string) => void;
  addMedia: (item: MediaItem) => void;
  removeMedia: (id: string) => void;
  selectMedia: (id: string) => void;

  addEffect: (type: EffectType, regionId?: string) => void;
  updateEffect: (id: string, updates: Partial<Effect>) => void;
  removeEffect: (id: string) => void;
  reorderEffect: (id: string, newIndex: number) => void;

  addRegion: (region: Region) => void;
  removeRegion: (id: string) => void;
  updateRegion: (id: string, updates: Partial<Region>) => void;

  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;

  // Timeline clip actions
  addClip: (clip: TimelineClip) => void;
  removeClip: (id: string) => void;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;

  // Effect param track actions
  addEffectParamTrack: (track: EffectParamTrack) => void;
  removeEffectParamTrack: (id: string) => void;
  addKeyframe: (trackId: string, keyframe: Keyframe) => void;
  updateKeyframe: (trackId: string, keyframeId: string, updates: Partial<Keyframe>) => void;
  removeKeyframe: (trackId: string, keyframeId: string) => void;
}

let effectIdCounter = 0;

export const useProjectStore = create<ProjectState>((set) => ({
  projectName: "Untitled Project",
  media: [],
  selectedMediaId: undefined,
  effects: [],
  regions: [],
  currentTime: 0,
  duration: 60,
  isPlaying: false,
  clips: [],
  effectParamTracks: [],

  setProjectName: (name) => set({ projectName: name }),

  addMedia: (item) =>
    set((state) => ({
      media: [...state.media, item],
      selectedMediaId: state.selectedMediaId || item.id,
    })),

  removeMedia: (id) =>
    set((state) => ({
      media: state.media.filter((m) => m.id !== id),
      selectedMediaId:
        state.selectedMediaId === id ? undefined : state.selectedMediaId,
      clips: state.clips.filter((c) => c.mediaId !== id),
    })),

  selectMedia: (id) => set({ selectedMediaId: id }),

  addEffect: (type, regionId) => {
    const newEffect = {
      id: `effect-${effectIdCounter++}`,
      type,
      active: true,
      params: getDefaultParams(type),
      regionId,
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
}));
