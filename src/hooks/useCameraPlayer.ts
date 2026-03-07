import { useEffect, useRef, useCallback, useState } from "react";
import { renderWithEffects } from "../lib/effects/effects-renderer";
import type { Effect, Region } from "../lib/effects/types";
import { detectFaces, type FaceBounds } from "../lib/effects/face-detector";

interface UseCameraPlayerOptions {
  canvas: HTMLCanvasElement | null;
  effects: Effect[];
  isActive: boolean;
  regions?: Region[];
}

export function useCameraPlayer({
  canvas,
  effects,
  isActive,
  regions = [],
}: UseCameraPlayerOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationFrameRef = useRef<number>();
  const tickRef = useRef(0);
  const [faceBounds, setFaceBounds] = useState<FaceBounds[]>([]);
  
  // Buffer for effects
  const bufferRef = useRef<HTMLCanvasElement | null>(null);
  const bufferCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    const buffer = document.createElement("canvas");
    bufferRef.current = buffer;
    bufferCtxRef.current = buffer.getContext("2d", { willReadFrequently: true });
  }, []);

  const render = useCallback(async () => {
    if (!canvas || !videoRef.current || !isActive) return;

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

    // For camera, we want to horizontally flip the context so the user sees a mirror image
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);

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

    ctx.restore();

    tickRef.current++;

    if (isActive) {
      animationFrameRef.current = requestAnimationFrame(render);
    }
  }, [canvas, effects, isActive, faceBounds, regions]);

  useEffect(() => {
    let activeStream: MediaStream | null = null;
    let isCancelled = false;

    async function startCamera() {
      if (!isActive) return;
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
          audio: false
        });
        
        if (isCancelled) {
          mediaStream.getTracks().forEach(track => track.stop());
          return;
        }

        activeStream = mediaStream;
        setStream(mediaStream);

        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.srcObject = mediaStream;

        video.onloadedmetadata = () => {
           video.play();
           videoRef.current = video;
           render();
        };

      } catch (err) {
        console.error("Error accessing camera:", err);
      }
    }

    if (isActive) {
      startCamera();
    } else {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        setStream(null);
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.pause();
        videoRef.current = null;
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    }

    return () => {
      isCancelled = true;
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isActive]); 

  useEffect(() => {
    if (videoRef.current && canvas && isActive) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      render();
    }
  }, [effects, regions, render, canvas, isActive]);

  return {};
}
