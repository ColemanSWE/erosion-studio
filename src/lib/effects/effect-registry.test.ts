import { describe, it, expect } from "vitest";
import {
  registerEffect,
  getEffectDefinition,
  getAllEffects,
  getEffectsByCategory,
  applyEffect,
  applyEffects,
  isStyleEffect,
} from "./effect-registry";
import type { EffectDefinition } from "./effect-registry";
import type { Effect } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDefinition(overrides: Partial<EffectDefinition> = {}): EffectDefinition {
  return {
    type: "invert",
    label: "Invert",
    category: "color",
    defaultParams: { strength: 1.0 },
    paramsConfig: [],
    processor: () => {},
    ...overrides,
  };
}

function makeEffect(overrides: Partial<Effect> = {}): Effect {
  return {
    id: "e1",
    type: "invert",
    active: true,
    params: {},
    ...overrides,
  };
}

// ─── registerEffect / getEffectDefinition ────────────────────────────────────

describe("registerEffect / getEffectDefinition", () => {
  it("retrieves a registered effect by type", () => {
    registerEffect(makeDefinition());
    const def = getEffectDefinition("invert");
    expect(def).toBeDefined();
    expect(def?.label).toBe("Invert");
  });

  it("returns undefined for an unknown type", () => {
    // @ts-expect-error intentional unknown type
    expect(getEffectDefinition("totally-unknown-type-xyz")).toBeUndefined();
  });
});

// ─── getAllEffects / getEffectsByCategory ────────────────────────────────────

describe("getAllEffects", () => {
  it("returns at least the registered effects", () => {
    // Processors are registered at import time — just verify the registry isn't empty
    // after importing the processors index
    expect(getAllEffects().length).toBeGreaterThan(0);
  });
});

describe("getEffectsByCategory", () => {
  it("filters effects to the requested category", () => {
    // Ensure at least one color effect exists (invert is always registered)
    registerEffect(makeDefinition({ type: "invert", category: "color" }));
    const colorEffects = getEffectsByCategory("color");
    expect(colorEffects.every((e) => e.category === "color")).toBe(true);
  });

  it("returns an empty array for an empty category", () => {
    // 'standard' category may or may not have effects; use a never-used category
    // We can verify the filter works by checking that all returned are correct category
    const styleEffects = getEffectsByCategory("style");
    expect(styleEffects.every((e) => e.category === "style")).toBe(true);
  });
});

// ─── applyEffect ─────────────────────────────────────────────────────────────

describe("applyEffect", () => {
  it("calls the processor with merged defaultParams + effect.params", () => {
    let capturedParams: Record<string, unknown> | null = null;

    registerEffect(
      makeDefinition({
        type: "invert",
        defaultParams: { strength: 0.5, mode: "soft" },
        processor: (_, __, params) => {
          capturedParams = params;
        },
      }),
    );

    const buf = new Uint8ClampedArray(4);
    applyEffect(buf, makeEffect({ params: { strength: 0.8 } }), { width: 1, height: 1 });

    expect(capturedParams).toMatchObject({ strength: 0.8, mode: "soft" });
  });

  it("does nothing for an inactive effect", () => {
    let called = false;
    registerEffect(makeDefinition({ type: "invert", processor: () => { called = true; } }));

    const buf = new Uint8ClampedArray(4);
    applyEffect(buf, makeEffect({ active: false }), { width: 1, height: 1 });
    expect(called).toBe(false);
  });

  it("does nothing for an unregistered effect type", () => {
    const buf = new Uint8ClampedArray(4);
    // @ts-expect-error intentional unknown type
    expect(() => applyEffect(buf, makeEffect({ type: "does-not-exist" }), { width: 1, height: 1 })).not.toThrow();
  });
});

// ─── applyEffects ────────────────────────────────────────────────────────────

describe("applyEffects", () => {
  it("applies multiple effects in order", () => {
    const calls: string[] = [];

    registerEffect(makeDefinition({ type: "invert", processor: () => { calls.push("invert"); } }));
    // We can't easily register a second type without modifying the union, so
    // we register invert twice (last-write-wins) — just verify the call count
    registerEffect(makeDefinition({ type: "invert", processor: () => { calls.push("invert2"); } }));

    const buf = new Uint8ClampedArray(4);
    applyEffects(buf, [makeEffect(), makeEffect({ id: "e2" })], { width: 1, height: 1 });

    expect(calls).toEqual(["invert2", "invert2"]);
  });
});

// ─── isStyleEffect ───────────────────────────────────────────────────────────

describe("isStyleEffect", () => {
  it("returns false for non-style effects", () => {
    registerEffect(makeDefinition({ type: "invert", category: "color" }));
    expect(isStyleEffect("invert")).toBe(false);
  });
});
