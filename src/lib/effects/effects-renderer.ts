import { Effect, Region, Overlay } from "./types";
import { applyEffects, isStyleEffect } from "./effect-registry";
import { renderFrame, RenderMode } from "./renderers";
import { emojiMap } from "./emoji-map";
import { PALETTES, PaletteKey } from "./palettes";
import { renderMesh } from "./mesh-renderer";
import { GLPipeline, type GLRegion } from "./gl/pipeline";
import { processEffectsInWorker } from "./worker-pool";

import "./processors";

import { FaceBounds, HandBounds, PoseBounds } from "./face-detector";

export type { GLPipeline };

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
  isFlipped?: boolean;
  glPipeline?: GLPipeline;
  overlays?: Overlay[];
  getOverlaySource?: (overlayId: string, type: "image" | "video") => CanvasImageSource | null;
}

// Style effects that have a dedicated render mode (not pixel processors)
const RENDER_MODE_STYLE_EFFECTS = new Set([
  "pixelate", "emoji", "ascii", "matrix", "halftone", "3d-mesh",
]);

export function getActiveStyleEffect(effects: Effect[]): Effect | null {
  for (let i = effects.length - 1; i >= 0; i--) {
    const effect = effects[i];
    if (effect.active && isStyleEffect(effect.type) && RENDER_MODE_STYLE_EFFECTS.has(effect.type)) {
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
    case "3d-mesh":
      return "native";
    default:
      return "native";
  }
}

export async function initializeEmojiPalette(
  paletteKey: PaletteKey,
): Promise<void> {
  const palette = PALETTES[paletteKey];
  if (!palette) {
    console.error(`Invalid palette key: ${paletteKey}, using standard`);
    await emojiMap.generatePalette(PALETTES.standard.emojis);
    return;
  }
  await emojiMap.generatePalette(palette.emojis);
}

// Cache for style effect render canvas to avoid creating new canvas every frame
let styleRenderCanvas: HTMLCanvasElement | null = null;
let styleRenderCtx: CanvasRenderingContext2D | null = null;

function getOrCreateStyleCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  if (!styleRenderCanvas || styleRenderCanvas.width !== width || styleRenderCanvas.height !== height) {
    styleRenderCanvas = document.createElement("canvas");
    styleRenderCanvas.width = width;
    styleRenderCanvas.height = height;
    styleRenderCtx = styleRenderCanvas.getContext("2d", { willReadFrequently: true });
  }
  
  if (!styleRenderCtx) {
    throw new Error("Failed to get 2D context for style render canvas");
  }
  
  return { canvas: styleRenderCanvas, ctx: styleRenderCtx };
}

let regionEffectsTempCanvas: HTMLCanvasElement | null = null;
let regionEffectsTempCtx: CanvasRenderingContext2D | null = null;

function getOrCreateRegionEffectsCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  if (!regionEffectsTempCanvas) {
    regionEffectsTempCanvas = document.createElement("canvas");
    regionEffectsTempCtx = regionEffectsTempCanvas.getContext("2d", { willReadFrequently: true });
  }
  if (!regionEffectsTempCtx) {
    throw new Error("Failed to get 2D context for region effects temp canvas");
  }
  return { canvas: regionEffectsTempCanvas, ctx: regionEffectsTempCtx };
}

