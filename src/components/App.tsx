import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
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
import { useRenderEngine } from "../hooks/useRenderEngine";
import { useCameraStream } from "../hooks/useCameraStream";
import { useClockSelector } from "../hooks/useClock";
import { useCameraCapture } from "../hooks/useCameraCapture";
import { useExport, type ExportResult } from "../hooks/useExport";
import { usePlayback } from "../hooks/usePlayback";
import { useFileImport } from "../hooks/useFileImport";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useAppActions } from "../hooks/useAppActions";
import { resolveRenderSources } from "../lib/engine/sources";
import { playbackClock } from "../lib/engine/clock";
import type { Region } from "../lib/effects/types";
import styles from "./App.module.scss";
import { ErrorBoundary, Toaster, toast } from "./ui";
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
  } = useProjectStore(
    useShallow((s) => ({
      projectName: s.projectName,
      isDirty: s.isDirty,
      media: s.media,
      selectedMediaId: s.selectedMediaId,
      effects: s.effects,
      regions: s.regions,
      overlays: s.overlays,
      resolution: s.resolution,
      currentTime: s.currentTime,
      duration: s.duration,
      isPlaying: s.isPlaying,
      clips: s.clips,
      effectParamTracks: s.effectParamTracks,
      addMedia: s.addMedia,
      removeMedia: s.removeMedia,
      selectMedia: s.selectMedia,
      addEffect: s.addEffect,
      updateEffect: s.updateEffect,
      removeEffect: s.removeEffect,
      reorderEffect: s.reorderEffect,
      addRegion: s.addRegion,
      removeRegion: s.removeRegion,
      addOverlay: s.addOverlay,
      removeOverlay: s.removeOverlay,
      updateOverlay: s.updateOverlay,
      setCurrentTime: s.setCurrentTime,
      setResolution: s.setResolution,
      play: s.play,
      pause: s.pause,
      stop: s.stop,
      setDuration: s.setDuration,
      addClip: s.addClip,
      removeClip: s.removeClip,
      updateClip: s.updateClip,
      addEffectParamTrack: s.addEffectParamTrack,
      removeEffectParamTrack: s.removeEffectParamTrack,
      addKeyframe: s.addKeyframe,
      updateKeyframe: s.updateKeyframe,
      removeKeyframe: s.removeKeyframe,
      saveProject: s.saveProject,
      saveProjectAs: s.saveProjectAs,
      loadProject: s.loadProject,
      newProject: s.newProject,
      setProjectName: s.setProjectName,
      undo: s.undo,
      redo: s.redo,
      sourceTransform: s.sourceTransform,
      setSourceTransform: s.setSourceTransform,
    })),
  );

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
  } = useUIStore(
    useShallow((s) => ({
      showMediaBrowser: s.showMediaBrowser,
      showEffectsPanel: s.showEffectsPanel,
      showTimeline: s.showTimeline,
      activeRegionId: s.activeRegionId,
      activeOverlayId: s.activeOverlayId,
      isDrawingRegion: s.isDrawingRegion,
      mediaBrowserSize: s.mediaBrowserSize,
      effectsPanelSize: s.effectsPanelSize,
      timelineSize: s.timelineSize,
      setShowMediaBrowser: s.setShowMediaBrowser,
      setShowEffectsPanel: s.setShowEffectsPanel,
      setShowTimeline: s.setShowTimeline,
      setActiveRegionId: s.setActiveRegionId,
      setActiveOverlayId: s.setActiveOverlayId,
      setIsDrawingRegion: s.setIsDrawingRegion,
      setMediaBrowserSize: s.setMediaBrowserSize,
      setEffectsPanelSize: s.setEffectsPanelSize,
      setTimelineSize: s.setTimelineSize,
    })),
  );

  const { showWelcome, setShowWelcome } = useAppStore(
    useShallow((s) => ({ showWelcome: s.showWelcome, setShowWelcome: s.setShowWelcome })),
  );

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

  // ─── Effective project duration ──────────────────────────────────────────
  // The store's `duration` reflects the loaded video file length.  When clips
  // or overlays extend past it (e.g. extra clips, long text overlays) the
  // playhead and effect-clip clamping must use the full project span instead.
  const effectiveDuration = useMemo(() => {
    const maxClip = clips.reduce(
      (max, c) => (isFinite(c.endTime) ? Math.max(max, c.endTime) : max),
      0,
    );
    const maxOverlay = overlays.reduce(
      (max, o) => (isFinite(o.endTime) ? Math.max(max, o.endTime) : max),
      0,
    );
    return Math.max(duration, maxClip, maxOverlay);
  }, [duration, clips, overlays]);

  // ─── Playback heartbeat ───────────────────────────────────────────────────
  usePlayback({ isPlaying, duration: effectiveDuration, setCurrentTime, pause });

  // ─── Rendering ────────────────────────────────────────────────────────────
  // The engine resolves which media is on screen from the timeline itself. The
  // UI only needs to know the *kind* of source at the playhead, which changes
  // at clip boundaries — not on every playback tick.
  const sourceKindAt = useCallback(
    (time: number) => {
      const s = resolveRenderSources(clips, media, overlays, time, selectedMediaId);
      return (s.isCamera ? 1 : 0) | (s.isVideo ? 2 : 0);
    },
    [clips, media, overlays, selectedMediaId],
  );
  const sourceKind = useClockSelector(sourceKindAt);
  const isCamera = (sourceKind & 1) !== 0;
  const isVideo = (sourceKind & 2) !== 0;

  const timelineModel = useMemo(
    () => ({ clips, media, overlays, selectedMediaId }),
    [clips, media, overlays, selectedMediaId],
  );

  const handleVideoDurationChange = useCallback(
    (dur: number) => {
      if (dur > duration) setDuration(dur);
    },
    [duration, setDuration],
  );

  const { stream, video: cameraVideo } = useCameraStream(isCamera);

  const { renderAt } = useRenderEngine({
    canvas,
    timeline: timelineModel,
    effects,
    paramTracks: effectParamTracks,
    regions,
    sourceTransform,
    camera: isCamera ? cameraVideo : null,
    isPlaying,
    resolutionKey: `${resolution.width}x${resolution.height}`,
    onDurationChange: handleVideoDurationChange,
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

  const handleSelectMedia = useCallback(
    (item: { id: string }) => selectMedia(item.id),
    [selectMedia],
  );

  // ─── Export ───────────────────────────────────────────────────────────────
  const { exportOffline, exportImage: exportImageFile, isExporting, exportProgress } = useExport();
  const [showExportDialog, setShowExportDialog] = useState(false);

  const handleExport = useCallback(() => setShowExportDialog(true), []);

  const handleExportConfirm = async (settings: ExportSettings) => {
    if (!canvas) {
      toast.error("Nothing to export", "The preview canvas isn't ready yet.");
      return;
    }

    try {
      const fmt = settings.format;
      const exportDuration =
        clips.length > 0
          ? Math.max(...clips.map((c) => c.endTime))
          : media.find((m) => m.id === selectedMediaId)?.duration ?? duration;

      let result: ExportResult | null;
      if (fmt === "png" || fmt === "jpeg") {
        result = await exportImageFile(canvas, fmt === "jpeg" ? "jpeg" : "png");
      } else {
        // MP4, WebM and GIF all render offline frame-by-frame: deterministic,
        // no dropped frames under heavy effects, and the quality setting applies.
        pause();
        result = await exportOffline(canvas, exportDuration, settings, renderAt);
        // Export walked the timeline; put the preview back at the playhead.
        await renderAt(playbackClock.time);
      }

      setShowExportDialog(false);
      if (!result || result.canceled) return;
      if (result.success) toast.success("Export complete", result.filePath);
      else toast.error("Export failed", result.error ?? "Unknown error");
    } catch (error) {
      setShowExportDialog(false);
      toast.error("Export failed", error instanceof Error ? error.message : String(error));
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
              <ErrorBoundary name="Media browser">
                <MediaBrowser
                  media={media}
                  selectedId={selectedMediaId}
                  onImport={handleImport}
                  onAddCamera={handleAddCamera}
                  onSelect={handleSelectMedia}
                  onRemove={removeMedia}
                  onDropFiles={handleDropFiles}
                />
              </ErrorBoundary>
            </Panel>
            <PanelResizeHandle />
            <Panel minSize="30">
              <ErrorBoundary name="Preview">
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
                  onOverlayUpdate={updateOverlay}
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
              </ErrorBoundary>
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
              <ErrorBoundary name="Effects panel">
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
                  onUpdateOverlay={updateOverlay}
                  onAddTextOverlay={handleAddTextOverlay}
                />
              </ErrorBoundary>
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
          <ErrorBoundary name="Timeline">
            <Timeline
              media={media}
              effects={effects}
              clips={clips}
              overlays={overlays}
              selectedOverlayId={activeOverlayId}
              effectParamTracks={effectParamTracks}
              currentTime={currentTime}
              duration={effectiveDuration}
              isPlaying={isPlaying}
              onAddClip={addClip}
              onRemoveClip={removeClip}
              onUpdateClip={updateClip}
              onAddOverlay={addOverlay}
              onUpdateOverlay={updateOverlay}
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
          </ErrorBoundary>
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
      <Toaster />
    </div>
  );
}

export default App;
