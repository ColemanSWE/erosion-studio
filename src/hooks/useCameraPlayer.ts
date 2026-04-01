import { useEffect, useRef, useCallback, useState } from "react";
import { renderWithEffects } from "../lib/effects/effects-renderer";
import type { Effect, Region, Overlay } from "../lib/effects/types";
import { detectFaces, requiresFaceDetection, type FaceBounds } from "../lib/effects/face-detector";
import { useRenderContext } from "./useRenderContext";

interface UseCameraPlayerOptions {
  canvas: HTMLCanvasElement | null;
  effects: Effect[];
  isActive: boolean;
  regions?: Region[];
  overlays?: Overlay[];
}

export function useCameraPlayer({
  canvas,
  effects,
  isActive,
  regions = [],
  overlays = [],
}: UseCameraPlayerOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationFrameRef = useRef<number>();
  const renderRef = useRef<(() => Promise<void>) | null>(null);
  const tickRef = useRef(0);
  const { bufferRef, bufferCtxRef, glPipelineRef } = useRenderContext();
  const faceBoundsRef = useRef<FaceBounds[]>([]);

  const [stream, setStream] = useState<MediaStream | null>(null);

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

    // Use the camera's native dimensions for source processing; canvas dimensions
    // are controlled by the selected resolution.
    const videoW = video.videoWidth || canvas.width;
    const videoH = video.videoHeight || canvas.height;

    if (tickRef.current % 10 === 0 && requiresFaceDetection(effects)) {
      try {
        faceBoundsRef.current = await detectFaces(video);
      } catch (error) {
        console.error("Face detection failed:", error);
      }
    }

    // For camera, we want to horizontally flip the context so the user sees a mirror image
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);

    await renderWithEffects(
      {
        ctx,
        buffer: bufferRef.current,
        bufferCtx: bufferCtxRef.current,
        source: video,
        sourceWidth: videoW,
        sourceHeight: videoH,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        tick: tickRef.current,
        faceBounds: faceBoundsRef.current,
        isFlipped: true,
        glPipeline: glPipelineRef.current ?? undefined,
        overlays,
      },
      effects.filter((e) => e.active),
      regions,
      overlays
    );

    ctx.restore();

    tickRef.current++;

    if (isActive) {
      animationFrameRef.current = requestAnimationFrame(() => renderRef.current?.());
    }
  }, [canvas, effects, isActive, regions, overlays]);

  useEffect(() => {
    renderRef.current = render;
  }, [render]);

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
  }, [effects, regions, overlays, render, canvas, isActive]);

  return { stream, videoRef };
}