function applyRegionEffects(
  bufferCtx: CanvasRenderingContext2D,
  regionEffects: Effect[],
  regions: Region[] | undefined,
  overlays: Overlay[] | undefined,
  sourceWidth: number,
  sourceHeight: number,
  drawX: number,
  drawY: number,
  canvasWidth: number,
  canvasHeight: number,
  scale: number,
  context: RenderContext,
  tick: number,
  overlayEffectsOnly = false,
): void {
  if (regionEffects.length === 0) return;

  const regionGroups = new Map<string, Effect[]>();
  const overlayGroups = new Map<string, Effect[]>();

  for (const effect of regionEffects) {
    if (effect.regionId) {
      if (!regionGroups.has(effect.regionId)) regionGroups.set(effect.regionId, []);
      regionGroups.get(effect.regionId)!.push(effect);
    } else if (effect.overlayId) {
      if (!overlayGroups.has(effect.overlayId)) overlayGroups.set(effect.overlayId, []);
      overlayGroups.get(effect.overlayId)!.push(effect);
    }
  }

  if (!overlayEffectsOnly) {
  for (const [regionId, regionEffectList] of regionGroups) {
    const region = regions?.find((r) => r.id === regionId);
    if (!region) continue;

    const c_x = region.x * sourceWidth;
    const c_y = region.y * sourceHeight;
    const c_w = region.width * sourceWidth;
    const c_h = region.height * sourceHeight;

    let rx = Math.floor(c_x);
    let ry = Math.floor(c_y);
    let rw = Math.floor(c_w);
    let rh = Math.floor(c_h);

    let startX = Math.max(0, rx);
    const startY = Math.max(0, ry);
    let endX = Math.min(sourceWidth, rx + rw);
    const endY = Math.min(sourceHeight, ry + rh);

    if (context.isFlipped) {
      const oldStartX = startX;
      const oldEndX = endX;
      startX = sourceWidth - oldEndX;
      endX = sourceWidth - oldStartX;
    }

    rx = startX;
    ry = startY;
    rw = endX - startX;
    rh = endY - startY;

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

  for (const [overlayId, overlayEffectList] of overlayGroups) {
    const overlay = overlays?.find((o) => o.id === overlayId);
    if (!overlay) continue;

    const cx = overlay.x * sourceWidth;
    const cy = overlay.y * sourceHeight;
    const cw = overlay.width * sourceWidth;
    const ch = overlay.height * sourceHeight;

    let rx = Math.floor(cx);
    let ry = Math.floor(cy);
    let rw = Math.floor(cw);
    let rh = Math.floor(ch);

    let startX = Math.max(0, rx);
    const startY = Math.max(0, ry);
    let endX = Math.min(sourceWidth, rx + rw);
    const endY = Math.min(sourceHeight, ry + rh);

    if (context.isFlipped) {
      const oldStartX = startX;
      const oldEndX = endX;
      startX = sourceWidth - oldEndX;
      endX = sourceWidth - oldStartX;
    }

    rx = startX;
    ry = startY;
    rw = endX - startX;
    rh = endY - startY;

    if (rw <= 0 || rh <= 0) continue;

    // Save background and apply effect
    const originalData = bufferCtx.getImageData(rx, ry, rw, rh);
    const effectedData = new ImageData(new Uint8ClampedArray(originalData.data), rw, rh);
    applyEffects(effectedData.data, overlayEffectList, {
      width: rw,
      height: rh,
      time: tick,
      timelineFrames: context.timelineFrames,
      faceBounds: context.faceBounds,
      handBounds: context.handBounds,
      poseBounds: context.poseBounds,
    });

    const { canvas: tempCanvas, ctx: tempCtx } = getOrCreateRegionEffectsCanvas();
    tempCanvas.width = rw;
    tempCanvas.height = rh;
    tempCtx.putImageData(effectedData, 0, 0);

    tempCtx.globalCompositeOperation = "destination-in";
    drawOverlay(tempCtx, overlay, context, sourceWidth, sourceHeight, 0, 0, rw, rh, true);

    bufferCtx.drawImage(tempCanvas, rx, ry);
  }
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: Overlay,
  context: RenderContext,
  sourceWidth: number,
  sourceHeight: number,
  drawX: number,
  drawY: number,
  drawWidth: number,
  drawHeight: number,
  isMaskPass = false // If true, local bounds are used
): void {
  const x = isMaskPass ? 0 : drawX + overlay.x * drawWidth;
  const y = isMaskPass ? 0 : drawY + overlay.y * drawHeight;
  const w = isMaskPass ? drawWidth : overlay.width * drawWidth;
  const h = isMaskPass ? drawHeight : overlay.height * drawHeight;

  if (overlay.type === "text" && overlay.text) {
    ctx.save();
    ctx.fillStyle = overlay.color || "#ffffff";
    const fontSize = overlay.fontSize ? overlay.fontSize * drawHeight : h * 0.8;
    ctx.font = `bold ${fontSize}px Inter, sans-serif`;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    ctx.fillText(overlay.text, x + w / 2, y + h * 0.1, w);
    ctx.restore();
  } else if ((overlay.type === "image" || overlay.type === "video") && overlay.mediaId && context.getOverlaySource) {
    const source = context.getOverlaySource(overlay.id, overlay.type);
    if (source) {
      if (!isMaskPass) {
        ctx.drawImage(source, x, y, w, h);
      } else {
        // If it's an image/video acting as a mask, optionally we could just draw it to apply alpha
        ctx.drawImage(source, x, y, w, h);
      }
    }
  }
}    

function buildGLRegions(
  regionEffects: Effect[],
  regions: Region[] | undefined,
  sourceWidth: number,
  sourceHeight: number,
  drawX: number,
  drawY: number,
  canvasWidth: number,
  canvasHeight: number,
  scale: number,
  isFlipped?: boolean,
): GLRegion[] {
  if (!regions || regions.length === 0 || regionEffects.length === 0) return [];

  const groups = new Map<string, Effect[]>();
  for (const e of regionEffects) {
    if (!e.regionId) continue;
    if (!groups.has(e.regionId)) groups.set(e.regionId, []);
    groups.get(e.regionId)!.push(e);
  }

  const result: GLRegion[] = [];
  for (const [regionId, effects] of groups) {
    const region = regions.find((r) => r.id === regionId);
    if (!region) continue;

    const cx = region.x * sourceWidth;
    const cy = region.y * sourceHeight;
    const cw = region.width * sourceWidth;
    const ch = region.height * sourceHeight;

    let startX = Math.max(0, Math.floor(cx));
    const startY = Math.max(0, Math.floor(cy));
    let endX = Math.min(sourceWidth, Math.floor(cx + cw));
    const endY = Math.min(sourceHeight, Math.floor(cy + ch));

    if (isFlipped) {
      const tmp = startX;
      startX = sourceWidth - endX;
      endX = sourceWidth - tmp;
    }

    const rw = endX - startX;
    const rh = endY - startY;
    if (rw <= 0 || rh <= 0) continue;

    result.push({ rect: [startX, startY, rw, rh], effects });
  }
  return result;
}

export async function renderWithEffects(
  context: RenderContext,
  effects: Effect[],
  regions?: Region[],
  overlays: Overlay[] = [],
): Promise<void> {
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
    const globalEffects = effects.filter((e) => e.active && !e.regionId && !e.overlayId);
    const regionEffects = effects.filter((e) => e.active && (e.regionId || e.overlayId));
    const hasOverlayMasks = regionEffects.some(e => e.overlayId);

    const scale = Math.min(
      canvasWidth / sourceWidth,
      canvasHeight / sourceHeight,
    );
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const drawX = (canvasWidth - drawWidth) / 2;
    const drawY = (canvasHeight - drawHeight) / 2;

    const processConfig = {
      width: sourceWidth,
      height: sourceHeight,
      time: tick,
      timelineFrames: context.timelineFrames,
      faceBounds: context.faceBounds,
      handBounds: context.handBounds,
      poseBounds: context.poseBounds,
    };

    // GL path: global effects + optional region effects all run on GPU (CPU fallback per-effect)
    if (context.glPipeline && (globalEffects.length > 0 || regionEffects.length > 0) && !hasOverlayMasks) {
      const glRegions = buildGLRegions(
        regionEffects,
        regions,
        sourceWidth,
        sourceHeight,
        drawX,
        drawY,
        canvasWidth,
        canvasHeight,
        scale,
        context.isFlipped,
      );
      context.glPipeline.renderEffects(
        source,
        sourceWidth,
        sourceHeight,
        globalEffects,
        processConfig,
        ctx,
        drawX,
        drawY,
        drawWidth,
        drawHeight,
        canvasWidth,
        canvasHeight,
        glRegions.length > 0 ? glRegions : undefined,
      );
      return;
    }

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    buffer.width = sourceWidth;
    buffer.height = sourceHeight;
    bufferCtx.drawImage(source, 0, 0, sourceWidth, sourceHeight);

    if (globalEffects.length > 0) {
      const imageData = bufferCtx.getImageData(0, 0, sourceWidth, sourceHeight);
      const useWorker = !context.timelineFrames?.length;
      try {
        if (useWorker) {
          const buffer = new Uint8ClampedArray(imageData.data);
          const processed = await processEffectsInWorker(
            buffer,
            globalEffects,
            processConfig,
          );
          bufferCtx.putImageData(
            new ImageData(new Uint8ClampedArray(processed), sourceWidth, sourceHeight),
            0,
            0,
          );
        } else {
          applyEffects(imageData.data, globalEffects, processConfig);
          bufferCtx.putImageData(imageData, 0, 0);
        }
      } catch {
        applyEffects(imageData.data, globalEffects, processConfig);
        bufferCtx.putImageData(imageData, 0, 0);
      }
    }

    if (regionEffects.length > 0) {
      const glRegions = context.glPipeline && buildGLRegions(
        regionEffects.filter((e) => e.regionId),
        regions,
        sourceWidth,
        sourceHeight,
        drawX,
        drawY,
        canvasWidth,
        canvasHeight,
        scale,
        context.isFlipped,
      );
      if (glRegions && glRegions.length > 0) {
        context.glPipeline!.renderEffects(
          buffer,
          sourceWidth,
          sourceHeight,
          [],
          processConfig,
          bufferCtx,
          0,
          0,
          sourceWidth,
          sourceHeight,
          sourceWidth,
          sourceHeight,
          glRegions,
        );
      }
      const usedGLForRegions = !!(glRegions && glRegions.length > 0);
      applyRegionEffects(
        bufferCtx,
        regionEffects,
        regions,
        overlays,
        sourceWidth,
        sourceHeight,
        drawX,
        drawY,
        canvasWidth,
        canvasHeight,
        scale,
        context,
        tick,
        usedGLForRegions,
      );
    }

    ctx.drawImage(buffer, drawX, drawY, drawWidth, drawHeight);

    // Draw active overlays that are not effect zones
    for (const overlay of overlays) {
      if (!overlay.isEffectZone) {
        drawOverlay(ctx, overlay, context, sourceWidth, sourceHeight, drawX, drawY, drawWidth, drawHeight);
      }
    }
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
      canvasHeight,
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
      canvasHeight / sourceHeight,
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

  const { canvas: renderCanvas, ctx: renderCtx } = getOrCreateStyleCanvas(canvasWidth, canvasHeight);
  
  renderCtx.clearRect(0, 0, canvasWidth, canvasHeight);

  const dotScale = (activeStyle.params.dotScale as number) || 1.0;
  const halftoneShape = (activeStyle.params.shape as string) || "circle";
  const halftoneAngle = (activeStyle.params.angle as number) || 0;
  const halftoneColorMode = (activeStyle.params.colorMode as string) || "colored";

  if (renderMode === "halftone") {
    renderHalftone(
      renderCtx,
      imageData.data,
      cols,
      rows,
      canvasWidth,
      canvasHeight,
      dotScale,
      halftoneShape,
      halftoneAngle,
      halftoneColorMode,
    );
  } else {
    renderFrame(renderCtx, imageData.data, cols, rows, {
      cols,
      fontSize,
      mode: renderMode as RenderMode,
      emojiMap,
      charset: (activeStyle.params.charset as string) || "standard",
      colorMode: (activeStyle.params.colorMode as string) || "colored",
    });
  }

  if (postStyleEffects.length > 0) {
    const renderImageData = renderCtx.getImageData(
      0,
      0,
      canvasWidth,
      canvasHeight,
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

  const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = (canvasWidth - drawWidth) / 2;
  const drawY = (canvasHeight - drawHeight) / 2;

  // Draw active overlays that are not effect zones
  for (const overlay of overlays) {
    if (!overlay.isEffectZone) {
      drawOverlay(ctx, overlay, context, sourceWidth, sourceHeight, drawX, drawY, drawWidth, drawHeight);
    }
  }
}

function renderHalftone(
  ctx: CanvasRenderingContext2D,
  data: Uint8ClampedArray,
  cols: number,
  rows: number,
  canvasWidth: number,
  canvasHeight: number,
  dotScale: number,
  shape: string = "circle",
  angle: number = 0,
  colorMode: string = "colored",
): void {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const cellWidth = canvasWidth / cols;
  const cellHeight = canvasHeight / rows;
  const maxRadius = (Math.min(cellWidth, cellHeight) / 2) * dotScale;

  const offsetX = (canvasWidth - cols * cellWidth) / 2;
  const offsetY = (canvasHeight - rows * cellHeight) / 2;

  // Apply rotation around canvas center
  const angleRad = (angle * Math.PI) / 180;
  if (angleRad !== 0) {
    ctx.save();
    ctx.translate(canvasWidth / 2, canvasHeight / 2);
    ctx.rotate(angleRad);
    ctx.translate(-canvasWidth / 2, -canvasHeight / 2);
  }

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

        // Color mode
        if (colorMode === "mono") {
          const val = Math.floor(brightness * 255);
          ctx.fillStyle = `rgb(${val}, ${val}, ${val})`;
        } else if (colorMode === "cmyk") {
          // Simulate CMYK separation with dot offsets
          const rNorm = r / 255, gNorm = g / 255, bNorm = b / 255;
          const k = 1 - Math.max(rNorm, gNorm, bNorm);
          const cCmyk = k < 1 ? (1 - rNorm - k) / (1 - k) : 0;
          const mCmyk = k < 1 ? (1 - gNorm - k) / (1 - k) : 0;
          const yCmyk = k < 1 ? (1 - bNorm - k) / (1 - k) : 0;

          const sep = maxRadius * 0.25;
          // Cyan
          const cRadius = cCmyk * maxRadius * 0.6;
          if (cRadius > 0.3) {
            ctx.fillStyle = "rgba(0, 255, 255, 0.7)";
            drawShape(ctx, cx - sep, cy, cRadius, shape);
          }
          // Magenta
          const mRadius = mCmyk * maxRadius * 0.6;
          if (mRadius > 0.3) {
            ctx.fillStyle = "rgba(255, 0, 255, 0.7)";
            drawShape(ctx, cx + sep * 0.5, cy - sep, mRadius, shape);
          }
          // Yellow
          const yRadius = yCmyk * maxRadius * 0.6;
          if (yRadius > 0.3) {
            ctx.fillStyle = "rgba(255, 255, 0, 0.7)";
            drawShape(ctx, cx + sep * 0.5, cy + sep, yRadius, shape);
          }
          // Black (key)
          const kRadius = k * maxRadius * 0.4;
          if (kRadius > 0.3) {
            ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
            drawShape(ctx, cx, cy, kRadius, shape);
          }
          continue;
        } else {
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        }

        drawShape(ctx, cx, cy, radius, shape);
      }
    }
  }

  if (angleRad !== 0) {
    ctx.restore();
  }
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  shape: string,
): void {
  if (shape === "square") {
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  } else if (shape === "diamond") {
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx + radius, cy);
    ctx.lineTo(cx, cy + radius);
    ctx.lineTo(cx - radius, cy);
    ctx.closePath();
    ctx.fill();
  } else if (shape === "line") {
    ctx.fillRect(cx - radius, cy - radius * 0.2, radius * 2, radius * 0.4);
  } else {
    // circle (default)
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
