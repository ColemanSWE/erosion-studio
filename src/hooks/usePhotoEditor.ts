import { useEffect, useRef, useCallback, useState } from "react";
import { renderWithEffects, type GLPipeline } from "../lib/effects/effects-renderer";
import type { Effect, Region, Overlay } from "../lib/effects/types";
import { detectFaces, type FaceBounds } from "../lib/effects/face-detector";
import { GIFEncoder, quantize, applyPalette } from "gifenc";

interface ActiveImage {
  id: string;
  path: string;
}

interface UsePhotoEditorOptions {
  canvas: HTMLCanvasElement | null;
  effects: Effect[];
  activeImages: ActiveImage[];
  regions?: Region[];
  overlays?: Overlay[];
}

export function usePhotoEditor({
  canvas,
  effects,
  activeImages,
  regions = [],
  overlays = [],
}: UsePhotoEditorOptions) {
  const imagesMapRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const animationFrameRef = useRef<number>();
  const tickRef = useRef(0);
  const faceBoundsRef = useRef<FaceBounds[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);

  const bufferRef = useRef<HTMLCanvasElement | null>(null);
  const bufferCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const glPipelineRef = useRef<GLPipeline | null>(null);

  useEffect(() => {
    const buffer = document.createElement("canvas");
    bufferRef.current = buffer;
    bufferCtxRef.current = buffer.getContext("2d", { willReadFrequently: true });

    // Lazy GL pipeline — falls back gracefully if WebGL2 is unavailable
    import("../lib/effects/gl/pipeline").then(({ GLPipeline }) => {
      glPipelineRef.current = GLPipeline.tryCreate();
    });

    return () => {
      glPipelineRef.current?.dispose();
      glPipelineRef.current = null;
    };
  }, []);

  // Check if any effects need animation
  useEffect(() => {
    const needsAnimation = effects.some(e => 
      e.active && [
        'glitch', 'datamosh', 'vhs', 'scanlines', 'crt', 
        'chromatic', 'pixelshift', 'rgbshift', 'timewarp',
        'bitcrush', 'pixelsort', 'slitscan', 'feedback'
      ].includes(e.type)
    );
    setIsAnimating(needsAnimation);
  }, [effects]);

  const renderFrame = useCallback((tick: number) => {
    if (!canvas || activeImages.length === 0 || !bufferRef.current || !bufferCtxRef.current) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const primaryImageDef = activeImages[0];
    const primaryImage = imagesMapRef.current.get(primaryImageDef.id);
    if (!primaryImage) return;

    // Secondary images for transitions
    const secondaryFrames: ImageData[] = [];
    for (let i = 1; i < activeImages.length; i++) {
        const secDef = activeImages[i];
        const secImage = imagesMapRef.current.get(secDef.id);
        if (secImage) {
            bufferCtxRef.current.drawImage(secImage, 0, 0, canvas.width, canvas.height);
            secondaryFrames.push(
                bufferCtxRef.current.getImageData(0, 0, canvas.width, canvas.height)
            );
        }
    }

    renderWithEffects(
      {
        ctx,
        buffer: bufferRef.current,
        bufferCtx: bufferCtxRef.current,
        source: primaryImage,
        sourceWidth: canvas.width,
        sourceHeight: canvas.height,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        tick,
        faceBounds: faceBoundsRef.current,
        timelineFrames: secondaryFrames,
        glPipeline: glPipelineRef.current ?? undefined,
        overlays,
        getOverlaySource: (mediaId) => {
          return imagesMapRef.current.get(mediaId) || null;
        }
      },
      effects.filter((e) => e.active),
      regions,
      overlays
    );
  }, [canvas, effects, regions, overlays, activeImages]);

  const render = useCallback(() => {
    if (!canvas || activeImages.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const primaryImageDef = activeImages[0];
    const primaryImage = imagesMapRef.current.get(primaryImageDef.id);
    if (!primaryImage) return;
    
    // Ensure buffer is ready
    if (!bufferRef.current) {
         const buffer = document.createElement("canvas");
         bufferRef.current = buffer;
         bufferCtxRef.current = buffer.getContext("2d", { willReadFrequently: true });
    }
    if (!bufferCtxRef.current) return;

    // Update canvas size if needed based on primary image
    if (canvas.width !== (primaryImage.naturalWidth || primaryImage.width)) {
       canvas.width = primaryImage.naturalWidth || primaryImage.width;
       canvas.height = primaryImage.naturalHeight || primaryImage.height;
    }

    renderFrame(tickRef.current);

    tickRef.current++;
    
    if (isAnimating) {
      animationFrameRef.current = requestAnimationFrame(render);
    }
  }, [canvas, renderFrame, isAnimating]);

  useEffect(() => {
    const map = imagesMapRef.current;
    const currentIds = new Set(activeImages.map(img => img.id));

    // Remove old images
    for (const [id] of map.entries()) {
        if (!currentIds.has(id)) {
            map.delete(id);
        }
    }

    // Load new images
    for (const imgDef of activeImages) {
        if (!map.has(imgDef.id)) {
            const img = new Image();
            if (!imgDef.path.startsWith("blob:") && !imgDef.path.startsWith("data:")) {
              img.crossOrigin = "anonymous";
            }

            img.onload = async () => {
              // Only do face detection on the primary image for simplicity,
              // but we could map faces by id if needed.
              if (imgDef.id === activeImages[0]?.id) {
                  try {
                    const faces = await detectFaces(img);
                    faceBoundsRef.current = faces;
                  } catch (error) {
                    console.error("Face detection failed:", error);
                    faceBoundsRef.current = [];
                  }
              }
              render();
            };

            img.onerror = () => {
              console.error("Failed to load image:", imgDef.path);
            };

            if (imgDef.path.startsWith("data:") || imgDef.path.startsWith("blob:")) {
              img.src = imgDef.path;
            } else if (imgDef.path.startsWith("http://") || imgDef.path.startsWith("https://")) {
              img.src = imgDef.path;
            } else {
              img.src = `file://${imgDef.path}`;
            }

            map.set(imgDef.id, img);
        }
    }

    if (activeImages.length === 0) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    }

    return () => {
      // Don't cancel here if just adding an image, let it run
    };
  }, [activeImages, render]);

  useEffect(() => {
    if (imagesMapRef.current.size > 0 && canvas) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      render();
    }
  }, [effects, render, canvas, isAnimating]);

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