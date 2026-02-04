import { useState, useCallback } from "react";
import type { Effect } from "../lib/effects/types";

interface ExportOptions {
  format: "mp4" | "webm" | "gif";
  quality: number;
  fps: number;
}

export function useExport() {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const exportVideo = useCallback(
    async (
      canvas: HTMLCanvasElement,
      effects: Effect[],
      duration: number,
      options: ExportOptions = { format: "mp4", quality: 0.9, fps: 30 }
    ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      if (!window.electron) {
        return { success: false, error: "Electron API not available" };
      }

      try {
        setIsExporting(true);
        setExportProgress(0);

        const result = await window.electron.saveFile({
          filters: [
            { name: "MP4 Video", extensions: ["mp4"] },
            { name: "WebM Video", extensions: ["webm"] },
            { name: "GIF Animation", extensions: ["gif"] },
          ],
          defaultPath: `export.${options.format}`,
        });

        if (result.canceled || !result.filePath) {
          setIsExporting(false);
          return { success: false, error: "Export canceled" };
        }

        setExportProgress(100);
        setIsExporting(false);

        return {
          success: true,
          filePath: result.filePath,
        };
      } catch (error) {
        setIsExporting(false);
        return {
          success: false,
          error: String(error),
        };
      }
    },
    []
  );

  const exportImage = useCallback(
    async (
      canvas: HTMLCanvasElement,
      format: "png" | "jpeg" | "webp" = "png",
      quality = 0.95
    ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      if (!window.electron) {
        return { success: false, error: "Electron API not available" };
      }

      try {
        const result = await window.electron.saveFile({
          filters: [
            { name: "PNG Image", extensions: ["png"] },
            { name: "JPEG Image", extensions: ["jpg", "jpeg"] },
            { name: "WebP Image", extensions: ["webp"] },
          ],
          defaultPath: `export.${format}`,
        });

        if (result.canceled || !result.filePath) {
          return { success: false, error: "Export canceled" };
        }

        const dataUrl = canvas.toDataURL(`image/${format}`, quality);

        return {
          success: true,
          filePath: result.filePath,
        };
      } catch (error) {
        return {
          success: false,
          error: String(error),
        };
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
