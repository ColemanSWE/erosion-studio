import { useState, useCallback } from "react";
import type { Effect } from "../lib/effects/types";
import { GIFEncoder, quantize, applyPalette } from "gifenc";

interface ExportOptions {
  format: "mp4" | "webm" | "gif";
  quality: number;
  fps: number;
}

/** Helper: convert a canvas dataURL to a byte array for IPC transfer */
function dataUrlToBytes(dataUrl: string): number[] {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes: number[] = new Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function useExport() {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  /**
   * Export video: records the canvas using MediaRecorder for webm,
   * or renders multiple frames for gif.
   */
  const exportVideo = useCallback(
    async (
      canvas: HTMLCanvasElement,
      _effects: Effect[],
      duration: number,
      options: ExportOptions = { format: "webm", quality: 0.9, fps: 30 }
    ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      if (!window.electron) {
        return { success: false, error: "Electron API not available" };
      }

      const ext = options.format === "gif" ? "gif" : "webm";

      const saveResult = await window.electron.saveFile({
        filters: [
          { name: "WebM Video", extensions: ["webm"] },
          { name: "GIF Animation", extensions: ["gif"] },
        ],
        defaultPath: `export.${ext}`,
      });

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, error: "Export canceled" };
      }

      const filePath = saveResult.filePath;

      try {
        setIsExporting(true);
        setExportProgress(0);

        if (options.format === "gif") {
          // ── GIF export via gifenc ────────────────────────────────────────
          const numFrames = Math.max(1, Math.round(duration * options.fps));
          const gif = GIFEncoder();
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("No canvas 2D context");

          // Build shared palette from first frame
          const firstData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const palette = quantize(firstData.data, 256);

          for (let i = 0; i < numFrames; i++) {
            setExportProgress(Math.round((i / numFrames) * 90));
            await new Promise<void>((r) => setTimeout(r, 0)); // yield to keep UI alive

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const index = applyPalette(imageData.data, palette);
            gif.writeFrame(index, canvas.width, canvas.height, {
              palette,
              delay: Math.round(1000 / options.fps),
            });
          }

          gif.finish();
          const rawBytes = gif.bytes();
          const bytes: number[] = Array.from({ length: rawBytes.length }, (_, i) => rawBytes[i]);
          setExportProgress(95);
          const writeResult = await window.electron.file.writeBinary(filePath, bytes);
          if (!writeResult.success) throw new Error(writeResult.error);
        } else {
          // ── WebM export via MediaRecorder ─────────────────────────────────
          const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
            ? "video/webm;codecs=vp9"
            : "video/webm";

          const stream = canvas.captureStream(options.fps);
          const recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: Math.round(options.quality * 8_000_000),
          });

          const chunks: Blob[] = [];
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
          };

          await new Promise<void>((resolve, reject) => {
            recorder.onstop = () => resolve();
            recorder.onerror = () => reject(new Error("MediaRecorder error"));
            recorder.start(100); // collect data every 100ms

            // Stop after duration elapses
            setTimeout(() => {
              if (recorder.state !== "inactive") recorder.stop();
            }, duration * 1000);
          });

          setExportProgress(80);

          const blob = new Blob(chunks, { type: "video/webm" });
          const arrayBuffer = await blob.arrayBuffer();
          const uint8 = new Uint8Array(arrayBuffer);
          const bytes: number[] = Array.from({ length: uint8.length }, (_, i) => uint8[i]);

          setExportProgress(95);
          const writeResult = await window.electron.file.writeBinary(filePath, bytes);
          if (!writeResult.success) throw new Error(writeResult.error);
        }

        setExportProgress(100);
        setIsExporting(false);
        return { success: true, filePath };
      } catch (error) {
        setIsExporting(false);
        return { success: false, error: String(error) };
      }
    },
    []
  );

  /**
   * Export image: renders current canvas to PNG/JPEG/WebP and writes to disk.
   */
  const exportImage = useCallback(
    async (
      canvas: HTMLCanvasElement,
      format: "png" | "jpeg" | "webp" = "png",
      quality = 0.95
    ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      if (!window.electron) {
        return { success: false, error: "Electron API not available" };
      }

      const saveResult = await window.electron.saveFile({
        filters: [
          { name: "PNG Image", extensions: ["png"] },
          { name: "JPEG Image", extensions: ["jpg", "jpeg"] },
          { name: "WebP Image", extensions: ["webp"] },
        ],
        defaultPath: `export.${format}`,
      });

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, error: "Export canceled" };
      }

      const filePath = saveResult.filePath;

      try {
        // Determine actual format from chosen extension
        const ext = filePath.split(".").pop()?.toLowerCase();
        const actualFormat: "png" | "jpeg" | "webp" =
          ext === "jpg" || ext === "jpeg" ? "jpeg" : ext === "webp" ? "webp" : "png";

        const dataUrl = canvas.toDataURL(`image/${actualFormat}`, quality);
        const bytes = dataUrlToBytes(dataUrl);
        const writeResult = await window.electron.file.writeBinary(filePath, bytes);

        if (!writeResult.success) throw new Error(writeResult.error);
        return { success: true, filePath };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    []
  );

  return {
    exportVideo,
    exportImage,
    isExporting,
    exportProgress,
  };
}
