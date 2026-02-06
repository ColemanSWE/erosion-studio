import { useState, useCallback } from "react";
import Toolbar from "./Toolbar/Toolbar";
import MediaBrowser from "./MediaBrowser/MediaBrowser";
import Preview from "./Preview/Preview";
import EffectsPanel from "./EffectsPanel/EffectsPanel";
import Timeline from "./Timeline/Timeline";
import Home from "./Home/Home";
import CameraBooth from "./Camera/CameraBooth";
import { useProjectStore } from "../stores/projectStore";
import { useUIStore } from "../stores/uiStore";
import { usePhotoEditor } from "../hooks/usePhotoEditor";
import { useVideoPlayer } from "../hooks/useVideoPlayer";
import { useExport } from "../hooks/useExport";
import { useHistory } from "../hooks/useHistory";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import {
  saveProject,
  type Project,
} from "../lib/project";
import styles from "./App.module.scss";

function App() {
  const {
    projectName,
    media,
    selectedMediaId,
    effects,
    currentTime,
    duration,
    isPlaying,
    addMedia,
    removeMedia,
    selectMedia,
    addEffect,
    updateEffect,
    removeEffect,
    reorderEffect,
    setCurrentTime,
    play,
    pause,
    stop,
    setDuration,
  } = useProjectStore();

  const {
    showMediaBrowser,
    showEffectsPanel,
    showTimeline,
    appMode,
    setAppMode,
    toggleTimeline,
  } = useUIStore();

  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  const projectSnapshot: Project = {
    name: projectName,
    media,
    effects,
    duration,
    currentTime,
    version: "1.0",
  };

  const {
    undo,
    redo,
    canUndo,
    canRedo,
  } = useHistory(projectSnapshot);

  const { exportVideo } = useExport();

  const selectedMedia = media.find((m) => m.id === selectedMediaId);
  const imagePath =
    selectedMedia?.type === "image" ? selectedMedia.path : undefined;
  const videoPath =
    selectedMedia?.type === "video" ? selectedMedia.path : undefined;

  const { exportImage } = usePhotoEditor({
    canvas,
    effects,
    imagePath,
  });

  useVideoPlayer({
    canvas,
    effects,
    videoPath,
    isPlaying,
    currentTime,
    onTimeUpdate: setCurrentTime,
    onDurationChange: (duration) => {
      setDuration(duration);
    },
  });

  const handleCanvasReady = useCallback((newCanvas: HTMLCanvasElement) => {
    setCanvas(newCanvas);
  }, []);

  const handleImport = async (type?: "image" | "video") => {
    if (!window.electron) {
      alert("File dialog only available in Electron");
      return;
    }

    const result = await window.electron.openFile({
      properties: ["openFile"],
      properties: ["openFile"],
      filters:
        type === "image"
          ? [
              {
                name: "Images",
                extensions: ["jpg", "jpeg", "png", "gif", "webp"],
              },
            ]
          : type === "video"
          ? [{ name: "Videos", extensions: ["mp4", "mov", "webm"] }]
          : [
              {
                name: "Images",
                extensions: ["jpg", "jpeg", "png", "gif", "webp"],
              },
              { name: "Videos", extensions: ["mp4", "mov", "webm"] },
            ],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      const fileName = filePath.split("/").pop() || "Unknown";
      const isVideo = /\.(mp4|mov|webm)$/i.test(fileName);

      const newMedia = {
        id: `media-${Date.now()}`,
        type: isVideo ? "video" : "image",
        name: fileName,
        path: filePath,
      } as const;

      addMedia(newMedia);

      if (isVideo && window.electron.ffmpeg) {
        const info = await window.electron.ffmpeg.getVideoInfo(filePath);
        if (info.success && info.duration) {
          setDuration(info.duration);
        }
      }

      // Auto-set timeline visibility based on type if coming from Home
      // Note: We access the store state directly via hook, so we can't conditionally call hooks here.
      // But we can toggle.
      // Ideally we'd set a specific value, but toggle is what we have exposed for now.
      // Let's rely on the user or a future refactor to set exact visibility.
    }
  };

  const handleExport = async () => {
    if (!canvas) {
      alert("No canvas available for export");
      return;
    }

    try {
      let result;
      
      if (selectedMedia?.type === "video") {
         result = await exportVideo(canvas, effects, duration, { format: "mp4", quality: 1.0, fps: 30 });
      } else {
         const format = await showFormatPicker();
         if (!format) return;
         result = await exportImage(format as "png" | "jpeg" | "webp" | "gif", 0.95);
      }

      if (result && result.success) {
        alert(`Exported to: ${result.filePath}`);
      } else {
        const errorMsg = result && 'error' in result ? result.error : "Unknown error";
        alert(`Export failed: ${errorMsg}`);
      }
    } catch (error) {
      alert(`Export failed: ${error}`);
    }
  };

  const showFormatPicker = (): Promise<string | null> => {
    return new Promise((resolve) => {
      const format = prompt(
        "Choose export format:\n1. PNG (lossless, still image)\n2. JPEG (lossy, still image)\n3. WebP (lossy, still image)\n4. GIF (animated, 2 seconds @ 30fps)\n\nEnter number (1-4):",
        "1"
      );
      
      if (!format) {
        resolve(null);
        return;
      }
      
      switch (format.trim()) {
        case "1":
          resolve("png");
          break;
        case "2":
          resolve("jpeg");
          break;
        case "3":
          resolve("webp");
          break;
        case "4":
          resolve("gif");
          break;
        default:
          alert("Invalid format. Using PNG.");
          resolve("png");
      }
    });
  };

  const handleUndo = useCallback(() => {
    undo();
  }, [undo]);

  const handleRedo = useCallback(() => {
    redo();
  }, [redo]);

  const handleSave = useCallback(async () => {
    const result = await saveProject(projectSnapshot);
    if (result.success) {
      alert(`Project saved to: ${result.filePath}`);
    } else {
      alert(`Save failed: ${result.error}`);
    }
  }, [projectSnapshot]);

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, pause, play]);

  useKeyboardShortcuts({
    undo: handleUndo,
    redo: handleRedo,
    save: handleSave,
    export: handleExport,
    playPause: handlePlayPause,
    canUndo,
    canRedo,
  });

  return (
    <div className={styles.app}>
      {appMode === "home" && <Home onImport={handleImport} />}

      {appMode === "camera" && (
        <>
          <CameraBooth />
          <div style={{ position: 'absolute', right: 0, top: 0, height: '100%', zIndex: 2000 }}>
             <EffectsPanel 
               effects={effects}
               onAddEffect={addEffect}
               onUpdateEffect={updateEffect}
               onRemoveEffect={removeEffect}
               onReorderEffect={reorderEffect}
             />
          </div>
        </>
      )}

      {appMode === "editor" && (
        <>
          <Toolbar
            projectName={projectName}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onExport={handleExport}
            canUndo={canUndo}
            canRedo={canRedo}
          />

          <div className={styles.mainContent}>
            {showMediaBrowser && (
              <MediaBrowser
                media={media}
                selectedId={selectedMediaId}
                onImport={() => handleImport()}
                onSelect={selectMedia}
                onRemove={removeMedia}
              />
            )}

            <Preview onCanvasReady={handleCanvasReady} />

            {showEffectsPanel && (
              <EffectsPanel
                effects={effects}
                onAddEffect={addEffect}
                onUpdateEffect={updateEffect}
                onRemoveEffect={removeEffect}
                onReorderEffect={reorderEffect}
              />
            )}
          </div>

          {showTimeline && (
            <Timeline
              duration={duration}
              currentTime={currentTime}
              isPlaying={isPlaying}
              onPlay={play}
              onPause={pause}
              onStop={stop}
              onSeek={setCurrentTime}
            />
          )}
        </>
      )}
    </div>
  );
}

export default App;
