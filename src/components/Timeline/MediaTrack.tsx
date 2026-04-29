import React, { useState, useRef, useCallback } from "react";
import { Film, Trash2 } from "lucide-react";
import type { TimelineClip, Overlay, TimelineTrack } from "../../lib/effects/types";
import type { MediaItem } from "../../lib/project";
import { collectSnapTargets, applySnap } from "../../lib/timeline";
import styles from "./Timeline.module.scss";

export const MEDIA_ROW_H = 40;
export const MIN_TRACK_ROWS = 2;

interface MediaTrackProps {
  clips: TimelineClip[];
  overlays: Overlay[];
  tracks: TimelineTrack[];
  media: MediaItem[];
  zoom: number;
  duration: number;
  currentTime: number;
  rowHeight: number;
  snapEnabled: boolean;
  onAddClip: (clip: TimelineClip) => void;
  onUpdateClip: (id: string, updates: Partial<TimelineClip>) => void;
  onRemoveClip: (id: string) => void;
  onSnapLine: (time: number | null) => void;
}

interface DragState {
  clipId: string;
  startTime: number;
  trackIndex: number;
}

let clipIdCounter = 0;

export function MediaTrack({
  clips,
  overlays,
  tracks,
  media,
  zoom,
  duration,
  currentTime,
  rowHeight,
  snapEnabled,
  onAddClip,
  onUpdateClip,
  onRemoveClip,
  onSnapLine,
}: MediaTrackProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [newMediaGhostX, setNewMediaGhostX] = useState<number | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [draggingState, setDraggingState] = useState<DragState | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // Ref mirror of draggingState for stable access in async handlers
  const draggingStateRef = useRef<DragState | null>(null);
  const setDragging = (s: DragState | null) => {
    draggingStateRef.current = s;
    setDraggingState(s);
  };

  const dragMoveRef = useRef<{
    clipId: string;
    startX: number;
    startY: number;
    origStart: number;
    origEnd: number;
    origTrack: number;
    hasMoved: boolean;
  } | null>(null);

  const resizingRef = useRef<{
    clipId: string;
    side: "left" | "right";
    startX: number;
    origStart: number;
    origEnd: number;
  } | null>(null);

  const lastResizeX = useRef(0);
  const resizeRafRef = useRef<number | null>(null);

  const numTracks = Math.max(
    tracks.length,
    ...clips.map((c) => c.trackIndex + 1),
    ...(draggingState ? [draggingState.trackIndex + 1] : []),
  );
  const totalHeight = numTracks * rowHeight;

  const getMediaName = (mediaId: string) =>
    media.find((m) => m.id === mediaId)?.name ?? "Unknown";

  const getMediaDuration = useCallback(
    (mediaId: string) => {
      const m = media.find((item) => item.id === mediaId);
      if (!m) return 5;
      if (m.duration && m.duration > 0 && isFinite(m.duration)) return m.duration;
      return m.type === "image" ? 5 : 10;
    },
    [media],
  );

  const yToTrackIndex = useCallback(
    (clientY: number): number => {
      const el = dropRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const relY = clientY - rect.top;
      const idx = Math.floor(relY / rowHeight);
      return Math.max(0, Math.min(numTracks, idx));
    },
    [numTracks, rowHeight],
  );

  // ─── Real-time clip drag ──────────────────────────────────────────────────
  const startClipDrag = useCallback(
    (e: React.MouseEvent, clipId: string) => {
      if ((e.target as HTMLElement).closest(`.${styles.clipHandle}`)) return;
      if ((e.target as HTMLElement).closest(`.${styles.removeClipBtn}`)) return;
      e.preventDefault();
      e.stopPropagation();

      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;

      setSelectedClipId(clipId);
      dragMoveRef.current = {
        clipId,
        startX: e.clientX,
        startY: e.clientY,
        origStart: clip.startTime,
        origEnd: clip.endTime,
        origTrack: clip.trackIndex,
        hasMoved: false,
      };

      let rafId: number | null = null;
      let lastX = e.clientX;
      let lastY = e.clientY;

      const onMove = (me: MouseEvent) => {
        lastX = me.clientX;
        lastY = me.clientY;
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          const r = dragMoveRef.current;
          if (!r) return;

          const dx = lastX - r.startX;
          const dy = lastY - r.startY;
          if (!r.hasMoved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
          r.hasMoved = true;

          const clipDuration = r.origEnd - r.origStart;
          const rawStart = r.origStart + dx / zoom;

          const el = dropRef.current;
          const currentNumTracks = el
            ? Math.max(
                tracks.length,
                ...clips.map((c) => c.trackIndex + 1),
              )
            : numTracks;
          const trackDelta = Math.round(dy / rowHeight);
          const newTrackIndex = Math.max(
            0,
            Math.min(currentNumTracks, r.origTrack + trackDelta),
          );

          const snapTargets = collectSnapTargets(clips, overlays, currentTime, r.clipId);
          const { snappedTime: snappedStart, magnetTime: magnetStart } = applySnap(
            rawStart, snapTargets, zoom, snapEnabled,
          );
          const { snappedTime: snappedEnd, magnetTime: magnetEnd } = applySnap(
            rawStart + clipDuration, snapTargets, zoom, snapEnabled,
          );

          let finalStart = snappedStart;
          if (!magnetStart && magnetEnd) {
            finalStart = Math.max(0, snappedEnd - clipDuration);
          }

          onSnapLine(magnetStart ?? magnetEnd ?? null);
          setDragging({ clipId: r.clipId, startTime: finalStart, trackIndex: newTrackIndex });
        });
      };

      const onUp = () => {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        const r = dragMoveRef.current;
        if (r?.hasMoved) {
          const ds = draggingStateRef.current;
          if (ds) {
            onUpdateClip(r.clipId, {
              startTime: ds.startTime,
              endTime: ds.startTime + (r.origEnd - r.origStart),
              trackIndex: ds.trackIndex,
            });
          }
        }
        dragMoveRef.current = null;
        setDragging(null);
        onSnapLine(null);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [clips, overlays, zoom, rowHeight, numTracks, currentTime, snapEnabled, tracks, onUpdateClip, onSnapLine],
  );

  // ─── Resize handles ───────────────────────────────────────────────────────
  const startResize = useCallback(
    (e: React.MouseEvent, clipId: string, side: "left" | "right") => {
      e.preventDefault();
      e.stopPropagation();
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;

      resizingRef.current = {
        clipId,
        side,
        startX: e.clientX,
        origStart: clip.startTime,
        origEnd: clip.endTime,
      };

      const snapTargets = collectSnapTargets(clips, overlays, currentTime, clipId);

      const onMove = (me: MouseEvent) => {
        lastResizeX.current = me.clientX;
        if (resizeRafRef.current !== null) return;
        resizeRafRef.current = requestAnimationFrame(() => {
          resizeRafRef.current = null;
          const r = resizingRef.current;
          if (!r) return;
          const dx = lastResizeX.current - r.startX;
          const rawTime = (r.side === "left" ? r.origStart : r.origEnd) + dx / zoom;
          const { snappedTime, magnetTime } = applySnap(rawTime, snapTargets, zoom, snapEnabled);

          onSnapLine(magnetTime);
          if (r.side === "left") {
            const newStart = Math.max(0, Math.min(r.origEnd - 0.1, snappedTime));
            onUpdateClip(r.clipId, { startTime: newStart });
          } else {
            const newEnd = Math.max(r.origStart + 0.1, Math.min(duration, snappedTime));
            onUpdateClip(r.clipId, { endTime: newEnd });
          }
        });
      };

      const onUp = () => {
        if (resizeRafRef.current !== null) {
          cancelAnimationFrame(resizeRafRef.current);
          resizeRafRef.current = null;
        }
        resizingRef.current = null;
        onSnapLine(null);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [clips, overlays, zoom, duration, currentTime, snapEnabled, onUpdateClip, onSnapLine],
  );

  // ─── New media drop from MediaBrowser ────────────────────────────────────
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      const isNew = e.dataTransfer.types.includes("application/media-item");
      if (!isNew) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setIsDragOver(true);
      const el = dropRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setNewMediaGhostX(e.clientX - rect.left);
    },
    [],
  );

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
    setNewMediaGhostX(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      setNewMediaGhostX(null);

      const json = e.dataTransfer.getData("application/media-item");
      if (!json) return;
      const item: MediaItem = JSON.parse(json);
      const el = dropRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const rawStart = x / zoom;
      const snapTargets = collectSnapTargets(clips, overlays, currentTime);
      const { snappedTime: startTime } = applySnap(rawStart, snapTargets, zoom, snapEnabled);
      const clipDuration = getMediaDuration(item.id);
      const endTime = Math.min(duration, startTime + clipDuration);
      const trackIndex = yToTrackIndex(e.clientY);

      onAddClip({
        id: `clip-${Date.now()}-${clipIdCounter++}`,
        mediaId: item.id,
        startTime,
        endTime,
        trackIndex,
      });
    },
    [zoom, duration, clips, overlays, currentTime, snapEnabled, onAddClip, getMediaDuration, yToTrackIndex],
  );

  const maxClipEnd = clips.reduce((max, c) => Math.max(max, c.endTime), duration);
  const totalWidth = Math.max(maxClipEnd * zoom + 120, 400);

  const trackHues = [210, 160, 40, 300, 20];
  const getTrackColor = (trackIndex: number) =>
    `hsl(${trackHues[trackIndex % trackHues.length]}, 70%, 45%)`;

  return (
    <div
      ref={dropRef}
      className={`${styles.dropZone} ${isDragOver ? styles.dragOver : ""}`}
      style={{ width: totalWidth, height: totalHeight, position: "relative" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onMouseDown={() => setSelectedClipId(null)}
    >
      {Array.from({ length: numTracks }, (_, idx) => (
        <div
          key={`lane-${idx}`}
          style={{
            position: "absolute",
            left: 0,
            top: idx * rowHeight,
            width: "100%",
            height: rowHeight,
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
            pointerEvents: "none",
          }}
        />
      ))}

      {/* Ghost for new media drop */}
      {newMediaGhostX !== null && (
        <div
          className={styles.clipGhost}
          style={{
            left: Math.max(0, newMediaGhostX - 2),
            width: 6,
            top: 2,
            height: rowHeight - 4,
          }}
        />
      )}

      {clips.map((clip) => {
        const isDragging = draggingState?.clipId === clip.id;
        const renderStart = isDragging ? draggingState!.startTime : clip.startTime;
        const renderTrack = isDragging ? draggingState!.trackIndex : clip.trackIndex;
        const left = renderStart * zoom;
        const width = Math.max(4, (clip.endTime - clip.startTime) * zoom);
        const top = renderTrack * rowHeight;
        const isSelected = selectedClipId === clip.id;
        const color = getTrackColor(clip.trackIndex);

        return (
          <div
            key={clip.id}
            className={`${styles.clip} ${isSelected ? styles.selected : ""} ${isDragging ? styles.dragging : ""}`}
            style={{ left, width, top, height: rowHeight - 4, background: color }}
            tabIndex={0}
            onMouseDown={(e) => startClipDrag(e, clip.id)}
            onKeyDown={(e) => {
              if (e.key === "Delete" || e.key === "Backspace") {
                onRemoveClip(clip.id);
                setSelectedClipId(null);
              }
            }}
            title={`${getMediaName(clip.mediaId)} (Track ${clip.trackIndex + 1}) — Delete to remove`}
          >
            <div
              className={`${styles.clipHandle} ${styles.left}`}
              onMouseDown={(e) => startResize(e, clip.id, "left")}
            />
            <span className={styles.clipName}>
              <span style={{ opacity: 0.6, fontSize: 9 }}>T{clip.trackIndex + 1} </span>
              {getMediaName(clip.mediaId)}
            </span>

            <button
              className={styles.removeClipBtn}
              onClick={(e) => {
                e.stopPropagation();
                onRemoveClip(clip.id);
              }}
              title="Remove clip"
            >
              <Trash2 size={10} />
            </button>

            <div
              className={`${styles.clipHandle} ${styles.right}`}
              onMouseDown={(e) => startResize(e, clip.id, "right")}
            />
          </div>
        );
      })}

      {clips.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <Film size={14} style={{ color: "#444", marginRight: 6 }} />
          <span style={{ fontFamily: "monospace", fontSize: 10, color: "#444" }}>
            Drag media here — use multiple rows to overlap clips (for transitions)
          </span>
        </div>
      )}
    </div>
  );
}
