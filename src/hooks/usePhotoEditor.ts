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

  const render = useCallback(() => {
    if (!canvas || !imageRef.current) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = imageRef.current;

    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    if (effects.length > 0) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      renderWithEffects(
        imageData.data,
        {
          width: canvas.width,
          height: canvas.height,
          time: tickRef.current,
        },
        effects.filter((e) => e.active)
      );

      ctx.putImageData(imageData, 0, 0);
    }

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

      return { filePath: result.filePath, data: base64Data };
    },
    [canvas]
  );

  return { exportImage };
}
