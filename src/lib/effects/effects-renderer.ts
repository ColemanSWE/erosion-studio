import { Effect } from "./types";
import {
  applyEffects,
  isStyleEffect,
  getProcessingEffects,
} from "./effect-registry";
import { renderFrame, RenderMode } from "./renderers";
import { emojiMap } from "./emoji-map";
import { PALETTES, PaletteKey } from "./palettes";

import "./processors";

import { FaceBounds, HandBounds, PoseBounds } from "./face-detector";

interface RenderContext {
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
}

export function getActiveStyleEffect(effects: Effect[]): Effect | null {
  for (let i = effects.length - 1; i >= 0; i--) {
    const effect = effects[i];
    if (effect.active && isStyleEffect(effect.type)) {
      return effect;
    }
  }
  return null;
}

function styleEffectToRenderMode(type: string): RenderMode | "halftone" {
  switch (type) {
    case "pixelate":
      return "standard";
    case "emoji":
      return "emoji";
    case "ascii":
      return "ascii-color";
    case "matrix":
      return "matrix";
    case "halftone":
      return "halftone";
    default:
      return "native";
  }
}

export async function initializeEmojiPalette(
  paletteKey: PaletteKey
): Promise<void> {
  const palette = PALETTES[paletteKey];
  if (!palette) {
    console.error(`Invalid palette key: ${paletteKey}, using standard`);
    await emojiMap.generatePalette(PALETTES.standard.emojis);
    return;
  }
  await emojiMap.generatePalette(palette.emojis);
}

export function renderWithEffects(
  context: RenderContext,
  effects: Effect[]
): void {
  const {
    ctx,
    buffer,
    bufferCtx,
    source,
    sourceWidth,
    sourceHeight,
    canvasWidth,
    canvasHeight,
    tick,
  } = context;

  const activeStyle = getActiveStyleEffect(effects);

  if (!activeStyle) {
    const processingEffects = getProcessingEffects(effects);
    const scale = Math.min(
      canvasWidth / sourceWidth,
      canvasHeight / sourceHeight
    );
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const drawX = (canvasWidth - drawWidth) / 2;
    const drawY = (canvasHeight - drawHeight) / 2;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    if (processingEffects.length > 0) {
      buffer.width = sourceWidth;
      buffer.height = sourceHeight;
      bufferCtx.drawImage(source, 0, 0, sourceWidth, sourceHeight);
      const imageData = bufferCtx.getImageData(0, 0, sourceWidth, sourceHeight);

      applyEffects(imageData.data, processingEffects, {
        width: sourceWidth,
        height: sourceHeight,
        time: tick,
        timelineFrames: context.timelineFrames,
        faceBounds: context.faceBounds,
        handBounds: context.handBounds,
        poseBounds: context.poseBounds,
      });

      bufferCtx.putImageData(imageData, 0, 0);
      ctx.drawImage(buffer, drawX, drawY, drawWidth, drawHeight);
    } else {
      ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
    }
    return;
  }

  const styleEffectIndex = effects.findIndex((e) => e.id === activeStyle.id);
  const preStyleEffects = effects
    .slice(0, styleEffectIndex)
    .filter((e) => e.active && !isStyleEffect(e.type));
  const postStyleEffects = effects
    .slice(styleEffectIndex + 1)
    .filter((e) => e.active && !isStyleEffect(e.type));

  const density = (activeStyle.params.density as number) || 64;
  const renderMode = styleEffectToRenderMode(activeStyle.type);

  const aspect = sourceHeight / sourceWidth;
  const charAspect = renderMode === "emoji" ? 1.0 : 0.6;
  const cols = density;
  const rows = Math.floor(cols * aspect * charAspect);

  const fontSize = Math.floor(
    Math.min(canvasWidth / cols, canvasHeight / rows)
  );

  buffer.width = cols;
  buffer.height = rows;
  bufferCtx.drawImage(source, 0, 0, cols, rows);

  const imageData = bufferCtx.getImageData(0, 0, cols, rows);

  applyEffects(imageData.data, preStyleEffects, {
    width: cols,
    height: rows,
    time: tick,
    timelineFrames: context.timelineFrames,
    faceBounds: context.faceBounds,
    handBounds: context.handBounds,
    poseBounds: context.poseBounds,
  });

  const renderCanvas = document.createElement("canvas");
  renderCanvas.width = canvasWidth;
  renderCanvas.height = canvasHeight;
  const renderCtx = renderCanvas.getContext("2d", { willReadFrequently: true });

  if (!renderCtx) return;

  if (renderMode === "halftone") {
    const dotScale = (activeStyle.params.dotScale as number) || 1.0;
    renderHalftone(
      renderCtx,
      imageData.data,
      cols,
      rows,
      canvasWidth,
      canvasHeight,
      fontSize,
      dotScale
    );
  } else {
    renderFrame(renderCtx, imageData.data, cols, rows, {
      cols,
      fontSize,
      mode: renderMode as RenderMode,
      emojiMap,
    });
  }

  if (postStyleEffects.length > 0) {
    const renderImageData = renderCtx.getImageData(
      0,
      0,
      canvasWidth,
      canvasHeight
    );
    applyEffects(renderImageData.data, postStyleEffects, {
      width: canvasWidth,
      height: canvasHeight,
      time: tick,
      timelineFrames: context.timelineFrames,
      faceBounds: context.faceBounds,
      handBounds: context.handBounds,
      poseBounds: context.poseBounds,
    });
    renderCtx.putImageData(renderImageData, 0, 0);
  }

  ctx.drawImage(renderCanvas, 0, 0);
}

function renderHalftone(
  ctx: CanvasRenderingContext2D,
  data: Uint8ClampedArray,
  cols: number,
  rows: number,
  canvasWidth: number,
  canvasHeight: number,
  fontSize: number,
  dotScale: number
): void {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const cellWidth = canvasWidth / cols;
  const cellHeight = canvasHeight / rows;
  const maxRadius = (Math.min(cellWidth, cellHeight) / 2) * dotScale;

  const offsetX = (canvasWidth - cols * cellWidth) / 2;
  const offsetY = (canvasHeight - rows * cellHeight) / 2;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const brightness = (r + g + b) / 3 / 255;

      const radius = brightness * maxRadius;

      if (radius > 0.5) {
        const cx = offsetX + x * cellWidth + cellWidth / 2;
        const cy = offsetY + y * cellHeight + cellHeight / 2;

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
