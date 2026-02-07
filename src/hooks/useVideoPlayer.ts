import { useEffect, useRef, useCallback, useState } from "react";
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
  const [faceBounds, setFaceBounds] = useState<FaceBounds[]>([]);
  
  // Buffer for effects
  const bufferRef = useRef<HTMLCanvasElement | null>(null);
  const bufferCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    const buffer = document.createElement("canvas");
    bufferRef.current = buffer;
    bufferCtxRef.current = buffer.getContext("2d", { willReadFrequently: true });
  }, []);

  const render = useCallback(async () => {
    if (!canvas || !videoRef.current) return;

    const ctx = canvas.getContext("2d");
    const video = videoRef.current;

    if (!ctx || video.readyState < 2) {
      animationFrameRef.current = requestAnimationFrame(render);
      return;
    }

    // Check buffer
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
        setFaceBounds(faces);
      } catch (error) {
        console.error("Face detection failed:", error);
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
        faceBounds,
      },
      effects.filter((e) => e.active),
      regions
    );

    if (onTimeUpdate) {
      onTimeUpdate(video.currentTime);
    }

    tickRef.current++;

    if (isPlaying && !video.paused) {
      animationFrameRef.current = requestAnimationFrame(render);
    }
  }, [canvas, effects, isPlaying, onTimeUpdate, faceBounds, regions]);

  useEffect(() => {
    if (!videoPath) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = "";
      }
      return;
    }

    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "auto";

    video.onloadedmetadata = () => {
      if (onDurationChange) {
        onDurationChange(video.duration);
      }
    };

    video.oncanplay = () => {
      videoRef.current = video;
      if (isPlaying) {
        video.play();
      }
      render();
    };

    video.onerror = () => {
      console.error("Failed to load video:", videoPath);
    };

    video.src = `file://${videoPath}`;

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      video.pause();
      video.src = "";
    };
  }, [videoPath, onDurationChange, render, isPlaying]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.play();
      render();
    } else {
      video.pause();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    }
  }, [isPlaying, render]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (Math.abs(video.currentTime - currentTime) > 0.1) {
      video.currentTime = currentTime;
      if (!isPlaying) {
        render();
      }
    }
  }, [currentTime, isPlaying, render]);

  useEffect(() => {
    if (videoRef.current && canvas && !isPlaying) {
      render();
    }
  }, [effects, render, canvas, isPlaying]);

  return {};
}
