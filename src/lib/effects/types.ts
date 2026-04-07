export type EffectType =
  | "invert"
  | "glitch"
  | "motion-smear"
  | "block-corrupt"
  | "pixel-sort"
  | "rgb-channel-separation"
  | "dither"
  | "chromatic-aberration"
  | "vignette"
  | "film-grain"
  | "scanlines"
  | "edge-detect"
  | "thermal"
  | "mirror"
  | "bloom"
  | "displacement"
  | "wave-distortion"
  | "twirl"
  | "ripple"
  | "vhs"
  | "crt"
  | "posterize"
  | "solarize"
  | "duotone"
  | "color-shift"
  | "channel-swap"
  | "noise"
  | "pixelate"
  | "emoji"
  | "ascii"
  | "matrix"
  | "halftone"
  | "block-shoving"
  | "datamosh"
  | "3d-mesh"
  | "face-pixelate"
  | "face-blur"
  | "face-color-replace"
  | "face-eye-censor"
  | "face-mouth-censor"
  | "face-landmark-glitch"
  | "screen-tear"
  | "bitcrush"
  | "fragment-glitch"
  | "heavy-distortion"
  | "data-destroy"
  | "melt"
  | "chaos"
  | "perlin-distort"
  | "scan-sweep"
  | "posterize-time"
  | "detection-labels"
  | "blob-track"
  | "jpeg-artifacts"
  | "codec-damage"
  | "rainbow-gradient"
  | "gradient-flash"
  | "xor-blend"
  | "rgb-vertical-xor"
  | "frame-trails"
  | "rgb-color-trails"
  | "strobe-flash"
  | "rgb-strobe"
  | "kaleidoscope"
  | "mirror-blend"
  | "feedback-echo"
  | "frame-delay"
  | "alpha-trails"
  | "square-swap"
  | "contrast"
  | "saturation"
  | "brightness"
  | "exposure"
  | "sepia"
  | "grayscale"
  | "temperature"
  | "tint"
  | "ascii-overlay"
  | "voronoi-mosaic"
  | "contour-lines"
  | "glitch-displacement"
  | "color-quantize"
  | "grid-overlay"
  | "flow-field"
  | "neon-wireframe"
  | "particle-disintegration"
  | "reaction-diffusion"
  | "droste"
  | "slit-scan"
  | "buffer-corrupt"
  | "neon-crush"
  | "line-massacre"
  | "vsync-destroy"
  | "nerve-damage"
  | "vhs-degrade"
  | "holographic"
  | "light-leak"
  | "chrome"
  | "photocopy"
  | "cctv"
  | "prism"
  | "3d-sphere"
  | "3d-shatter"
  | "3d-ribbon"
  | "3d-crystal"
  | "face-forehead-text";

export interface Region {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface Overlay {
  id: string;
  name: string;
  type: "text" | "image" | "video";
  text?: string;
  mediaId?: string; // id of the media item for image/video
  x: number;
  y: number;
  width: number;
  height: number;
  startTime: number;
  endTime: number;
  trackIndex: number; // row in timeline
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  isEffectZone?: boolean; // If true, it acts as a mask and isn't drawn directly
}

export interface Effect {
  id: string;
  type: EffectType;
  active: boolean;
  params: Record<string, unknown>;
  regionId?: string;
  overlayId?: string; // If set, the effect will use this overlay as an alpha mask
  /** Timeline window – if set, effect only runs when currentTime is in [startTime, endTime] */
  startTime?: number;
  endTime?: number;
}

/** A single keyframe value at a point in time */
export interface Keyframe {
  id: string;
  time: number;   // seconds
  value: number;
}

/** Animates a single numeric parameter of an effect over time */
export interface EffectParamTrack {
  id: string;
  effectId: string;
  paramKey: string;
  keyframes: Keyframe[];
}

/** A media clip placed on the timeline */
export interface TimelineClip {
  id: string;
  mediaId: string;
  startTime: number;  // seconds
  endTime: number;
  trackIndex: number; // row (0 = primary)
}

/** A named row on the timeline (media or overlay section) */
export interface TimelineTrack {
  id: string;
  name: string;
  type: "media" | "overlay";
}

export interface EffectParamConfig {
  key: string;
  label: string;
  type: "slider" | "checkbox" | "select" | "color" | "text";
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  options?: string[];
  group?: string;
  placeholder?: string;
}
