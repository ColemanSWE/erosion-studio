import React, { useRef, useState, useCallback, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Play,
  Pause,
  Square,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Magnet,
  Plus,
  Trash2,
  Film,
  Layers,
} from "lucide-react";
import type {
  Effect,
  TimelineClip,
  EffectParamTrack,
  Keyframe,
  Overlay,
} from "../../lib/effects/types";
import type { MediaItem } from "../../lib/project";
import { TimelineRuler } from "./TimelineRuler";
import { MediaTrack } from "./MediaTrack";
import { OverlayTrack } from "./OverlayTrack";
import { EffectTrack } from "./EffectTrack";
import { formatTime } from "../../lib/timeline";
import { useProjectStore } from "../../stores/projectStore";
import { playbackClock } from "../../lib/engine/clock";
import { useClockSelector } from "../../hooks/useClock";
import styles from "./Timeline.module.scss";

interface TimelineProps {
  media: MediaItem[];
  effects: Effect[];
  clips: TimelineClip[];
  overlays: Overlay[];
  selectedOverlayId: string | null;
  effectParamTracks: EffectParamTrack[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;

  onAddClip: (clip: TimelineClip) => void;
  onRemoveClip: (id: string) => void;
  onUpdateClip: (id: string, updates: Partial<TimelineClip>) => void;

  onAddOverlay: (overlay: Overlay) => void;
  onUpdateOverlay: (id: string, updates: Partial<Overlay>) => void;
  onRemoveOverlay: (id: string) => void;
  onSelectOverlay: (id: string | null) => void;

  onUpdateEffect: (id: string, updates: Partial<Effect>) => void;
  onRemoveEffect: (id: string) => void;

  onAddEffectParamTrack: (track: EffectParamTrack) => void;
  onRemoveEffectParamTrack: (id: string) => void;
  onAddKeyframe: (trackId: string, kf: Keyframe) => void;
  onUpdateKeyframe: (trackId: string, kfId: string, updates: Partial<Keyframe>) => void;
  onRemoveKeyframe: (trackId: string, kfId: string) => void;

  onSeek: (time: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
}

const MIN_ZOOM = 2;
const MAX_ZOOM = 400;
const DEFAULT_ZOOM = 60;
const MIN_TRACK_H = 24;
const MAX_TRACK_H = 100;
const DEFAULT_TRACK_H = 40;
const LABEL_W = 170;

/** Re-renders only when the formatted time string changes. */
function LiveTimeDisplay({ className }: { className: string }) {
  const text = useClockSelector(formatTime);
  return <span className={className}>{text}</span>;
}

export function Timeline({
  media,
  effects,
  clips,
  overlays,
  selectedOverlayId,
  effectParamTracks,
  currentTime,
  duration,
  isPlaying,
  onAddClip,
  onRemoveClip,
  onUpdateClip,
  onAddOverlay,
  onRemoveOverlay,
  onUpdateOverlay,
  onSelectOverlay,
  onUpdateEffect,
  onRemoveEffect,
  onAddEffectParamTrack,
  onRemoveEffectParamTrack,
  onAddKeyframe,
  onUpdateKeyframe,
  onRemoveKeyframe,
  onSeek,
  onPlay,
  onPause,
  onStop,
}: TimelineProps) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [trackHeight, setTrackHeight] = useState(DEFAULT_TRACK_H);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [expandedEffects, setExpandedEffects] = useState<Record<string, boolean>>({});

  const toggleEffectExpanded = useCallback((id: string) => {
    setExpandedEffects((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);
  const tracksAreaRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const playheadLineRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const pendingScrollLeftRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);

  // Refs so the playhead RAF loop always reads the latest values without
  // being re-created when zoom or scrollLeft changes.
  const zoomRef = useRef(0);
  const scrollLeftRef = useRef(0);

  const {
    mediaTracks,
    overlayTracks,
    addMediaTrack,
    removeMediaTrack,
    renameMediaTrack,
    addOverlayTrack,
    removeOverlayTrack,
    renameOverlayTrack,
  } = useProjectStore(
    useShallow((s) => ({
      mediaTracks: s.mediaTracks,
      overlayTracks: s.overlayTracks,
      addMediaTrack: s.addMediaTrack,
      removeMediaTrack: s.removeMediaTrack,
      renameMediaTrack: s.renameMediaTrack,
      addOverlayTrack: s.addOverlayTrack,
      removeOverlayTrack: s.removeOverlayTrack,
      renameOverlayTrack: s.renameOverlayTrack,
    })),
  );

  // Keep zoom/scrollLeft refs in sync so the playhead RAF reads fresh values.
  zoomRef.current = zoom;
  scrollLeftRef.current = scrollLeft;

  // Direct-DOM playhead + auto-scroll during playback, driven by the playback
  // clock so the needle moves every frame without any React re-render.
  useEffect(() => {
    if (!isPlaying) return;
    return playbackClock.subscribe((time) => {
      const px = time * zoomRef.current;
      if (playheadLineRef.current) playheadLineRef.current.style.left = `${px}px`;
      const ta = tracksAreaRef.current;
      if (!ta) return;
      if (px < ta.scrollLeft || px > ta.scrollLeft + ta.clientWidth - 60) {
        // onScroll → syncScroll propagates the new scrollLeft to the ruler.
        ta.scrollLeft = Math.max(0, px - ta.clientWidth / 2);
      }
    });
  }, [isPlaying]);

  const syncScroll = useCallback(() => {
    const ta = tracksAreaRef.current;
    const lb = labelsRef.current;
    if (!ta || !lb) return;
    lb.scrollTop = ta.scrollTop;
    pendingScrollLeftRef.current = ta.scrollLeft;
    if (scrollRafRef.current === null) {
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        setScrollLeft(pendingScrollLeftRef.current);
      });
    }
  }, []);

  const zoomIn = useCallback(() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.5)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.5)), []);

  const zoomToFit = useCallback(() => {
    const ta = tracksAreaRef.current;
    if (!ta) return;
    const maxClipEnd = clips.reduce((m, c) => Math.max(m, c.endTime), duration);
    const effectiveDur = Math.max(duration, maxClipEnd);
    if (effectiveDur <= 0) return;
    const fitZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, ta.clientWidth / effectiveDur));
    setZoom(fitZoom);
    ta.scrollLeft = 0;
    setScrollLeft(0);
  }, [clips, duration]);

  // Wheel: Ctrl/Meta = horizontal zoom (cursor-centred), Shift = vertical zoom
  useEffect(() => {
    const el = tracksAreaRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        setZoom((oldZoom) => {
          const factor = e.deltaY < 0 ? 1.2 : 0.85;
          const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * factor));
          const cursorTime = (el.scrollLeft + cursorX) / oldZoom;
          requestAnimationFrame(() => {
            el.scrollLeft = cursorTime * newZoom - cursorX;
            setScrollLeft(el.scrollLeft);
          });
          return newZoom;
        });
      } else if (e.shiftKey) {
        e.preventDefault();
        setTrackHeight((h) =>
          Math.max(MIN_TRACK_H, Math.min(MAX_TRACK_H, h + (e.deltaY < 0 ? 4 : -4))),
        );
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const activeEffects = effects.filter((e) => e.active);
  const maxClipEnd = clips.reduce(
    (max, c) => (isFinite(c.endTime) ? Math.max(max, c.endTime) : max),
    duration,
  );
  const effectiveDuration = Math.max(duration, maxClipEnd);
  const totalWidth = Math.max(effectiveDuration * zoom + 500, 800);

  const numMediaRows = Math.max(
    mediaTracks.length,
    ...clips.filter((c) => isFinite(c.trackIndex)).map((c) => c.trackIndex + 1),
  );
  const MEDIA_TRACK_H = numMediaRows * trackHeight;

  const numOverlayRows = Math.max(
    overlayTracks.length,
    ...overlays.filter((o) => isFinite(o.trackIndex)).map((o) => o.trackIndex + 1),
  );
  const OVERLAY_TRACK_H = numOverlayRows * trackHeight;

  // ─── Labels column ────────────────────────────────────────────────────────
  const renderLabels = () => {
    const labels: React.ReactNode[] = [];

    // Media track rows
    for (let i = 0; i < numMediaRows; i++) {
      const track = mediaTracks[i];
      labels.push(
        <TrackLabelRow
          key={track ? track.id : `media-auto-${i}`}
          name={track?.name ?? `Track ${i + 1}`}
          icon={<Film size={11} />}
          height={trackHeight}
          canDelete={mediaTracks.length > 1 && !!track}
          onRename={track ? (name) => renameMediaTrack(track.id, name) : undefined}
          onDelete={track ? () => removeMediaTrack(track.id) : undefined}
        />,
      );
    }
    // Overlay track rows
    for (let i = 0; i < numOverlayRows; i++) {
      const track = overlayTracks[i];
      labels.push(
        <TrackLabelRow
          key={track ? track.id : `overlay-auto-${i}`}
          name={track?.name ?? `Overlay ${i + 1}`}
          icon={<Layers size={11} />}
          height={trackHeight}
          canDelete={overlayTracks.length > 1 && !!track}
          onRename={track ? (name) => renameOverlayTrack(track.id, name) : undefined}
          onDelete={track ? () => removeOverlayTrack(track.id) : undefined}
        />,
      );
    }

    // Effect track labels — heights must exactly mirror EffectTrack's rendered rows
    for (const effect of activeEffects) {
      const tracks = effectParamTracks.filter((t) => t.effectId === effect.id);
      const isExpanded = expandedEffects[effect.id] ?? false;
      const effectName = effect.type
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      labels.push(
        <div key={effect.id}>
          <div
            className={styles.trackLabel}
            style={{
              height: trackHeight,
              borderLeft: `2px solid ${effect.startTime != null || effect.endTime != null ? "var(--cool)" : "var(--border-strong)"}`,
            }}
          >
            <span className={styles.trackLabelText}>{effectName}</span>
            <div className={styles.trackLabelActions}>
              <button
                className={`${styles.trackLabelBtn} ${styles.danger}`}
                onClick={(e) => { e.stopPropagation(); onRemoveEffect(effect.id); }}
                title="Remove effect"
              >
                <Trash2 size={10} />
              </button>
            </div>
          </div>
          {isExpanded && (
            <>
              {/* Matches the 24px "add param tracks" row in EffectTrack */}
              <div style={{ height: 24, background: "var(--bg-base)" }} />
              {tracks.map((t) => (
                <div key={t.id} className={styles.trackLabel} style={{ height: 24, paddingLeft: 20 }}>
                  <span className={styles.trackLabelText} style={{ color: "var(--keyframe-text)", fontSize: 9 }}>
                    {t.paramKey}
                  </span>
                  <div className={styles.trackLabelActions}>
                    <button
                      className={`${styles.trackLabelBtn} ${styles.danger}`}
                      onClick={() => onRemoveEffectParamTrack(t.id)}
                      title="Remove param track"
                    >
                      <Trash2 size={9} />
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>,
      );
    }

    return labels;
  };

  return (
    <div className={styles.timeline}>
      {/* ── Header bar ──────────────────────────────────────────────────── */}
      <div className={styles.timelineHeader}>
        <span className={styles.timelineTitle}>Timeline</span>

        <button className={styles.headerBtn} onClick={isPlaying ? onPause : onPlay} title={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <button className={styles.headerBtn} onClick={onStop} title="Stop">
          <Square size={12} />
        </button>

        <LiveTimeDisplay className={styles.timeDisplay} />

        <button
          className={`${styles.headerBtn} ${snapEnabled ? styles.active : ""}`}
          onClick={() => setSnapEnabled((v) => !v)}
          title={snapEnabled ? "Snapping on" : "Snapping off"}
        >
          <Magnet size={12} />
        </button>

        <div className={styles.zoomControls}>
          <button className={styles.headerBtn} onClick={zoomOut} title="Zoom Out">
            <ZoomOut size={12} />
          </button>
          <span className={styles.zoomLabel}>{Math.round(zoom)}px/s</span>
          <button className={styles.headerBtn} onClick={zoomIn} title="Zoom In">
            <ZoomIn size={12} />
          </button>
          <button className={styles.headerBtn} onClick={zoomToFit} title="Zoom to fit">
            <Maximize2 size={12} />
          </button>
        </div>
        <button className={styles.headerBtn} onClick={addMediaTrack} title="Add media track">
          <Film size={12} />
          <Plus size={10} />
        </button>
        <button className={styles.headerBtn} onClick={addOverlayTrack} title="Add overlay track">
          <Layers size={12} />
          <Plus size={10} />
        </button>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className={styles.timelineBody} style={{ flex: 1, overflow: "hidden" }}>
        {/* Left panel: fixed header aligned with ruler + scrollable track labels */}
        <div className={styles.leftPanel} style={{ width: LABEL_W }}>
          <div className={styles.labelsHeader} />
          <div ref={labelsRef} className={styles.labelsColumn}>
            {renderLabels()}
          </div>
        </div>

        {/* Right panel: ruler row (never scrolls) + scrollable tracks area */}
        <div className={styles.tracksRight}>
          {/* Ruler sits outside the scroll container so horizontal scroll
              doesn't double-offset the tick/playhead positions */}
          <div className={styles.rulerRow}>
            <TimelineRuler
              duration={effectiveDuration + 500 / zoom}
              currentTime={currentTime}
              zoom={zoom}
              onSeek={onSeek}
              scrollLeft={scrollLeft}
              isPlaying={isPlaying}
            />
          </div>

          {/* Scrollable tracks area */}
          <div ref={tracksAreaRef} className={styles.tracksArea} onScroll={syncScroll}>
            {/* Playhead line — position is driven by direct DOM during playback */}
            <div
              ref={playheadLineRef}
              style={{
                position: "absolute",
                // Live clock time, so a re-render mid-playback never snaps the line back.
                left: playbackClock.time * zoom,
                top: 0,
                bottom: 0,
                width: 1,
                background: "var(--hot-dim)",
                pointerEvents: "none",
                zIndex: 4,
              }}
            />

            {/* Magnetic snap indicator */}
            {snapLine !== null && (
              <div
                className={styles.snapLine}
                style={{ left: snapLine * zoom, top: 0 }}
              />
            )}

            {/* Media track */}
            <div className={styles.trackRow} style={{ width: totalWidth, height: MEDIA_TRACK_H }}>
              <MediaTrack
                clips={clips}
                overlays={overlays}
                tracks={mediaTracks}
                media={media}
                zoom={zoom}
                duration={duration}
                rowHeight={trackHeight}
                snapEnabled={snapEnabled}
                minWidth={totalWidth}
                onAddClip={onAddClip}
                onUpdateClip={onUpdateClip}
                onRemoveClip={onRemoveClip}
                onSnapLine={setSnapLine}
                onClearOverlaySelection={() => onSelectOverlay(null)}
              />
            </div>

            {/* Overlay track */}
            <div className={styles.trackRow} style={{ width: totalWidth, height: OVERLAY_TRACK_H }}>
              <OverlayTrack
                overlays={overlays}
                clips={clips}
                tracks={overlayTracks}
                media={media}
                zoom={zoom}
                duration={duration}
                minWidth={totalWidth}
                rowHeight={trackHeight}
                snapEnabled={snapEnabled}
                onAddOverlay={onAddOverlay}
                onUpdateOverlay={onUpdateOverlay}
                onRemoveOverlay={onRemoveOverlay}
                onSelectOverlay={onSelectOverlay}
                selectedOverlayId={selectedOverlayId}
                onSnapLine={setSnapLine}
              />
            </div>

            {/* Effect tracks */}
            {activeEffects.map((effect) => {
              const tracks = effectParamTracks.filter((t) => t.effectId === effect.id);
              return (
                <EffectTrack
                  key={effect.id}
                  effect={effect}
                  paramTracks={tracks}
                  clips={clips}
                  overlays={overlays}
                  zoom={zoom}
                  duration={duration}
                  snapEnabled={snapEnabled}
                  expanded={expandedEffects[effect.id] ?? false}
                  onToggleExpanded={() => toggleEffectExpanded(effect.id)}
                  onUpdateEffect={onUpdateEffect}
                  onRemoveEffect={onRemoveEffect}
                  onAddParamTrack={onAddEffectParamTrack}
                  _onRemoveParamTrack={onRemoveEffectParamTrack}
                  onAddKeyframe={onAddKeyframe}
                  onUpdateKeyframe={onUpdateKeyframe}
                  onRemoveKeyframe={onRemoveKeyframe}
                  onSnapLine={setSnapLine}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Track label row with inline rename ──────────────────────────────────────
interface TrackLabelRowProps {
  name: string;
  icon: React.ReactNode;
  height: number;
  canDelete: boolean;
  onRename?: (name: string) => void;
  onDelete?: () => void;
}

function TrackLabelRow({ name, icon, height, canDelete, onRename, onDelete }: TrackLabelRowProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);

  const commit = () => {
    const trimmed = editValue.trim();
    if (trimmed && onRename) onRename(trimmed);
    setEditing(false);
  };

  return (
    <div className={styles.trackLabel} style={{ height }}>
      <span className={styles.trackIcon}>{icon}</span>
      {editing ? (
        <input
          className={styles.trackLabelInput}
          value={editValue}
          autoFocus
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setEditing(false); setEditValue(name); }
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className={styles.trackLabelText}
          onDoubleClick={() => onRename && setEditing(true)}
          title={onRename ? "Double-click to rename" : undefined}
        >
          {name}
        </span>
      )}
      {canDelete && onDelete && (
        <div className={styles.trackLabelActions}>
          <button
            className={`${styles.trackLabelBtn} ${styles.danger}`}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Remove track"
          >
            <Trash2 size={10} />
          </button>
        </div>
      )}
    </div>
  );
}

export default Timeline;
