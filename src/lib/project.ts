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

export interface SourceTransform {
  mode: "fit" | "fill";
  panX: number;
  panY: number;
}

export const DEFAULT_SOURCE_TRANSFORM: SourceTransform = {
  mode: "fit",
  panX: 0,
  panY: 0,
};



