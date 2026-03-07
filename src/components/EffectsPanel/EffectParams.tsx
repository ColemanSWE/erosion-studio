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
        key: "mode",
        label: "Mode",
        type: "select",
        options: ["mesh", "solid", "points"],
        default: "mesh",
      },
      {
        key: "wireframe",
        label: "Wireframe",
        type: "checkbox",
        default: true,
      },
      {
        key: "pointSize",
        label: "Point Size",
        type: "slider",
        min: 0.01,
        max: 0.2,
        step: 0.01,
        default: 0.08,
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
    dither: [
      {
        key: "depth",
        label: "Depth",
        type: "slider",
        min: 2,
        max: 16,
        default: 4,
      },
    ],
    "rainbow-gradient": [
      {
        key: "speed",
        label: "Speed",
        type: "slider",
        min: 0,
        max: 5,
        step: 0.1,
        default: 1,
      },
      {
        key: "intensity",
        label: "Intensity",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
      },
      {
        key: "direction",
        label: "Direction",
        type: "select",
        options: ["horizontal", "vertical", "diagonal", "radial"],
        default: "horizontal",
      },
    ],
    "gradient-flash": [
      {
        key: "speed",
        label: "Speed",
        type: "slider",
        min: 0,
        max: 5,
        step: 0.1,
        default: 2,
      },
      {
        key: "intensity",
        label: "Intensity",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.7,
      },
      {
        key: "flashRate",
        label: "Flash Rate",
        type: "slider",
        min: 1,
        max: 20,
        default: 4,
      },
    ],
    "xor-blend": [
      {
        key: "intensity",
        label: "Intensity",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
      },
      {
        key: "frameHistory",
        label: "Frame Delay",
        type: "slider",
        min: 1,
        max: 8,
        default: 1,
      },
    ],
    "rgb-vertical-xor": [
      {
        key: "speed",
        label: "Speed",
        type: "slider",
        min: 0,
        max: 10,
        step: 0.1,
        default: 2,
      },
      {
        key: "amplitude",
        label: "Amplitude",
        type: "slider",
        min: 0,
        max: 3,
        step: 0.1,
        default: 1.0,
      },
    ],
    "frame-trails": [
      {
        key: "intensity",
        label: "Intensity",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.7,
      },
      {
        key: "decay",
        label: "Decay",
        type: "slider",
        min: 0.5,
        max: 0.99,
        step: 0.01,
        default: 0.9,
      },
      {
        key: "maxFrames",
        label: "Max Frames",
        type: "slider",
        min: 2,
        max: 16,
        default: 8,
      },
    ],
    "rgb-color-trails": [
      {
        key: "rDecay",
        label: "Red Decay",
        type: "slider",
        min: 0.5,
        max: 0.99,
        step: 0.01,
        default: 0.95,
      },
      {
        key: "gDecay",
        label: "Green Decay",
        type: "slider",
        min: 0.5,
        max: 0.99,
        step: 0.01,
        default: 0.9,
      },
      {
        key: "bDecay",
        label: "Blue Decay",
        type: "slider",
        min: 0.5,
        max: 0.99,
        step: 0.01,
        default: 0.85,
      },
      {
        key: "maxFrames",
        label: "Max Frames",
        type: "slider",
        min: 2,
        max: 12,
        default: 6,
      },
    ],
    "strobe-flash": [
      {
        key: "frequency",
        label: "Frequency",
        type: "slider",
        min: 1,
        max: 30,
        default: 8,
      },
      {
        key: "intensity",
        label: "Intensity",
        type: "slider",
        min: 0,
        max: 2,
        step: 0.1,
        default: 1.0,
      },
      {
        key: "pattern",
        label: "Pattern",
        type: "select",
        options: ["pulse", "saw", "square", "triangle"],
        default: "pulse",
      },
    ],
    "rgb-strobe": [
      {
        key: "rFreq",
        label: "Red Frequency",
        type: "slider",
        min: 1,
        max: 30,
        default: 8,
      },
      {
        key: "gFreq",
        label: "Green Frequency",
        type: "slider",
        min: 1,
        max: 30,
        default: 6,
      },
      {
        key: "bFreq",
        label: "Blue Frequency",
        type: "slider",
        min: 1,
        max: 30,
        default: 10,
      },
      {
        key: "intensity",
        label: "Intensity",
        type: "slider",
        min: 0,
        max: 2,
        step: 0.1,
        default: 0.8,
      },
    ],
    kaleidoscope: [
      {
        key: "segments",
        label: "Segments",
        type: "slider",
        min: 2,
        max: 16,
        default: 6,
      },
      {
        key: "angle",
        label: "Angle",
        type: "slider",
        min: 0,
        max: 360,
        default: 0,
      },
      {
        key: "animated",
        label: "Animated",
        type: "checkbox",
        default: true,
      },
    ],
    "mirror-blend": [
      {
        key: "mode",
        label: "Mode",
        type: "select",
        options: ["quadrant", "cross"],
        default: "quadrant",
      },
      {
        key: "blendAmount",
        label: "Blend Amount",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
      },
    ],
    "feedback-echo": [
      {
        key: "delay",
        label: "Delay",
        type: "slider",
        min: 1,
        max: 10,
        default: 2,
      },
      {
        key: "feedback",
        label: "Feedback",
        type: "slider",
        min: 0,
        max: 0.95,
        step: 0.01,
        default: 0.8,
      },
      {
        key: "scale",
        label: "Scale",
        type: "slider",
        min: 0.8,
        max: 1.0,
        step: 0.01,
        default: 0.95,
      },
    ],
    "frame-delay": [
      {
        key: "delay",
        label: "Delay",
        type: "slider",
        min: 1,
        max: 16,
        default: 5,
      },
      {
        key: "blendMode",
        label: "Blend Mode",
        type: "select",
        options: ["replace", "blend", "xor"],
        default: "replace",
      },
    ],
    "alpha-trails": [
      {
        key: "alpha",
        label: "Alpha",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.3,
      },
      {
        key: "maxFrames",
        label: "Max Frames",
        type: "slider",
        min: 2,
        max: 16,
        default: 10,
      },
    ],
    "square-swap": [
      {
        key: "gridSize",
        label: "Grid Size",
        type: "slider",
        min: 2,
        max: 16,
        default: 4,
      },
      {
        key: "swapPattern",
        label: "Pattern",
        type: "select",
        options: ["random", "flip", "rotate"],
        default: "random",
      },
      {
        key: "animated",
        label: "Animated",
        type: "checkbox",
        default: true,
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
