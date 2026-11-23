import type { Effect, Region, Overlay } from "./types";
import { applyEffects } from "./effect-registry";
import type { RenderContext } from "./render-types";

let regionEffectsTempCanvas: HTMLCanvasElement | null = null;
let regionEffectsTempCtx: CanvasRenderingContext2D | null = null;

export function getOrCreateRegionEffectsCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  if (!regionEffectsTempCanvas) {
    regionEffectsTempCanvas = document.createElement("canvas");
    regionEffectsTempCtx = regionEffectsTempCanvas.getContext("2d", { willReadFrequently: true });
  }
  if (!regionEffectsTempCtx) throw new Error("Failed to get 2D context for region effects temp canvas");
  return { canvas: regionEffectsTempCanvas, ctx: regionEffectsTempCtx };
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
  isMaskPass = false,
): void {
  const x = isMaskPass ? 0 : drawX + overlay.x * drawWidth;
  const y = isMaskPass ? 0 : drawY + overlay.y * drawHeight;
  const w = isMaskPass ? drawWidth : overlay.width * drawWidth;
  const h = isMaskPass ? drawHeight : overlay.height * drawHeight;

  const alpha = overlay.opacity ?? 1;

  if (overlay.type === "text" && overlay.text) {
    ctx.save();
    if (!isMaskPass && alpha < 1) ctx.globalAlpha = alpha;
    ctx.fillStyle = overlay.color || "#ffffff";
    const heightRef = isMaskPass ? sourceHeight : drawHeight;
    const fontSize = overlay.fontSize ? overlay.fontSize * heightRef : h * 0.8;
    ctx.font = `bold ${fontSize}px ${overlay.fontFamily || "Inter, sans-serif"}`;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    ctx.fillText(overlay.text, x + w / 2, y + h * 0.1, w);
    ctx.restore();
  } else if ((overlay.type === "image" || overlay.type === "video") && overlay.mediaId && context.getOverlaySource) {
    const source = context.getOverlaySource(overlay.id, overlay.type);
    if (source) {
      ctx.save();
      if (!isMaskPass && alpha < 1) ctx.globalAlpha = alpha;
      ctx.drawImage(source, x, y, w, h);
      ctx.restore();
    }
  }
}

/**
 * Applies region and overlay effects to the buffer.
 *
 * Returns a Set of overlay IDs whose content (including applied effects) has
 * already been composited into bufferCtx. The caller should skip plain
 * drawOverlay calls for these overlays to avoid drawing them twice.
 */
export function applyRegionEffects(
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
): Set<string> {
  const compositedOverlayIds = new Set<string>();

  if (regionEffects.length === 0 && !overlays?.some(o => o.isEffectZone)) return compositedOverlayIds;

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

      let startX = Math.max(0, Math.floor(region.x * sourceWidth));
      const startY = Math.max(0, Math.floor(region.y * sourceHeight));
      let endX = Math.min(sourceWidth, Math.floor((region.x + region.width) * sourceWidth));
      const endY = Math.min(sourceHeight, Math.floor((region.y + region.height) * sourceHeight));

      if (context.isFlipped) {
        [startX, endX] = [sourceWidth - endX, sourceWidth - startX];
      }

      const rw = endX - startX;
      const rh = endY - startY;
      if (rw <= 0 || rh <= 0) continue;

      const regionData = bufferCtx.getImageData(startX, startY, rw, rh);
      applyEffects(regionData.data, regionEffectList, {
        width: rw, height: rh, time: tick, mediaTime: context.mediaTime,
        timelineFrames: context.timelineFrames,
        faceBounds: context.faceBounds,
        handBounds: context.handBounds,
        poseBounds: context.poseBounds,
      });
      bufferCtx.putImageData(regionData, startX, startY);
    }
  }

  if (overlays) {
    for (const overlay of overlays) {
      if (overlay.isEffectZone && !overlayGroups.has(overlay.id)) {
        overlayGroups.set(overlay.id, []);
      }
    }
  }

  const processConfig = {
    time: tick, mediaTime: context.mediaTime,
    timelineFrames: context.timelineFrames,
    faceBounds: context.faceBounds,
    handBounds: context.handBounds,
    poseBounds: context.poseBounds,
  };

  for (const [overlayId, overlayEffectList] of overlayGroups) {
    const overlay = overlays?.find((o) => o.id === overlayId);
    if (!overlay) continue;

    let startX = Math.max(0, Math.floor(overlay.x * sourceWidth));
    const startY = Math.max(0, Math.floor(overlay.y * sourceHeight));
    let endX = Math.min(sourceWidth, Math.floor((overlay.x + overlay.width) * sourceWidth));
    const endY = Math.min(sourceHeight, Math.floor((overlay.y + overlay.height) * sourceHeight));

    if (context.isFlipped) {
      [startX, endX] = [sourceWidth - endX, sourceWidth - startX];
    }

    const rw = endX - startX;
    const rh = endY - startY;
    if (rw <= 0 || rh <= 0) continue;

    const { canvas: tempCanvas, ctx: tempCtx } = getOrCreateRegionEffectsCanvas();
    tempCanvas.width = rw;
    tempCanvas.height = rh;

    if (overlay.isEffectZone) {
      // Effect zone: apply effects to the video pixels behind the overlay,
      // then mask to the overlay's shape so the effected video shows through.
      const originalData = bufferCtx.getImageData(startX, startY, rw, rh);
      const effectedData = new ImageData(new Uint8ClampedArray(originalData.data), rw, rh);
      applyEffects(effectedData.data, overlayEffectList, { width: rw, height: rh, ...processConfig });

      tempCtx.putImageData(effectedData, 0, 0);
      tempCtx.globalCompositeOperation = "destination-in";
      drawOverlay(tempCtx, overlay, context, sourceWidth, sourceHeight, 0, 0, rw, rh, true);
      tempCtx.globalCompositeOperation = "source-over";

      bufferCtx.drawImage(tempCanvas, startX, startY);
      // Effect zones are never drawn as plain overlays; no need to add to compositedOverlayIds.
    } else {
      // Non-effect-zone overlay: apply effects to the overlay's own content,
      // then composite the result into the buffer.
      drawOverlay(tempCtx, overlay, context, sourceWidth, sourceHeight, 0, 0, rw, rh, true);

      if (overlayEffectList.length > 0) {
        const overlayData = tempCtx.getImageData(0, 0, rw, rh);
        applyEffects(overlayData.data, overlayEffectList, { width: rw, height: rh, ...processConfig });
        tempCtx.putImageData(overlayData, 0, 0);
      }

      bufferCtx.drawImage(tempCanvas, startX, startY);
      // Tell the caller not to re-draw this overlay without effects on top.
      compositedOverlayIds.add(overlayId);
    }
  }

  return compositedOverlayIds;
}
