import { useEffect, useRef, useCallback } from "react";
import { renderWithEffects } from "../lib/effects/effects-renderer";
import type { Effect, Region, Overlay } from "../lib/effects/types";
import { detectFaces, requiresFaceDetection, type FaceBounds } from "../lib/effects/face-detector";
import { useRenderContext } from "./useRenderContext";

interface ActiveVideo {
  id: string;
  path: string;
  localTime: number;
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
  // Absolute filesystem path (Electron only) — use file:// scheme
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
}: UseVideoPlayerOptions) {
  const videosMapRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const animationFrameRef = useRef<number>();
  const tickRef = useRef(0);
  const faceBoundsRef = useRef<FaceBounds[]>([]);
  const lastFrameTimeRef = useRef(0);
  const skipEffectsRef = useRef(false);

  const { bufferRef, bufferCtxRef, glPipelineRef } = useRenderContext();

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
    };
  }, []);

  // Stable refs so the video-loading effect doesn't re-run when these change
  const onDurationChangeRef = useRef(onDurationChange);
  onDurationChangeRef.current = onDurationChange;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const renderRef = useRef<(() => Promise<void>) | null>(null);

  const render = useCallback(async () => {
    if (!canvas || activeVideos.length === 0) return;

    const ctx = canvas.getContext("2d");
    const primaryVideoDef = activeVideos[0];
    const primaryVideo = videosMapRef.current.get(primaryVideoDef.id);

    if (!ctx || !primaryVideo || primaryVideo.readyState < 2) {
      animationFrameRef.current = requestAnimationFrame(render);
      return;
    }

    if (!bufferRef.current || !bufferCtxRef.current) {
      animationFrameRef.current = requestAnimationFrame(render);
      return;
    }

    // Use the video's native dimensions for source processing; the canvas dimensions
    // are controlled by the selected resolution (set via JSX props) and should not
    // be overridden here — renderWithEffects letterboxes the source into the canvas.
    const videoW = primaryVideo.videoWidth || canvas.width;
    const videoH = primaryVideo.videoHeight || canvas.height;

    // Secondary videos for transitions/composition
    const secondaryFrames: ImageData[] = [];
    for (let i = 1; i < activeVideos.length; i++) {
      const secDef = activeVideos[i];
      const secVideo = videosMapRef.current.get(secDef.id);
      if (secVideo && secVideo.readyState >= 2) {
        // Draw secondary video to buffer to extract ImageData at source dimensions
        bufferCtxRef.current.drawImage(secVideo, 0, 0, videoW, videoH);
        secondaryFrames.push(
          bufferCtxRef.current.getImageData(0, 0, videoW, videoH)
        );
      }
    }

    const frameStart = performance.now();
    const FRAME_BUDGET_MS = 33;
    const skipEffects = skipEffectsRef.current;

    if (skipEffects) {
      skipEffectsRef.current = false;
    } else {
    if (tickRef.current % 10 === 0 && requiresFaceDetection(effects)) {
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
        overlays,
        getOverlaySource: (mediaId) => {
          return videosMapRef.current.get(mediaId) || null;
        }
      },
      effects.filter((e) => e.active),
      regions,
      overlays
    );
    }

    lastFrameTimeRef.current = performance.now() - frameStart;
    if (lastFrameTimeRef.current > FRAME_BUDGET_MS * 5) {
      skipEffectsRef.current = true;
    }

    if (onTimeUpdate) {
      onTimeUpdate(primaryVideo.currentTime);
    }

    tickRef.current++;

    if (isPlayingRef.current && !primaryVideo.paused) {
      animationFrameRef.current = requestAnimationFrame(() => renderRef.current?.());
    }
  }, [canvas, effects, onTimeUpdate, regions, overlays, activeVideos]);

  // Keep renderRef updated
  useEffect(() => {
    renderRef.current = render;
  }, [render]);

  // ── Video elements lifecycle ───────────────────────────────────────────────
  useEffect(() => {
    const map = videosMapRef.current;
    const allVideos = [...activeVideos, ...overlayVideos];
    const currentIds = new Set(allVideos.map((v) => v.id));

    // Remove old videos
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

    // Add new videos
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
             // Only report duration for the primary clip for simplicity
             if (vDef.id === activeVideos[0]?.id) {
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
        video.currentTime = vDef.localTime;
        video.load();
        
        map.set(vDef.id, video);
      }
    }

    // If no active videos and no overlay videos, clean up RAF
    if (allVideos.length === 0) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    }
  }, [activeVideos, overlayVideos]); // Runs when active media array shape changes

  // ── Play / pause (isPlaying changes) ─────────────────────────────────────
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

  // ── Seek (currentTime changes from outside) ────────────────────────────────
  useEffect(() => {
    let seeked = false;
    const allVideos = [...activeVideos, ...overlayVideos];
    for (const vDef of allVideos) {
      const video = videosMapRef.current.get(vDef.id);
      if (video && Math.abs(video.currentTime - vDef.localTime) > 0.1) {
        video.currentTime = vDef.localTime;
        seeked = true;
      }
    }
    
    if (seeked && !isPlaying) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      render();
    }
  }, [currentTime, activeVideos, isPlaying, render]);

  // ── Re-render on effects/regions change ──────────────────────────────────
  useEffect(() => {
    if (videosMapRef.current.size > 0 && canvas && !isPlaying) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      render();
    }
  }, [effects, regions, render, canvas, isPlaying]);

  return {};
}
