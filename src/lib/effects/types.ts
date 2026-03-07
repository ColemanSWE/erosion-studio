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
  | "tint";

export interface Region {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface Effect {
  id: string;
  type: EffectType;
  active: boolean;
  params: Record<string, unknown>;
  regionId?: string;
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

export interface EffectParamConfig {
  key: string;
  label: string;
  type: "slider" | "checkbox" | "select" | "color";
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  options?: string[];
}
