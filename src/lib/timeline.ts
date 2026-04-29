import type { EffectParamTrack, Effect, TimelineClip, Overlay } from "./effects/types";

/**
 * Linearly interpolate a value between two keyframes at time `t`.
 * Returns undefined if there are no keyframes.
 */
export function evaluateParamTrack(
  track: EffectParamTrack,
  time: number
): number | undefined {
  const kfs = track.keyframes;
  if (kfs.length === 0) return undefined;
  if (kfs.length === 1) return kfs[0].value;

  // Before first
  if (time <= kfs[0].time) return kfs[0].value;
  // After last
  if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

  // Find surrounding pair
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (time >= a.time && time <= b.time) {
      const t = (time - a.time) / (b.time - a.time);
      return a.value + (b.value - a.value) * t;
    }
  }
  return undefined;
}

/**
 * Return a copy of `effects` with:
 *  - Effects outside their time window filtered out
 *  - Params overridden by evaluated keyframe tracks
 */
export function resolveEffectsAtTime(
  effects: Effect[],
  paramTracks: EffectParamTrack[],
  currentTime: number
): Effect[] {
  return effects
    .filter((effect) => {
      if (!effect.active) return false;
      const hasWindow =
        effect.startTime !== undefined || effect.endTime !== undefined;
      if (!hasWindow) return true;
      const start = effect.startTime ?? 0;
      const end = effect.endTime ?? Infinity;
      return currentTime >= start && currentTime <= end;
    })
    .map((effect) => {
      const tracks = paramTracks.filter((t) => t.effectId === effect.id);
      if (tracks.length === 0) return effect;

      const overrides: Record<string, unknown> = {};
      for (const track of tracks) {
        const val = evaluateParamTrack(track, currentTime);
        if (val !== undefined) overrides[track.paramKey] = val;
      }

      return { ...effect, params: { ...effect.params, ...overrides } };
    });
}

/** Snap a time value to the nearest snap interval */
export function snapTime(time: number, snapInterval: number): number {
  return Math.round(time / snapInterval) * snapInterval;
}

/** Returns the appropriate snap interval in seconds for a given zoom level (px/s). */
export function getSnapInterval(zoom: number): number {
  if (zoom >= 200) return 1 / 30;
  if (zoom >= 60) return 0.1;
  if (zoom >= 20) return 0.5;
  return 1;
}

/** Format seconds as mm:ss.f */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 10);
  return `${m}:${String(s).padStart(2, "0")}.${f}`;
}

// ─── Magnetic snapping ────────────────────────────────────────────────────────

export interface SnapTarget {
  time: number;
  type: "clip-start" | "clip-end" | "playhead";
}

/**
 * Collect snap targets from all clips, overlays, and the playhead.
 * Optionally exclude one clip or overlay (the item currently being dragged).
 */
export function collectSnapTargets(
  clips: TimelineClip[],
  overlays: Overlay[],
  currentTime: number,
  excludeClipId?: string,
  excludeOverlayId?: string,
): SnapTarget[] {
  const targets: SnapTarget[] = [{ time: currentTime, type: "playhead" }];

  for (const clip of clips) {
    if (clip.id === excludeClipId) continue;
    targets.push({ time: clip.startTime, type: "clip-start" });
    targets.push({ time: clip.endTime, type: "clip-end" });
  }

  for (const overlay of overlays) {
    if (overlay.id === excludeOverlayId) continue;
    targets.push({ time: overlay.startTime, type: "clip-start" });
    targets.push({ time: overlay.endTime, type: "clip-end" });
  }

  return targets;
}

/**
 * Apply snapping to a time value. First tries magnetic snap to the provided
 * targets (within 8px). Falls back to grid snap if nothing is in range.
 *
 * Returns the final time and the magnetic snap time if one was applied (null
 * means only grid snap was used, so no indicator line should be shown).
 */
export function applySnap(
  time: number,
  targets: SnapTarget[],
  zoom: number,
  enabled: boolean,
): { snappedTime: number; magnetTime: number | null } {
  const clamped = Math.max(0, time);
  if (!enabled) return { snappedTime: clamped, magnetTime: null };

  const thresholdSec = 8 / zoom;
  let best: SnapTarget | null = null;
  let bestDist = thresholdSec;

  for (const t of targets) {
    const d = Math.abs(clamped - t.time);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }

  if (best) return { snappedTime: best.time, magnetTime: best.time };

  const interval = getSnapInterval(zoom);
  return { snappedTime: snapTime(clamped, interval), magnetTime: null };
}
