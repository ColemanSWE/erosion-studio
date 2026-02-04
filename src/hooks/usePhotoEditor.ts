import { useEffect, useRef, useCallback } from "react";
import { renderWithEffects } from "../lib/effects/effects-renderer";
import type { Effect } from "../lib/effects/types";

interface UsePhotoEditorOptions {
  canvas: HTMLCanvasElement | null;
  effects: Effect[];
  imagePath?: string;
}

export function usePhotoEditor({
  canvas,
  effects,
  imagePath,
}: UsePhotoEditorOptions) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const animationFrameRef = useRef<number>();
  const tickRef = useRef(0);
  
  // Buffer canvas for effects processing
  const bufferRef = useRef<HTMLCanvasElement | null>(null);
  const bufferCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    const buffer = document.createElement("canvas");
    bufferRef.current = buffer;
    bufferCtxRef.current = buffer.getContext("2d", { willReadFrequently: true });
  }, []);

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
        tick: tickRef.current,
      },
      effects.filter((e) => e.active)
    );

    tickRef.current++;
    animationFrameRef.current = requestAnimationFrame(render);
  }, [canvas, effects]);

  useEffect(() => {
    if (!imagePath) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      imageRef.current = img;
      render();
    };

    img.onerror = () => {
      console.error("Failed to load image:", imagePath);
    };

    img.src = `file://${imagePath}`;

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
    async (format: "png" | "jpeg" | "webp" = "png", quality = 0.95) => {
      if (!canvas || !window.electron) {
        throw new Error("Canvas or Electron API not available");
      }

      const result = await window.electron.saveFile({
        filters: [
          { name: "PNG Image", extensions: ["png"] },
          { name: "JPEG Image", extensions: ["jpg", "jpeg"] },
          { name: "WebP Image", extensions: ["webp"] },
        ],
        defaultPath: `export.${format}`,
      });

      if (result.canceled || !result.filePath) {
        return null;
      }

      const dataUrl = canvas.toDataURL(`image/${format}`, quality);
      const base64Data = dataUrl.split(",")[1];
      const binaryStr = atob(base64Data);
      const len = binaryStr.length;
      const bytes = new Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      await window.electron.file.writeBinary(result.filePath, bytes);

      return { success: true, filePath: result.filePath };
    },
    [canvas]
  );

  return { exportImage };
}
