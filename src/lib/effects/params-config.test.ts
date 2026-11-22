import { describe, it, expect } from "vitest";
import { getAllEffects } from "./effect-registry";
import "./processors";

// Params that are set programmatically (or kept only for old project files)
// rather than edited through a UI control.
const NON_UI_PARAMS = new Set(["mediaSources", "blob-track.color"]);

describe("effect paramsConfig", () => {
  const effects = getAllEffects();

  it("only references real params", () => {
    for (const def of effects) {
      for (const p of def.paramsConfig) {
        expect(def.defaultParams, `${def.type}.${p.key}`).toHaveProperty(p.key);
      }
    }
  });

  it("exposes a control for every user-facing param", () => {
    const missing: string[] = [];
    for (const def of effects) {
      const covered = new Set(def.paramsConfig.map((p) => p.key));
      for (const [key, value] of Object.entries(def.defaultParams)) {
        if (NON_UI_PARAMS.has(key) || NON_UI_PARAMS.has(`${def.type}.${key}`) || Array.isArray(value) || typeof value === "object") continue;
        if (!covered.has(key)) missing.push(`${def.type}.${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("keeps slider defaults inside their range", () => {
    for (const def of effects) {
      for (const p of def.paramsConfig) {
        if (p.type !== "slider") continue;
        const value = (def.defaultParams[p.key] ?? p.default) as number;
        expect(value, `${def.type}.${p.key}`).toBeGreaterThanOrEqual(p.min!);
        expect(value, `${def.type}.${p.key}`).toBeLessThanOrEqual(p.max!);
      }
    }
  });
});
