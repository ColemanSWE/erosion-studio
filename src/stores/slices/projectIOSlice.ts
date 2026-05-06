import type { StateCreator } from "zustand";
import type { Effect, Region, Overlay, TimelineClip, TimelineTrack, EffectParamTrack } from "../../lib/effects/types";
import type { MediaItem, Resolution, SourceTransform } from "../../lib/project";
import { DEFAULT_RESOLUTION, DEFAULT_SOURCE_TRANSFORM } from "../../lib/project";
import type { PaletteKey } from "../../lib/effects/palettes";
import type { ProjectState } from "../projectState";
import { defaultMediaTrack, defaultOverlayTrack } from "./timelineSlice";

export type ProjectIOSlice = {
  projectName: string;
  filePath: string | null;
  isDirty: boolean;
  resolution: Resolution;
  currentTime: number;
  duration: number;
  isPlaying: number; // kept as number to satisfy TS (actually boolean)
  sourceTransform: SourceTransform;

  setProjectName: (name: string) => void;
  setResolution: (resolution: Resolution) => void;
  setSourceTransform: (transform: SourceTransform) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;

  saveProject: () => Promise<void>;
  saveProjectAs: () => Promise<void>;
  loadProject: (filePath?: string) => Promise<void>;
  newProject: (name?: string) => void;
  _writeProject: (filePath: string) => Promise<void>;
};

