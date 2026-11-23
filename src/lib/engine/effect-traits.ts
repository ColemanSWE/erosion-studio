import { getEffectDefinition } from "../effects/effect-registry";
import type { Effect } from "../effects/types";

const animatedCache = new Map<string, boolean>();

// Signals in CPU processor source that output depends on time or on state
// carried between frames. Property names survive minification, so this holds in
// production builds too.
const CPU_ANIMATION_HINT = /\btime\b|Math\.random|performance\.now|Date\.now|prevFrame|history/;

/**
 * True when an effect produces different output on successive frames of an
 * unchanging source — i.e. a still image needs a continuous render loop.
 */
export function isAnimatedEffectType(type: string): boolean {
  const cached = animatedCache.get(type);
  if (cached !== undefined) return cached;

  const def = getEffectDefinition(type as Effect["type"]);
  let animated = false;
  if (def) {
    if (def.animated !== undefined) animated = def.animated;
    else if (def.glsl?.needsPrevFrame) animated = true;
    else if (def.glsl?.fragment.includes("u_time")) animated = true;
    else animated = CPU_ANIMATION_HINT.test(def.processor.toString());
  }
  animatedCache.set(type, animated);
  return animated;
}

export function effectsNeedAnimation(effects: Effect[]): boolean {
  return effects.some((e) => e.active && isAnimatedEffectType(e.type));
}

/** Effects that read the *other* sources on the timeline (transitions). */
export function effectsNeedTimelineFrames(effects: Effect[]): boolean {
  return effects.some((e) => {
    if (!e.active) return false;
    if (e.type === "datamosh") return true; // overlapping clips: moshes from the incoming one
    if (e.type === "motion-smear" && (e.params as Record<string, unknown>)?.mode === "bloom") return true;
    return false;
  });
}
