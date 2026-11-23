import { Effect, Region, Overlay } from "./types";
import { applyEffects, isStyleEffect } from "./effect-registry";
import { GLPipeline, type GLRegion, type OverlayDescriptor } from "./gl/pipeline";
import { processEffectsInWorker } from "./worker-pool";
import { PALETTES, PaletteKey } from "./palettes";
import { emojiMap } from "./emoji-map";
import { type RenderContext, computeDrawRect, styleEffectToRenderMode } from "./render-types";
import { drawOverlay, applyRegionEffects } from "./overlay-compositor";
import { renderStyleEffect } from "./style-renderer";

import "./processors";

export type { GLPipeline, RenderContext };
export { computeDrawRect, styleEffectToRenderMode };

const RENDER_MODE_STYLE_EFFECTS = new Set([
  "pixelate", "emoji", "ascii", "matrix", "halftone", "3d-mesh",
  "3d-sphere", "3d-shatter", "3d-ribbon", "3d-crystal",
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

export async function initializeEmojiPalette(paletteKey: PaletteKey): Promise<void> {
  const palette = PALETTES[paletteKey];
  if (!palette) {
    console.error(`Invalid palette key: ${paletteKey}, using standard`);
    await emojiMap.generatePalette(PALETTES.standard.emojis);
    return;
  }
  await emojiMap.generatePalette(palette.emojis);
}

function buildOverlayDescriptors(
  overlays: Overlay[],
  context: RenderContext,
  sourceWidth: number,
  sourceHeight: number,
  excludeIds?: Set<string>,
  overlayEffectsMap?: Map<string, Effect[]>,
): { descriptors: OverlayDescriptor[]; textOverlays: Overlay[] } {
  const descriptors: OverlayDescriptor[] = [];
  const textOverlays: Overlay[] = [];
  for (const overlay of overlays) {
    if (overlay.isEffectZone) continue;
    if (excludeIds?.has(overlay.id)) continue;
    if (overlay.type === "text") {
      textOverlays.push(overlay);
      continue;
    }
    if ((overlay.type === "image" || overlay.type === "video") && overlay.mediaId && context.getOverlaySource) {
      const source = context.getOverlaySource(overlay.id, overlay.type);
      if (source) {
        descriptors.push({
          source: source as TexImageSource,
          x: overlay.x * sourceWidth,
          y: overlay.y * sourceHeight,
          w: overlay.width * sourceWidth,
          h: overlay.height * sourceHeight,
          opacity: overlay.opacity ?? 1,
          effects: overlayEffectsMap?.get(overlay.id),
        });
      }
    }
  }
  return { descriptors, textOverlays };
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

    let startX = Math.max(0, Math.floor(region.x * sourceWidth));
    const startY = Math.max(0, Math.floor(region.y * sourceHeight));
    let endX = Math.min(sourceWidth, Math.floor((region.x + region.width) * sourceWidth));
    const endY = Math.min(sourceHeight, Math.floor((region.y + region.height) * sourceHeight));

    if (isFlipped) {
      [startX, endX] = [sourceWidth - endX, sourceWidth - startX];
    }

    const rw = endX - startX;
    const rh = endY - startY;
    if (rw <= 0 || rh <= 0) continue;

    result.push({ rect: [startX, startY, rw, rh], effects });
  }
  return result;
}

function buildEffectZoneGLRegions(
  overlays: Overlay[],
  regionEffects: Effect[],
  sourceWidth: number,
  sourceHeight: number,
  isFlipped?: boolean,
): GLRegion[] {
  const result: GLRegion[] = [];
  for (const overlay of overlays) {
    if (!overlay.isEffectZone) continue;
    const zoneEffects = regionEffects.filter((e) => e.overlayId === overlay.id);
    if (zoneEffects.length === 0) continue;

    let startX = Math.max(0, Math.floor(overlay.x * sourceWidth));
    const startY = Math.max(0, Math.floor(overlay.y * sourceHeight));
    let endX = Math.min(sourceWidth, Math.floor((overlay.x + overlay.width) * sourceWidth));
    const endY = Math.min(sourceHeight, Math.floor((overlay.y + overlay.height) * sourceHeight));

    if (isFlipped) {
      [startX, endX] = [sourceWidth - endX, sourceWidth - startX];
    }

    const rw = endX - startX;
    const rh = endY - startY;
    if (rw <= 0 || rh <= 0) continue;

    result.push({ rect: [startX, startY, rw, rh], effects: zoneEffects });
  }
  return result;
}

export async function renderWithEffects(
  context: RenderContext,
  effects: Effect[],
  regions?: Region[],
  overlays: Overlay[] = [],
): Promise<void> {
  const { ctx, buffer, bufferCtx, source, sourceWidth, sourceHeight, canvasWidth, canvasHeight, tick } = context;

  const activeStyle = getActiveStyleEffect(effects);

  if (!activeStyle) {
    const globalEffects = effects.filter((e) => e.active && !e.regionId && !e.overlayId);
    const regionEffects = effects.filter((e) => e.active && (e.regionId || e.overlayId));
    // Effect zones are handled on the GPU via GLRegion scissor passes.
    // Per-overlay effects (effects targeting non-effect-zone overlays) still use
    // the CPU hybrid path — routing them through readPixels would cause a GPU
    // pipeline stall on every frame, which is worse than the 2D canvas path.
    const hasOverlayMasks = regionEffects.some((e) => {
      if (!e.overlayId) return false;
      const overlay = overlays.find((o) => o.id === e.overlayId);
      return !overlay?.isEffectZone;
    });
    const hasRegionEffects = regionEffects.some(e => e.regionId);

    const { drawX, drawY, drawWidth, drawHeight } = computeDrawRect(
      sourceWidth, sourceHeight, canvasWidth, canvasHeight, context.sourceTransform,
    );
    const scale = drawWidth / sourceWidth;

    const processConfig = {
      width: sourceWidth, height: sourceHeight, time: tick, mediaTime: context.mediaTime,
      timelineFrames: context.timelineFrames,
      faceBounds: context.faceBounds, handBounds: context.handBounds, poseBounds: context.poseBounds,
    };

    // GL fast path: effects on GPU, blit directly to ctx.
    if (context.glPipeline && !hasOverlayMasks) {
      const glRegions = buildGLRegions(
        regionEffects, regions, sourceWidth, sourceHeight,
        drawX, drawY, canvasWidth, canvasHeight, scale, context.isFlipped,
      );
      const effectZoneRegions = buildEffectZoneGLRegions(
        overlays, regionEffects, sourceWidth, sourceHeight, context.isFlipped,
      );
      const allGLRegions = [...glRegions, ...effectZoneRegions];

      if (globalEffects.length > 0 || allGLRegions.length > 0) {
        const { descriptors: overlayDescriptors, textOverlays } = buildOverlayDescriptors(
          overlays, context, sourceWidth, sourceHeight,
        );
        await context.glPipeline.renderEffects(
          source, sourceWidth, sourceHeight, globalEffects, processConfig,
          ctx, drawX, drawY, drawWidth, drawHeight, canvasWidth, canvasHeight,
          allGLRegions.length > 0 ? allGLRegions : undefined,
          overlayDescriptors.length > 0 ? overlayDescriptors : undefined,
        );
        for (const overlay of textOverlays) {
          drawOverlay(ctx, overlay, context, sourceWidth, sourceHeight, drawX, drawY, drawWidth, drawHeight);
        }
        return;
      }
    }

    // GL overlay-only path: no effects active, but GPU overlays to composite.
    if (context.glPipeline && globalEffects.length === 0 && regionEffects.length === 0 && !hasOverlayMasks) {
      const { descriptors, textOverlays } = buildOverlayDescriptors(overlays, context, sourceWidth, sourceHeight);
      if (descriptors.length > 0) {
        await context.glPipeline.compositeOverlaysOnto(
          source, sourceWidth, sourceHeight, descriptors,
          ctx, drawX, drawY, drawWidth, drawHeight, canvasWidth, canvasHeight,
        );
        for (const overlay of textOverlays) {
          drawOverlay(ctx, overlay, context, sourceWidth, sourceHeight, drawX, drawY, drawWidth, drawHeight);
        }
        return;
      }
    }

    // GL hybrid path: global + region effects on GPU → buffer; overlay masking on CPU.
    if (context.glPipeline && hasOverlayMasks) {
      buffer.width = sourceWidth;
      buffer.height = sourceHeight;

      const regionOnlyEffects = regionEffects.filter(e => e.regionId);
      const glRegions = hasRegionEffects ? buildGLRegions(
        regionOnlyEffects, regions,
        sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight, 1.0, context.isFlipped,
      ) : [];

      await context.glPipeline.renderEffects(
        source, sourceWidth, sourceHeight,
        globalEffects, processConfig,
        bufferCtx, 0, 0, sourceWidth, sourceHeight, sourceWidth, sourceHeight,
        glRegions.length > 0 ? glRegions : undefined,
      );

      const compositedOverlayIds = applyRegionEffects(
        bufferCtx, regionEffects.filter(e => e.overlayId), regions, overlays,
        sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight,
        1.0, context, tick, true,
      );

      const { descriptors: remainingDescriptors, textOverlays: remainingTextOverlays } =
        buildOverlayDescriptors(overlays, context, sourceWidth, sourceHeight, compositedOverlayIds);

      await context.glPipeline.compositeOverlaysOnto(
        buffer, sourceWidth, sourceHeight,
        remainingDescriptors,
        ctx, drawX, drawY, drawWidth, drawHeight, canvasWidth, canvasHeight,
      );
      for (const overlay of remainingTextOverlays) {
        drawOverlay(ctx, overlay, context, sourceWidth, sourceHeight, drawX, drawY, drawWidth, drawHeight);
      }
      return;
    }

    // CPU-only fallback.
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    buffer.width = sourceWidth;
    buffer.height = sourceHeight;
    bufferCtx.drawImage(source, 0, 0, sourceWidth, sourceHeight);

    if (globalEffects.length > 0) {
      const imageData = bufferCtx.getImageData(0, 0, sourceWidth, sourceHeight);
      // Always the worker (timelineFrames are cloned over), so stateful effects
      // keep one copy of their cross-frame state.
      try {
        const buf = new Uint8ClampedArray(imageData.data);
        const processed = await processEffectsInWorker(buf, globalEffects, processConfig);
        bufferCtx.putImageData(
          new ImageData(new Uint8ClampedArray(processed), sourceWidth, sourceHeight), 0, 0,
        );
      } catch {
        applyEffects(imageData.data, globalEffects, processConfig);
        bufferCtx.putImageData(imageData, 0, 0);
      }
    }

    let compositedOverlayIds = new Set<string>();
    if (regionEffects.length > 0 || hasOverlayMasks) {
      const regionOnlyEffects = regionEffects.filter(e => e.regionId);
      const glRegions = (context.glPipeline && regionOnlyEffects.length > 0)
        ? buildGLRegions(
            regionOnlyEffects, regions,
            sourceWidth, sourceHeight, drawX, drawY, canvasWidth, canvasHeight, scale, context.isFlipped,
          )
        : null;
      if (glRegions && glRegions.length > 0) {
        await context.glPipeline!.renderEffects(
          buffer, sourceWidth, sourceHeight, [], processConfig, bufferCtx,
          0, 0, sourceWidth, sourceHeight, sourceWidth, sourceHeight, glRegions,
        );
      }
      compositedOverlayIds = applyRegionEffects(
        bufferCtx, regionEffects, regions, overlays,
        sourceWidth, sourceHeight, drawX, drawY, canvasWidth, canvasHeight,
        scale, context, tick, !!(glRegions && glRegions.length > 0),
      );
    }

    ctx.drawImage(buffer, drawX, drawY, drawWidth, drawHeight);

    for (const overlay of overlays) {
      if (!overlay.isEffectZone && !compositedOverlayIds.has(overlay.id)) {
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

  await renderStyleEffect(context, activeStyle, preStyleEffects, postStyleEffects, overlays);
}
