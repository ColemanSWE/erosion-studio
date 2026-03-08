import { useState, useCallback, useEffect, useRef } from "react";
import Toolbar from "./Toolbar/Toolbar";
import MediaBrowser from "./MediaBrowser/MediaBrowser";
import Preview from "./Preview/Preview";
import EffectsPanel from "./EffectsPanel/EffectsPanel";
import { Timeline } from "./Timeline/Timeline";
import { useProjectStore } from "../stores/projectStore";
import { useUIStore } from "../stores/uiStore";
import { usePhotoEditor } from "../hooks/usePhotoEditor";
import { useVideoPlayer } from "../hooks/useVideoPlayer";
import { useCameraPlayer } from "../hooks/useCameraPlayer";
import { useCameraCapture } from "../hooks/useCameraCapture";
import { useExport } from "../hooks/useExport";
import { useHistory } from "../hooks/useHistory";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import {
  saveProject,
  type Project,
} from "../lib/project";
import type { Region } from "../lib/effects/types";
import styles from "./App.module.scss";
import previewStyles from "./Preview/Preview.module.scss";
import { Camera, Video, Square as StopIcon } from "lucide-react";
import { resolveEffectsAtTime } from "../lib/timeline";

const REGION_COLORS = ["#ff3366", "#33ccff", "#ffcc00", "#66ff66", "#cc66ff", "#ff9933"];

