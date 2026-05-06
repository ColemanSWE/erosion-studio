import type { Effect, Region, Overlay, TimelineClip, TimelineTrack, EffectParamTrack } from "../lib/effects/types";
import type { MediaItem, Resolution, SourceTransform } from "../lib/project";
import type { MediaSlice } from "./slices/mediaSlice";
import type { EffectsSlice } from "./slices/effectsSlice";
import type { TimelineSlice } from "./slices/timelineSlice";
import type { HistorySlice } from "./slices/historySlice";

export type HistoricalState = {
  effects: Effect[];
  regions: Region[];
  overlays: Overlay[];
  clips: TimelineClip[];
  media: MediaItem[];
  effectParamTracks: EffectParamTrack[];
};

// ProjectIOSlice fields inlined here to avoid circular imports from its file.
type ProjectIOState = {
  projectName: string;
  filePath: string | null;
  isDirty: boolean;
  resolution: Resolution;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
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

export type ProjectState = MediaSlice & EffectsSlice & TimelineSlice & HistorySlice & ProjectIOState;

export type { TimelineTrack };
