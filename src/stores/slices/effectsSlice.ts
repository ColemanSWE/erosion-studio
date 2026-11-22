import type { StateCreator } from "zustand";
import type { Effect, EffectType, EffectParamTrack, Keyframe } from "../../lib/effects/types";
import type { PaletteKey } from "../../lib/effects/palettes";
import { getEffectDefinition } from "../../lib/effects/effect-registry";
import type { ProjectState } from "../projectState";
import { withHistory } from "../projectUtils";

function getDefaultParams(type: EffectType): Record<string, unknown> {
  const def = getEffectDefinition(type);
  return def ? { ...def.defaultParams } : {};
}

async function initEmoji(params: Record<string, unknown>) {
  try {
    const { initializeEmojiPalette } = await import("../../lib/effects/effects-renderer");
    const { PALETTES } = await import("../../lib/effects/palettes");
    const palette = (params.palette as string) || "standard";
    if (palette in PALETTES) {
      await initializeEmojiPalette(palette as PaletteKey);
    } else {
      await initializeEmojiPalette("standard");
    }
  } catch (e) {
    console.error("Failed to initialize emoji palette:", e);
  }
}

export type EffectsSlice = {
  effects: Effect[];
  effectParamTracks: EffectParamTrack[];
  addEffect: (type: EffectType, regionId?: string, overlayId?: string) => void;
  updateEffect: (id: string, updates: Partial<Effect>) => void;
  removeEffect: (id: string) => void;
  reorderEffect: (id: string, newIndex: number) => void;
  addEffectParamTrack: (track: EffectParamTrack) => void;
  removeEffectParamTrack: (id: string) => void;
  addKeyframe: (trackId: string, keyframe: Keyframe) => void;
  updateKeyframe: (trackId: string, keyframeId: string, updates: Partial<Keyframe>) => void;
  removeKeyframe: (trackId: string, keyframeId: string) => void;
};

export const createEffectsSlice: StateCreator<ProjectState, [], [], EffectsSlice> = (set, get) => ({
  effects: [],
  effectParamTracks: [],

  addEffect: (type, regionId, overlayId) => {
    const newEffect: Effect = {
      id: crypto.randomUUID(),
      type,
      active: true,
      params: getDefaultParams(type),
      regionId,
      overlayId,
    };
    set((state) => ({ ...withHistory(state), effects: [...state.effects, newEffect] }));
    if (type === "emoji") initEmoji(newEffect.params);
  },

  updateEffect: (id, updates) => {
    set((state) => ({
      ...withHistory(state, `effect:${id}`),
      effects: state.effects.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    }));
    const effect = get().effects.find((e) => e.id === id);
    if (effect?.type === "emoji" && updates.params && "palette" in updates.params) {
      initEmoji(updates.params!);
    }
  },

  removeEffect: (id) =>
    set((state) => ({
      ...withHistory(state),
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
      return { ...withHistory(state), effects };
    }),

  addEffectParamTrack: (track) =>
    set((state) => ({
      ...withHistory(state),
      effectParamTracks: [...state.effectParamTracks, track],
    })),

  removeEffectParamTrack: (id) =>
    set((state) => ({
      ...withHistory(state),
      effectParamTracks: state.effectParamTracks.filter((t) => t.id !== id),
    })),

  addKeyframe: (trackId, keyframe) =>
    set((state) => ({
      ...withHistory(state),
      effectParamTracks: state.effectParamTracks.map((t) =>
        t.id === trackId
          ? { ...t, keyframes: [...t.keyframes, keyframe].sort((a, b) => a.time - b.time) }
          : t,
      ),
    })),

  updateKeyframe: (trackId, keyframeId, updates) =>
    set((state) => ({
      ...withHistory(state, `keyframe:${keyframeId}`),
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
      ...withHistory(state),
      effectParamTracks: state.effectParamTracks.map((t) =>
        t.id === trackId
          ? { ...t, keyframes: t.keyframes.filter((k) => k.id !== keyframeId) }
          : t,
      ),
    })),
});
