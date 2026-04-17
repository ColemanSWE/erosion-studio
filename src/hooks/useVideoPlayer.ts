import { useEffect, useRef, useCallback } from "react";
import { renderWithEffects } from "../lib/effects/effects-renderer";
import type { Effect, Region, Overlay } from "../lib/effects/types";
import { detectFaces, requiresFaceDetection, type FaceBounds } from "../lib/effects/face-detector";
import type { SourceTransform } from "../lib/project";
import { useRenderContext } from "./useRenderContext";

interface ActiveVideo {
  id: string;
  path: string;
  clipStartTime: number;
}

interface UseVideoPlayerOptions {
  canvas: HTMLCanvasElement | null;
  effects: Effect[];
  activeVideos: ActiveVideo[];
  overlayVideos?: ActiveVideo[];
  isPlaying: boolean;
  currentTime: number;
  regions?: Region[];
  overlays?: Overlay[];
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  sourceTransform?: SourceTransform;
}

/** Resolve a video path to a URL the HTML video element can load.
 *  - blob: / data: / http: → pass through as-is
 *  - Absolute paths → file:// (works when webSecurity: false in Electron)
 */
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
  effects,
  activeVideos,
  overlayVideos = [],
  isPlaying,
  currentTime,
  regions = [],
  overlays = [],
  onTimeUpdate,
  onDurationChange,
  sourceTransform,
}: UseVideoPlayerOptions) {
  const videosMapRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const animationFrameRef = useRef<number>();
  const tickRef = useRef(0);
  const faceBoundsRef = useRef<FaceBounds[]>([]);
  const emaFrameTimeRef = useRef(0);

  // Refs for all volatile props — keeps the render callback identity stable across frames.
  // Without this, every re-render caused by setCurrentTime would create a new `render`
  // function, which would cause the play/pause effect to cancel and restart the RAF loop.
  const effectsRef = useRef(effects);
  const activeVideosRef = useRef(activeVideos);
  const overlayVideosRef = useRef(overlayVideos);
  const regionsRef = useRef(regions);
  const overlaysRef = useRef(overlays);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const sourceTransformRef = useRef(sourceTransform);
  const currentTimeRef = useRef(currentTime);

  effectsRef.current = effects;
  activeVideosRef.current = activeVideos;
  overlayVideosRef.current = overlayVideos;
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
    };
  }, []);

  const onDurationChangeRef = useRef(onDurationChange);
  onDurationChangeRef.current = onDurationChange;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const renderRef = useRef<(() => Promise<void>) | null>(null);

  // `canvas` is the only dep — all other values are read from refs so this
  // function keeps the same identity for the entire mount. This prevents the
  // play/pause effect (which lists `render` as a dep) from canceling and
  // restarting the RAF loop on every frame.
  const render = useCallback(async () => {
    const currentActiveVideos = activeVideosRef.current;
    if (!canvas || currentActiveVideos.length === 0) return;

    const ctx = canvas.getContext("2d");
    const primaryVideoDef = currentActiveVideos[0];
    const primaryVideo = videosMapRef.current.get(primaryVideoDef.id);

    if (!ctx || !primaryVideo || primaryVideo.readyState < 2) {
      animationFrameRef.current = requestAnimationFrame(render);
      return;
    }

    if (!bufferRef.current || !bufferCtxRef.current) {
      animationFrameRef.current = requestAnimationFrame(render);
      return;
    }

    const videoW = primaryVideo.videoWidth || canvas.width;
    const videoH = primaryVideo.videoHeight || canvas.height;

    const secondaryFrames: ImageData[] = [];
    for (let i = 1; i < currentActiveVideos.length; i++) {
      const secDef = currentActiveVideos[i];
      const secVideo = videosMapRef.current.get(secDef.id);
      if (secVideo && secVideo.readyState >= 2) {
        bufferCtxRef.current.drawImage(secVideo, 0, 0, videoW, videoH);
        secondaryFrames.push(bufferCtxRef.current.getImageData(0, 0, videoW, videoH));
      }
    }

    const frameStart = performance.now();
    const FRAME_BUDGET_MS = 33;

    const ema = emaFrameTimeRef.current;
    const skipEffects = ema > FRAME_BUDGET_MS * 4;
    const throttleEffects = !skipEffects && ema > FRAME_BUDGET_MS * 2 && tickRef.current % 2 !== 0;

    if (!skipEffects && !throttleEffects) {
      if (tickRef.current % 10 === 0 && requiresFaceDetection(effectsRef.current)) {
        try {
          faceBoundsRef.current = await detectFaces(primaryVideo);
        } catch {
          faceBoundsRef.current = [];
        }
      }

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
          getOverlaySource: (mediaId) => videosMapRef.current.get(mediaId) || null,
          sourceTransform: sourceTransformRef.current,
        },
        effectsRef.current.filter((e) => e.active),
        regionsRef.current,
        overlaysRef.current,
      );
    }

    const elapsed = performance.now() - frameStart;
    emaFrameTimeRef.current = emaFrameTimeRef.current * 0.8 + elapsed * 0.2;

    if (onTimeUpdateRef.current) {
      onTimeUpdateRef.current(primaryVideo.currentTime);
    }

    tickRef.current++;

    if (isPlayingRef.current && !primaryVideo.paused) {
      animationFrameRef.current = requestAnimationFrame(() => renderRef.current?.());
    }
  }, [canvas]);

  useEffect(() => {
    renderRef.current = render;
  }, [render]);

  // ── Video elements lifecycle ───────────────────────────────────────────────
  useEffect(() => {
    const map = videosMapRef.current;
    const allVideos = [...activeVideos, ...overlayVideos];
    const currentIds = new Set(allVideos.map((v) => v.id));

    for (const [id, video] of map.entries()) {
      if (!currentIds.has(id)) {
        video.onerror = null;
        video.onloadedmetadata = null;
        video.oncanplay = null;
        video.pause();
        video.src = "";
        map.delete(id);
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
  // `render` is stable (depends only on `canvas`), so this effect only fires
  // when isPlaying actually changes — not on every frame.
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
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    }
  }, [isPlaying, render]);

  // ── Seek (scrubbing while paused) ─────────────────────────────────────────
  // During playback, videos run natively — no manual seeking needed.
  // The early return eliminates all per-frame work when this effect fires from
  // a throttled store update while playing.
  useEffect(() => {
    if (isPlaying) return;

    let seeked = false;
    const allVideos = [...activeVideos, ...overlayVideos];
    for (const vDef of allVideos) {
      const video = videosMapRef.current.get(vDef.id);
      const localTime = currentTimeRef.current - vDef.clipStartTime;
      if (video && Math.abs(video.currentTime - localTime) > 0.1) {
        video.currentTime = localTime;
        seeked = true;
      }
    }

    if (seeked) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      render();
    }
  }, [currentTime, activeVideos, overlayVideos, isPlaying, render]);

  // ── Re-render on effects/regions change ──────────────────────────────────
  useEffect(() => {
    if (videosMapRef.current.size > 0 && canvas && !isPlaying) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      render();
    }
  }, [effects, regions, render, canvas, isPlaying]);

  return {};
}
