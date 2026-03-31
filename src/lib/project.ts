import type { Effect, Region, Overlay } from "./effects/types";

export interface MediaItem {
  id: string;
  type: "image" | "video" | "camera";
  name: string;
  path: string;
  thumbnail?: string;
  duration?: number;
}

export interface Resolution {
  width: number;
  height: number;
  name: string;
}

export const PREDEFINED_RESOLUTIONS: Resolution[] = [
  { width: 1920, height: 1080, name: "16:9 Landscape" },
  { width: 1080, height: 1920, name: "9:16 TikTok / Reels" },
  { width: 1080, height: 1080, name: "1:1 Square" },
  { width: 1080, height: 1350, name: "4:5 Instagram" },
];

export const DEFAULT_RESOLUTION = PREDEFINED_RESOLUTIONS[0];

export interface Project {
  name: string;
  media: MediaItem[];
  effects: Effect[];
  regions: Region[];
  overlays: Overlay[];
  resolution: Resolution;
  duration: number;
  currentTime: number;
  version: string;
}

export function createEmptyProject(): Project {
  return {
    name: "Untitled Project",
    media: [],
    effects: [],
    regions: [],
    overlays: [],
    resolution: DEFAULT_RESOLUTION,
    duration: 60,
    currentTime: 0,
    version: "1.0",
  };
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function deserializeProject(json: string): Project {
  const data = JSON.parse(json);

  return {
    name: data.name || "Untitled Project",
    media: data.media || [],
    effects: data.effects || [],
    regions: data.regions || [],
    overlays: data.overlays || [],
    resolution: data.resolution || DEFAULT_RESOLUTION,
    duration: data.duration || 60,
    currentTime: data.currentTime || 0,
    version: data.version || "1.0",
  };
}

