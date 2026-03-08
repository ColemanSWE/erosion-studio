import { useEffect, useRef, useCallback } from "react";
import { renderWithEffects } from "../lib/effects/effects-renderer";
import type { Effect, Region } from "../lib/effects/types";
import { detectFaces, type FaceBounds } from "../lib/effects/face-detector";

interface UseVideoPlayerOptions {
  canvas: HTMLCanvasElement | null;
  effects: Effect[];
  videoPath?: string;
  isPlaying: boolean;
  currentTime: number;
  regions?: Region[];
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
  videoPath,
  isPlaying,
  currentTime,
  regions = [],
  onTimeUpdate,
  onDurationChange,
}: UseVideoPlayerOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationFrameRef = useRef<number>();
  const tickRef = useRef(0);
  const faceBoundsRef = useRef<FaceBounds[]>([]);

  // Buffer for effects
  const bufferRef = useRef<HTMLCanvasElement | null>(null);
  const bufferCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    const buffer = document.createElement("canvas");
    bufferRef.current = buffer;
    bufferCtxRef.current = buffer.getContext("2d", { willReadFrequently: true });
  }, []);

  // Stable refs so the video-loading effect doesn't re-run when these change
  const onDurationChangeRef = useRef(onDurationChange);
  onDurationChangeRef.current = onDurationChange;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const renderRef = useRef<(() => Promise<void>) | null>(null);

  const render = useCallback(async () => {
    if (!canvas || !videoRef.current) return;

    const ctx = canvas.getContext("2d");
    const video = videoRef.current;

    if (!ctx || video.readyState < 2) {
      animationFrameRef.current = requestAnimationFrame(render);
      return;
    }

    if (!bufferRef.current || !bufferCtxRef.current) {
      animationFrameRef.current = requestAnimationFrame(render);
      return;
    }

    // Update dimensions
    if (canvas.width !== (video.videoWidth || 1920)) {
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
    }

    // Detect faces every 10 frames to reduce overhead
    if (tickRef.current % 10 === 0) {
      try {
        const faces = await detectFaces(video);
        faceBoundsRef.current = faces;
      } catch {
        faceBoundsRef.current = [];
      }
    }

    renderWithEffects(
      {
        ctx,
        buffer: bufferRef.current,
        bufferCtx: bufferCtxRef.current,
        source: video,
        sourceWidth: canvas.width,
        sourceHeight: canvas.height,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        tick: tickRef.current,
        faceBounds: faceBoundsRef.current,
      },
      effects.filter((e) => e.active),
      regions
    );

    if (onTimeUpdate) {
      onTimeUpdate(video.currentTime);
    }

    tickRef.current++;

    if (isPlayingRef.current && !video.paused) {
      animationFrameRef.current = requestAnimationFrame(render);
    }
  }, [canvas, effects, onTimeUpdate, regions]);

  // Keep renderRef updated
  useEffect(() => {
    renderRef.current = render;
  }, [render]);

  // ── Video element lifecycle (only re-run when videoPath changes) ────────────
  useEffect(() => {
    if (!videoPath) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = "";
        videoRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const video = document.createElement("video");
    video.preload = "auto";
    video.playsInline = true;
    // Don't set crossOrigin for blob: and local file: URLs — it breaks them
    const src = resolveVideoSrc(videoPath);
    const needsCrossOrigin =
      src.startsWith("http://") || src.startsWith("https://");
    if (needsCrossOrigin) video.crossOrigin = "anonymous";

    video.onloadedmetadata = () => {
      if (cancelled) return;
      const dur = video.duration;
      if (dur && isFinite(dur)) {
        onDurationChangeRef.current?.(dur);
      }
    };

    video.oncanplay = () => {
      if (cancelled) return;
      videoRef.current = video;
      if (isPlayingRef.current) {
        video.play().catch(() => {}); // ignore interrupted-by-pause errors
      }
      renderRef.current?.();
    };

    video.onerror = () => {
      if (!cancelled) {
        console.error("Failed to load video:", videoPath, "resolved as:", src);
      }
    };

    video.src = src;
    video.load();

    return () => {
      cancelled = true;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      // Give pending play() promise a tick to resolve before pausing
      requestAnimationFrame(() => {
        video.pause();
        video.src = "";
      });
    };
  }, [videoPath]); // intentionally only videoPath — stable refs handle the rest

  // ── Play / pause (isPlaying changes) ─────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.play().catch(() => {}); // ignore race-condition errors
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      render();
    } else {
      video.pause();
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    }
  }, [isPlaying, render]);

  // ── Seek (currentTime changes from outside) ────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (Math.abs(video.currentTime - currentTime) > 0.1) {
      video.currentTime = currentTime;
      if (!isPlaying) {
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        render();
      }
    }
  }, [currentTime, isPlaying, render]);

  // ── Re-render on effects/regions change ──────────────────────────────────
  useEffect(() => {
    if (videoRef.current && canvas && !isPlaying) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      render();
    }
  }, [effects, regions, render, canvas, isPlaying]);

  return {};
}
