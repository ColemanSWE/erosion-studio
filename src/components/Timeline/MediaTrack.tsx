import React, { useState, useRef, useCallback } from "react";
import { Film, Trash2 } from "lucide-react";
import type { TimelineClip } from "../../lib/effects/types";
import type { MediaItem } from "../../lib/project";
import { snapTime, getSnapInterval } from "../../lib/timeline";
import styles from "./Timeline.module.scss";

export const MEDIA_ROW_H = 40;
export const MIN_TRACK_ROWS = 2;

interface MediaTrackProps {
  clips: TimelineClip[];
  media: MediaItem[];
  zoom: number; // px per second
  duration: number;
  currentTime: number;
  onAddClip: (clip: TimelineClip) => void;
  onUpdateClip: (id: string, updates: Partial<TimelineClip>) => void;
  onRemoveClip: (id: string) => void;
}

interface GhostClip {
  left: number;  // px from track left
  width: number; // px
  top: number;   // px from track top
}

let clipIdCounter = 0;

export function MediaTrack({
  clips,
  media,
  zoom,
  duration,
  onAddClip,
  onUpdateClip,
  onRemoveClip,
}: MediaTrackProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [ghostClip, setGhostClip] = useState<GhostClip | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // Stores clip info for the clip currently being dragged, so handleDragOver
  // can compute the ghost position without reading from dataTransfer (restricted during dragover).
  const activeDragRef = useRef<{
    offsetPx: number;
    durationSec: number;
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

  const numTracks = Math.max(MIN_TRACK_ROWS, ...clips.map((c) => c.trackIndex + 1));
  const totalHeight = numTracks * MEDIA_ROW_H;

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
      const idx = Math.floor(relY / MEDIA_ROW_H);
      return Math.max(0, Math.min(numTracks - 1, idx));
    },
    [numTracks],
  );

  // ─── Drop from MediaBrowser ───────────────────────────────────────────────
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const isExisting = e.dataTransfer.types.includes("application/timeline-clip");
      const isNew = e.dataTransfer.types.includes("application/media-item");
      if (!isExisting && !isNew) return;

      e.dataTransfer.dropEffect = isExisting ? "move" : "copy";
      setIsDragOver(true);

      // Compute ghost clip position for visual feedback
      const el = dropRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const trackIndex = yToTrackIndex(e.clientY);
      const top = trackIndex * MEDIA_ROW_H;

      if (isExisting && activeDragRef.current) {
        const startPx = x - activeDragRef.current.offsetPx;
        const startSec = snapTime(
          Math.max(0, startPx / zoom),
          getSnapInterval(zoom),
        );
        setGhostClip({
          left: startSec * zoom,
          width: activeDragRef.current.durationSec * zoom,
          top,
        });
      } else {
        // New media — width unknown, show a thin position indicator
        setGhostClip({ left: Math.max(0, x - 2), width: 6, top });
      }
    },
    [zoom, yToTrackIndex],
  );

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
    setGhostClip(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      setGhostClip(null);
      activeDragRef.current = null;

      const snap = getSnapInterval(zoom);

      // New media item from browser
      const json = e.dataTransfer.getData("application/media-item");
      if (json) {
        const item: MediaItem = JSON.parse(json);
        const el = dropRef.current;
        if (!el) return;

        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const startTime = snapTime(Math.max(0, x / zoom), snap);
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
        return;
      }

      // Existing clip being repositioned
      const clipId = e.dataTransfer.getData("application/timeline-clip");
      if (clipId) {
        const clip = clips.find((c) => c.id === clipId);
        if (!clip) return;

        const el = dropRef.current;
        if (!el) return;

        const offsetXStr = e.dataTransfer.getData("application/timeline-clip-offset");
        const offsetX = offsetXStr ? parseFloat(offsetXStr) : 0;

        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left - offsetX;
        const newStart = snapTime(Math.max(0, x / zoom), snap);
        const clipLen = clip.endTime - clip.startTime;
        const newEnd = Math.min(duration, newStart + clipLen);
        const trackIndex = yToTrackIndex(e.clientY);

        onUpdateClip(clipId, { startTime: newStart, endTime: newEnd, trackIndex });
      }
    },
    [zoom, duration, onAddClip, onUpdateClip, getMediaDuration, yToTrackIndex, clips],
  );

  // ─── Drag clip to reposition ──────────────────────────────────────────────
  const handleClipDragStart = useCallback(
    (e: React.DragEvent, clipId: string) => {
      e.dataTransfer.setData("application/timeline-clip", clipId);
      e.dataTransfer.effectAllowed = "move";

      const el = dropRef.current;
      const clip = clips.find((c) => c.id === clipId);
      if (el && clip) {
        const rect = el.getBoundingClientRect();
        const mouseXInTrack = e.clientX - rect.left;
        const clipStartXInTrack = clip.startTime * zoom;
        const offsetX = mouseXInTrack - clipStartXInTrack;
        e.dataTransfer.setData("application/timeline-clip-offset", String(offsetX));

        // Store for use in handleDragOver (can't read dataTransfer there)
        activeDragRef.current = {
          offsetPx: offsetX,
          durationSec: clip.endTime - clip.startTime,
        };
      }
    },
    [clips, zoom],
  );

  const handleClipDragEnd = useCallback(() => {
    activeDragRef.current = null;
    setGhostClip(null);
  }, []);

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

      const snap = getSnapInterval(zoom);

      const onMove = (me: MouseEvent) => {
        lastResizeX.current = me.clientX;
        if (resizeRafRef.current !== null) return;
        resizeRafRef.current = requestAnimationFrame(() => {
          resizeRafRef.current = null;
          const r = resizingRef.current;
          if (!r) return;
          const dx = lastResizeX.current - r.startX;
          const dt = dx / zoom;

          if (r.side === "left") {
            const newStart = snapTime(
              Math.max(0, Math.min(r.origEnd - 0.1, r.origStart + dt)),
              snap,
            );
            onUpdateClip(r.clipId, { startTime: newStart });
          } else {
            const newEnd = snapTime(
              Math.max(r.origStart + 0.1, Math.min(duration, r.origEnd + dt)),
              snap,
            );
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
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [clips, zoom, duration, onUpdateClip],
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
      {/* Track row lane backgrounds */}
      {Array.from({ length: numTracks }, (_, idx) => (
        <div
          key={`lane-${idx}`}
          style={{
            position: "absolute",
            left: 0,
            top: idx * MEDIA_ROW_H,
            width: "100%",
            height: MEDIA_ROW_H,
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
            pointerEvents: "none",
          }}
        />
      ))}

      {/* Ghost drop preview */}
      {ghostClip && (
        <div
          className={styles.clipGhost}
          style={{
            left: ghostClip.left,
            width: Math.max(6, ghostClip.width),
            top: ghostClip.top + 2,
            height: MEDIA_ROW_H - 4,
          }}
        />
      )}

      {/* Clips */}
      {clips.map((clip) => {
        const left = clip.startTime * zoom;
        const width = Math.max(4, (clip.endTime - clip.startTime) * zoom);
        const top = clip.trackIndex * MEDIA_ROW_H;
        const isSelected = selectedClipId === clip.id;
        const color = getTrackColor(clip.trackIndex);

        return (
          <div
            key={clip.id}
            className={`${styles.clip} ${isSelected ? styles.selected : ""}`}
            style={{ left, width, top, height: MEDIA_ROW_H - 4, background: color }}
            draggable
            tabIndex={0}
            onDragStart={(e) => handleClipDragStart(e, clip.id)}
            onDragEnd={handleClipDragEnd}
            onMouseDown={(e) => {
              e.stopPropagation();
              setSelectedClipId(clip.id);
            }}
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
