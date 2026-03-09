import { useState, useCallback } from "react";
import type { ExportSettings } from "../components/ExportDialog/ExportDialog";

/** Convert a canvas data-URL to a byte array for IPC transfer. */
function dataUrlToBytes(dataUrl: string): number[] {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes: number[] = new Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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
        return { success: false, error: "Electron API not available" };
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

        // 1. Create temp directory for frames
        const tmpResult = await window.electron.ffmpeg.createTempDir();
        if (!tmpResult.success || !tmpResult.path) {
          throw new Error(tmpResult.error || "Failed to create temp dir");
        }
        const framesDir = tmpResult.path;

        const fps = settings.fps || 30;
        const totalFrames = Math.max(1, Math.round(duration * fps));

        // 2. Render each frame
        for (let i = 0; i < totalFrames; i++) {
          const time = (i / totalFrames) * duration;

          // Seek the timeline to this exact time and wait for the canvas to render
          await seek(time);

          // Extract the frame from the canvas
          const dataUrl = canvas.toDataURL("image/png");
          const bytes = dataUrlToBytes(dataUrl);

          // Write frame to temp dir
          const frameName = `frame_${String(i).padStart(6, "0")}.png`;
          const framePath = `${framesDir}/${frameName}`;
          const writeResult = await window.electron.file.writeBinary(framePath, bytes);
          if (!writeResult.success) {
            throw new Error(writeResult.error || "Failed to write frame");
          }

          setExportProgress(Math.round(((i + 1) / totalFrames) * 80));
        }

        // 3. Encode frames into final video via FFmpeg
        setExportProgress(85);
        const ffmpegFormat = ext as "mp4" | "webm" | "gif";
        const encodeResult = await window.electron.ffmpeg.encodeVideo(
          framesDir,
          filePath,
          fps,
          ffmpegFormat,
        );
        if (!encodeResult.success) {
          throw new Error(encodeResult.error || "FFmpeg encoding failed");
        }

        // 4. Clean up temp dir
        setExportProgress(95);
        await window.electron.ffmpeg.cleanupTempDir(framesDir);

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
        return { success: false, error: "Electron API not available" };
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
        const arrayBuffer = await blob.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        const bytes: number[] = Array.from({ length: uint8.length }, (_, i) => uint8[i]);

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
