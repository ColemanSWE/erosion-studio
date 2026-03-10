import { useState, useCallback, useEffect, useRef } from "react";
import Toolbar from "./Toolbar/Toolbar";
import MediaBrowser from "./MediaBrowser/MediaBrowser";
import Preview from "./Preview/Preview";
import EffectsPanel from "./EffectsPanel/EffectsPanel";
import { Timeline } from "./Timeline/Timeline";
import ExportDialog from "./ExportDialog/ExportDialog";
import type { ExportSettings } from "./ExportDialog/ExportDialog";
import { useProjectStore } from "../stores/projectStore";
import { useUIStore } from "../stores/uiStore";
import { usePhotoEditor } from "../hooks/usePhotoEditor";
import { useVideoPlayer } from "../hooks/useVideoPlayer";
import { useCameraPlayer } from "../hooks/useCameraPlayer";
import { useCameraCapture } from "../hooks/useCameraCapture";
import { useExport } from "../hooks/useExport";
import { useHistory } from "../hooks/useHistory";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import type { Project } from "../lib/project";
import type { Region } from "../lib/effects/types";
import styles from "./App.module.scss";
import previewStyles from "./Preview/Preview.module.scss";
import { Camera, Video, Square as StopIcon } from "lucide-react";
import { resolveEffectsAtTime } from "../lib/timeline";
import "../lib/effects/processors";

const REGION_COLORS = ["#ff3366", "#33ccff", "#ffcc00", "#66ff66", "#cc66ff", "#ff9933"];