export const createProjectIOSlice: StateCreator<ProjectState, [], [], Omit<ProjectIOSlice, "isPlaying"> & { isPlaying: boolean }> = (set, get) => ({
  projectName: "Untitled Project",
  filePath: null,
  isDirty: false,
  resolution: DEFAULT_RESOLUTION,
  currentTime: 0,
  duration: 10,
  isPlaying: false,
  sourceTransform: DEFAULT_SOURCE_TRANSFORM,

  setProjectName: (name) => set({ projectName: name, isDirty: true }),
  setResolution: (resolution) => set({ resolution }),
  setSourceTransform: (transform) => set({ sourceTransform: transform }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  stop: () => set({ isPlaying: false, currentTime: 0 }),

  saveProject: async () => {
    const state = get();
    let targetPath = state.filePath;
    if (!targetPath) {
      const { useAppStore } = await import("../appStore");
      const projectsDirectory = useAppStore.getState().projectsDirectory;
      const defaultPath = projectsDirectory
        ? `${projectsDirectory}/${state.projectName || "project"}.eron`
        : `${state.projectName || "project"}.eron`;
      const result = await window.electron.saveFile({
        title: "Save Project",
        defaultPath,
        filters: [{ name: "Erosion Project", extensions: ["eron"] }],
      });
      if (result.canceled || !result.filePath) return;
      targetPath = result.filePath;
    }
    await get()._writeProject(targetPath);
  },

  saveProjectAs: async () => {
    const state = get();
    const { useAppStore } = await import("../appStore");
    const projectsDirectory = useAppStore.getState().projectsDirectory;
    const defaultPath = projectsDirectory
      ? `${projectsDirectory}/${state.projectName || "project"}.eron`
      : `${state.projectName || "project"}.eron`;
    const result = await window.electron.saveFile({
      title: "Save Project As",
      defaultPath,
      filters: [{ name: "Erosion Project", extensions: ["eron"] }],
    });
    if (result.canceled || !result.filePath) return;
    await get()._writeProject(result.filePath);
  },

  _writeProject: async (targetPath: string) => {
    const state = get();
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
      sourceTransform: state.sourceTransform,
    };
    const res = await window.electron.file.writeText(targetPath, JSON.stringify(projectData, null, 2));
    if (!res.success) {
      console.error("Failed to save project:", res.error);
      return;
    }
    set({ filePath: targetPath, isDirty: false });
    const { useAppStore } = await import("../appStore");
    useAppStore.getState().addRecentProject({ name: state.projectName, path: targetPath, lastOpened: Date.now() });
  },

  newProject: (name = "Untitled Project") => {
    const state = get();
    for (const m of state.media) {
      if (m.path.startsWith("blob:")) URL.revokeObjectURL(m.path);
    }
    set({
      projectName: name,
      filePath: null,
      isDirty: false,
      media: [],
      selectedMediaId: undefined,
      effects: [],
      regions: [],
      overlays: [],
      resolution: DEFAULT_RESOLUTION,
      duration: 10,
      currentTime: 0,
      isPlaying: false,
      clips: [],
      effectParamTracks: [],
      mediaTracks: [defaultMediaTrack()],
      overlayTracks: [defaultOverlayTrack()],
      sourceTransform: DEFAULT_SOURCE_TRANSFORM,
      _historyPast: [],
      _historyFuture: [],
    });
  },

  loadProject: async (filePath?: string) => {
    try {
      let resolvedPath = filePath;
      if (!resolvedPath) {
        const result = await window.electron.openFile({
          title: "Open Project",
          properties: ["openFile"],
          filters: [{ name: "Erosion Project", extensions: ["eron"] }],
        });
        if (result.canceled || !result.filePaths.length) return;
        resolvedPath = result.filePaths[0];
      }

      const res = await window.electron.file.readText(resolvedPath);
      if (!res.success || !res.data) {
        console.error("Failed to load project:", res.error);
        return;
      }

      const projectData = JSON.parse(res.data) as Record<string, unknown>;
      const currentState = get();
      for (const m of currentState.media) {
        if (m.path.startsWith("blob:")) URL.revokeObjectURL(m.path);
      }

      const loadedClips: TimelineClip[] = (projectData.clips as TimelineClip[]) || [];
      const loadedOverlays: Overlay[] = (projectData.overlays as Overlay[]) || [];

      let loadedMediaTracks: TimelineTrack[] = (projectData.mediaTracks as TimelineTrack[]) || [];
      if (loadedMediaTracks.length === 0) {
        const maxIdx = loadedClips.reduce((m: number, c: TimelineClip) => Math.max(m, c.trackIndex), 0);
        loadedMediaTracks = Array.from({ length: Math.max(1, maxIdx + 1) }, (_, i) => ({
          id: `mt-auto-${i}`,
          name: i === 0 ? "Video" : `Track ${i + 1}`,
          type: "media" as const,
        }));
      }

      let loadedOverlayTracks: TimelineTrack[] = (projectData.overlayTracks as TimelineTrack[]) || [];
      if (loadedOverlayTracks.length === 0) {
        const maxIdx = loadedOverlays.reduce((m: number, o: Overlay) => Math.max(m, o.trackIndex), 0);
        loadedOverlayTracks = Array.from({ length: Math.max(1, maxIdx + 1) }, (_, i) => ({
          id: `ot-auto-${i}`,
          name: i === 0 ? "Overlays" : `Overlay ${i + 1}`,
          type: "overlay" as const,
        }));
      }

      const loadedName = (projectData.projectName as string) || "Untitled Project";
      set({
        projectName: loadedName,
        filePath: resolvedPath,
        isDirty: false,
        resolution: (projectData.resolution as Resolution) || DEFAULT_RESOLUTION,
        duration: (projectData.duration as number) || 10,
        media: (projectData.media as MediaItem[]) || [],
        effects: (projectData.effects as Effect[]) || [],
        regions: (projectData.regions as Region[]) || [],
        overlays: loadedOverlays,
        clips: loadedClips,
        effectParamTracks: (projectData.effectParamTracks as EffectParamTrack[]) || [],
        mediaTracks: loadedMediaTracks,
        overlayTracks: loadedOverlayTracks,
        sourceTransform: (projectData.sourceTransform as SourceTransform) || DEFAULT_SOURCE_TRANSFORM,
        currentTime: 0,
        isPlaying: false,
        selectedMediaId: undefined,
        _historyPast: [],
        _historyFuture: [],
      });

      const { useAppStore } = await import("../appStore");
      useAppStore.getState().addRecentProject({ name: loadedName, path: resolvedPath, lastOpened: Date.now() });

      const effects = (projectData.effects as Effect[]) || [];
      for (const effect of effects) {
        if (effect.type === "emoji") {
          try {
            const { initializeEmojiPalette } = await import("../../lib/effects/effects-renderer");
            const { PALETTES } = await import("../../lib/effects/palettes");
            const palette = (effect.params?.palette as string) || "standard";
            await initializeEmojiPalette((palette in PALETTES ? palette : "standard") as PaletteKey);
          } catch (e) {
            console.error("Failed to re-initialize emoji palette:", e);
          }
        }
      }
    } catch (e) {
      console.error("Failed to open project:", e);
    }
  },
});
