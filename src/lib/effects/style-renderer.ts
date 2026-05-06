import type { Effect, Overlay } from "./types";
import { applyEffects } from "./effect-registry";
import { renderFrame, RenderMode } from "./renderers";
import { emojiMap } from "./emoji-map";
import { renderMesh } from "./mesh-renderer";
import { renderSphere } from "./sphere-renderer";
import { renderShatter } from "./shatter-renderer";
import { renderRibbon } from "./ribbon-renderer";
import { renderCrystal } from "./crystal-renderer";
import { type RenderContext, computeDrawRect, styleEffectToRenderMode } from "./render-types";
import { drawOverlay } from "./overlay-compositor";

let styleRenderCanvas: HTMLCanvasElement | null = null;
let styleRenderCtx: CanvasRenderingContext2D | null = null;

export function getOrCreateStyleCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  if (!styleRenderCanvas || styleRenderCanvas.width !== width || styleRenderCanvas.height !== height) {
    styleRenderCanvas = document.createElement("canvas");
    styleRenderCanvas.width = width;
    styleRenderCanvas.height = height;
    styleRenderCtx = styleRenderCanvas.getContext("2d", { willReadFrequently: true });
  }
  if (!styleRenderCtx) throw new Error("Failed to get 2D context for style render canvas");
  return { canvas: styleRenderCanvas, ctx: styleRenderCtx };
}

export function renderHalftone(
  ctx: CanvasRenderingContext2D,
  data: Uint8ClampedArray,
  cols: number,
  rows: number,
  canvasWidth: number,
  canvasHeight: number,
  dotScale: number,
  shape = "circle",
  angle = 0,
  colorMode = "colored",
): void {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const cellWidth = canvasWidth / cols;
  const cellHeight = canvasHeight / rows;
  const maxRadius = (Math.min(cellWidth, cellHeight) / 2) * dotScale;
  const offsetX = (canvasWidth - cols * cellWidth) / 2;
  const offsetY = (canvasHeight - rows * cellHeight) / 2;
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
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const brightness = (r + g + b) / 3 / 255;
      const radius = brightness * maxRadius;
      if (radius <= 0.5) continue;

      const cx = offsetX + x * cellWidth + cellWidth / 2;
      const cy = offsetY + y * cellHeight + cellHeight / 2;

      if (colorMode === "mono") {
        const val = Math.floor(brightness * 255);
        ctx.fillStyle = `rgb(${val}, ${val}, ${val})`;
      } else if (colorMode === "cmyk") {
        const rN = r / 255, gN = g / 255, bN = b / 255;
        const k = 1 - Math.max(rN, gN, bN);
        const inv = k < 1 ? 1 / (1 - k) : 0;
        const sep = maxRadius * 0.25;
        const c = k < 1 ? (1 - rN - k) * inv : 0;
        const m = k < 1 ? (1 - gN - k) * inv : 0;
        const yc = k < 1 ? (1 - bN - k) * inv : 0;
        const cRadius = c * maxRadius * 0.6;
        if (cRadius > 0.3) { ctx.fillStyle = "rgba(0,255,255,.7)"; drawShape(ctx, cx - sep, cy, cRadius, shape); }
        const mRadius = m * maxRadius * 0.6;
        if (mRadius > 0.3) { ctx.fillStyle = "rgba(255,0,255,.7)"; drawShape(ctx, cx + sep * 0.5, cy - sep, mRadius, shape); }
        const yRadius = yc * maxRadius * 0.6;
        if (yRadius > 0.3) { ctx.fillStyle = "rgba(255,255,0,.7)"; drawShape(ctx, cx + sep * 0.5, cy + sep, yRadius, shape); }
        const kRadius = k * maxRadius * 0.4;
        if (kRadius > 0.3) { ctx.fillStyle = "rgba(0,0,0,.8)"; drawShape(ctx, cx, cy, kRadius, shape); }
        continue;
      } else {
        ctx.fillStyle = `rgb(${r},${g},${b})`;
      }

      drawShape(ctx, cx, cy, radius, shape);
    }
  }

  if (angleRad !== 0) ctx.restore();
}

