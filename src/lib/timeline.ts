import type { Keyframe, EffectParamTrack, Effect } from "./effects/types";

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

/** Format seconds as mm:ss.f */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 10);
  return `${m}:${String(s).padStart(2, "0")}.${f}`;
}
