import { useState, useCallback } from "react";
import type { ExportSettings } from "../components/ExportDialog/ExportDialog";

/** Encode a canvas to a Uint8Array for IPC transfer. */
function canvasToBytes(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) { reject(new Error("Canvas toBlob returned null")); return; }
        blob.arrayBuffer().then((ab) => resolve(new Uint8Array(ab))).catch(reject);
      },
      mimeType,
      quality,
    );
  });
}

/** Get raw RGBA pixel data from a canvas. */
function canvasToRawRGBA(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D context for frame capture");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return new Uint8Array(imageData.data.buffer);
}

export interface ExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
  /** The user dismissed the save dialog — not an error. */
  canceled?: boolean;
}

export interface ExportHook {
  /** Start an offline (frame-by-frame) export via FFmpeg. */
  exportOffline: (
    canvas: HTMLCanvasElement,
    duration: number,
    settings: ExportSettings,
    /** Called once per frame.  `seek(time)` should update the app's
     *  currentTime so the canvas re-renders to that frame. It must
     *  return a Promise that resolves after the canvas has been drawn. */
    seek: (time: number) => Promise<void>,
  ) => Promise<ExportResult>;

  /** Still image export. */
  exportImage: (
    canvas: HTMLCanvasElement,
    format: "png" | "jpeg" | "webp",
    quality?: number,
  ) => Promise<ExportResult>;

  isExporting: boolean;
  exportProgress: number;
}

export function useExport(): ExportHook {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // ── Offline frame-by-frame export (MP4, WebM, GIF via FFmpeg) ──────────
  const exportOffline = useCallback(
    async (
      canvas: HTMLCanvasElement,
      duration: number,
      settings: ExportSettings,
      seek: (time: number) => Promise<void>,
    ): Promise<ExportResult> => {
      if (!window.electron) {
        return { success: false, error: "Export requires the Electron window. You are viewing the app in a browser — use the Electron window that opened alongside the Vite dev server, not a browser tab or IDE preview." };
      }

      const ext = settings.format === "gif" ? "gif" : settings.format === "webm" ? "webm" : "mp4";

      const saveResult = await window.electron.saveFile({
        filters: [
          ...(ext === "mp4" ? [{ name: "MP4 Video", extensions: ["mp4"] }] : []),
          ...(ext === "webm" ? [{ name: "WebM Video", extensions: ["webm"] }] : []),
          ...(ext === "gif" ? [{ name: "GIF Animation", extensions: ["gif"] }] : []),
        ],
        defaultPath: `export.${ext}`,
      });

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, canceled: true };
      }

      const filePath = saveResult.filePath;

      try {
        setIsExporting(true);
        setExportProgress(0);

        const fps = settings.fps || 30;
        const totalFrames = Math.max(1, Math.round(duration * fps));

        if (ext === "gif") {
          // GIF needs two FFmpeg passes (palettegen + paletteuse), so use PNG temp files.
          const tmpResult = await window.electron.ffmpeg.createTempDir();
          if (!tmpResult.success || !tmpResult.path) {
            throw new Error(tmpResult.error || "Failed to create temp dir");
          }
          const framesDir = tmpResult.path;

          for (let i = 0; i < totalFrames; i++) {
            const time = (i / totalFrames) * duration;
            await seek(time);
            const bytes = await canvasToBytes(canvas, "image/png");
            const framePath = `${framesDir}/frame_${String(i).padStart(6, "0")}.png`;
            const writeResult = await window.electron.file.writeBinary(framePath, bytes);
            if (!writeResult.success) throw new Error(writeResult.error || "Failed to write frame");
            setExportProgress(Math.round(((i + 1) / totalFrames) * 75));
          }

          setExportProgress(85);
          const encodeResult = await window.electron.ffmpeg.encodeVideo(framesDir, filePath, fps, "gif");
          if (!encodeResult.success) throw new Error(encodeResult.error || "FFmpeg encoding failed");

          setExportProgress(95);
          await window.electron.ffmpeg.cleanupTempDir(framesDir);
        } else {
          // MP4 / WebM: stream raw RGBA frames directly to FFmpeg stdin — no PNG encode, no temp files.
          const sessionId = `export-${Date.now()}`;
          const format = ext as "mp4" | "webm";
          const startResult = await window.electron.ffmpeg.startStreamExport(sessionId, {
            width: canvas.width,
            height: canvas.height,
            fps,
            format,
            outputPath: filePath,
            quality: settings.quality,
          });
          if (!startResult.success) throw new Error(startResult.error || "Failed to start FFmpeg stream");

          // Render frame N+1 while FFmpeg is still consuming frame N: per-frame
          // cost becomes max(render, encode) instead of render + encode. At most
          // one write is in flight, so memory stays bounded to a couple of frames.
          const ffmpeg = window.electron.ffmpeg;
          let pendingWrite: Promise<void> | null = null;
          const writeFrame = (frame: Uint8Array) =>
            ffmpeg.writeFrame(sessionId, frame).then((r) => {
              if (!r.success) throw new Error(r.error || "Failed to write frame");
            });

          try {
            for (let i = 0; i < totalFrames; i++) {
              const time = (i / totalFrames) * duration;
              await seek(time);
              const frameData = canvasToRawRGBA(canvas);
              if (pendingWrite) await pendingWrite;
              pendingWrite = writeFrame(frameData);
              setExportProgress(Math.round(((i + 1) / totalFrames) * 90));
            }
            if (pendingWrite) await pendingWrite;
          } catch (err) {
            // Don't leave an FFmpeg process waiting on stdin.
            await ffmpeg.endStreamExport(sessionId).catch(() => {});
            throw err;
          }

          setExportProgress(95);
          const endResult = await ffmpeg.endStreamExport(sessionId);
          if (!endResult.success) throw new Error(endResult.error || "FFmpeg encoding failed");
        }

        setExportProgress(100);
        setIsExporting(false);
        return { success: true, filePath };
      } catch (error) {
        setIsExporting(false);
        return { success: false, error: String(error) };
      }
    },
    [],
  );

  // ── Still image export ────────────────────────────────────────────────
  const exportImage = useCallback(
    async (
      canvas: HTMLCanvasElement,
      format: "png" | "jpeg" | "webp" = "png",
      quality = 0.95,
    ): Promise<ExportResult> => {
      if (!window.electron) {
        return { success: false, error: "Export requires the Electron window. You are viewing the app in a browser — use the Electron window that opened alongside the Vite dev server, not a browser tab or IDE preview." };
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
        return { success: false, canceled: true };
      }

      const filePath = saveResult.filePath;

      try {
        const ext = filePath.split(".").pop()?.toLowerCase();
        const actualFormat: "png" | "jpeg" | "webp" =
          ext === "jpg" || ext === "jpeg" ? "jpeg" : ext === "webp" ? "webp" : "png";

        const bytes = await canvasToBytes(canvas, `image/${actualFormat}`, quality);
        const writeResult = await window.electron.file.writeBinary(filePath, bytes);

        if (!writeResult.success) throw new Error(writeResult.error);
        return { success: true, filePath };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    [],
  );

  return {
    exportOffline,
    exportImage,
    isExporting,
    exportProgress,
  };
}