function App() {
  const {
    projectName,
    media,
    selectedMediaId,
    effects,
    regions,
    currentTime,
    duration,
    isPlaying,
    clips,
    effectParamTracks,
    addMedia,
    removeMedia,
    selectMedia,
    addEffect,
    updateEffect,
    removeEffect,
    reorderEffect,
    addRegion,
    removeRegion,
    setCurrentTime,
    play,
    pause,
    stop,
    setDuration,
    addClip,
    removeClip,
    updateClip,
    addEffectParamTrack,
    removeEffectParamTrack,
    addKeyframe,
    updateKeyframe,
    removeKeyframe,
  } = useProjectStore();

  const {
    showMediaBrowser,
    showEffectsPanel,
    showTimeline,
    activeRegionId,
    isDrawingRegion,
    setActiveRegionId,
    setIsDrawingRegion,
  } = useUIStore();

  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  const projectSnapshot: Project = {
    name: projectName,
    media,
    effects,
    regions,
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

  // ─── Playback Heartbeat ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) return;

    let lastTime = performance.now();
    const tick = (now: number) => {
      if (!isPlaying) return;
      
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      
      const nextTime = currentTime + dt;
      if (nextTime >= duration) {
        setCurrentTime(duration);
        pause();
      } else {
        setCurrentTime(nextTime);
        requestAnimationFrame(tick);
      }
    };
    const id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [isPlaying, duration, currentTime, setCurrentTime, pause]);

  // ─── Timeline Rendering logic ─────────────────────────────────────────────
  const activeClip = clips.find(
    (c) => currentTime >= c.startTime && currentTime <= c.endTime
  );
  const activeMedia = activeClip ? media.find((m) => m.id === activeClip.mediaId) : null;
  const selectedMedia = media.find((m) => m.id === selectedMediaId);
  
  // Use selected media if no clip is active (fallback behavior)
  const renderSource = activeMedia || selectedMedia;
  // Resolve effects based on timeline keyframes and time windows
  const resolvedEffects = resolveEffectsAtTime(
    effects,
    effectParamTracks,
    currentTime
  );

  const isCamera = renderSource?.type === "camera";
  const isVideo = renderSource?.type === "video";
  const isImage = renderSource?.type === "image";

  // ─── Rendering Hooks ─────────────────────────────────────────────────────
  // Only the hook corresponding to the active source type will draw.
  
  const { exportImage } = usePhotoEditor({
    canvas,
    effects: resolvedEffects,
    imagePath: isImage ? renderSource.path : undefined,
    regions,
  });

  useVideoPlayer({
    canvas,
    effects: resolvedEffects,
    videoPath: isVideo ? renderSource.path : undefined,
    isPlaying,
    currentTime: activeClip 
      ? currentTime - activeClip.startTime // Local time within clip
      : currentTime,
    regions,
    onDurationChange: (dur) => {
       if (!activeClip && dur > duration) setDuration(dur);
    },
  });

  const { stream, videoRef: _videoRef } = useCameraPlayer({
    canvas,
    effects: resolvedEffects,
    isActive: isCamera,
    regions,
  });

  // ─── Camera capture ───────────────────────────────────────────────────────
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recSeconds, setRecSeconds] = useState(0);

  const handleMediaCaptured = useCallback(
    (item: { id: string; type: "image" | "video"; name: string; path: string; duration?: number }) => {
      addMedia(item as any);
      if (item.type === "video" && item.duration) {
         if (item.duration > duration) setDuration(item.duration);
      }
    },
    [addMedia, duration, setDuration],
  );

  const { captureMode, snapPhoto, startRecording, stopRecording } =
    useCameraCapture({ stream, canvas, onMediaCaptured: handleMediaCaptured });

  // Tick the recording timer
  useEffect(() => {
    if (captureMode === "recording") {
      setRecSeconds(0);
      recTimerRef.current = setInterval(
        () => setRecSeconds((s) => s + 1),
        1000,
      );
    } else {
      if (recTimerRef.current) {
        clearInterval(recTimerRef.current);
        recTimerRef.current = null;
      }
      setRecSeconds(0);
    }
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    };
  }, [captureMode]);

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
           if (info.duration > duration) setDuration(info.duration);
        }
      }
    }
  };

  const handleAddCamera = () => {
    const newMedia = {
      id: `camera-${Date.now()}`,
      type: "camera" as const,
      name: `Live Camera`,
      path: "",
    };
    addMedia(newMedia);
    selectMedia(newMedia.id);
  };

  const handleExport = async () => {
    if (!canvas) {
      alert("No canvas available for export");
      return;
    }

    try {
      let result;
      
      if (renderSource?.type === "video") {
         result = await exportVideo(canvas, effects, duration, { format: "mp4", quality: 1.0, fps: 30 });
      } else {
         result = await exportImage();
      }

      if (!result) return;

      if (result.success) {
        alert(`Exported to: ${result.filePath}`);
      } else {
        const errorMsg = 'error' in result ? result.error : "Unknown error";
        alert(`Export failed: ${errorMsg}`);
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

  const handleRegionDrawn = useCallback((region: Omit<Region, 'id' | 'name' | 'color'>) => {
    const regionNumber = regions.length + 1;
    const colorIndex = regions.length % REGION_COLORS.length;
    const newRegion: Region = {
      id: `region-${Date.now()}`,
      name: `Region ${regionNumber}`,
      color: REGION_COLORS[colorIndex],
      ...region,
    };
    addRegion(newRegion);
    setActiveRegionId(newRegion.id);
    setIsDrawingRegion(false);
  }, [regions, addRegion, setActiveRegionId, setIsDrawingRegion]);

  const handleRemoveRegion = useCallback((id: string) => {
    removeRegion(id);
    if (activeRegionId === id) {
      setActiveRegionId(null);
    }
  }, [removeRegion, activeRegionId, setActiveRegionId]);

  const handleStartDrawingRegion = useCallback(() => {
    setIsDrawingRegion(true);
  }, [setIsDrawingRegion]);

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
            onImport={() => handleImport()}
            onAddCamera={handleAddCamera}
            onSelect={(item) => selectMedia(item.id)}
            onRemove={removeMedia}
          />
        )}

        <Preview 
          onCanvasReady={handleCanvasReady}
          regions={regions}
          activeRegionId={activeRegionId}
          isDrawingRegion={isDrawingRegion}
          onRegionDrawn={handleRegionDrawn}
          onRegionSelect={setActiveRegionId}
          captureHud={
            isCamera ? (
              <div className={previewStyles.captureHud}>
                <button
                  className={`${previewStyles.captureBtn} ${previewStyles.snap}`}
                  onClick={snapPhoto}
                  title="Snap photo from canvas (effects included)"
                >
                  <Camera size={13} />
                  Snap
                </button>

                {captureMode === "idle" ? (
                  <button
                    className={`${previewStyles.captureBtn} ${previewStyles.record}`}
                    onClick={startRecording}
                    title="Start recording (effects included)"
                  >
                    <Video size={13} />
                    Record
                  </button>
                ) : (
                  <>
                    <span className={previewStyles.recTimer}>
                      {String(Math.floor(recSeconds / 60)).padStart(2, "0")}:
                      {String(recSeconds % 60).padStart(2, "0")}
                    </span>
                    <button
                      className={`${previewStyles.captureBtn} ${previewStyles.record} ${previewStyles.recording}`}
                      onClick={stopRecording}
                      title="Stop recording"
                    >
                      <StopIcon size={13} />
                      Stop
                    </button>
                  </>
                )}
              </div>
            ) : undefined
          }
        />

        {showEffectsPanel && (
          <EffectsPanel
            effects={effects}
            regions={regions}
            activeRegionId={activeRegionId}
            onAddEffect={addEffect}
            onUpdateEffect={updateEffect}
            onRemoveEffect={removeEffect}
            onReorderEffect={reorderEffect}
            onRemoveRegion={handleRemoveRegion}
            onSelectRegion={setActiveRegionId}
            onStartDrawingRegion={handleStartDrawingRegion}
          />
        )}
      </div>

      {showTimeline && (
        <Timeline
          media={media}
          effects={effects}
          clips={clips}
          effectParamTracks={effectParamTracks}
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying}
          onAddClip={addClip}
          onRemoveClip={removeClip}
          onUpdateClip={updateClip}
          onUpdateEffect={updateEffect}
          onRemoveEffect={removeEffect}
          onAddEffectParamTrack={addEffectParamTrack}
          onRemoveEffectParamTrack={removeEffectParamTrack}
          onAddKeyframe={addKeyframe}
          onUpdateKeyframe={updateKeyframe}
          onRemoveKeyframe={removeKeyframe}
          onSeek={setCurrentTime}
          onPlay={play}
          onPause={pause}
          onStop={stop}
        />
      )}
    </div>
  );
}

export default App;
