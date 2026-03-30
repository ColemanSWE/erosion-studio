import React, { useState, useRef, useCallback } from "react";
import { Type, Image as ImageIcon, Trash2 } from "lucide-react";
import type { Overlay, TimelineClip, TimelineTrack } from "../../lib/effects/types";
import { collectSnapTargets, applySnap } from "../../lib/timeline";
import styles from "./Timeline.module.scss";

interface OverlayTrackProps {
  overlays: Overlay[];
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  zoom: number;
  duration: number;
  currentTime: number;
  rowHeight: number;
  snapEnabled: boolean;
  onAddOverlay: (overlay: Overlay) => void;
  onUpdateOverlay: (id: string, updates: Partial<Overlay>) => void;
  onRemoveOverlay: (id: string) => void;
  onSelectOverlay: (id: string | null) => void;
  selectedOverlayId: string | null;
  onSnapLine: (time: number | null) => void;
}

interface DragState {
  overlayId: string;
  startTime: number;
  trackIndex: number;
}

export function OverlayTrack({
  overlays,
  clips,
  tracks,
  zoom,
  duration,
  currentTime,
  rowHeight,
  snapEnabled,
  onAddOverlay,
  onUpdateOverlay,
  onRemoveOverlay,
  onSelectOverlay,
  selectedOverlayId,
  onSnapLine,
}: OverlayTrackProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [newMediaGhostX, setNewMediaGhostX] = useState<number | null>(null);
  const [draggingState, setDraggingState] = useState<DragState | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const draggingStateRef = useRef<DragState | null>(null);
  const setDragging = (s: DragState | null) => {
    draggingStateRef.current = s;
    setDraggingState(s);
  };

  const dragMoveRef = useRef<{
    overlayId: string;
    startX: number;
    startY: number;
    origStart: number;
    origEnd: number;
    origTrack: number;
    hasMoved: boolean;
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

  const numTracks = Math.max(
    tracks.length,
    ...overlays.map((o) => o.trackIndex + 1),
    ...(draggingState ? [draggingState.trackIndex + 1] : []),
  );
  const totalHeight = numTracks * rowHeight;

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

  // ─── Real-time overlay drag ───────────────────────────────────────────────
  const startOverlayDrag = useCallback(
    (e: React.MouseEvent, overlayId: string) => {
      if ((e.target as HTMLElement).closest(`.${styles.clipHandle}`)) return;
      if ((e.target as HTMLElement).closest(`.${styles.removeClipBtn}`)) return;
      e.preventDefault();
      e.stopPropagation();

      const overlay = overlays.find((o) => o.id === overlayId);
      if (!overlay) return;

      onSelectOverlay(overlayId);
      dragMoveRef.current = {
        overlayId,
        startX: e.clientX,
        startY: e.clientY,
        origStart: overlay.startTime,
        origEnd: overlay.endTime,
        origTrack: overlay.trackIndex,
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

          const overlayDuration = r.origEnd - r.origStart;
          const rawStart = r.origStart + dx / zoom;

          const currentNumTracks = Math.max(tracks.length, ...overlays.map((o) => o.trackIndex + 1));
          const trackDelta = Math.round(dy / rowHeight);
          const newTrackIndex = Math.max(0, Math.min(currentNumTracks, r.origTrack + trackDelta));

          const snapTargets = collectSnapTargets(clips, overlays, currentTime, undefined, r.overlayId);
          const { snappedTime: snappedStart, magnetTime: magnetStart } = applySnap(
            rawStart, snapTargets, zoom, snapEnabled,
          );
          const { snappedTime: snappedEnd, magnetTime: magnetEnd } = applySnap(
            rawStart + overlayDuration, snapTargets, zoom, snapEnabled,
          );

          let finalStart = snappedStart;
          if (!magnetStart && magnetEnd) {
            finalStart = Math.max(0, snappedEnd - overlayDuration);
          }

          onSnapLine(magnetStart ?? magnetEnd ?? null);
          setDragging({ overlayId: r.overlayId, startTime: finalStart, trackIndex: newTrackIndex });
        });
      };

      const onUp = () => {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        const r = dragMoveRef.current;
        if (r?.hasMoved) {
          const ds = draggingStateRef.current;
          if (ds) {
            onUpdateOverlay(r.overlayId, {
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
    [overlays, clips, zoom, rowHeight, numTracks, currentTime, snapEnabled, tracks, onUpdateOverlay, onSelectOverlay, onSnapLine],
  );

  // ─── Resize handles ───────────────────────────────────────────────────────
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

      const snapTargets = collectSnapTargets(clips, overlays, currentTime, undefined, overlayId);

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
            onUpdateOverlay(r.overlayId, { startTime: newStart });
          } else {
            const newEnd = Math.max(r.origStart + 0.1, snappedTime);
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
        onSnapLine(null);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [overlays, clips, zoom, currentTime, snapEnabled, onUpdateOverlay, onSnapLine],
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

      const mediaJson = e.dataTransfer.getData("application/media-item");
      if (!mediaJson) return;
      const item = JSON.parse(mediaJson);
      const el = dropRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const rawStart = x / zoom;
      const snapTargets = collectSnapTargets(clips, overlays, currentTime);
      const { snappedTime: startTime } = applySnap(rawStart, snapTargets, zoom, snapEnabled);
      const defaultDuration =
        item.duration && isFinite(item.duration) ? item.duration : item.type === "image" ? 5 : 10;
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
    },
    [zoom, duration, clips, overlays, currentTime, snapEnabled, yToTrackIndex, onAddOverlay],
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
            top: idx * rowHeight,
            width: "100%",
            height: rowHeight,
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
            pointerEvents: "none",
          }}
        />
      ))}

      {newMediaGhostX !== null && (
        <div
          className={styles.clipGhost}
          style={{ left: Math.max(0, newMediaGhostX - 2), width: 6, top: 2, height: rowHeight - 4 }}
        />
      )}

      {overlays.map((overlay) => {
        const isDragging = draggingState?.overlayId === overlay.id;
        const renderStart = isDragging ? draggingState!.startTime : overlay.startTime;
        const renderTrack = isDragging ? draggingState!.trackIndex : overlay.trackIndex;
        const left = renderStart * zoom;
        const width = Math.max(4, (overlay.endTime - overlay.startTime) * zoom);
        const top = renderTrack * rowHeight;
        const isSelected = selectedOverlayId === overlay.id;
        const color = getTrackColor(overlay.trackIndex);

        return (
          <div
            key={overlay.id}
            className={`${styles.clip} ${isSelected ? styles.selected : ""} ${isDragging ? styles.dragging : ""}`}
            style={{
              left,
              width,
              top,
              height: rowHeight - 4,
              background: overlay.isEffectZone ? "transparent" : color,
              border: overlay.isEffectZone ? `1px dashed ${color}` : undefined,
            }}
            tabIndex={0}
            onMouseDown={(e) => startOverlayDrag(e, overlay.id)}
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
            height: rowHeight,
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
