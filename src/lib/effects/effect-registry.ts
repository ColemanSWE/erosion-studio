import { Effect, EffectType, EffectParamConfig } from "./types";

import { FaceBounds, HandBounds, PoseBounds } from "./face-detector";

export interface ProcessConfig {
  width: number;
  height: number;
  time?: number;
  timelineFrames?: ImageData[];
  faceBounds?: FaceBounds[];
  handBounds?: HandBounds[];
  poseBounds?: PoseBounds[];
}

export type EffectProcessor = (
  data: Uint8ClampedArray,
  config: ProcessConfig,
  params: Record<string, unknown>
) => void;

export interface EffectDefinition {
  type: EffectType;
  label: string;
  category:
    | "glitch"
    | "distortion"
    | "color"
    | "retro"
    | "noise"
    | "style"
    | "face"
    | "standard";
  defaultParams: Record<string, unknown>;
  paramsConfig: EffectParamConfig[];
  processor: EffectProcessor;
}

const registry = new Map<EffectType, EffectDefinition>();

export function registerEffect(definition: EffectDefinition): void {
  registry.set(definition.type, definition);
}

export function getEffectDefinition(
  type: EffectType
): EffectDefinition | undefined {
  return registry.get(type);
}

export function getAllEffects(): EffectDefinition[] {
  return Array.from(registry.values());
}

export function getEffectsByCategory(
  category: EffectDefinition["category"]
): EffectDefinition[] {
  return getAllEffects().filter((e) => e.category === category);
}

export function applyEffect(
  data: Uint8ClampedArray,
  effect: Effect,
  config: ProcessConfig
): void {
  if (!effect.active) return;

  const definition = registry.get(effect.type);
  if (!definition) return;

  const params = { ...definition.defaultParams, ...effect.params };
  definition.processor(data, config, params);
}

export function applyEffects(
  data: Uint8ClampedArray,
  effects: Effect[],
  config: ProcessConfig
): void {
  for (const effect of effects) {
    applyEffect(data, effect, config);
  }
}

export function isStyleEffect(type: EffectType): boolean {
  return getEffectDefinition(type)?.category === "style";
}

export function getProcessingEffects(effects: Effect[]): Effect[] {
  return effects.filter((e) => e.active && !isStyleEffect(e.type));
}
