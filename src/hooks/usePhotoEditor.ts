import { useEffect, useRef, useCallback, useState } from "react";
import { renderWithEffects } from "../lib/effects/effects-renderer";
import type { Effect } from "../lib/effects/types";
import { detectFaces, type FaceBounds } from "../lib/effects/face-detector";
import { GIFEncoder, quantize, applyPalette } from "gifenc";

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
  const [faceBounds, setFaceBounds] = useState<FaceBounds[]>([]);
  
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
        faceBounds,
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

      let bytes: number[];

      if (format === "gif") {
        const fps = 30;
        const duration = 2000;
        const numFrames = Math.floor((fps * duration) / 1000);
        
        const gif = GIFEncoder();
        
        for (let i = 0; i < numFrames; i++) {
          tickRef.current = i;
          render();
          
          await new Promise(resolve => setTimeout(resolve, 0));
          
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const palette = quantize(imageData.data, 256);
          const index = applyPalette(imageData.data, palette);
          
          gif.writeFrame(index, canvas.width, canvas.height, {
            palette,
            delay: Math.floor(1000 / fps),
          });
        }
        
        gif.finish();
        const buffer = gif.bytes();
        bytes = Array.from(buffer);
      } else {
        const dataUrl = canvas.toDataURL(`image/${format}`, quality);
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
    [canvas, render]
  );

  return { exportImage };
}
