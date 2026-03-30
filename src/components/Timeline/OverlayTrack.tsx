import React, { useState, useRef, useCallback } from "react";
import { Type, Image as ImageIcon, Trash2 } from "lucide-react";
import type { Overlay } from "../../lib/effects/types";
import { snapTime, getSnapInterval } from "../../lib/timeline";
import styles from "./Timeline.module.scss";
import { MEDIA_ROW_H, MIN_TRACK_ROWS } from "./MediaTrack";

interface OverlayTrackProps {
  overlays: Overlay[];
  zoom: number; // px per second
  duration: number;
  currentTime: number;
  onAddOverlay: (overlay: Overlay) => void;
  onUpdateOverlay: (id: string, updates: Partial<Overlay>) => void;
  onRemoveOverlay: (id: string) => void;
  onSelectOverlay: (id: string | null) => void;
  selectedOverlayId: string | null;
}

interface GhostClip {
  left: number;
  width: number;
  top: number;
}

export function OverlayTrack({
  overlays,
  zoom,
  duration,
  onAddOverlay,
  onUpdateOverlay,
  onRemoveOverlay,
  onSelectOverlay,
  selectedOverlayId,
}: OverlayTrackProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [ghostClip, setGhostClip] = useState<GhostClip | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const activeDragRef = useRef<{
    offsetPx: number;
    durationSec: number;
  } | null>(null);

  const resizingRef = useRef<{
    overlayId: string;
    side: "left" | "right";
    startX: number;
    origStart: number;
    origEnd: number;
  } | null>(null);

  const lastResizeX = useRef(0);
  const resizeRafRef = useRef<number | null>(null);

  const numTracks = Math.max(MIN_TRACK_ROWS, ...overlays.map((o) => o.trackIndex + 1));
  const totalHeight = numTracks * MEDIA_ROW_H;

  const yToTrackIndex = useCallback(
    (clientY: number): number => {
      const el = dropRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const relY = clientY - rect.top;
      const idx = Math.floor(relY / MEDIA_ROW_H);
      return Math.max(0, Math.min(numTracks - 1, idx)); // was clamping to numTracks (off-by-one)
    },
    [numTracks],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const isExisting = e.dataTransfer.types.includes("application/timeline-overlay");
      const isNew = e.dataTransfer.types.includes("application/media-item");
      if (!isExisting && !isNew) return;

      e.dataTransfer.dropEffect = isExisting ? "move" : "copy";
      setIsDragOver(true);

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

      const overlayId = e.dataTransfer.getData("application/timeline-overlay");
      if (overlayId) {
        const overlay = overlays.find((o) => o.id === overlayId);
        if (!overlay) return;

        const el = dropRef.current;
        if (!el) return;

        const offsetXStr = e.dataTransfer.getData("application/timeline-overlay-offset");
        const offsetX = offsetXStr ? parseFloat(offsetXStr) : 0;

        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left - offsetX;
        const newStart = snapTime(Math.max(0, x / zoom), snap);
        const overlayLen = overlay.endTime - overlay.startTime;
        const newEnd = Math.min(duration, newStart + overlayLen);
        const trackIndex = yToTrackIndex(e.clientY);

        onUpdateOverlay(overlayId, { startTime: newStart, endTime: newEnd, trackIndex });
        return;
      }

      const mediaJson = e.dataTransfer.getData("application/media-item");
      if (mediaJson) {
        const item = JSON.parse(mediaJson);
        const el = dropRef.current;
        if (!el) return;

        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const startTime = snapTime(Math.max(0, x / zoom), snap);
        const defaultDuration =
          item.duration && isFinite(item.duration)
            ? item.duration
            : item.type === "image"
              ? 5
              : 10;
        const endTime = Math.min(duration, startTime + defaultDuration);
        const trackIndex = yToTrackIndex(e.clientY);

        onAddOverlay({
          id: `overlay-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          name: item.name,
          type: item.type === "video" ? "video" : "image",
          mediaId: item.id,
          x: 0.1,
          y: 0.1,
          width: 0.3,
          height: 0.3,
          startTime,
          endTime,
          trackIndex,
          isEffectZone: false,
        });
      }
    },
    [zoom, duration, yToTrackIndex, overlays, onUpdateOverlay, onAddOverlay],
  );

  const handleOverlayDragStart = useCallback(
    (e: React.DragEvent, overlayId: string) => {
      e.dataTransfer.setData("application/timeline-overlay", overlayId);
      e.dataTransfer.effectAllowed = "move";

      const el = dropRef.current;
      const overlay = overlays.find((o) => o.id === overlayId);
      if (el && overlay) {
        const rect = el.getBoundingClientRect();
        const mouseXInTrack = e.clientX - rect.left;
        const startXInTrack = overlay.startTime * zoom;
        const offsetX = mouseXInTrack - startXInTrack;
        e.dataTransfer.setData("application/timeline-overlay-offset", String(offsetX));

        activeDragRef.current = {
          offsetPx: offsetX,
          durationSec: overlay.endTime - overlay.startTime,
        };
      }
    },
    [overlays, zoom],
  );

  const handleOverlayDragEnd = useCallback(() => {
    activeDragRef.current = null;
    setGhostClip(null);
  }, []);

  const startResize = useCallback(
    (e: React.MouseEvent, overlayId: string, side: "left" | "right") => {
      e.preventDefault();
      e.stopPropagation();
      const overlay = overlays.find((o) => o.id === overlayId);
      if (!overlay) return;

      resizingRef.current = {
        overlayId,
        side,
        startX: e.clientX,
        origStart: overlay.startTime,
        origEnd: overlay.endTime,
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
            onUpdateOverlay(r.overlayId, { startTime: newStart });
          } else {
            const newEnd = snapTime(
              Math.max(r.origStart + 0.1, r.origEnd + dt),
              snap,
            );
            onUpdateOverlay(r.overlayId, { endTime: newEnd });
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
    [overlays, zoom, onUpdateOverlay],
  );

  const maxEnd = overlays.reduce((max, o) => Math.max(max, o.endTime), duration);
  const totalWidth = Math.max(maxEnd * zoom + 120, 400);

  const getTrackColor = (trackIndex: number) => `hsl(${320 - trackIndex * 30}, 60%, 45%)`;

  return (
    <div
      ref={dropRef}
      className={`${styles.dropZone} ${isDragOver ? styles.dragOver : ""}`}
      style={{ width: totalWidth, height: totalHeight, position: "relative" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onMouseDown={() => onSelectOverlay(null)}
    >
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

      {overlays.map((overlay) => {
        const left = overlay.startTime * zoom;
        const width = Math.max(4, (overlay.endTime - overlay.startTime) * zoom);
        const top = overlay.trackIndex * MEDIA_ROW_H;
        const isSelected = selectedOverlayId === overlay.id;
        const color = getTrackColor(overlay.trackIndex);

        return (
          <div
            key={overlay.id}
            className={`${styles.clip} ${isSelected ? styles.selected : ""}`}
            style={{
              left,
              width,
              top,
              height: MEDIA_ROW_H - 4,
              background: overlay.isEffectZone ? "transparent" : color,
              border: overlay.isEffectZone ? `1px dashed ${color}` : undefined,
            }}
            draggable
            tabIndex={0}
            onDragStart={(e) => handleOverlayDragStart(e, overlay.id)}
            onDragEnd={handleOverlayDragEnd}
            onMouseDown={(e) => {
              e.stopPropagation();
              onSelectOverlay(overlay.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Delete" || e.key === "Backspace") {
                onRemoveOverlay(overlay.id);
                onSelectOverlay(null);
              }
            }}
            title={`${overlay.name} (Track ${overlay.trackIndex + 1}) — Delete to remove`}
          >
            <div
              className={`${styles.clipHandle} ${styles.left}`}
              onMouseDown={(e) => startResize(e, overlay.id, "left")}
            />
            <span
              className={styles.clipName}
              style={{ color: overlay.isEffectZone ? color : "#fff" }}
            >
              <span style={{ opacity: 0.6, fontSize: 9 }}>T{overlay.trackIndex + 1} </span>
              {overlay.type === "text" ? (
                <Type size={10} style={{ display: "inline", marginRight: 2 }} />
              ) : (
                <ImageIcon size={10} style={{ display: "inline", marginRight: 2 }} />
              )}
              {overlay.name}
              {overlay.isEffectZone && " (Zone)"}
            </span>

            <button
              className={styles.removeClipBtn}
              onClick={(e) => {
                e.stopPropagation();
                onRemoveOverlay(overlay.id);
              }}
              title="Remove overlay"
            >
              <Trash2 size={10} />
            </button>

            <div
              className={`${styles.clipHandle} ${styles.right}`}
              onMouseDown={(e) => startResize(e, overlay.id, "right")}
            />
          </div>
        );
      })}

      {overlays.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            height: MEDIA_ROW_H,
          }}
        >
          <span style={{ fontFamily: "monospace", fontSize: 10, color: "#444" }}>
            Add overlays from the toolbar or drag media here
          </span>
        </div>
      )}
    </div>
  );
}