export function drawShape(
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
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

export async function renderStyleEffect(
  context: RenderContext,
  activeStyle: Effect,
  preStyleEffects: Effect[],
  postStyleEffects: Effect[],
  overlays: Overlay[],
): Promise<void> {
  const { ctx, buffer, bufferCtx, source, sourceWidth, sourceHeight, canvasWidth, canvasHeight, tick } = context;

  const density = (activeStyle.params.density as number) || 80;
  const renderMode = styleEffectToRenderMode(activeStyle.type);

  if (renderMode === "native") {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    buffer.width = sourceWidth;
    buffer.height = sourceHeight;
    bufferCtx.drawImage(source, 0, 0, sourceWidth, sourceHeight);

    if (preStyleEffects.length > 0) {
      const imageData = bufferCtx.getImageData(0, 0, sourceWidth, sourceHeight);
      applyEffects(imageData.data, preStyleEffects, {
        width: sourceWidth, height: sourceHeight, time: tick,
        timelineFrames: context.timelineFrames, faceBounds: context.faceBounds,
        handBounds: context.handBounds, poseBounds: context.poseBounds,
      });
      bufferCtx.putImageData(imageData, 0, 0);
    }

    const { drawX: nDrawX, drawY: nDrawY, drawWidth: nDrawW, drawHeight: nDrawH } = computeDrawRect(
      sourceWidth, sourceHeight, canvasWidth, canvasHeight, context.sourceTransform,
    );

    if (activeStyle.type !== "3d-mesh") {
      ctx.drawImage(buffer, nDrawX, nDrawY, nDrawW, nDrawH);
    }

    let nativeCanvas: HTMLCanvasElement;
    switch (activeStyle.type) {
      case "3d-sphere": nativeCanvas = renderSphere(buffer, activeStyle.params, canvasWidth, canvasHeight); break;
      case "3d-shatter": nativeCanvas = renderShatter(buffer, activeStyle.params, canvasWidth, canvasHeight); break;
      case "3d-ribbon": nativeCanvas = renderRibbon(buffer, activeStyle.params, canvasWidth, canvasHeight); break;
      case "3d-crystal": nativeCanvas = renderCrystal(buffer, activeStyle.params, canvasWidth, canvasHeight); break;
      default: nativeCanvas = renderMesh(buffer, activeStyle.params, Math.round(nDrawW), Math.round(nDrawH));
    }

    if (activeStyle.type === "3d-mesh") {
      ctx.drawImage(nativeCanvas, nDrawX, nDrawY, nDrawW, nDrawH);
    } else {
      ctx.drawImage(nativeCanvas, 0, 0, canvasWidth, canvasHeight);
    }

    if (postStyleEffects.length > 0) {
      const canvasImageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
      applyEffects(canvasImageData.data, postStyleEffects, {
        width: canvasWidth, height: canvasHeight, time: tick,
        timelineFrames: context.timelineFrames, faceBounds: context.faceBounds,
        handBounds: context.handBounds, poseBounds: context.poseBounds,
      });
      ctx.putImageData(canvasImageData, 0, 0);
    }
    return;
  }

  const { drawX, drawY, drawWidth, drawHeight } = computeDrawRect(
    sourceWidth, sourceHeight, canvasWidth, canvasHeight, context.sourceTransform,
  );

  const charAspect = renderMode === "standard" || renderMode === "emoji" ? 1.0 : 0.6;
  const cols = density;
  const aspect = drawHeight / drawWidth;
  const rows = Math.floor(cols * aspect * charAspect);

  if (rows < 1 || cols < 1) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
    return;
  }

  const cellWidth = drawWidth / cols;
  const cellHeight = drawHeight / rows;
  const fontSize = Math.floor(Math.min(cellWidth, cellHeight));

  buffer.width = cols;
  buffer.height = rows;
  bufferCtx.drawImage(source, 0, 0, cols, rows);

  const imageData = bufferCtx.getImageData(0, 0, cols, rows);
  applyEffects(imageData.data, preStyleEffects, {
    width: cols, height: rows, time: tick,
    timelineFrames: context.timelineFrames, faceBounds: context.faceBounds,
    handBounds: context.handBounds, poseBounds: context.poseBounds,
  });

  const drawWidthInt = Math.round(drawWidth);
  const drawHeightInt = Math.round(drawHeight);
  const { canvas: renderCanvas, ctx: renderCtx } = getOrCreateStyleCanvas(drawWidthInt, drawHeightInt);
  renderCtx.clearRect(0, 0, drawWidthInt, drawHeightInt);

  const dotScale = (activeStyle.params.dotScale as number) || 1.0;
  const halftoneShape = (activeStyle.params.shape as string) || "circle";
  const halftoneAngle = (activeStyle.params.angle as number) || 0;
  const halftoneColorMode = (activeStyle.params.colorMode as string) || "colored";

  if (renderMode === "halftone") {
    renderHalftone(renderCtx, imageData.data, cols, rows, drawWidthInt, drawHeightInt, dotScale, halftoneShape, halftoneAngle, halftoneColorMode);
  } else {
    renderFrame(renderCtx, imageData.data, cols, rows, {
      cols, fontSize,
      mode: renderMode as RenderMode,
      emojiMap,
      charset: (activeStyle.params.charset as string) || "standard",
      colorMode: (activeStyle.params.colorMode as string) || "colored",
    });
  }

  if (postStyleEffects.length > 0) {
    const renderImageData = renderCtx.getImageData(0, 0, drawWidthInt, drawHeightInt);
    applyEffects(renderImageData.data, postStyleEffects, {
      width: drawWidthInt, height: drawHeightInt, time: tick,
      timelineFrames: context.timelineFrames, faceBounds: context.faceBounds,
      handBounds: context.handBounds, poseBounds: context.poseBounds,
    });
    renderCtx.putImageData(renderImageData, 0, 0);
  }

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.drawImage(renderCanvas, drawX, drawY, drawWidth, drawHeight);

  for (const overlay of overlays) {
    if (!overlay.isEffectZone) {
      drawOverlay(ctx, overlay, context, sourceWidth, sourceHeight, drawX, drawY, drawWidth, drawHeight);
    }
  }
}
