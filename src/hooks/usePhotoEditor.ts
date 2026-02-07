import { useEffect, useRef, useCallback, useState } from "react";
import { renderWithEffects } from "../lib/effects/effects-renderer";
import type { Effect, Region } from "../lib/effects/types";
import { detectFaces, type FaceBounds } from "../lib/effects/face-detector";
import { GIFEncoder, quantize, applyPalette } from "gifenc";

interface UsePhotoEditorOptions {
  canvas: HTMLCanvasElement | null;
  effects: Effect[];
  imagePath?: string;
  regions?: Region[];
}

export function usePhotoEditor({
  canvas,
  effects,
  imagePath,
  regions = [],
}: UsePhotoEditorOptions) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const animationFrameRef = useRef<number>();
  const tickRef = useRef(0);
  const [faceBounds, setFaceBounds] = useState<FaceBounds[]>([]);
  
  // Buffer canvas for effects processing
  const bufferRef = useRef<HTMLCanvasElement | null>(null);
  const bufferCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    const buffer = document.createElement("canvas");
    bufferRef.current = buffer;
    bufferCtxRef.current = buffer.getContext("2d", { willReadFrequently: true });
  }, []);

  const renderFrame = useCallback((tick: number) => {
    if (!canvas || !imageRef.current || !bufferRef.current || !bufferCtxRef.current) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = imageRef.current;

    renderWithEffects(
      {
        ctx,
        buffer: bufferRef.current,
        bufferCtx: bufferCtxRef.current,
        source: img,
        sourceWidth: canvas.width,
        sourceHeight: canvas.height,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        tick,
        faceBounds,
      },
      effects.filter((e) => e.active),
      regions
    );
  }, [canvas, effects, faceBounds, regions]);

  const render = useCallback(() => {
    if (!canvas || !imageRef.current) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = imageRef.current;
    
    // Ensure buffer is ready
    if (!bufferRef.current) {
         const buffer = document.createElement("canvas");
         bufferRef.current = buffer;
         bufferCtxRef.current = buffer.getContext("2d", { willReadFrequently: true });
    }
    if (!bufferCtxRef.current) return;

    // Update canvas size if needed
    if (canvas.width !== (img.naturalWidth || img.width)) {
       canvas.width = img.naturalWidth || img.width;
       canvas.height = img.naturalHeight || img.height;
    }

    renderFrame(tickRef.current);

    tickRef.current++;
    animationFrameRef.current = requestAnimationFrame(render);
  }, [canvas, renderFrame]);

  useEffect(() => {
    if (!imagePath) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = async () => {
      imageRef.current = img;
      
      try {
        const faces = await detectFaces(img);
        setFaceBounds(faces);
      } catch (error) {
        console.error("Face detection failed:", error);
        setFaceBounds([]);
      }
      
      render();
    };

    img.onerror = () => {
      console.error("Failed to load image:", imagePath);
    };

    img.src = imagePath.startsWith("data:") ? imagePath : `file://${imagePath}`;

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [imagePath, render]);

  useEffect(() => {
    if (imageRef.current && canvas) {
      render();
    }
  }, [effects, render, canvas]);

  const exportImage = useCallback(
    async (format: "png" | "jpeg" | "webp" | "gif" = "png", quality = 0.95) => {
      if (!canvas || !window.electron) {
        throw new Error("Canvas or Electron API not available");
      }

      const filters = [
        { name: "PNG Image", extensions: ["png"] },
        { name: "JPEG Image", extensions: ["jpg", "jpeg"] },
        { name: "WebP Image", extensions: ["webp"] },
        { name: "GIF Image", extensions: ["gif"] },
      ];

      const result = await window.electron.saveFile({
        filters,
        defaultPath: `export.${format}`,
      });

      if (result.canceled || !result.filePath) {
        return null;
      }

      const ext = result.filePath.split(".").pop()?.toLowerCase();
      const actualFormat: "png" | "jpeg" | "webp" | "gif" =
        ext === "jpg" || ext === "jpeg"
          ? "jpeg"
          : ext === "webp"
            ? "webp"
            : ext === "gif"
              ? "gif"
              : "png";

      let bytes: number[];

      if (actualFormat === "gif") {
        const fps = 30;
        const duration = 2000;
        const numFrames = Math.floor((fps * duration) / 1000);
        
        const gif = GIFEncoder();
        
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas context not available");
        
        // Generate a shared palette from the first frame
        renderFrame(0);
        const firstFrameData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const sharedPalette = quantize(firstFrameData.data, 256);
        
        for (let i = 0; i < numFrames; i++) {
          renderFrame(i);
          
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const index = applyPalette(imageData.data, sharedPalette);
          
          gif.writeFrame(index, canvas.width, canvas.height, {
            palette: sharedPalette,
            delay: Math.floor(1000 / fps),
          });
          
          // Yield to event loop every few frames to keep UI responsive
          if (i % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
        
        gif.finish();
        const buffer = gif.bytes();
        bytes = Array.from(buffer);
      } else {
        const dataUrl = canvas.toDataURL(`image/${actualFormat}`, quality);
        const base64Data = dataUrl.split(",")[1];
        const binaryStr = atob(base64Data);
        const len = binaryStr.length;
        bytes = new Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
      }

      await window.electron.file.writeBinary(result.filePath, bytes);

      return { success: true, filePath: result.filePath };
    },
    [canvas, renderFrame]
  );

  return { exportImage };
}