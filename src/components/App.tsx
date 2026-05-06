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
import WelcomeModal from "./WelcomeModal/WelcomeModal";
import { CameraHud } from "./Preview/CameraHud";
import type { ExportSettings } from "./ExportDialog/ExportDialog";
import { useProjectStore, selectCanUndo, selectCanRedo } from "../stores/projectStore";
import { useUIStore } from "../stores/uiStore";
import { useAppStore } from "../stores/appStore";
import { usePhotoEditor } from "../hooks/usePhotoEditor";
import { useVideoPlayer } from "../hooks/useVideoPlayer";
import { useCameraPlayer } from "../hooks/useCameraPlayer";
import { useCameraCapture } from "../hooks/useCameraCapture";
import { useExport } from "../hooks/useExport";
import { usePlayback } from "../hooks/usePlayback";
import { useFileImport } from "../hooks/useFileImport";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useAppActions } from "../hooks/useAppActions";
import { resolveRenderSources } from "../hooks/useRenderSources";
import type { Region } from "../lib/effects/types";
import styles from "./App.module.scss";
import { resolveEffectsAtTime } from "../lib/timeline";
import "../lib/effects/processors";

const REGION_COLORS = ["#ff3366", "#33ccff", "#ffcc00", "#66ff66", "#cc66ff", "#ff9933"];

function App() {
  const {
    projectName,
    isDirty,
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
    saveProjectAs,
    loadProject,
    newProject,
    setProjectName,
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

  const { showWelcome, setShowWelcome } = useAppStore();

  const mediaBrowserRef = useRef<PanelImperativeHandle | null>(null);
  const effectsPanelRef = useRef<PanelImperativeHandle | null>(null);
  const timelinePanelRef = useRef<PanelImperativeHandle | null>(null);

  const handleToggleMediaBrowser = useCallback(() => {
    const panel = mediaBrowserRef.current;
    if (!panel) return;
    if (showMediaBrowser) panel.collapse();
    else panel.resize(`${mediaBrowserSize}%`);
  }, [showMediaBrowser, mediaBrowserSize]);

  const handleToggleEffectsPanel = useCallback(() => {
    const panel = effectsPanelRef.current;
    if (!panel) return;
    if (showEffectsPanel) panel.collapse();
    else panel.resize(`${effectsPanelSize}%`);
  }, [showEffectsPanel, effectsPanelSize]);

  const handleToggleTimeline = useCallback(() => {
    const panel = timelinePanelRef.current;
    if (!panel) return;
    if (showTimeline) panel.collapse();
    else panel.resize(`${timelineSize}%`);
  }, [showTimeline, timelineSize]);

  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  // ─── Playback heartbeat ───────────────────────────────────────────────────
  const { liveTimeRef } = usePlayback({ isPlaying, currentTime, duration, setCurrentTime, pause });

  // ─── Timeline rendering logic ─────────────────────────────────────────────
  const resolvedEffects = resolveEffectsAtTime(effects, effectParamTracks, currentTime);

  const resolveEffectsForTime = useCallback(
    (time: number) => resolveEffectsAtTime(effects, effectParamTracks, time),
    [effects, effectParamTracks],
  );

  const { videoSources, imageSources, activeOverlays, overlayVideos, overlayImages, isCamera, isVideo } = useMemo(
    () => resolveRenderSources(clips, media, overlays, currentTime, selectedMediaId),
    [clips, media, overlays, currentTime, selectedMediaId],
  );

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
    resolveEffects: resolveEffectsForTime,
    effects: resolvedEffects,
    activeVideos: videoSources,
    overlayVideos,
    overlayImages,
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
          : media.find((m) => m.id === selectedMediaId)?.duration ?? duration;

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
  const { handleUndo, handleRedo, handleSave, handleSaveAs, handleNewProject, handleShowWelcome, handleCloseWelcome } =
    useAppActions({ isDirty, undo, redo, saveProject, saveProjectAs, loadProject, newProject, setShowWelcome });

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
      saveAs: handleSaveAs,
      newProject: handleNewProject,
      export: handleExport,
      playPause: handlePlayPause,
      canUndo,
      canRedo,
    }),
    [handleUndo, handleRedo, handleSave, handleSaveAs, handleNewProject, handleExport, handlePlayPause, canUndo, canRedo],
  );

  useKeyboardShortcuts(shortcuts);

  return (
    <div className={styles.app}>
      <Toolbar
        projectName={projectName}
        isDirty={isDirty}
        onProjectNameChange={setProjectName}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onOpen={loadProject}
        onNewProject={handleNewProject}
        onShowWelcome={handleShowWelcome}
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

      <PanelGroup
        orientation="vertical"
        className={styles.panelGroupVertical}
        onLayoutChanged={(layout) => {
          const tlSize = layout["timeline"];
          if (tlSize !== undefined && tlSize >= 12) setTimelineSize(tlSize);
        }}
      >
        <Panel minSize="40" className={styles.mainPanel}>
          <PanelGroup
            orientation="horizontal"
            onLayoutChanged={(layout) => {
              const mbSize = layout["media-browser"];
              const epSize = layout["effects-panel"];
              if (mbSize !== undefined && mbSize >= 12) setMediaBrowserSize(mbSize);
              if (epSize !== undefined && epSize >= 14) setEffectsPanelSize(epSize);
            }}
          >
            <Panel
              id="media-browser"
              panelRef={mediaBrowserRef}
              defaultSize={`${mediaBrowserSize}%`}
              minSize="12"
              collapsible
              onResize={(size) => {
                const visible = size.asPercentage > 0;
                if (visible !== showMediaBrowser) setShowMediaBrowser(visible);
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
            <Panel minSize="30">
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
                    <CameraHud
                      captureMode={captureMode}
                      recSeconds={recSeconds}
                      onSnap={snapPhoto}
                      onStartRecording={startRecording}
                      onStopRecording={stopRecording}
                    />
                  ) : undefined
                }
              />
            </Panel>
            <PanelResizeHandle />
            <Panel
              id="effects-panel"
              panelRef={effectsPanelRef}
              defaultSize={`${effectsPanelSize}%`}
              minSize="14"
              collapsible
              onResize={(size) => {
                const visible = size.asPercentage > 0;
                if (visible !== showEffectsPanel) setShowEffectsPanel(visible);
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
          id="timeline"
          panelRef={timelinePanelRef}
          defaultSize={`${timelineSize}%`}
          minSize="12"
          collapsible
          onResize={(size) => {
            const visible = size.asPercentage > 0;
            if (visible !== showTimeline) setShowTimeline(visible);
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
            liveTimeRef={liveTimeRef}
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

      {showWelcome && <WelcomeModal onClose={handleCloseWelcome} />}
    </div>
  );
}

export default App;
