import { create } from "zustand";
import type { Effect, EffectType } from "../lib/effects/types";
import { getDefaultParams } from "../lib/effects/types";

interface MediaItem {
  id: string;
  type: "image" | "video";
  name: string;
  path: string;
  thumbnail?: string;
  duration?: number;
}

interface ProjectState {
  projectName: string;
  media: MediaItem[];
  selectedMediaId?: string;
  effects: Effect[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;

  setProjectName: (name: string) => void;
  addMedia: (item: MediaItem) => void;
  removeMedia: (id: string) => void;
  selectMedia: (id: string) => void;

  addEffect: (type: EffectType) => void;
  updateEffect: (id: string, updates: Partial<Effect>) => void;
  removeEffect: (id: string) => void;
  reorderEffect: (id: string, newIndex: number) => void;

  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
}

let effectIdCounter = 0;

export const useProjectStore = create<ProjectState>((set) => ({
  projectName: "Untitled Project",
  media: [],
  selectedMediaId: undefined,
  effects: [],
  currentTime: 0,
  duration: 60,
  isPlaying: false,

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
    })),

  selectMedia: (id) => set({ selectedMediaId: id }),

  addEffect: (type) =>
    set(async (state) => {
      const newEffect = {
        id: `effect-${effectIdCounter++}`,
        type,
        active: true,
        params: getDefaultParams(type),
      };
      
      if (type === "emoji") {
        const { initializeEmojiPalette } = await import("../lib/effects/effects-renderer");
        const palette = (newEffect.params.palette as string) || "standard";
        await initializeEmojiPalette(palette as any);
      }
      
      return {
        effects: [...state.effects, newEffect],
      };
    }),

  updateEffect: (id, updates) =>
    set(async (state) => {
      const effect = state.effects.find((e) => e.id === id);
      
      if (effect?.type === "emoji" && updates.params?.palette) {
        const { initializeEmojiPalette } = await import("../lib/effects/effects-renderer");
        await initializeEmojiPalette(updates.params.palette as any);
      }
      
      return {
        effects: state.effects.map((e) =>
          e.id === id ? { ...e, ...updates } : e
        ),
      };
    }),

  removeEffect: (id) =>
    set((state) => ({
      effects: state.effects.filter((e) => e.id !== id),
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

  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  stop: () => set({ isPlaying: false, currentTime: 0 }),
}));
