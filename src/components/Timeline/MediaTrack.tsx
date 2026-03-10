import React, { useState, useRef, useCallback } from "react";
import { Film, Trash2 } from "lucide-react";
import type { TimelineClip } from "../../lib/effects/types";
import type { MediaItem } from "../../lib/project";
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
  const dropRef = useRef<HTMLDivElement>(null);

  // Always show at least MIN_TRACK_ROWS rows, grow as needed
  const numTracks = Math.max(
    MIN_TRACK_ROWS,
    ...clips.map((c) => c.trackIndex + 1)
  );
  const totalHeight = numTracks * MEDIA_ROW_H;

  const getMediaName = (mediaId: string) =>
    media.find((m) => m.id === mediaId)?.name ?? "Unknown";

  const getMediaDuration = (mediaId: string) => {
    const m = media.find((m) => m.id === mediaId);
    if (!m) return 5;
    if (m.duration && m.duration > 0 && isFinite(m.duration)) return m.duration;
    return m.type === "image" ? 5 : 10;
  };

  // Convert a Y position relative to the track container into a track index
  const yToTrackIndex = useCallback(
    (clientY: number): number => {
      const el = dropRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const relY = clientY - rect.top;
      const idx = Math.floor(relY / MEDIA_ROW_H);
      return Math.max(0, Math.min(numTracks - 1, idx));
    },
    [numTracks]
  );

  // ─── Drop from MediaBrowser ───────────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("application/timeline-clip")) {
      e.dataTransfer.dropEffect = "move";
      setIsDragOver(true);
    } else if (e.dataTransfer.types.includes("application/media-item")) {
      e.dataTransfer.dropEffect = "copy";
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      // New media item from browser
      const json = e.dataTransfer.getData("application/media-item");
      if (json) {
        const item: MediaItem = JSON.parse(json);
        const el = dropRef.current;
        if (!el) return;

        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const startTime = Math.max(0, x / zoom);
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
        const newStart = Math.max(0, x / zoom);
        const clipLen = clip.endTime - clip.startTime;
        const newEnd = Math.min(duration, newStart + clipLen);
        const trackIndex = yToTrackIndex(e.clientY);

        onUpdateClip(clipId, { startTime: newStart, endTime: newEnd, trackIndex });
      }
    },
    [zoom, duration, onAddClip, onUpdateClip, getMediaDuration, yToTrackIndex, clips]
  );

  // ─── Drag clip to reposition ──────────────────────────────────────────────
  const handleClipDragStart = useCallback(
    (e: React.DragEvent, clipId: string) => {
      e.dataTransfer.setData("application/timeline-clip", clipId);
      e.dataTransfer.effectAllowed = "move";

      const el = dropRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const mouseXInTrack = e.clientX - rect.left;
        const clip = clips.find((c) => c.id === clipId);
        if (clip) {
          const clipStartXInTrack = clip.startTime * zoom;
          const offsetX = mouseXInTrack - clipStartXInTrack;
          e.dataTransfer.setData("application/timeline-clip-offset", String(offsetX));
        }
      }
    },
    [clips, zoom]
  );

  // ─── Resize handles ───────────────────────────────────────────────────────
  const resizingRef = useRef<{
    clipId: string;
    side: "left" | "right";
    startX: number;
    origStart: number;
    origEnd: number;
  } | null>(null);

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

      const onMove = (me: MouseEvent) => {
        const r = resizingRef.current;
        if (!r) return;
        const dx = me.clientX - r.startX;
        const dt = dx / zoom;

        if (r.side === "left") {
          const newStart = Math.max(0, Math.min(r.origEnd - 0.1, r.origStart + dt));
          onUpdateClip(r.clipId, { startTime: newStart });
        } else {
          const newEnd = Math.max(r.origStart + 0.1, Math.min(duration, r.origEnd + dt));
          onUpdateClip(r.clipId, { endTime: newEnd });
        }
      };

      const onUp = () => {
        resizingRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [clips, zoom, duration, onUpdateClip]
  );

  const maxClipEnd = clips.reduce((max, c) => Math.max(max, c.endTime), duration);
  const totalWidth = Math.max(maxClipEnd * zoom + 120, 400);

  // Distinct hue per track to make it easy to tell tracks apart
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
      {/* Track row lane backgrounds + labels */}
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
            style={{
              left,
              width,
              top,
              height: MEDIA_ROW_H - 4,
              background: color,
            }}
            draggable
            tabIndex={0}
            onDragStart={(e) => handleClipDragStart(e, clip.id)}
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
            onDoubleClick={() => onRemoveClip(clip.id)}
            title={`${getMediaName(clip.mediaId)} (Track ${clip.trackIndex + 1}) — double-click or Delete to remove`}
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
