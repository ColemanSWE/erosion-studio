import React, { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Trash2, RotateCcw } from "lucide-react";
import type {
  Effect,
  EffectParamTrack,
  Keyframe,
  TimelineClip,
  Overlay,
} from "../../lib/effects/types";
import { getEffectDefinition } from "../../lib/effects/effect-registry";
import { collectSnapTargets, applySnap, type SnapTarget } from "../../lib/timeline";
import { useDragHandler, useResizeHandler } from "../../hooks/useDragHandler";
import { playbackClock } from "../../lib/engine/clock";
import styles from "./Timeline.module.scss";

interface EffectTrackProps {
  effect: Effect;
  paramTracks: EffectParamTrack[];
  clips: TimelineClip[];
  overlays: Overlay[];
  zoom: number;
  duration: number;
  snapEnabled: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onUpdateEffect: (id: string, updates: Partial<Effect>) => void;
  onRemoveEffect: (id: string) => void;
  onAddParamTrack: (track: EffectParamTrack) => void;
  _onRemoveParamTrack: (id: string) => void;
  onAddKeyframe: (trackId: string, kf: Keyframe) => void;
  onUpdateKeyframe: (trackId: string, kfId: string, updates: Partial<Keyframe>) => void;
  onRemoveKeyframe: (trackId: string, kfId: string) => void;
  onSnapLine: (time: number | null) => void;
}

let trackIdCounter = 0;
let kfIdCounter = 0;

