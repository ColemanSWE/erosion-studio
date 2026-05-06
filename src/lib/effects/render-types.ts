import type { Overlay } from "./types";
import type { GLPipeline } from "./gl/pipeline";
import type { FaceBounds, HandBounds, PoseBounds } from "./face-detector";
import type { SourceTransform } from "../project";
import { RenderMode } from "./renderers";

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  buffer: HTMLCanvasElement;
  bufferCtx: CanvasRenderingContext2D;
  source: CanvasImageSource;
  sourceWidth: number;
  sourceHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  tick: number;
  timelineFrames?: ImageData[];
  faceBounds?: FaceBounds[];
  handBounds?: HandBounds[];
  poseBounds?: PoseBounds[];
  isFlipped?: boolean;
  glPipeline?: GLPipeline;
  overlays?: Overlay[];
  getOverlaySource?: (overlayId: string, type: "image" | "video") => CanvasImageSource | null;
  sourceTransform?: SourceTransform;
}

export function computeDrawRect(
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  transform?: SourceTransform,
): { drawX: number; drawY: number; drawWidth: number; drawHeight: number } {
  if (transform?.mode === "fill") {
    const scale = Math.max(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const centerX = (canvasWidth - drawWidth) / 2;
    const centerY = (canvasHeight - drawHeight) / 2;
    const maxPanX = Math.max(0, (drawWidth - canvasWidth) / 2);
    const maxPanY = Math.max(0, (drawHeight - canvasHeight) / 2);
    return {
      drawX: centerX + Math.max(-maxPanX, Math.min(maxPanX, transform.panX)),
      drawY: centerY + Math.max(-maxPanY, Math.min(maxPanY, transform.panY)),
      drawWidth,
      drawHeight,
    };
  }
  const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  return {
    drawX: (canvasWidth - drawWidth) / 2,
    drawY: (canvasHeight - drawHeight) / 2,
    drawWidth,
    drawHeight,
  };
}

export function styleEffectToRenderMode(type: string): RenderMode | "halftone" | "native" {
  switch (type) {
    case "pixelate": return "standard";
    case "emoji": return "emoji";
    case "ascii": return "ascii-color";
    case "matrix": return "matrix";
    case "halftone": return "halftone";
    case "3d-mesh":
    case "3d-sphere":
    case "3d-shatter":
    case "3d-ribbon":
    case "3d-crystal":
      return "native";
    default: return "native";
  }
}
