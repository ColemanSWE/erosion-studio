import React, { useState, useCallback } from "react";
import Toolbar from "./Toolbar/Toolbar";
import MediaBrowser from "./MediaBrowser/MediaBrowser";
import Preview from "./Preview/Preview";
import EffectsPanel from "./EffectsPanel/EffectsPanel";
import Timeline from "./Timeline/Timeline";
import { useProjectStore } from "../stores/projectStore";
import { useUIStore } from "../stores/uiStore";
import { usePhotoEditor } from "../hooks/usePhotoEditor";
import { useVideoPlayer } from "../hooks/useVideoPlayer";
import { useExport } from "../hooks/useExport";
import { useHistory } from "../hooks/useHistory";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import {
  saveProject,
  loadProject,
  createEmptyProject,
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
  } = useProjectStore();

  const { showMediaBrowser, showEffectsPanel, showTimeline } = useUIStore();

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
    state: historyState,
    setState: setHistoryState,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useHistory(projectSnapshot);

  const { exportImage: exportImageHook } = useExport();

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

  const handleImport = async () => {
    if (!window.electron) {
      alert("File dialog only available in Electron");
      return;
    }

    const result = await window.electron.openFile({
      properties: ["openFile"],
      filters: [
        { name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "webp"] },
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
    }
  };

  const handleExport = async () => {
    if (!canvas) {
      alert("No canvas available for export");
      return;
    }

    try {
      const result =
        selectedMedia?.type === "video"
          ? await exportImageHook(canvas, "png", 1.0)
          : await exportImage("png", 1.0);

      if (result.success) {
        alert(`Exported to: ${result.filePath}`);
      } else {
        alert(`Export failed: ${result.error}`);
      }
    } catch (error) {
      alert(`Export failed: ${error}`);
    }
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
            onImport={handleImport}
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
    </div>
  );
}

export default App;