export function EffectTrack({
  effect,
  paramTracks,
  clips,
  overlays,
  zoom,
  duration,
  snapEnabled,
  expanded,
  onToggleExpanded,
  onUpdateEffect,
  onRemoveEffect,
  onAddParamTrack,
  _onRemoveParamTrack,
  onAddKeyframe,
  onUpdateKeyframe,
  onRemoveKeyframe,
  onSnapLine,
}: EffectTrackProps) {
  const [selectedKf, setSelectedKf] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const def = getEffectDefinition(effect.type);
  const numericParams = def?.paramsConfig.filter((p) => p.type === "slider") ?? [];

  const totalWidth = Math.max(duration * zoom, 200);

  const startTime = effect.startTime ?? 0;
  const endTime = effect.endTime ?? duration;
  const barLeft = startTime * zoom;
  const barWidth = Math.max(4, (endTime - startTime) * zoom);

  const buildSnapTargets = useCallback(
    () => collectSnapTargets(clips, overlays, playbackClock.time),
    [clips, overlays],
  );

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const openContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => closeContextMenu();
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [contextMenu, closeContextMenu]);

  // ─── Drag whole bar ───────────────────────────────────────────────────────
  const barDragRef = useRef<{ origStart: number; origEnd: number; snapTargets: SnapTarget[] } | null>(null);

  const onBarDrag = useCallback(
    (dx: number) => {
      const d = barDragRef.current;
      if (!d) return;
      const clipLen = d.origEnd - d.origStart;
      const rawStart = d.origStart + dx / zoom;
      const { snappedTime: snappedStart, magnetTime: ms } = applySnap(rawStart, d.snapTargets, zoom, snapEnabled);
      const { snappedTime: snappedEnd, magnetTime: me2 } = applySnap(rawStart + clipLen, d.snapTargets, zoom, snapEnabled);
      let finalStart = ms ? snappedStart : me2 ? Math.max(0, snappedEnd - clipLen) : snappedStart;
      finalStart = Math.max(0, Math.min(duration - clipLen, finalStart));
      onSnapLine(ms ?? me2 ?? null);
      onUpdateEffect(effect.id, { startTime: finalStart, endTime: finalStart + clipLen });
    },
    [zoom, snapEnabled, duration, effect.id, onUpdateEffect, onSnapLine],
  );

  const onBarDragEnd = useCallback(
    () => { barDragRef.current = null; onSnapLine(null); },
    [onSnapLine],
  );

  const barDragCore = useDragHandler(onBarDrag, onBarDragEnd);

  const handleBarDrag = useCallback(
    (e: React.MouseEvent) => {
      barDragRef.current = { origStart: startTime, origEnd: endTime, snapTargets: buildSnapTargets() };
      barDragCore(e);
    },
    [startTime, endTime, buildSnapTargets, barDragCore],
  );

  // ─── Resize handles ───────────────────────────────────────────────────────
  const barResizeRef = useRef<{ origStart: number; origEnd: number; side: "left" | "right"; snapTargets: SnapTarget[] } | null>(null);

  const onBarResize = useCallback(
    (dx: number) => {
      const d = barResizeRef.current;
      if (!d) return;
      const rawTime = (d.side === "left" ? d.origStart : d.origEnd) + dx / zoom;
      const { snappedTime, magnetTime } = applySnap(rawTime, d.snapTargets, zoom, snapEnabled);
      onSnapLine(magnetTime);
      if (d.side === "left") {
        onUpdateEffect(effect.id, { startTime: Math.max(0, Math.min(d.origEnd - 0.1, snappedTime)) });
      } else {
        onUpdateEffect(effect.id, { endTime: Math.max(d.origStart + 0.1, Math.min(duration, snappedTime)) });
      }
    },
    [zoom, snapEnabled, duration, effect.id, onUpdateEffect, onSnapLine],
  );

  const onBarResizeEnd = useCallback(
    () => { barResizeRef.current = null; onSnapLine(null); },
    [onSnapLine],
  );

  const barResizeCore = useResizeHandler(onBarResize, onBarResizeEnd);

  const startBarResize = useCallback(
    (e: React.MouseEvent, side: "left" | "right") => {
      barResizeRef.current = { origStart: startTime, origEnd: endTime, side, snapTargets: buildSnapTargets() };
      barResizeCore(e);
    },
    [startTime, endTime, buildSnapTargets, barResizeCore],
  );

  // ─── Keyframe actions ─────────────────────────────────────────────────────
  const addKeyframeAtPlayhead = useCallback(
    (track: EffectParamTrack) => {
      const existing = track.keyframes.find((k) => Math.abs(k.time - playbackClock.time) < 0.05);
      if (existing) return;
      const rawVal = effect.params[track.paramKey];
      const val = typeof rawVal === "number" ? rawVal : 0;
      onAddKeyframe(track.id, {
        id: `kf-${Date.now()}-${kfIdCounter++}`,
        time: playbackClock.time,
        value: val,
      });
    },
    [effect.params, onAddKeyframe],
  );

  const addNewParamTrack = useCallback(
    (paramKey: string) => {
      if (paramTracks.some((t) => t.paramKey === paramKey)) return;
      onAddParamTrack({
        id: `pt-${Date.now()}-${trackIdCounter++}`,
        effectId: effect.id,
        paramKey,
        keyframes: [],
      });
    },
    [paramTracks, effect.id, onAddParamTrack],
  );

  return (
    <div style={{ width: totalWidth, position: "relative" }}>
      <div className={styles.trackRow} style={{ width: totalWidth }}>
        <div
          ref={barRef}
          className={`${styles.effectBar} ${!effect.startTime && !effect.endTime ? styles.effectBarFull : ""}`}
          style={{ left: barLeft, width: barWidth }}
          onMouseDown={handleBarDrag}
          onContextMenu={openContextMenu}
        >
          <div
            className={`${styles.effectBarHandle} ${styles.left}`}
            onMouseDown={(e) => startBarResize(e, "left")}
          />
          <div
            className={`${styles.effectBarHandle} ${styles.right}`}
            onMouseDown={(e) => startBarResize(e, "right")}
          />
        </div>

        {numericParams.length > 0 && (
          <button
            className={styles.addKeyframeBtn}
            title="Add keyframe track for a param"
            onClick={onToggleExpanded}
          >
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        )}
      </div>

      {expanded && (
        <div>
          <div
            style={{
              position: "relative",
              height: 24,
              borderBottom: "1px solid #222",
              display: "flex",
              alignItems: "center",
              paddingLeft: 8,
              gap: 6,
              background: "#0a0a0a",
            }}
          >
            {numericParams
              .filter((p) => !paramTracks.some((t) => t.paramKey === p.key))
              .map((p) => (
                <button
                  key={p.key}
                  onClick={() => addNewParamTrack(p.key)}
                  style={{
                    fontFamily: "monospace",
                    fontSize: 9,
                    color: "#ffaa00",
                    background: "transparent",
                    border: "1px solid #ffaa0044",
                    padding: "1px 6px",
                    cursor: "pointer",
                  }}
                  title={`Add keyframe track for ${p.label}`}
                >
                  + {p.label}
                </button>
              ))}
          </div>

          {paramTracks.map((track) => {
            const paramConfig = numericParams.find((p) => p.key === track.paramKey);
            return (
              <div
                key={track.id}
                className={styles.keyframeRow}
                style={{ width: totalWidth }}
                onDoubleClick={() => addKeyframeAtPlayhead(track)}
              >
                {track.keyframes.map((kf) => (
                  <KeyframeMarker
                    key={kf.id}
                    kf={kf}
                    x={kf.time * zoom}
                    selected={selectedKf === kf.id}
                    zoom={zoom}
                    duration={duration}
                    min={paramConfig?.min ?? 0}
                    max={paramConfig?.max ?? 1}
                    step={paramConfig?.step}
                    label={paramConfig?.label ?? track.paramKey}
                    snapTargets={buildSnapTargets()}
                    snapEnabled={snapEnabled}
                    onSelect={() => setSelectedKf(kf.id === selectedKf ? null : kf.id)}
                    onUpdate={(updates) => onUpdateKeyframe(track.id, kf.id, updates)}
                    onRemove={() => { onRemoveKeyframe(track.id, kf.id); setSelectedKf(null); }}
                    onSnapLine={onSnapLine}
                  />
                ))}

                <button
                  className={styles.addKeyframeBtn}
                  onClick={() => addKeyframeAtPlayhead(track)}
                  title={`Add keyframe for ${paramConfig?.label ?? track.paramKey} at playhead`}
                >
                  +
                </button>
              </div>
            );
          })}
        </div>
      )}
    {contextMenu && createPortal(
      <div
        className={styles.contextMenu}
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {(effect.startTime != null || effect.endTime != null) && (
          <button
            className={styles.contextMenuItem}
            onClick={() => {
              onUpdateEffect(effect.id, { startTime: undefined, endTime: undefined });
              closeContextMenu();
            }}
          >
            <RotateCcw size={13} />
            Reset Time Range
          </button>
        )}
        <div className={styles.contextMenuSeparator} />
        <button
          className={`${styles.contextMenuItem} ${styles.danger}`}
          onClick={() => {
            onRemoveEffect(effect.id);
            closeContextMenu();
          }}
        >
          <Trash2 size={13} />
          Delete Effect
        </button>
      </div>,
      document.body
    )}
    </div>
  );
}

