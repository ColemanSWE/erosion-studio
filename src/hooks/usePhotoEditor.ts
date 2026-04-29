import { useEffect, useRef, useCallback, useState } from "react";
import { renderWithEffects } from "../lib/effects/effects-renderer";
import type { Effect, Region, Overlay } from "../lib/effects/types";
import { detectFaces, type FaceBounds } from "../lib/effects/face-detector";
import type { SourceTransform } from "../lib/project";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { GifDecoder } from "../lib/gif-decoder";
import { useRenderContext } from "./useRenderContext";

type ImageSource = HTMLImageElement | ImageBitmap;

interface ActiveImage {
  id: string;
  path: string;
}

interface UsePhotoEditorOptions {
  canvas: HTMLCanvasElement | null;
  effects: Effect[];
  activeImages: ActiveImage[];
  overlayImages?: ActiveImage[];
  regions?: Region[];
  overlays?: Overlay[];
  sourceTransform?: SourceTransform;
}

function isGifPath(path: string): boolean {
  // Check file extension — blob URLs won't match, which is fine for Electron
  return path.toLowerCase().endsWith(".gif");
}

function getSourceDimensions(source: ImageSource): { w: number; h: number } {
  if (source instanceof HTMLImageElement) {
    return { w: source.naturalWidth, h: source.naturalHeight };
  }
  return { w: source.width, h: source.height };
}

function resolveSrc(path: string): string {
  if (
    path.startsWith("data:") ||
    path.startsWith("blob:") ||
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("file://")
  ) {
    return path;
  }
  return `file://${path}`;
}

