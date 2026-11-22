import { useCallback } from "react";
import type { MediaItem } from "../lib/project";
import { toast } from "../stores/toastStore";

interface UseFileImportOptions {
  addMedia: (item: MediaItem) => void;
  selectMedia: (id: string) => void;
  duration: number;
  setDuration: (duration: number) => void;
}

export function useFileImport({
  addMedia,
  selectMedia,
  duration,
  setDuration,
}: UseFileImportOptions) {
  const handleImport = useCallback(async () => {
    if (!window.electron) {
      toast.error("Importing needs the desktop app", "File dialogs aren't available in a browser tab.");
      return;
    }

    const result = await window.electron.openFile({
      properties: ["openFile"],
      filters: [
        {
          name: "All Supported Media",
          extensions: ["mp4", "mov", "webm", "avi", "mkv", "m4v", "jpg", "jpeg", "png", "gif", "webp"],
        },
        { name: "Videos", extensions: ["mp4", "mov", "webm", "avi", "mkv", "m4v"] },
        { name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "webp"] },
      ],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      const fileName = filePath.split("/").pop() || "Unknown";
      const isVideoFile = /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(fileName);

      let videoDuration: number | undefined;
      if (isVideoFile && window.electron?.ffmpeg) {
        const info = await window.electron.ffmpeg.getVideoInfo(filePath);
        if (info.success && info.duration && isFinite(info.duration)) {
          videoDuration = info.duration;
          if (info.duration > duration) setDuration(info.duration);
        }
      }

      addMedia({
        id: `media-${Date.now()}`,
        type: isVideoFile ? "video" : "image",
        name: fileName,
        path: filePath,
        duration: videoDuration,
      });
    }
  }, [addMedia, duration, setDuration]);

  const handleAddCamera = useCallback(() => {
    const newMedia: MediaItem = {
      id: `camera-${Date.now()}`,
      type: "camera",
      name: "Live Camera",
      path: "",
    };
    addMedia(newMedia);
    selectMedia(newMedia.id);
  }, [addMedia, selectMedia]);

  const handleDropFiles = useCallback(
    async (files: FileList) => {
      const skipped: string[] = [];
      for (const file of Array.from(files)) {
        const isVideoFile = /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(file.name);
        const isImageFile = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name);
        if (!isVideoFile && !isImageFile) {
          skipped.push(file.name);
          continue;
        }

        // Electron adds a `path` property to File objects for local files
        const filePath = (file as File & { path?: string }).path || file.name;

        let videoDuration: number | undefined;
        if (isVideoFile && window.electron?.ffmpeg && filePath.startsWith("/")) {
          try {
            const info = await window.electron.ffmpeg.getVideoInfo(filePath);
            if (info.success && info.duration && isFinite(info.duration)) {
              videoDuration = info.duration;
              if (info.duration > duration) setDuration(info.duration);
            }
          } catch (e) {
            // Duration also arrives from the <video> element's metadata later.
            console.warn("Couldn't probe video duration:", filePath, e);
          }
        }

        addMedia({
          id: `media-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: isVideoFile ? "video" : "image",
          name: file.name,
          path: filePath.startsWith("/") ? filePath : URL.createObjectURL(file),
          duration: videoDuration,
        });
      }
      if (skipped.length > 0) {
        toast.info(
          `Skipped ${skipped.length} unsupported file${skipped.length > 1 ? "s" : ""}`,
          skipped.slice(0, 3).join(", ") + (skipped.length > 3 ? "…" : ""),
        );
      }
    },
    [addMedia, duration, setDuration],
  );

  return { handleImport, handleAddCamera, handleDropFiles };
}
