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
  ) => Promise<{ success: boolean; filePath?: string; error?: string }>;

  /** Real-time WebM export (legacy, used when format=webm). */
  exportRealtime: (
    canvas: HTMLCanvasElement,
    duration: number,
    fps: number,
  ) => Promise<{ success: boolean; filePath?: string; error?: string }>;

  /** Still image export. */
  exportImage: (
    canvas: HTMLCanvasElement,
    format: "png" | "jpeg" | "webp",
    quality?: number,
  ) => Promise<{ success: boolean; filePath?: string; error?: string }>;

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
    ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
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
        return { success: false, error: "Export canceled" };
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
          });
          if (!startResult.success) throw new Error(startResult.error || "Failed to start FFmpeg stream");

          for (let i = 0; i < totalFrames; i++) {
            const time = (i / totalFrames) * duration;
            await seek(time);
            const frameData = canvasToRawRGBA(canvas);
            const writeResult = await window.electron.ffmpeg.writeFrame(sessionId, frameData);
            if (!writeResult.success) throw new Error(writeResult.error || "Failed to write frame");
            setExportProgress(Math.round(((i + 1) / totalFrames) * 90));
          }

          setExportProgress(95);
          const endResult = await window.electron.ffmpeg.endStreamExport(sessionId);
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

  // ── Real-time WebM export via MediaRecorder ────────────────────────────
  const exportRealtime = useCallback(
    async (
      canvas: HTMLCanvasElement,
      duration: number,
      fps: number,
    ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      if (!window.electron) {
        return { success: false, error: "Export requires the Electron window. You are viewing the app in a browser — use the Electron window that opened alongside the Vite dev server, not a browser tab or IDE preview." };
      }

      const saveResult = await window.electron.saveFile({
        filters: [{ name: "WebM Video", extensions: ["webm"] }],
        defaultPath: "export.webm",
      });

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, error: "Export canceled" };
      }

      const filePath = saveResult.filePath;

      try {
        setIsExporting(true);
        setExportProgress(0);

        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm";

        const stream = canvas.captureStream(fps);
        const recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 8_000_000,
        });

        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        await new Promise<void>((resolve, reject) => {
          recorder.onstop = () => resolve();
          recorder.onerror = () => reject(new Error("MediaRecorder error"));
          recorder.start(100);

          // Progress ticker
          const startMs = Date.now();
          const progressInterval = setInterval(() => {
            const elapsed = (Date.now() - startMs) / 1000;
            setExportProgress(Math.min(90, Math.round((elapsed / duration) * 90)));
          }, 250);

          setTimeout(() => {
            clearInterval(progressInterval);
            if (recorder.state !== "inactive") recorder.stop();
          }, duration * 1000);
        });

        setExportProgress(80);

        const blob = new Blob(chunks, { type: "video/webm" });
        const bytes = new Uint8Array(await blob.arrayBuffer());

        setExportProgress(95);
        const writeResult = await window.electron.file.writeBinary(filePath, bytes);
        if (!writeResult.success) throw new Error(writeResult.error);

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
    ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
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
        return { success: false, error: "Export canceled" };
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
    exportRealtime,
    exportImage,
    isExporting,
    exportProgress,
  };
}