function App() {
  const {
    projectName,
    media,
    selectedMediaId,
    effects,
    regions,
    overlays,
    resolution,
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
    addOverlay,
    removeOverlay,
    updateOverlay,
    setCurrentTime,
    setResolution,
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
    saveProject,
    loadProject,
  } = useProjectStore();

  const {
    showMediaBrowser,
    showEffectsPanel,
    showTimeline,
    activeRegionId,
    activeOverlayId,
    isDrawingRegion,
    setActiveRegionId,
    setActiveOverlayId,
    setIsDrawingRegion,
  } = useUIStore();

  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  const projectSnapshot: Project = {
    name: projectName,
    media,
    effects,
    regions,
    overlays,
    resolution,
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

  const { exportOffline, exportRealtime, exportImage: exportImageFile, isExporting, exportProgress } = useExport();
  const [showExportDialog, setShowExportDialog] = useState(false);

  // ─── Playback Heartbeat ──────────────────────────────────────────────────
  // Use refs so the rAF loop doesn't tear down on every frame
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const durationRef = useRef(duration);
  durationRef.current = duration;

  useEffect(() => {
    if (!isPlaying) return;

    let rafId: number;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const next = currentTimeRef.current + dt;
      if (next >= durationRef.current) {
        setCurrentTime(durationRef.current);
        pause();
      } else {
        setCurrentTime(next);
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, setCurrentTime, pause]);

  // ─── Timeline Rendering logic ─────────────────────────────────────────────
  const activeClips = clips
    .filter((c) => currentTime >= c.startTime && currentTime <= c.endTime)
    .sort((a, b) => a.startTime - b.startTime); // Primary is first, secondary (transitioning in) is next

  const activeMediaList = activeClips
    .map((c) => ({
      clip: c,
      media: media.find((m) => m.id === c.mediaId),
      isFallback: false,
    }))
    .filter((m) => m.media != null) as { clip: any; media: any; isFallback: boolean }[];

  const selectedMedia = media.find((m) => m.id === selectedMediaId);

  // Use selected media if no clip is active (fallback behavior)
  const renderSources =
    activeMediaList.length > 0
      ? activeMediaList
      : selectedMedia
        ? [{ clip: undefined, media: selectedMedia, isFallback: true }]
        : [];
  // Resolve effects based on timeline keyframes and time windows
  const resolvedEffects = resolveEffectsAtTime(
    effects,
    effectParamTracks,
    currentTime
  );

  const isCamera = renderSources.length > 0 && renderSources[0].media?.type === "camera";
  const isVideo = renderSources.length > 0 && renderSources.some((s) => s.media?.type === "video");
  const isImage = renderSources.length > 0 && renderSources.some((s) => s.media?.type === "image");

  // Filter sources by type for the respective hooks
  const imageSources = renderSources
    .filter((s) => s.media.type === "image")
    .map((s) => ({
      id: s.clip ? s.clip.id : s.media.id,
      path: s.media.path,
    }));

  const videoSources = renderSources
    .filter((s) => s.media.type === "video")
    .map((s) => ({
      id: s.clip ? s.clip.id : s.media.id,
      path: s.media.path,
      localTime: s.clip ? currentTime - s.clip.startTime : currentTime,
    }));

  // ─── Rendering Hooks ─────────────────────────────────────────────────────
  // Only the hook corresponding to the active source type will draw.
  
  const { exportImage } = usePhotoEditor({
    canvas,
    effects: resolvedEffects,
    activeImages: imageSources,
    regions,
  });

  const handleVideoDurationChange = useCallback((dur: number) => {
    if (dur > durationRef.current) setDuration(dur);
  }, [setDuration]);

  useVideoPlayer({
    canvas,
    effects: resolvedEffects,
    activeVideos: videoSources,
    isPlaying,
    currentTime,
    regions,
    onDurationChange: handleVideoDurationChange,
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
      filters: [
        {
          name: "All Supported Media",
          extensions: ["mp4", "mov", "webm", "avi", "mkv", "m4v", "jpg", "jpeg", "png", "gif", "webp"],
        },
        {
          name: "Videos",
          extensions: ["mp4", "mov", "webm", "avi", "mkv", "m4v"],
        },
        {
          name: "Images",
          extensions: ["jpg", "jpeg", "png", "gif", "webp"],
        },
      ],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      const fileName = filePath.split("/").pop() || "Unknown";
      const isVideo = /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(fileName);

      let videoDuration: number | undefined;
      if (isVideo && window.electron?.ffmpeg) {
        const info = await window.electron.ffmpeg.getVideoInfo(filePath);
        if (info.success && info.duration && isFinite(info.duration)) {
          videoDuration = info.duration;
          if (info.duration > duration) setDuration(info.duration);
        }
      }

      const newMedia = {
        id: `media-${Date.now()}`,
        type: isVideo ? "video" : "image",
        name: fileName,
        path: filePath,
        duration: videoDuration,
      } as const;

      addMedia(newMedia);
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

  const handleDropFiles = useCallback(async (files: FileList) => {
    for (const file of Array.from(files)) {
      const isVideo = /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(file.name);
      const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name);
      if (!isVideo && !isImage) continue;

      // Build a pseudo file:// path from the file object
      // In Electron, File objects have a `path` property
      const filePath = (file as any).path || file.name;

      let videoDuration: number | undefined;
      if (isVideo && window.electron?.ffmpeg && filePath.startsWith("/")) {
        try {
          const info = await window.electron.ffmpeg.getVideoInfo(filePath);
          if (info.success && info.duration && isFinite(info.duration)) {
            videoDuration = info.duration;
            if (info.duration > duration) setDuration(info.duration);
          }
        } catch {}
      }

      const newMedia = {
        id: `media-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: isVideo ? "video" : "image",
        name: file.name,
        path: filePath.startsWith("/") ? filePath : URL.createObjectURL(file),
        duration: videoDuration,
      } as const;

      addMedia(newMedia);
    }
  }, [addMedia, duration, setDuration]);

  const handleExport = () => {
    setShowExportDialog(true);
  };

  const handleExportConfirm = async (settings: ExportSettings) => {
    if (!canvas) {
      alert("No canvas available for export");
      return;
    }

    try {
      let result;
      const fmt = settings.format;

      const exportDuration =
        clips.length > 0
          ? Math.max(...clips.map((c) => c.endTime))
          : selectedMedia?.duration ?? duration;

      if (fmt === "png" || fmt === "jpeg") {
        // Still image export
        result = await exportImageFile(canvas, fmt === "jpeg" ? "jpeg" : "png");
      } else if (fmt === "webm" && isVideo) {
        // Real-time WebM via MediaRecorder — play the timeline
        pause();
        setCurrentTime(0);
        await new Promise((r) => setTimeout(r, 300));
        play();
        result = await exportRealtime(canvas, exportDuration, settings.fps);
        pause();
      } else {
        // Offline frame-by-frame export (MP4, GIF, or WebM-offline)
        pause();

        const seek = (time: number): Promise<void> => {
          return new Promise((resolve) => {
            setCurrentTime(time);
            // Wait two rAF cycles so the video player can seek and render
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          });
        };

        result = await exportOffline(canvas, exportDuration, settings, seek);
      }

      setShowExportDialog(false);

      if (!result) return;
      if (result.success) {
        alert(`Exported to: ${result.filePath}`);
      } else {
        const errorMsg = "error" in result ? result.error : "Unknown error";
        alert(`Export failed: ${errorMsg}`);
      }
    } catch (error) {
      alert(`Export failed: ${error}`);
      setShowExportDialog(false);
    }
  };

  const handleUndo = useCallback(() => {
    undo();
  }, [undo]);

  const handleRedo = useCallback(() => {
    redo();
  }, [redo]);

  const handleSave = useCallback(async () => {
    await saveProject();
  }, [saveProject]);

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

  const handleAddTextOverlay = useCallback(() => {
    addOverlay({
      id: `overlay-${Date.now()}`,
      name: "Text Overlay",
      type: "text",
      text: "New Text",
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.1,
      startTime: 0,
      endTime: duration,
      trackIndex: 1,
      color: "#ffffff",
      isEffectZone: false,
    });
  }, [addOverlay, duration]);

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
        onSave={handleSave}
        onOpen={loadProject}
        onExport={handleExport}
        onAddText={handleAddTextOverlay}
        canUndo={canUndo}
        canRedo={canRedo}
        resolution={resolution}
        onResolutionChange={setResolution}
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
            onDropFiles={handleDropFiles}
          />
        )}

        <Preview
          width={resolution.width}
          height={resolution.height}
          onCanvasReady={handleCanvasReady}
          regions={regions}
          overlays={overlays}
          activeRegionId={activeRegionId}
          activeOverlayId={activeOverlayId}
          isDrawingRegion={isDrawingRegion}
          onRegionDrawn={handleRegionDrawn}
          onRegionSelect={setActiveRegionId}
          onOverlaySelect={setActiveOverlayId}
          onOverlayUpdate={(id, updates) => updateOverlay(id, updates)}
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
            overlays={overlays}
            activeRegionId={activeRegionId}
            activeOverlayId={activeOverlayId}
            onAddEffect={addEffect}
            onUpdateEffect={updateEffect}
            onRemoveEffect={removeEffect}
            onReorderEffect={reorderEffect}
            onRemoveRegion={handleRemoveRegion}
            onSelectRegion={setActiveRegionId}
            onStartDrawingRegion={handleStartDrawingRegion}
            onUpdateOverlay={(id, updates) => updateOverlay(id, updates)}
          />
        )}
      </div>

      {showTimeline && (
        <Timeline
          media={media}
          effects={effects}
          clips={clips}
          overlays={overlays}
          selectedOverlayId={activeOverlayId}
          effectParamTracks={effectParamTracks}
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying}
          onAddClip={addClip}
          onRemoveClip={removeClip}
          onUpdateClip={updateClip}
          onAddOverlay={addOverlay}
          onUpdateOverlay={(id, updates) => updateOverlay(id, updates)}
          onRemoveOverlay={removeOverlay}
          onSelectOverlay={setActiveOverlayId}
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
      {showExportDialog && (
        <ExportDialog
          isVideo={isVideo || false}
          isExporting={isExporting}
          exportProgress={exportProgress}
          onExport={handleExportConfirm}
          onCancel={() => setShowExportDialog(false)}
        />
      )}
    </div>
  );
}

export default App;
