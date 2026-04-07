import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import Toolbar from "./Toolbar/Toolbar";
import MediaBrowser from "./MediaBrowser/MediaBrowser";
import Preview from "./Preview/Preview";
import EffectsPanel from "./EffectsPanel/EffectsPanel";
import { Timeline } from "./Timeline/Timeline";
import ExportDialog from "./ExportDialog/ExportDialog";
import type { ExportSettings } from "./ExportDialog/ExportDialog";
import { useProjectStore, selectCanUndo, selectCanRedo } from "../stores/projectStore";
import { useUIStore } from "../stores/uiStore";
import { usePhotoEditor } from "../hooks/usePhotoEditor";
import { useVideoPlayer } from "../hooks/useVideoPlayer";
import { useCameraPlayer } from "../hooks/useCameraPlayer";
import { useCameraCapture } from "../hooks/useCameraCapture";
import { useExport } from "../hooks/useExport";
import { usePlayback } from "../hooks/usePlayback";
import { useFileImport } from "../hooks/useFileImport";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
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
    undo,
    redo,
    sourceTransform,
    setSourceTransform,
  } = useProjectStore();

  const canUndo = useProjectStore(selectCanUndo);
  const canRedo = useProjectStore(selectCanRedo);

  const {
    showMediaBrowser,
    showEffectsPanel,
    showTimeline,
    activeRegionId,
    activeOverlayId,
    isDrawingRegion,
    mediaBrowserSize,
    effectsPanelSize,
    timelineSize,
    setShowMediaBrowser,
    setShowEffectsPanel,
    setShowTimeline,
    setActiveRegionId,
    setActiveOverlayId,
    setIsDrawingRegion,
    setMediaBrowserSize,
    setEffectsPanelSize,
    setTimelineSize,
  } = useUIStore();

  const mediaBrowserRef = useRef<PanelImperativeHandle | null>(null);
  const effectsPanelRef = useRef<PanelImperativeHandle | null>(null);
  const timelinePanelRef = useRef<PanelImperativeHandle | null>(null);

  const handleToggleMediaBrowser = useCallback(() => {
    const panel = mediaBrowserRef.current;
    if (!panel) return;
    if (showMediaBrowser) panel.collapse();
    else panel.expand();
  }, [showMediaBrowser]);

  const handleToggleEffectsPanel = useCallback(() => {
    const panel = effectsPanelRef.current;
    if (!panel) return;
    if (showEffectsPanel) panel.collapse();
    else panel.expand();
  }, [showEffectsPanel]);

  const handleToggleTimeline = useCallback(() => {
    const panel = timelinePanelRef.current;
    if (!panel) return;
    if (showTimeline) panel.collapse();
    else panel.expand();
  }, [showTimeline]);

  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  // ─── Playback heartbeat ───────────────────────────────────────────────────
  usePlayback({ isPlaying, currentTime, duration, setCurrentTime, pause });

  // ─── Timeline rendering logic ─────────────────────────────────────────────
  const activeClips = clips
    .filter((c) => currentTime >= c.startTime && currentTime <= c.endTime)
    .sort((a, b) => a.startTime - b.startTime);

  const activeMediaList = activeClips
    .map((c) => ({
      clip: c,
      media: media.find((m) => m.id === c.mediaId),
      isFallback: false,
    }))
    .filter(
      (m): m is { clip: (typeof activeClips)[number]; media: NonNullable<ReturnType<typeof media.find>>; isFallback: boolean } =>
        m.media != null,
    );

  const selectedMedia = media.find((m) => m.id === selectedMediaId);

  const renderSources =
    activeMediaList.length > 0
      ? activeMediaList
      : selectedMedia
        ? [{ clip: undefined, media: selectedMedia, isFallback: true }]
        : [];

  const resolvedEffects = resolveEffectsAtTime(effects, effectParamTracks, currentTime);

  const isCamera = renderSources.length > 0 && renderSources[0].media?.type === "camera";
  const isVideo = renderSources.length > 0 && renderSources.some((s) => s.media?.type === "video");

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

  const activeOverlays = overlays.filter(
    (o) => currentTime >= o.startTime && currentTime <= o.endTime,
  );

  const overlayVideos = activeOverlays
    .filter((o) => o.type === "video" && o.mediaId)
    .map((o) => {
      const mediaItem = media.find((m) => m.id === o.mediaId);
      return { id: o.id, path: mediaItem?.path || "", localTime: currentTime - o.startTime };
    })
    .filter((o) => o.path);

  const overlayImages = activeOverlays
    .filter((o) => o.type === "image" && o.mediaId)
    .map((o) => {
      const mediaItem = media.find((m) => m.id === o.mediaId);
      return { id: o.id, path: mediaItem?.path || "" };
    })
    .filter((o) => o.path);

  // ─── Rendering hooks ─────────────────────────────────────────────────────
  const { exportImage } = usePhotoEditor({
    canvas,
    effects: resolvedEffects,
    activeImages: imageSources,
    overlayImages,
    regions,
    overlays,
    sourceTransform,
  });

  // Suppress unused warning — exportImage is used internally by usePhotoEditor
  void exportImage;

  const handleVideoDurationChange = useCallback(
    (dur: number) => {
      if (dur > duration) setDuration(dur);
    },
    [duration, setDuration],
  );

  useVideoPlayer({
    canvas,
    effects: resolvedEffects,
    activeVideos: videoSources,
    overlayVideos,
    isPlaying,
    currentTime,
    regions,
    overlays,
    onDurationChange: handleVideoDurationChange,
    sourceTransform,
  });

  const { stream } = useCameraPlayer({
    canvas,
    effects: resolvedEffects,
    isActive: isCamera,
    regions,
    sourceTransform,
  });

  // ─── Camera capture ───────────────────────────────────────────────────────
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recSeconds, setRecSeconds] = useState(0);

  const handleMediaCaptured = useCallback(
    ({ blob: _blob, ...item }: { id: string; type: "image" | "video"; name: string; path: string; duration?: number; blob?: Blob }) => {
      addMedia(item);
      if (item.type === "video" && item.duration) {
        if (item.duration > duration) setDuration(item.duration);
      }
    },
    [addMedia, duration, setDuration],
  );

  const { captureMode, snapPhoto, startRecording, stopRecording } = useCameraCapture({
    stream,
    canvas,
    onMediaCaptured: handleMediaCaptured,
  });

  useEffect(() => {
    if (captureMode === "recording") {
      setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
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

  // ─── File import ──────────────────────────────────────────────────────────
  const { handleImport, handleAddCamera, handleDropFiles } = useFileImport({
    addMedia,
    selectMedia,
    duration,
    setDuration,
  });

  // ─── Export ───────────────────────────────────────────────────────────────
  const { exportOffline, exportRealtime, exportImage: exportImageFile, isExporting, exportProgress } = useExport();
  const [showExportDialog, setShowExportDialog] = useState(false);

  const handleExport = useCallback(() => setShowExportDialog(true), []);

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
        result = await exportImageFile(canvas, fmt === "jpeg" ? "jpeg" : "png");
      } else if (fmt === "webm" && isVideo) {
        pause();
        setCurrentTime(0);
        await new Promise((r) => setTimeout(r, 300));
        play();
        result = await exportRealtime(canvas, exportDuration, settings.fps);
        pause();
      } else {
        pause();
        const seek = (time: number): Promise<void> =>
          new Promise((resolve) => {
            setCurrentTime(time);
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          });
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

  // ─── Actions ──────────────────────────────────────────────────────────────
  const handleUndo = useCallback(() => undo(), [undo]);
  const handleRedo = useCallback(() => redo(), [redo]);
  const handleSave = useCallback(async () => saveProject(), [saveProject]);
  const handlePlayPause = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, pause, play]);

  const handleRegionDrawn = useCallback(
    (region: Omit<Region, "id" | "name" | "color">) => {
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
    },
    [regions, addRegion, setActiveRegionId, setIsDrawingRegion],
  );

  const handleRemoveRegion = useCallback(
    (id: string) => {
      removeRegion(id);
      if (activeRegionId === id) setActiveRegionId(null);
    },
    [removeRegion, activeRegionId, setActiveRegionId],
  );

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

  const shortcuts = useMemo(
    () => ({
      undo: handleUndo,
      redo: handleRedo,
      save: handleSave,
      export: handleExport,
      playPause: handlePlayPause,
      canUndo,
      canRedo,
    }),
    [handleUndo, handleRedo, handleSave, handleExport, handlePlayPause, canUndo, canRedo],
  );

  useKeyboardShortcuts(shortcuts);

  return (
    <div className={styles.app}>
      <Toolbar
        projectName={projectName}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSave={handleSave}
        onOpen={loadProject}
        onExport={handleExport}
        canUndo={canUndo}
        canRedo={canRedo}
        resolution={resolution}
        onResolutionChange={setResolution}
        showMediaBrowser={showMediaBrowser}
        showEffectsPanel={showEffectsPanel}
        showTimeline={showTimeline}
        onToggleMediaBrowser={handleToggleMediaBrowser}
        onToggleEffectsPanel={handleToggleEffectsPanel}
        onToggleTimeline={handleToggleTimeline}
      />

      <PanelGroup orientation="vertical" className={styles.panelGroupVertical}>
        <Panel minSize={40} className={styles.mainPanel}>
          <PanelGroup orientation="horizontal">
            <Panel
              panelRef={mediaBrowserRef}
              defaultSize={mediaBrowserSize}
              minSize={12}
              collapsible
              onResize={(size) => {
                setMediaBrowserSize(size.asPercentage);
                setShowMediaBrowser(size.asPercentage > 0);
              }}
            >
              <MediaBrowser
                media={media}
                selectedId={selectedMediaId}
                onImport={handleImport}
                onAddCamera={handleAddCamera}
                onSelect={(item) => selectMedia(item.id)}
                onRemove={removeMedia}
                onDropFiles={handleDropFiles}
              />
            </Panel>
            <PanelResizeHandle />
            <Panel minSize={30}>
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
                sourceTransform={sourceTransform}
                onSourceTransformChange={setSourceTransform}
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
            </Panel>
            <PanelResizeHandle />
            <Panel
              panelRef={effectsPanelRef}
              defaultSize={effectsPanelSize}
              minSize={14}
              collapsible
              onResize={(size) => {
                setEffectsPanelSize(size.asPercentage);
                setShowEffectsPanel(size.asPercentage > 0);
              }}
            >
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
                onSelectOverlay={setActiveOverlayId}
                onStartDrawingRegion={handleStartDrawingRegion}
                onUpdateOverlay={(id, updates) => updateOverlay(id, updates)}
                onAddTextOverlay={handleAddTextOverlay}
              />
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle />
        <Panel
          panelRef={timelinePanelRef}
          defaultSize={timelineSize}
          minSize={12}
          collapsible
          onResize={(size) => {
            setTimelineSize(size.asPercentage);
            setShowTimeline(size.asPercentage > 0);
          }}
        >
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
        </Panel>
      </PanelGroup>

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
