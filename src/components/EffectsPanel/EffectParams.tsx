import React from "react";
import type { Effect, EffectType } from "../../lib/effects/types";
import styles from "./EffectParams.module.scss";

interface EffectParamsProps {
  effect: Effect;
  onUpdate: (updates: Partial<Effect>) => void;
}

function EffectParams({ effect, onUpdate }: EffectParamsProps) {
  const updateParam = (key: string, value: unknown) => {
    onUpdate({
      params: {
        ...effect.params,
        [key]: value,
      },
    });
  };

  const params = getEffectParams(effect.type);
  if (params.length === 0) return null;

  return (
    <div className={styles.effectParams}>
      {params.map((param) => {
        const value = effect.params[param.key] ?? param.default;

        switch (param.type) {
          case "slider":
            return (
              <div key={param.key} className={styles.param}>
                <label>
                  <span>{param.label}</span>
                  <span className={styles.value}>
                    {Math.round(value as number)}
                  </span>
                </label>
                <input
                  type="range"
                  min={param.min}
                  max={param.max}
                  step={param.step || 1}
                  value={value as number}
                  onChange={(e) =>
                    updateParam(param.key, parseFloat(e.target.value))
                  }
                />
              </div>
            );

          case "checkbox":
            return (
              <div key={param.key} className={styles.param}>
                <label>
                  <input
                    type="checkbox"
                    checked={value as boolean}
                    onChange={(e) => updateParam(param.key, e.target.checked)}
                  />
                  <span>{param.label}</span>
                </label>
              </div>
            );

          case "select":
            return (
              <div key={param.key} className={styles.param}>
                <label>
                  <span>{param.label}</span>
                </label>
                <select
                  value={value as string}
                  onChange={(e) => updateParam(param.key, e.target.value)}
                >
                  {param.options?.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            );

          case "color":
            return (
              <div key={param.key} className={styles.param}>
                <label>
                  <span>{param.label}</span>
                </label>
                <input
                  type="color"
                  value={value as string}
                  onChange={(e) => updateParam(param.key, e.target.value)}
                />
              </div>
            );

          default:
            return null;
        }
      })}
    </div>
  );
}

interface ParamConfig {
  key: string;
  label: string;
  type: "slider" | "checkbox" | "select" | "color";
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  options?: string[];
}

function getEffectParams(type: EffectType): ParamConfig[] {
  const commonParams: Record<string, ParamConfig[]> = {
    glitch: [
      {
        key: "intensity",
        label: "Intensity",
        type: "slider",
        min: 0,
        max: 100,
        default: 30,
      },
    ],
    "motion-smear": [
      {
        key: "intensity",
        label: "Intensity",
        type: "slider",
        min: 0,
        max: 100,
        default: 50,
      },
      {
        key: "length",
        label: "Length",
        type: "slider",
        min: 1,
        max: 20,
        default: 5,
      },
    ],
    "block-corrupt": [
      {
        key: "intensity",
        label: "Intensity",
        type: "slider",
        min: 0,
        max: 100,
        default: 30,
      },
      {
        key: "blockSize",
        label: "Block Size",
        type: "select",
        options: ["8", "16", "32", "64"],
        default: "16",
      },
    ],
    "pixel-sort": [
      {
        key: "threshold",
        label: "Threshold",
        type: "slider",
        min: 0,
        max: 255,
        default: 128,
      },
      {
        key: "angle",
        label: "Angle",
        type: "slider",
        min: 0,
        max: 360,
        default: 0,
      },
    ],
    datamosh: [
      {
        key: "intensity",
        label: "Intensity",
        type: "slider",
        min: 0,
        max: 100,
        default: 50,
      },
      {
        key: "blockSize",
        label: "Block Size",
        type: "slider",
        min: 4,
        max: 64,
        default: 16,
      },
    ],
    "jpeg-artifacts": [
      {
        key: "quality",
        label: "Quality",
        type: "slider",
        min: 0,
        max: 100,
        default: 30,
      },
      {
        key: "blockiness",
        label: "Blockiness",
        type: "slider",
        min: 0,
        max: 100,
        default: 50,
      },
      {
        key: "colorBanding",
        label: "Color Banding",
        type: "slider",
        min: 0,
        max: 100,
        default: 50,
      },
    ],
    "codec-damage": [
      {
        key: "intensity",
        label: "Intensity",
        type: "slider",
        min: 0,
        max: 100,
        default: 50,
      },
      {
        key: "blockSize",
        label: "Block Size",
        type: "select",
        options: ["8", "16", "32"],
        default: "16",
      },
      {
        key: "colorBleed",
        label: "Color Bleed",
        type: "slider",
        min: 0,
        max: 100,
        default: 50,
      },
      { key: "temporal", label: "Temporal", type: "checkbox", default: true },
    ],
    vhs: [
      {
        key: "intensity",
        label: "Intensity",
        type: "slider",
        min: 0,
        max: 100,
        default: 50,
      },
      { key: "scanlines", label: "Scanlines", type: "checkbox", default: true },
    ],
    crt: [
      {
        key: "scanlineIntensity",
        label: "Scanlines",
        type: "slider",
        min: 0,
        max: 100,
        default: 50,
      },
      {
        key: "curvature",
        label: "Curvature",
        type: "slider",
        min: 0,
        max: 100,
        default: 20,
      },
    ],
    pixelate: [
      {
        key: "density",
        label: "Density",
        type: "slider",
        min: 16,
        max: 128,
        default: 64,
      },
    ],
    emoji: [
      {
        key: "density",
        label: "Density",
        type: "slider",
        min: 16,
        max: 128,
        default: 64,
      },
      {
        key: "palette",
        label: "Palette",
        type: "select",
        options: ["standard", "nature", "faces", "symbols"],
        default: "standard",
      },
    ],
    ascii: [
      {
        key: "density",
        label: "Density",
        type: "slider",
        min: 16,
        max: 128,
        default: 64,
      },
    ],
    matrix: [
      {
        key: "density",
        label: "Density",
        type: "slider",
        min: 16,
        max: 128,
        default: 64,
      },
    ],
    halftone: [
      {
        key: "density",
        label: "Density",
        type: "slider",
        min: 16,
        max: 128,
        default: 64,
      },
      {
        key: "dotScale",
        label: "Dot Scale",
        type: "slider",
        min: 0.5,
        max: 2.0,
        step: 0.1,
        default: 1.0,
      },
    ],
    "3d-mesh": [
      {
        key: "density",
        label: "Density",
        type: "slider",
        min: 1,
        max: 5,
        default: 2,
      },
      {
        key: "displacementScale",
        label: "Displacement",
        type: "slider",
        min: 0,
        max: 10,
        default: 3,
      },
      {
        key: "wireframe",
        label: "Wireframe",
        type: "checkbox",
        default: true,
      },
    ],
    "detection-labels": [
      {
        key: "showFaces",
        label: "Show Faces",
        type: "checkbox",
        default: true,
      },
      {
        key: "showHands",
        label: "Show Hands",
        type: "checkbox",
        default: true,
      },
      { key: "showPose", label: "Show Pose", type: "checkbox", default: true },
      {
        key: "labelSize",
        label: "Label Size",
        type: "slider",
        min: 8,
        max: 24,
        default: 14,
      },
    ],
  };

  return (
    commonParams[type] || [
      {
        key: "intensity",
        label: "Intensity",
        type: "slider",
        min: 0,
        max: 100,
        default: 50,
      },
    ]
  );
}

export default EffectParams;
