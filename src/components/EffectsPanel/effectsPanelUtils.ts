import { getEffectDefinition } from "../../lib/effects/effect-registry";
import type { EffectType } from "../../lib/effects/types";

/** Display name for an effect: its registered label, or a title-cased id as a fallback. */
export function formatEffectName(type: string): string {
  const label = getEffectDefinition(type as EffectType)?.label;
  if (label) return label;
  return type
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
