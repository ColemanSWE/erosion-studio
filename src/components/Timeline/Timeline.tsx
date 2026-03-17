import React, { useRef, useState, useCallback, useEffect } from "react";
import {
  Play,
  Pause,
  Square,
  ZoomIn,
  ZoomOut,
  Clock,
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
import { MediaTrack, MEDIA_ROW_H, MIN_TRACK_ROWS } from "./MediaTrack";
import { OverlayTrack } from "./OverlayTrack";
import { EffectTrack } from "./EffectTrack";
import { formatTime } from "../../lib/timeline";
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
const DEFAULT_ZOOM = 60; // 60px per second = 1min fills ~3600px

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
  const tracksAreaRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);

  // Keep labels column scroll in sync with tracks area (vertical only — horizontal is independent)
  const syncScroll = useCallback(() => {
    const ta = tracksAreaRef.current;
    const lb = labelsRef.current;
    if (!ta || !lb) return;
    lb.scrollTop = ta.scrollTop;
    setScrollLeft(ta.scrollLeft);
  }, []);

  // Auto-scroll playhead into view during playback
  useEffect(() => {
    if (!isPlaying) return;
    const ta = tracksAreaRef.current;
    if (!ta) return;
    const px = currentTime * zoom;
    const { scrollLeft: sl, clientWidth } = ta;
    if (px < sl || px > sl + clientWidth - 60) {
      const newLeft = Math.max(0, px - clientWidth / 2);
      ta.scrollLeft = newLeft;
      setScrollLeft(newLeft);
    }
  }, [currentTime, isPlaying, zoom]);

  const zoomIn = useCallback(
    () => setZoom((z) => Math.min(MAX_ZOOM, z * 1.5)),
    [],
  );
  const zoomOut = useCallback(
    () => setZoom((z) => Math.max(MIN_ZOOM, z / 1.5)),
    [],
  );

  // Wheel to zoom (horizontal) — must use native listener with passive:false
  // because React mounts onWheel as passive by default, blocking preventDefault()
  useEffect(() => {
    const el = tracksAreaRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom((z) =>
          Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * (e.deltaY < 0 ? 1.2 : 0.85)))
        );
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []); // tracksAreaRef.current is stable after mount

  const activeEffects = effects.filter((e) => e.active);
  // Extend duration to cover all placed clips
  const maxClipEnd = clips.reduce((max, c) => Math.max(max, c.endTime), duration);
  const effectiveDuration = Math.max(duration, maxClipEnd);
  // Add generous right padding so the ruler always extends well past all content
  const totalWidth = Math.max(effectiveDuration * zoom + 500, 800);
  const LABEL_W = 170;
  const RULER_H = 28;
  const ROW_H = 40;

  const numMediaTracks = Math.max(MIN_TRACK_ROWS, ...clips.map((c) => c.trackIndex + 1));
  const MEDIA_TRACK_H = numMediaTracks * MEDIA_ROW_H;

  const numOverlayTracks = Math.max(MIN_TRACK_ROWS, ...overlays.map((o) => o.trackIndex + 1));
  const OVERLAY_TRACK_H = numOverlayTracks * MEDIA_ROW_H;

  // ─── Label rows —— must mirror track rows exactly ─────────────────────────
  const renderLabels = () => {
    const labels: React.ReactNode[] = [];

    // Header spacer (mirrors ruler)
    labels.push(<div key="ruler-spacer" className={styles.labelsHeader} />);

    // Media track label — height matches dynamic multi-row height
    labels.push(
      <div key="media-label" className={styles.trackLabel} style={{ height: MEDIA_TRACK_H }}>
        <Clock size={12} className={styles.trackIcon} />
        <span className={styles.trackLabelText}>Media</span>
      </div>,
    );

    labels.push(
      <div key="overlay-label" className={styles.trackLabel} style={{ height: OVERLAY_TRACK_H }}>
        <span className={styles.trackLabelText}>Overlays</span>
      </div>,
    );

    // Effect track labels
    for (const effect of activeEffects) {
      const tracks = effectParamTracks.filter((t) => t.effectId === effect.id);
      const hasParamRows = tracks.length > 0;
      const effectName = effect.type
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");

      labels.push(
        <div key={effect.id}>
          <div
            className={styles.trackLabel}
            style={{
              height: ROW_H,
              borderLeft: `2px solid ${effect.startTime != null || effect.endTime != null ? "#4ad0d0" : "#555"}`,
            }}
          >
            <span className={styles.trackLabelText}>{effectName}</span>
            <div className={styles.trackLabelActions}>
              <button
                className={`${styles.trackLabelBtn} ${styles.danger}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveEffect(effect.id);
                }}
                title="Remove effect"
              >
                ×
              </button>
            </div>
          </div>
          {/* Param track labels */}
          {hasParamRows &&
            tracks.map((t) => (
              <div key={t.id} className={styles.trackLabel} style={{ height: 24, paddingLeft: 20 }}>
                <span className={styles.trackLabelText} style={{ color: "#ffaa00", fontSize: 9 }}>
                  {t.paramKey}
                </span>
                <div className={styles.trackLabelActions}>
                  <button
                    className={`${styles.trackLabelBtn} ${styles.danger}`}
                    onClick={() => onRemoveEffectParamTrack(t.id)}
                    title="Remove param track"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
        </div>,
      );
    }

    return labels;
  };

  return (
    <div className={styles.timeline} style={{ height: 220 }}>
      {/* ── Header bar ───────────────────────────────────────────────────── */}
      <div className={styles.timelineHeader}>
        <span className={styles.timelineTitle}>Timeline</span>

        <button
          className={styles.headerBtn}
          onClick={isPlaying ? onPause : onPlay}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <button className={styles.headerBtn} onClick={onStop} title="Stop">
          <Square size={12} />
        </button>

        <span
          style={{
            fontFamily: "monospace",
            fontSize: 10,
            color: "#666",
            minWidth: 60,
            textAlign: "center",
          }}
        >
          {formatTime(currentTime)}
        </span>

        <div className={styles.zoomControls}>
          <button className={styles.headerBtn} onClick={zoomOut} title="Zoom Out">
            <ZoomOut size={12} />
          </button>
          <span className={styles.zoomLabel}>{Math.round(zoom)}px/s</span>
          <button className={styles.headerBtn} onClick={zoomIn} title="Zoom In">
            <ZoomIn size={12} />
          </button>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className={styles.timelineBody} style={{ flex: 1, overflow: "hidden" }}>
        {/* Labels column */}
        <div
          ref={labelsRef}
          className={styles.labelsColumn}
          style={{ width: LABEL_W, overflowY: "hidden" }}
        >
          {renderLabels()}
        </div>

        {/* Tracks area */}
        <div
          ref={tracksAreaRef}
          className={styles.tracksArea}
          onScroll={syncScroll}
        >
          {/* Sticky ruler */}
          <TimelineRuler
            duration={effectiveDuration + (500 / zoom)}
            currentTime={currentTime}
            zoom={zoom}
            onSeek={onSeek}
            scrollLeft={scrollLeft}
          />

          {/* Playhead line spanning all rows */}
          <div
            style={{
              position: "absolute",
              left: currentTime * zoom,
              top: RULER_H,
              bottom: 0,
              width: 1,
              background: "rgba(255,51,102,0.3)",
              pointerEvents: "none",
              zIndex: 4,
            }}
          />

          {/* Media track row — height is dynamic */}
          <div className={styles.trackRow} style={{ width: totalWidth, height: MEDIA_TRACK_H }}>
            <MediaTrack
              clips={clips}
              media={media}
              zoom={zoom}
              duration={duration}
              currentTime={currentTime}
              onAddClip={onAddClip}
              onUpdateClip={onUpdateClip}
              onRemoveClip={onRemoveClip}
            />
          </div>

          {/* Overlay track row */}
          <div className={styles.trackRow} style={{ width: totalWidth, height: OVERLAY_TRACK_H }}>
            <OverlayTrack
              overlays={overlays}
              zoom={zoom}
              duration={duration}
              currentTime={currentTime}
              onAddOverlay={onAddOverlay}
              onUpdateOverlay={onUpdateOverlay}
              onRemoveOverlay={onRemoveOverlay}
              onSelectOverlay={onSelectOverlay}
              selectedOverlayId={selectedOverlayId}
            />
          </div>

          {/* Effect track rows */}
          {activeEffects.map((effect) => {
            const tracks = effectParamTracks.filter((t) => t.effectId === effect.id);
            return (
              <EffectTrack
                key={effect.id}
                effect={effect}
                paramTracks={tracks}
                zoom={zoom}
                duration={duration}
                currentTime={currentTime}
                onUpdateEffect={onUpdateEffect}
                onAddParamTrack={onAddEffectParamTrack}
                onRemoveParamTrack={onRemoveEffectParamTrack}
                onAddKeyframe={onAddKeyframe}
                onUpdateKeyframe={onUpdateKeyframe}
                onRemoveKeyframe={onRemoveKeyframe}
              />
            );
          })}

          {activeEffects.length === 0 && (
            <div className={styles.emptyState} style={{ height: 80 }}>
              <span>Add effects to see effect tracks</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Timeline;
