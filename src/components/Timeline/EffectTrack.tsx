import React, { useState, useRef, useCallback } from "react";
import { Plus, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import type {
  Effect,
  EffectParamTrack,
  Keyframe,
  TimelineClip,
  Overlay,
} from "../../lib/effects/types";
import { getEffectDefinition } from "../../lib/effects/effect-registry";
import { collectSnapTargets, applySnap } from "../../lib/timeline";
import styles from "./Timeline.module.scss";

interface EffectTrackProps {
  effect: Effect;
  paramTracks: EffectParamTrack[];
  clips: TimelineClip[];
  overlays: Overlay[];
  zoom: number;
  duration: number;
  currentTime: number;
  snapEnabled: boolean;
  onUpdateEffect: (id: string, updates: Partial<Effect>) => void;
  onAddParamTrack: (track: EffectParamTrack) => void;
  onRemoveParamTrack: (id: string) => void;
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
  currentTime,
  snapEnabled,
  onUpdateEffect,
  onAddParamTrack,
  onRemoveParamTrack,
  onAddKeyframe,
  onUpdateKeyframe,
  onRemoveKeyframe,
  onSnapLine,
}: EffectTrackProps) {
  const [expanded, setExpanded] = useState(false);
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
    () => collectSnapTargets(clips, overlays, currentTime),
    [clips, overlays, currentTime],
  );

  // ─── Drag whole bar ───────────────────────────────────────────────────────
  const handleBarDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const origStart = startTime;
      const origEnd = endTime;
      const clipLen = origEnd - origStart;
      let lastX = startX;
      let rafId: number | null = null;
      const snapTargets = buildSnapTargets();

      const onMove = (me: MouseEvent) => {
        lastX = me.clientX;
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          const rawStart = origStart + (lastX - startX) / zoom;
          const { snappedTime: snappedStart, magnetTime: ms } = applySnap(rawStart, snapTargets, zoom, snapEnabled);
          const { snappedTime: snappedEnd, magnetTime: me2 } = applySnap(rawStart + clipLen, snapTargets, zoom, snapEnabled);

          let finalStart = snappedStart;
          if (!ms && me2) finalStart = Math.max(0, snappedEnd - clipLen);
          finalStart = Math.max(0, Math.min(duration - clipLen, finalStart));

          onSnapLine(ms ?? me2 ?? null);
          onUpdateEffect(effect.id, { startTime: finalStart, endTime: finalStart + clipLen });
        });
      };
      const onUp = () => {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        onSnapLine(null);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [startTime, endTime, zoom, duration, effect.id, snapEnabled, buildSnapTargets, onUpdateEffect, onSnapLine],
  );

  // ─── Resize handles ───────────────────────────────────────────────────────
  const startBarResize = useCallback(
    (e: React.MouseEvent, side: "left" | "right") => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const origStart = startTime;
      const origEnd = endTime;
      let lastX = startX;
      let rafId: number | null = null;
      const snapTargets = buildSnapTargets();

      const onMove = (me: MouseEvent) => {
        lastX = me.clientX;
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          const rawTime = (side === "left" ? origStart : origEnd) + (lastX - startX) / zoom;
          const { snappedTime, magnetTime } = applySnap(rawTime, snapTargets, zoom, snapEnabled);
          onSnapLine(magnetTime);
          if (side === "left") {
            const newStart = Math.max(0, Math.min(origEnd - 0.1, snappedTime));
            onUpdateEffect(effect.id, { startTime: newStart });
          } else {
            const newEnd = Math.max(origStart + 0.1, Math.min(duration, snappedTime));
            onUpdateEffect(effect.id, { endTime: newEnd });
          }
        });
      };
      const onUp = () => {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        onSnapLine(null);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [startTime, endTime, zoom, duration, effect.id, snapEnabled, buildSnapTargets, onUpdateEffect, onSnapLine],
  );

  // ─── Keyframe actions ─────────────────────────────────────────────────────
  const addKeyframeAtPlayhead = useCallback(
    (track: EffectParamTrack) => {
      const existing = track.keyframes.find((k) => Math.abs(k.time - currentTime) < 0.05);
      if (existing) return;
      const rawVal = effect.params[track.paramKey];
      const val = typeof rawVal === "number" ? rawVal : 0;
      onAddKeyframe(track.id, {
        id: `kf-${Date.now()}-${kfIdCounter++}`,
        time: currentTime,
        value: val,
      });
    },
    [currentTime, effect.params, onAddKeyframe],
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
            onClick={() => setExpanded((v) => !v)}
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
    </div>
  );
}

// ─── Keyframe Marker ─────────────────────────────────────────────────────────
import type { SnapTarget } from "../../lib/timeline";

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

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const origTime = kf.time;
      let lastX = startX;
      let rafId: number | null = null;

      const onMove = (me: MouseEvent) => {
        lastX = me.clientX;
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          const rawTime = Math.max(0, Math.min(duration, origTime + (lastX - startX) / zoom));
          const { snappedTime, magnetTime } = applySnap(rawTime, snapTargets, zoom, snapEnabled);
          onSnapLine(magnetTime);
          onUpdate({ time: snappedTime });
        });
      };
      const onUp = () => {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        onSnapLine(null);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [kf.time, zoom, duration, snapTargets, snapEnabled, onUpdate, onSnapLine],
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
