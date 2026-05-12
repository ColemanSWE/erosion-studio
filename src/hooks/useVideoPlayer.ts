import { useEffect, useRef, useCallback } from "react";
import { renderWithEffects, computeDrawRect } from "../lib/effects/effects-renderer";
import { drawOverlay } from "../lib/effects/overlay-compositor";
import type { Effect, Region, Overlay } from "../lib/effects/types";
import { detectFaces, requiresFaceDetection, type FaceBounds } from "../lib/effects/face-detector";
import type { SourceTransform } from "../lib/project";
import { GifDecoder } from "../lib/gif-decoder";
import { useRenderContext } from "./useRenderContext";

interface ActiveVideo {
  id: string;
  path: string;
  clipStartTime: number;
}

interface OverlayImage {
  id: string;
  path: string;
}

type OverlayImageSource = HTMLImageElement | ImageBitmap;

function isGifPath(path: string): boolean {
  return path.toLowerCase().endsWith(".gif");
}

function resolveSrc(path: string): string {
  if (
    path.startsWith("data:") ||
    path.startsWith("blob:") ||
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("file://")
  ) {
    return path;
  }
  return `file://${path}`;
}

interface UseVideoPlayerOptions {
  canvas: HTMLCanvasElement | null;
  resolveEffects?: (time: number) => Effect[];
  effects: Effect[];
  activeVideos: ActiveVideo[];
  overlayVideos?: ActiveVideo[];
  overlayImages?: OverlayImage[];
  isPlaying: boolean;
  currentTime: number;
  regions?: Region[];
  overlays?: Overlay[];
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  sourceTransform?: SourceTransform;
}

function resolveVideoSrc(videoPath: string): string {
  if (
    videoPath.startsWith("blob:") ||
    videoPath.startsWith("data:") ||
    videoPath.startsWith("http://") ||
    videoPath.startsWith("https://") ||
    videoPath.startsWith("file://")
  ) {
    return videoPath;
  }
  return `file://${videoPath}`;
}