export function usePhotoEditor({
  canvas,
  effects,
  activeImages,
  overlayImages = [],
  regions = [],
  overlays = [],
  sourceTransform,
}: UsePhotoEditorOptions) {
  const imagesMapRef = useRef<Map<string, ImageSource>>(new Map());
  const gifDecodersRef = useRef<Map<string, GifDecoder>>(new Map());
  const loadingGifsRef = useRef<Set<string>>(new Set());
  // Tracks which IDs are currently wanted — checked when async GIF loads resolve
  const wantedIdsRef = useRef<Set<string>>(new Set());
  const animationFrameRef = useRef<number>();
  const tickRef = useRef(0);
  const faceBoundsRef = useRef<FaceBounds[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const isAnimatingRef = useRef(false);
  const renderRef = useRef<(() => Promise<void>) | null>(null);

  const { bufferRef, bufferCtxRef, glPipelineRef } = useRenderContext();

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
      for (const decoder of gifDecodersRef.current.values()) decoder.dispose();
      gifDecodersRef.current.clear();
    };
  }, []);

  // Keep isAnimatingRef in sync (read by the rAF loop without closure capture)
  isAnimatingRef.current = isAnimating;

  // Continuous animation needed for animated effects or GIFs
  useEffect(() => {
    const needsAnimation =
      effects.some(
        (e) =>
          e.active &&
          [
            "glitch",
            "datamosh",
            "block-shoving",
            "vhs",
            "scanlines",
            "crt",
            "chromatic",
            "pixelshift",
            "rgbshift",
            "timewarp",
            "bitcrush",
            "pixelsort",
            "slitscan",
            "feedback",
          ].includes(e.type),
      ) || activeImages.some((img) => isGifPath(img.path));
    setIsAnimating(needsAnimation);
  }, [effects, activeImages]);

  const renderFrame = useCallback(
    async (tick: number) => {
      if (!canvas || activeImages.length === 0 || !bufferRef.current || !bufferCtxRef.current)
        return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const primaryImageDef = activeImages[0];
      const primarySource = imagesMapRef.current.get(primaryImageDef.id);
      if (!primarySource) return;

      // Use the source's native dimensions for processing; the canvas dimensions are
      // controlled by the selected resolution and should not be overridden here.
      const { w: sourceW, h: sourceH } = getSourceDimensions(primarySource);
      if (sourceW === 0 || sourceH === 0) return;

      // Secondary images for transitions
      const secondaryFrames: ImageData[] = [];
      for (let i = 1; i < activeImages.length; i++) {
        const secDef = activeImages[i];
        const secSource = imagesMapRef.current.get(secDef.id);
        if (secSource) {
          bufferCtxRef.current.drawImage(secSource, 0, 0, sourceW, sourceH);
          secondaryFrames.push(
            bufferCtxRef.current.getImageData(0, 0, sourceW, sourceH),
          );
        }
      }

      await renderWithEffects(
        {
          ctx,
          buffer: bufferRef.current,
          bufferCtx: bufferCtxRef.current,
          source: primarySource,
          sourceWidth: sourceW,
          sourceHeight: sourceH,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          tick,
          faceBounds: faceBoundsRef.current,
          timelineFrames: secondaryFrames,
          glPipeline: glPipelineRef.current ?? undefined,
          overlays,
          getOverlaySource: (mediaId) => imagesMapRef.current.get(mediaId) ?? null,
          sourceTransform,
        },
        effects.filter((e) => e.active),
        regions,
        overlays,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvas, effects, regions, overlays, activeImages, sourceTransform],
  );

  const render = useCallback(async () => {
    if (!canvas || activeImages.length === 0) return;

    const primaryImageDef = activeImages[0];

    // Advance all active GIF decoders and sync their latest bitmap into imagesMapRef
    const now = performance.now();
    for (const [id, decoder] of gifDecodersRef.current.entries()) {
      const advanced = await decoder.tick(now);
      if (advanced && decoder.bitmap) {
        imagesMapRef.current.set(id, decoder.bitmap);
      }
    }

    const primarySource = imagesMapRef.current.get(primaryImageDef.id);
    if (!primarySource) return;

    if (!bufferRef.current) {
      const buffer = document.createElement("canvas");
      bufferRef.current = buffer;
      bufferCtxRef.current = buffer.getContext("2d", { willReadFrequently: true });
    }
    if (!bufferCtxRef.current) return;

    await renderFrame(tickRef.current);
    tickRef.current++;

    if (isAnimatingRef.current) {
      animationFrameRef.current = requestAnimationFrame(() => renderRef.current?.());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, renderFrame]);

  // Keep renderRef current so callbacks always call the latest render
  useEffect(() => {
    renderRef.current = render;
  }, [render]);

  // ── Image / GIF lifecycle ─────────────────────────────────────────────────
  useEffect(() => {
    const map = imagesMapRef.current;
    const gifDecoders = gifDecodersRef.current;
    const loadingGifs = loadingGifsRef.current;
    const allImages = [...activeImages, ...overlayImages];
    const currentIds = new Set(allImages.map((img) => img.id));
    wantedIdsRef.current = currentIds;

    // Remove sources that are no longer active
    for (const [id] of map.entries()) {
      if (!currentIds.has(id)) map.delete(id);
    }
    for (const [id, decoder] of gifDecoders.entries()) {
      if (!currentIds.has(id)) {
        decoder.dispose();
        gifDecoders.delete(id);
      }
    }
    for (const id of loadingGifs) {
      if (!currentIds.has(id)) loadingGifs.delete(id);
    }

    // Load new sources
    for (const imgDef of allImages) {
      if (map.has(imgDef.id) || gifDecoders.has(imgDef.id) || loadingGifs.has(imgDef.id)) {
        continue;
      }

      if (isGifPath(imgDef.path)) {
        loadingGifs.add(imgDef.id);
        GifDecoder.create(imgDef.path)
          .then((decoder) => {
            loadingGifs.delete(imgDef.id);
            if (!wantedIdsRef.current.has(imgDef.id)) {
              decoder.dispose();
              return;
            }
            gifDecoders.set(imgDef.id, decoder);
            if (decoder.bitmap) map.set(imgDef.id, decoder.bitmap);
            renderRef.current?.();
          })
          .catch((err) => {
            loadingGifs.delete(imgDef.id);
            console.error("Failed to load GIF:", imgDef.path, err);
          });
      } else {
        const img = new Image();
        if (!imgDef.path.startsWith("blob:") && !imgDef.path.startsWith("data:")) {
          img.crossOrigin = "anonymous";
        }

        img.onload = async () => {
          if (imgDef.id === activeImages[0]?.id) {
            try {
              const faces = await detectFaces(img);
              faceBoundsRef.current = faces;
            } catch {
              faceBoundsRef.current = [];
            }
          }
          renderRef.current?.();
        };

        img.onerror = () => {
          console.error("Failed to load image:", imgDef.path);
        };

        img.src = resolveSrc(imgDef.path);
        map.set(imgDef.id, img);
      }
    }

    if (allImages.length === 0) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    }
  }, [activeImages, overlayImages, render]);

  useEffect(() => {
    if (imagesMapRef.current.size > 0 && canvas) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
      renderRef.current?.();
    }
  }, [effects, render, canvas, isAnimating]);

  const exportImage = useCallback(
    async (format: "png" | "jpeg" | "webp" | "gif" = "png", quality = 0.95) => {
      if (!canvas || !window.electron) {
        throw new Error("Export requires the Electron window — not a browser tab or IDE preview.");
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

        await renderFrame(0);
        const firstFrameData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const sharedPalette = quantize(firstFrameData.data, 256);

        for (let i = 0; i < numFrames; i++) {
          await renderFrame(i);

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const index = applyPalette(imageData.data, sharedPalette);

          gif.writeFrame(index, canvas.width, canvas.height, {
            palette: sharedPalette,
            delay: Math.floor(1000 / fps),
          });

          if (i % 10 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
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
    [canvas, renderFrame],
  );

  return { exportImage };
}
