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
  | "jpeg-artifacts"
  | "codec-damage";

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
}

export function getDefaultParams(type: EffectType): Record<string, unknown> {
  switch (type) {
    case "invert":
      return {};
    case "glitch":
      return { intensity: 50, speed: 10 };
    case "motion-smear":
      return { mode: "melt", intensity: 70, momentum: 0.92, mediaSources: [] };
    case "block-corrupt":
      return { intensity: 30, blockSize: 16 };
    case "pixel-sort":
      return { threshold: 50, direction: "horizontal" };
    case "rgb-channel-separation":
      return { rOffset: 5, gOffset: 0, bOffset: -5 };
    case "dither":
      return { depth: 4 };
    case "chromatic-aberration":
      return { offset: 5 };
    case "vignette":
      return { intensity: 0.5, radius: 0.8 };
    case "film-grain":
      return { intensity: 30 };
    case "scanlines":
      return { spacing: 3, opacity: 0.4 };
    case "edge-detect":
      return { threshold: 50, invert: false };
    case "thermal":
      return { palette: "thermal" };
    case "mirror":
      return { mode: "horizontal" };
    case "bloom":
      return { threshold: 200, intensity: 0.5, radius: 3 };
    case "displacement":
      return { scale: 20, animated: true };
    case "wave-distortion":
      return {
        amplitude: 10,
        frequency: 0.1,
        direction: "horizontal",
        animated: true,
      };
    case "twirl":
      return { angle: 0.5, radius: 0.5 };
    case "ripple":
      return { amplitude: 20, frequency: 0.05, centerX: 0.5, centerY: 0.5 };
    case "vhs":
      return { intensity: 50 };
    case "crt":
      return { curvature: 0.2, scanlines: 0.3 };
    case "posterize":
      return { levels: 8 };
    case "solarize":
      return { threshold: 128 };
    case "duotone":
      return { color1: "#000000", color2: "#00ff88" };
    case "color-shift":
      return { speed: 1 };
    case "channel-swap":
      return { swap: "rg" };
    case "noise":
      return { intensity: 20, colored: false };
    case "pixelate":
      return { density: 64 };
    case "emoji":
      return { density: 48, palette: "standard" };
    case "ascii":
      return { density: 80, colored: true };
    case "matrix":
      return { density: 64 };
    case "halftone":
      return { density: 48, dotScale: 1.0 };
    case "block-shoving":
      return {
        style: "block",
        intensity: 50,
        blockSize: 16,
        mediaSources: [],
        lastUpdate: 0,
        activeSource: -1,
      };
    case "datamosh":
      return {
        intensity: 50,
        mediaSources: [],
        lastUpdate: 0,
        activeSource: -1,
      };
    case "3d-mesh":
      return {
        displacementScale: 3,
        wireframe: true,
        mode: "mesh",
        pointSize: 0.08,
        density: 2,
      };
    case "face-pixelate":
      return { blockSize: 16 };
    case "face-blur":
      return { radius: 20 };
    case "face-color-replace":
      return { mode: "solid", color: "#ff00ff" };
    case "face-eye-censor":
      return { style: "solid", color: "#000000", thickness: 1.5 };
    case "face-mouth-censor":
      return { style: "solid", color: "#000000", thickness: 1.2 };
    case "face-landmark-glitch":
      return { intensity: 50, lineCount: 15, color: "#00ff88" };
    case "screen-tear":
      return { intensity: 50, count: 3, offset: 20 };
    case "bitcrush":
      return { bits: 4, intensity: 50 };
    case "fragment-glitch":
      return { intensity: 50, fragmentSize: 8 };
    case "heavy-distortion":
      return { intensity: 50, frequency: 0.15, speed: 2 };
    case "data-destroy":
      return { intensity: 50, corruption: 30 };
    case "melt":
      return { intensity: 50, direction: "down" };
    case "chaos":
      return { intensity: 50, layers: 3 };
    case "perlin-distort":
      return { intensity: 50, scale: 0.01, speed: 1 };
    case "scan-sweep":
      return { speed: 2, count: 3, thickness: 2, direction: "vertical" };
    case "posterize-time":
      return { fps: 12 };
    case "detection-labels":
      return {
        showFaces: true,
        showHands: true,
        showPose: true,
        labelSize: 14,
        boxThickness: 2,
        showConfidence: false,
      };
    case "jpeg-artifacts":
      return {
        quality: 30,
        blockiness: 50,
        colorBanding: 50,
      };
    case "codec-damage":
      return {
        intensity: 50,
        blockSize: 16,
        colorBleed: 50,
        temporal: true,
      };
    default:
      return {};
  }
}
