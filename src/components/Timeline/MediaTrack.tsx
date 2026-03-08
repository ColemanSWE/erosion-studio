import React, { useState, useRef, useCallback } from "react";
import { Film, Trash2 } from "lucide-react";
import type { TimelineClip } from "../../lib/effects/types";
import type { MediaItem } from "../../lib/project";
import styles from "./Timeline.module.scss";

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

  const getMediaName = (mediaId: string) =>
    media.find((m) => m.id === mediaId)?.name ?? "Unknown";

  const getMediaDuration = (mediaId: string) => {
    // Images default to 5s on timeline; videos use duration from store
    const m = media.find((m) => m.id === mediaId);
    if (!m) return 5;
    return m.type === "video" ? 10 : 5; // fallback; real duration set on drop
  };

  // ─── Drop from MediaBrowser ───────────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("application/media-item")) {
      e.dataTransfer.dropEffect = "copy";
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const json = e.dataTransfer.getData("application/media-item");
      if (!json) return;

      const item: MediaItem = JSON.parse(json);
      const dropRef2 = dropRef.current;
      if (!dropRef2) return;

      const rect = dropRef2.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const startTime = Math.max(0, x / zoom);
      const clipDuration = getMediaDuration(item.id);
      const endTime = Math.min(duration, startTime + clipDuration);

      onAddClip({
        id: `clip-${Date.now()}-${clipIdCounter++}`,
        mediaId: item.id,
        startTime,
        endTime,
        trackIndex: 0,
      });
    },
    [zoom, duration, onAddClip, getMediaDuration],
  );

  // ─── Drag clip to reposition ──────────────────────────────────────────────
  const handleClipDragStart = useCallback(
    (e: React.DragEvent, clipId: string) => {
      e.dataTransfer.setData("application/timeline-clip", clipId);
      e.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const handleClipDrop = useCallback(
    (e: React.DragEvent) => {
      const clipId = e.dataTransfer.getData("application/timeline-clip");
      if (!clipId) return;

      const dropRefEl = dropRef.current;
      if (!dropRefEl) return;

      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;

      const rect = dropRefEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const newStart = Math.max(0, x / zoom);
      const clipLen = clip.endTime - clip.startTime;
      const newEnd = Math.min(duration, newStart + clipLen);

      onUpdateClip(clipId, { startTime: newStart, endTime: newEnd });
    },
    [clips, zoom, duration, onUpdateClip],
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
    [clips, zoom, duration, onUpdateClip],
  );

  const totalWidth = Math.max(duration * zoom, 200);

  return (
    <div
      ref={dropRef}
      className={`${styles.dropZone} ${isDragOver ? styles.dragOver : ""}`}
      style={{ width: totalWidth, minHeight: 40, position: "relative" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => {
        handleDrop(e);
        handleClipDrop(e);
      }}
      onMouseDown={() => setSelectedClipId(null)}
    >
      {clips.map((clip) => {
        const left = clip.startTime * zoom;
        const width = Math.max(4, (clip.endTime - clip.startTime) * zoom);
        const isSelected = selectedClipId === clip.id;

        return (
          <div
            key={clip.id}
            className={`${styles.clip} ${isSelected ? styles.selected : ""}`}
            style={{ left, width }}
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
            title={`${getMediaName(clip.mediaId)} — double-click or press Delete to remove`}
          >
            <div
              className={`${styles.clipHandle} ${styles.left}`}
              onMouseDown={(e) => startResize(e, clip.id, "left")}
            />
            <span className={styles.clipName}>{getMediaName(clip.mediaId)}</span>
            
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
            Drag media here
          </span>
        </div>
      )}
    </div>
  );
}