// ─── Keyframe Marker ─────────────────────────────────────────────────────────

interface KeyframeMarkerProps {
  kf: Keyframe;
  x: number;
  selected: boolean;
  zoom: number;
  duration: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  snapTargets: SnapTarget[];
  snapEnabled: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<Keyframe>) => void;
  onRemove: () => void;
  onSnapLine: (time: number | null) => void;
}

function KeyframeMarker({
  kf,
  x,
  selected,
  zoom,
  duration,
  min,
  max,
  step,
  label,
  snapTargets,
  snapEnabled,
  onSelect,
  onUpdate,
  onRemove,
  onSnapLine,
}: KeyframeMarkerProps) {
  const markerRef = useRef<HTMLDivElement>(null);
  const kfDragRef = useRef<{ origTime: number }>({ origTime: 0 });

  const onKfDrag = useCallback(
    (dx: number) => {
      const rawTime = Math.max(0, Math.min(duration, kfDragRef.current.origTime + dx / zoom));
      const { snappedTime, magnetTime } = applySnap(rawTime, snapTargets, zoom, snapEnabled);
      onSnapLine(magnetTime);
      onUpdate({ time: snappedTime });
    },
    [duration, zoom, snapTargets, snapEnabled, onSnapLine, onUpdate],
  );

  const onKfDragEnd = useCallback(() => { onSnapLine(null); }, [onSnapLine]);

  const kfDragCore = useDragHandler(onKfDrag, onKfDragEnd);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      kfDragRef.current = { origTime: kf.time };
      kfDragCore(e);
    },
    [kf.time, kfDragCore],
  );

  return (
    <div style={{ position: "absolute", left: x, top: 0, bottom: 0, zIndex: 2 }}>
      <div
        ref={markerRef}
        className={`${styles.keyframe} ${selected ? styles.selected : ""}`}
        onMouseDown={startDrag}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        onDoubleClick={(e) => { e.stopPropagation(); onRemove(); }}
        title={`${label}: ${kf.value.toFixed(3)} @ ${kf.time.toFixed(2)}s\nDouble-click to delete`}
      />

      {selected && (
        <div
          className={styles.keyframePopup}
          style={{ left: 10, top: -50 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div style={{ fontSize: 9, color: "#999", marginBottom: 2 }}>
            {label} @ {kf.time.toFixed(2)}s
          </div>
          <input
            type="number"
            className={styles.keyframeInput}
            value={kf.value}
            min={min}
            max={max}
            step={step ?? 0.01}
            onChange={(e) => onUpdate({ value: parseFloat(e.target.value) })}
          />
          <button
            onClick={onRemove}
            style={{
              fontSize: 9,
              color: "#ff4444",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
              padding: 0,
            }}
          >
            Remove keyframe
          </button>
        </div>
      )}
    </div>
  );
}