export function useVideoPlayer({
  canvas,
  resolveEffects,
  effects,
  activeVideos,
  overlayVideos = [],
  overlayImages = [],
  isPlaying,
  currentTime,
  regions = [],
  overlays = [],
  onTimeUpdate,
  onDurationChange,
  sourceTransform,
}: UseVideoPlayerOptions) {
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;

  const videosMapRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const overlayImagesMapRef = useRef<Map<string, OverlayImageSource>>(new Map());
  const gifDecodersRef = useRef<Map<string, GifDecoder>>(new Map());
  const loadingGifsRef = useRef<Set<string>>(new Set());
  const wantedImageIdsRef = useRef<Set<string>>(new Set());

  const animationFrameRef = useRef<number>();
  const rvfcHandleRef = useRef<number | undefined>(undefined);
  const rvfcVideoRef = useRef<HTMLVideoElement | null>(null);
  const gifTickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef(0);
  const faceBoundsRef = useRef<FaceBounds[]>([]);
  const faceDetectionRunningRef = useRef(false);
  const emaFrameTimeRef = useRef(0);

  // P4: dirty-checking refs — skip rendering when video frame + effects are unchanged
  const lastVideoTimeRef = useRef(-1);
  const lastEffectsRef = useRef<Effect[] | null>(null);
  const lastRegionsRef = useRef<Region[] | null>(null);
  const lastOverlaysRef = useRef<Overlay[] | null>(null);

  // Refs for volatile props — keeps render callback stable across re-renders.
  const resolveEffectsRef = useRef(resolveEffects);
  const effectsRef = useRef(effects);
  const activeVideosRef = useRef(activeVideos);
  const overlayVideosRef = useRef(overlayVideos);
  const overlayImagesRef = useRef(overlayImages);
  const regionsRef = useRef(regions);
  const overlaysRef = useRef(overlays);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const sourceTransformRef = useRef(sourceTransform);
  const currentTimeRef = useRef(currentTime);

  resolveEffectsRef.current = resolveEffects;
  effectsRef.current = effects;
  activeVideosRef.current = activeVideos;
  overlayVideosRef.current = overlayVideos;
  overlayImagesRef.current = overlayImages;
  regionsRef.current = regions;
  overlaysRef.current = overlays;
  onTimeUpdateRef.current = onTimeUpdate;
  sourceTransformRef.current = sourceTransform;
  currentTimeRef.current = currentTime;

  const { bufferRef, bufferCtxRef, glPipelineRef } = useRenderContext();

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
      if (rvfcHandleRef.current !== undefined) {
        (rvfcVideoRef.current as any)?.cancelVideoFrameCallback?.(rvfcHandleRef.current);
        rvfcHandleRef.current = undefined;
        rvfcVideoRef.current = null;
      }
      if (gifTickIntervalRef.current) {
        clearInterval(gifTickIntervalRef.current);
        gifTickIntervalRef.current = null;
      }
      for (const decoder of gifDecodersRef.current.values()) decoder.dispose();
      gifDecodersRef.current.clear();
    };
  }, []);

  const onDurationChangeRef = useRef(onDurationChange);
  onDurationChangeRef.current = onDurationChange;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const renderRef = useRef<(() => Promise<void>) | null>(null);

  const render = useCallback(async () => {
    const currentActiveVideos = activeVideosRef.current;
    if (!canvas || currentActiveVideos.length === 0) return;

    const ctx = canvas.getContext("2d");
    const primaryVideoDef = currentActiveVideos[0];
    const primaryVideo = videosMapRef.current.get(primaryVideoDef.id);

    if (!ctx || !primaryVideo || primaryVideo.readyState < 2) {
      if (!primaryVideo?.error) {
        animationFrameRef.current = requestAnimationFrame(render);
      }
      return;
    }

    if (!bufferRef.current || !bufferCtxRef.current) {
      animationFrameRef.current = requestAnimationFrame(render);
      return;
    }

    const videoW = primaryVideo.videoWidth || canvas.width;
    const videoH = primaryVideo.videoHeight || canvas.height;

    // P4: skip rendering when the video frame and all reactive state are unchanged.
    const currentVideoTime = primaryVideo.currentTime;
    const hasNewVideoFrame = Math.abs(currentVideoTime - lastVideoTimeRef.current) > 0.0001;
    const effectsUnchanged =
      effectsRef.current === lastEffectsRef.current &&
      regionsRef.current === lastRegionsRef.current &&
      overlaysRef.current === lastOverlaysRef.current;

    if (isPlayingRef.current && !hasNewVideoFrame && effectsUnchanged) {
      tickRef.current++;
      if ("requestVideoFrameCallback" in primaryVideo) {
        rvfcHandleRef.current = (primaryVideo as any).requestVideoFrameCallback(() => {
          rvfcHandleRef.current = undefined;
          rvfcVideoRef.current = null;
          renderRef.current?.();
        });
        rvfcVideoRef.current = primaryVideo;
      } else {
        animationFrameRef.current = requestAnimationFrame(() => renderRef.current?.());
      }
      return;
    }

    if (hasNewVideoFrame) lastVideoTimeRef.current = currentVideoTime;
    lastEffectsRef.current = effectsRef.current;
    lastRegionsRef.current = regionsRef.current;
    lastOverlaysRef.current = overlaysRef.current;

    // Only extract secondary video frames when an active effect actually reads them.
    // Most effects don't use timelineFrames; skipping this saves 2x createImageBitmap
    // + getImageData per frame for every multi-clip timeline that has no such effect.
    const needsTimelineFrames =
      currentActiveVideos.length > 1 &&
      effectsRef.current.some((e) => {
        if (!e.active) return false;
        if (e.type === "datamosh") return true;
        if (e.type === "motion-smear" && (e.params as Record<string, unknown>)?.mode === "bloom") return true;
        return false;
      });

    const secondaryFrames: ImageData[] = [];
    if (needsTimelineFrames) {
      const bitmaps = await Promise.all(
        currentActiveVideos.slice(1).map(async (secDef) => {
          const secVideo = videosMapRef.current.get(secDef.id);
          if (!secVideo || secVideo.readyState < 2) return null;
          try {
            return await createImageBitmap(secVideo, { resizeWidth: videoW, resizeHeight: videoH, resizeQuality: "pixelated" });
          } catch {
            return null;
          }
        }),
      );
      for (const bitmap of bitmaps) {
        if (!bitmap) continue;
        bufferCtxRef.current.drawImage(bitmap, 0, 0, videoW, videoH);
        secondaryFrames.push(bufferCtxRef.current.getImageData(0, 0, videoW, videoH));
        bitmap.close();
      }
    }

    const frameStart = performance.now();
    const FRAME_BUDGET_MS = 33;

    const ema = emaFrameTimeRef.current;
    const skipEffects = ema > FRAME_BUDGET_MS * 4;
    const throttleEffects = !skipEffects && ema > FRAME_BUDGET_MS * 2 && tickRef.current % 2 !== 0;

    if (!skipEffects && !throttleEffects) {
      // P3: fire-and-forget face detection — cache last result, update asynchronously.
      if (tickRef.current % 10 === 0 && requiresFaceDetection(effectsRef.current) && !faceDetectionRunningRef.current) {
        faceDetectionRunningRef.current = true;
        detectFaces(primaryVideo)
          .then((bounds) => { faceBoundsRef.current = bounds; })
          .catch(() => { faceBoundsRef.current = []; })
          .finally(() => { faceDetectionRunningRef.current = false; });
      }

      // P2: resolve effects using accurate video time (not throttled store time).
      const liveTime = primaryVideoDef.clipStartTime + primaryVideo.currentTime;

      // Periodically correct overlay video drift — overlays play independently after play()
      // so their internal clock can diverge from the primary video's decoded time.
      if (tickRef.current % 15 === 0) {
        for (const vDef of overlayVideosRef.current) {
          const ov = videosMapRef.current.get(vDef.id);
          if (!ov || ov.readyState < 2) continue;
          const expected = Math.max(0, liveTime - vDef.clipStartTime);
          if (Math.abs(ov.currentTime - expected) > 0.15) {
            ov.currentTime = expected;
          }
        }
      }

      const liveEffects = resolveEffectsRef.current
        ? resolveEffectsRef.current(liveTime)
        : effectsRef.current.filter(e => e.active);

      await renderWithEffects(
        {
          ctx,
          buffer: bufferRef.current,
          bufferCtx: bufferCtxRef.current,
          source: primaryVideo,
          sourceWidth: videoW,
          sourceHeight: videoH,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          tick: tickRef.current,
          faceBounds: faceBoundsRef.current,
          timelineFrames: secondaryFrames,
          glPipeline: glPipelineRef.current ?? undefined,
          overlays: overlaysRef.current,
          getOverlaySource: (id) =>
            videosMapRef.current.get(id) ||
            overlayImagesMapRef.current.get(id) ||
            null,
          sourceTransform: sourceTransformRef.current,
        },
        liveEffects,
        regionsRef.current,
        overlaysRef.current,
      );
    } else {
      // Draw raw video without effects so the canvas stays in sync with the video clock.
      const { drawX, drawY, drawWidth, drawHeight } = computeDrawRect(
        videoW, videoH, canvas.width, canvas.height, sourceTransformRef.current,
      );
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(primaryVideo, drawX, drawY, drawWidth, drawHeight);
      // Draw overlays cheaply (no effects) so they remain visible during load-shedding.
      const overlayCtx = {
        getOverlaySource: (id: string) =>
          videosMapRef.current.get(id) || overlayImagesMapRef.current.get(id) || null,
        sourceTransform: sourceTransformRef.current,
      } as unknown as import("../lib/effects/render-types").RenderContext;
      for (const overlay of overlaysRef.current) {
        if (overlay.isEffectZone) continue;
        drawOverlay(ctx, overlay, overlayCtx, videoW, videoH, drawX, drawY, drawWidth, drawHeight);
      }
    }

    const elapsed = performance.now() - frameStart;
    emaFrameTimeRef.current = emaFrameTimeRef.current * 0.8 + elapsed * 0.2;

    if (onTimeUpdateRef.current) {
      onTimeUpdateRef.current(primaryVideo.currentTime);
    }

    tickRef.current++;

    if (isPlayingRef.current && !primaryVideo.paused) {
      if ("requestVideoFrameCallback" in primaryVideo) {
        rvfcHandleRef.current = (primaryVideo as any).requestVideoFrameCallback(() => {
          rvfcHandleRef.current = undefined;
          rvfcVideoRef.current = null;
          renderRef.current?.();
        });
        rvfcVideoRef.current = primaryVideo;
      } else {
        animationFrameRef.current = requestAnimationFrame(() => renderRef.current?.());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas]);

  useEffect(() => {
    renderRef.current = render;
  }, [render]);

  const seekAndRender = useCallback(async (time: number): Promise<void> => {
    const allVideos = [...activeVideosRef.current, ...overlayVideosRef.current];

    await Promise.all(
      allVideos.map((vDef) => {
        const video = videosMapRef.current.get(vDef.id);
        if (!video) return Promise.resolve();
        const localTime = Math.max(0, time - vDef.clipStartTime);
        if (Math.abs(video.currentTime - localTime) < 0.001) return Promise.resolve();
        return new Promise<void>((resolve) => {
          const onSeeked = () => {
            video.removeEventListener("seeked", onSeeked);
            resolve();
          };
          video.addEventListener("seeked", onSeeked);
          video.currentTime = localTime;
        });
      }),
    );

    lastVideoTimeRef.current = -1;

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }
    if (rvfcHandleRef.current !== undefined) {
      (rvfcVideoRef.current as any)?.cancelVideoFrameCallback?.(rvfcHandleRef.current);
      rvfcHandleRef.current = undefined;
      rvfcVideoRef.current = null;
    }

    await renderRef.current?.();
  }, []);

  // ── GIF frame advancement — runs on a dedicated interval, not in the RAF loop ──
  useEffect(() => {
    if (gifTickIntervalRef.current) {
      clearInterval(gifTickIntervalRef.current);
      gifTickIntervalRef.current = null;
    }

    gifTickIntervalRef.current = setInterval(() => {
      const now = performance.now();
      let anyAdvanced = false;
      for (const [id, decoder] of gifDecodersRef.current.entries()) {
        decoder.tick(now).then((advanced) => {
          if (advanced && decoder.bitmap) {
            overlayImagesMapRef.current.set(id, decoder.bitmap);
            anyAdvanced = true;
          }
        });
      }
      if (anyAdvanced && !isPlayingRef.current) {
        renderRef.current?.();
      }
    }, 33);

    return () => {
      if (gifTickIntervalRef.current) {
        clearInterval(gifTickIntervalRef.current);
        gifTickIntervalRef.current = null;
      }
    };
  }, []);

  // ── Image overlay lifecycle (static images + animated GIFs) ──────────────
  useEffect(() => {
    const map = overlayImagesMapRef.current;
    const gifDecoders = gifDecodersRef.current;
    const loadingGifs = loadingGifsRef.current;
    const ids = new Set(overlayImages.map((i) => i.id));
    wantedImageIdsRef.current = ids;

    for (const [id] of map.entries()) {
      if (!ids.has(id)) map.delete(id);
    }
    for (const [id, decoder] of gifDecoders.entries()) {
      if (!ids.has(id)) { decoder.dispose(); gifDecoders.delete(id); }
    }
    for (const id of loadingGifs) {
      if (!ids.has(id)) loadingGifs.delete(id);
    }

    for (const imgDef of overlayImages) {
      if (map.has(imgDef.id) || gifDecoders.has(imgDef.id) || loadingGifs.has(imgDef.id)) continue;

      if (isGifPath(imgDef.path)) {
        loadingGifs.add(imgDef.id);
        GifDecoder.create(imgDef.path)
          .then((decoder) => {
            loadingGifs.delete(imgDef.id);
            if (!wantedImageIdsRef.current.has(imgDef.id)) { decoder.dispose(); return; }
            gifDecoders.set(imgDef.id, decoder);
            if (decoder.bitmap) map.set(imgDef.id, decoder.bitmap);
            renderRef.current?.();
          })
          .catch((err) => {
            loadingGifs.delete(imgDef.id);
            console.error("Failed to load overlay GIF:", imgDef.path, err);
          });
      } else {
        const img = new Image();
        if (!imgDef.path.startsWith("blob:") && !imgDef.path.startsWith("data:")) {
          img.crossOrigin = "anonymous";
        }
        img.onload = () => renderRef.current?.();
        img.onerror = () => console.error("Failed to load overlay image:", imgDef.path);
        img.src = resolveSrc(imgDef.path);
        map.set(imgDef.id, img);
      }
    }
  }, [overlayImages]);

  // ── Video elements lifecycle ───────────────────────────────────────────────
  useEffect(() => {
    const map = videosMapRef.current;
    const allVideos = [...activeVideos, ...overlayVideos];
    const currentIds = new Set(allVideos.map((v) => v.id));

    // Build a src→newId map for the incoming entries so the cleanup loop can
    // re-key an element (same file, new clip ID) instead of destroying it.
    const incomingSrcToId = new Map<string, string>();
    for (const vDef of allVideos) {
      incomingSrcToId.set(resolveVideoSrc(vDef.path), vDef.id);
    }

    for (const [id, video] of map.entries()) {
      if (!currentIds.has(id)) {
        const newId = incomingSrcToId.get(video.src);
        if (newId && !map.has(newId)) {
          // Same file is still needed under a different clip ID — re-key it and
          // seek to the correct local time for the new clip.
          map.set(newId, video);
          map.delete(id);
          const newDef = allVideos.find((v) => v.id === newId);
          if (newDef) {
            const localTime = Math.max(0, currentTimeRef.current - newDef.clipStartTime);
            video.currentTime = localTime;
          }
        } else {
          video.onerror = null;
          video.onloadedmetadata = null;
          video.oncanplay = null;
          video.pause();
          video.src = "";
          map.delete(id);
        }
      }
    }

    for (const vDef of allVideos) {
      if (!map.has(vDef.id)) {
        const video = document.createElement("video");
        video.preload = "auto";
        video.playsInline = true;

        const src = resolveVideoSrc(vDef.path);
        const needsCrossOrigin = src.startsWith("http://") || src.startsWith("https://");
        if (needsCrossOrigin) video.crossOrigin = "anonymous";

        video.onloadedmetadata = () => {
          const dur = video.duration;
          if (dur && isFinite(dur)) {
            if (vDef.id === activeVideosRef.current[0]?.id) {
              onDurationChangeRef.current?.(dur);
            }
          }
        };

        video.oncanplay = () => {
          if (isPlayingRef.current) {
            video.play().catch(() => {});
          }
          renderRef.current?.();
        };

        video.onerror = () => {
          console.error("Failed to load video:", vDef.path, "resolved as:", src);
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = undefined;
          }
          const c = canvasRef.current;
          if (!c) return;
          const ctx2d = c.getContext("2d");
          if (!ctx2d) return;
          const fs = Math.max(12, Math.floor(c.height / 22));
          ctx2d.fillStyle = "#141414";
          ctx2d.fillRect(0, 0, c.width, c.height);
          ctx2d.textAlign = "center";
          ctx2d.fillStyle = "#555";
          ctx2d.font = `${fs}px monospace`;
          ctx2d.fillText("Video format not supported", c.width / 2, c.height / 2 - fs * 0.8);
          ctx2d.fillStyle = "#3a3a3a";
          ctx2d.font = `${Math.max(10, Math.floor(fs * 0.75))}px monospace`;
          ctx2d.fillText("Re-encode to H.264 MP4 to play in preview", c.width / 2, c.height / 2 + fs * 0.8);
        };

        video.src = src;
        video.currentTime = currentTimeRef.current - vDef.clipStartTime;
        video.load();

        map.set(vDef.id, video);
      }
    }

    if (allVideos.length === 0) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    }
  }, [activeVideos, overlayVideos]);

  // ── Play / pause ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (isPlaying) {
      for (const video of videosMapRef.current.values()) {
        video.play().catch(() => {});
      }
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      render();
    } else {
      for (const video of videosMapRef.current.values()) {
        video.pause();
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
      if (rvfcHandleRef.current !== undefined) {
        (rvfcVideoRef.current as any)?.cancelVideoFrameCallback?.(rvfcHandleRef.current);
        rvfcHandleRef.current = undefined;
        rvfcVideoRef.current = null;
      }
    }
  }, [isPlaying, render]);

  // ── Seek (scrubbing while paused) ─────────────────────────────────────────
  // activeVideos/overlayVideos are read from refs (always current) so we don't
  // need them as deps — avoids triggering on every new-array-reference from
  // resolveRenderSources (e.g. during preview overlay position drags).
  useEffect(() => {
    if (isPlaying) return;

    let seeked = false;
    const allVideos = [...activeVideosRef.current, ...overlayVideosRef.current];
    for (const vDef of allVideos) {
      const video = videosMapRef.current.get(vDef.id);
      const localTime = currentTimeRef.current - vDef.clipStartTime;
      if (video && Math.abs(video.currentTime - localTime) > 0.1) {
        video.currentTime = localTime;
        seeked = true;
      }
    }

    if (seeked) {
      // Reset dirty-check so the seeked frame always renders.
      lastVideoTimeRef.current = -1;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      render();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, isPlaying, render]);

  // ── Re-render on effects/regions/overlays change ─────────────────────────
  useEffect(() => {
    if (videosMapRef.current.size > 0 && canvas && !isPlaying) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      render();
    }
  }, [effects, regions, overlays, render, canvas, isPlaying]);

  return { seekAndRender };
}
