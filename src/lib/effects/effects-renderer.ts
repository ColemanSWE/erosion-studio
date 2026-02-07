import { Effect, Region } from "./types";
import {
  applyEffects,
  isStyleEffect,
} from "./effect-registry";
import { renderFrame, RenderMode } from "./renderers";
import { emojiMap } from "./emoji-map";
import { PALETTES, PaletteKey } from "./palettes";
import { renderMesh } from "./mesh-renderer";

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
  effects: Effect[],
  regions?: Region[]
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
    const globalEffects = effects.filter((e) => e.active && !e.regionId);
    const regionEffects = effects.filter((e) => e.active && e.regionId);
    
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

    buffer.width = sourceWidth;
    buffer.height = sourceHeight;
    bufferCtx.drawImage(source, 0, 0, sourceWidth, sourceHeight);

    if (globalEffects.length > 0) {
      const imageData = bufferCtx.getImageData(0, 0, sourceWidth, sourceHeight);

      applyEffects(imageData.data, globalEffects, {
        width: sourceWidth,
        height: sourceHeight,
        time: tick,
        timelineFrames: context.timelineFrames,
        faceBounds: context.faceBounds,
        handBounds: context.handBounds,
        poseBounds: context.poseBounds,
      });

      bufferCtx.putImageData(imageData, 0, 0);
    }

    if (regionEffects.length > 0 && regions && regions.length > 0) {
      const regionGroups = new Map<string, Effect[]>();
      for (const effect of regionEffects) {
        if (!effect.regionId) continue;
        if (!regionGroups.has(effect.regionId)) {
          regionGroups.set(effect.regionId, []);
        }
        regionGroups.get(effect.regionId)!.push(effect);
      }

      for (const [regionId, regionEffectList] of regionGroups) {
        const region = regions.find((r) => r.id === regionId);
        if (!region) continue;

        const rx = Math.floor(region.x * sourceWidth);
        const ry = Math.floor(region.y * sourceHeight);
        const rw = Math.floor(region.width * sourceWidth);
        const rh = Math.floor(region.height * sourceHeight);

        console.log("Applying region effects:", {
          regionId,
          region,
          sourceWidth,
          sourceHeight,
          rx, ry, rw, rh,
          effectCount: regionEffectList.length,
        });

        if (rw <= 0 || rh <= 0) continue;

        const regionData = bufferCtx.getImageData(rx, ry, rw, rh);

        applyEffects(regionData.data, regionEffectList, {
          width: rw,
          height: rh,
          time: tick,
          timelineFrames: context.timelineFrames,
          faceBounds: context.faceBounds,
          handBounds: context.handBounds,
          poseBounds: context.poseBounds,
        });

        bufferCtx.putImageData(regionData, rx, ry);
      }
    }

    ctx.drawImage(buffer, drawX, drawY, drawWidth, drawHeight);
    return;
  }

  const styleEffectIndex = effects.findIndex((e) => e.id === activeStyle.id);
  const preStyleEffects = effects
    .slice(0, styleEffectIndex)
    .filter((e) => e.active && !isStyleEffect(e.type) && !e.regionId);
  const postStyleEffects = effects
    .slice(styleEffectIndex + 1)
    .filter((e) => e.active && !isStyleEffect(e.type) && !e.regionId);

  const density = (activeStyle.params.density as number) || 64;
  const renderMode = styleEffectToRenderMode(activeStyle.type);

  if (renderMode === "native") {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Prepare source for mesh renderer
    buffer.width = sourceWidth;
    buffer.height = sourceHeight;
    bufferCtx.drawImage(source, 0, 0, sourceWidth, sourceHeight);

    if (preStyleEffects.length > 0) {
      const imageData = bufferCtx.getImageData(0, 0, sourceWidth, sourceHeight);
      applyEffects(imageData.data, preStyleEffects, {
        width: sourceWidth,
        height: sourceHeight,
        time: tick,
        timelineFrames: context.timelineFrames,
        faceBounds: context.faceBounds,
        handBounds: context.handBounds,
        poseBounds: context.poseBounds,
      });
      bufferCtx.putImageData(imageData, 0, 0);
    }

    // Render 3D mesh
    const meshCanvas = renderMesh(
      buffer,
      activeStyle.params,
      canvasWidth,
      canvasHeight
    );

    // Draw mesh to output canvas
    ctx.drawImage(meshCanvas, 0, 0, canvasWidth, canvasHeight);

    if (postStyleEffects.length > 0) {
      const canvasImageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
      applyEffects(canvasImageData.data, postStyleEffects, {
        width: canvasWidth,
        height: canvasHeight,
        time: tick,
        timelineFrames: context.timelineFrames,
        faceBounds: context.faceBounds,
        handBounds: context.handBounds,
        poseBounds: context.poseBounds,
      });
      ctx.putImageData(canvasImageData, 0, 0);
    }
    return;
  }

  const aspect = sourceHeight / sourceWidth;
  const charAspect = renderMode === "emoji" ? 1.0 : 0.6;
  const cols = density;
  const rows = Math.floor(cols * aspect * charAspect);

  if (rows < 1 || cols < 1) {
    console.warn("Calculated dimensions too small for style effect, skipping");
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
    ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
    return;
  }

  const cellWidth = canvasWidth / cols;
  const cellHeight = canvasHeight / rows;
  const fontSize = Math.floor(Math.min(cellWidth, cellHeight));

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

  const dotScale = (activeStyle.params.dotScale as number) || 1.0;
  
  if (renderMode === "halftone") {
    renderHalftone(
      renderCtx,
      imageData.data,
      cols,
      rows,
      canvasWidth,
      canvasHeight,
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
