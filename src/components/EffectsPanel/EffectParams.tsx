import { useEffect, useRef, useState } from "react";
import type { Effect, EffectType } from "../../lib/effects/types";
import { getEffectDefinition } from "../../lib/effects/effect-registry";
import styles from "./EffectParams.module.scss";

interface ColorInputProps {
  value: string;
  onCommit: (value: string) => void;
}

function ColorInput({ value, onCommit }: ColorInputProps) {
  const [draft, setDraft] = useState(value);
  const activeRef = useRef(false);
  // Sync external value changes into draft only when the picker is not open
  useEffect(() => {
    if (!activeRef.current) setDraft(value);
  }, [value]);
  return (
    <input
      type="color"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => { activeRef.current = true; }}
      onBlur={(e) => {
        activeRef.current = false;
        onCommit(e.target.value);
      }}
    />
  );
}

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

  const effectDef = getEffectDefinition(effect.type);
  const params = effectDef?.paramsConfig || [];
  if (params.length === 0) return null;

  const formatSliderValue = (value: number, step?: number): string => {
    if (!step || step >= 1) return String(Math.round(value));
    const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
    return value.toFixed(decimals);
  };

  let lastGroup: string | undefined = undefined;

  return (
    <div className={styles.effectParams}>
      {params.map((param) => {
        const value = effect.params[param.key] ?? param.default;
        const showGroup = param.group !== undefined && param.group !== lastGroup;
        if (param.group !== undefined) lastGroup = param.group;

        switch (param.type) {
          case "slider":
            return (
              <div key={param.key}>
                {showGroup && <div className={styles.paramGroup}>{param.group}</div>}
                <div className={styles.param}>
                  <label>
                    <span>{param.label}</span>
                    <span className={styles.value}>
                      {formatSliderValue(value as number, param.step)}
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
              </div>
            );

          case "checkbox":
            return (
              <div key={param.key}>
                {showGroup && <div className={styles.paramGroup}>{param.group}</div>}
                <div className={styles.param}>
                  <label>
                    <input
                      type="checkbox"
                      checked={value as boolean}
                      onChange={(e) => updateParam(param.key, e.target.checked)}
                    />
                    <span>{param.label}</span>
                  </label>
                </div>
              </div>
            );

          case "select":
            return (
              <div key={param.key}>
                {showGroup && <div className={styles.paramGroup}>{param.group}</div>}
                <div className={styles.param}>
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
              </div>
            );

          case "color":
            return (
              <div key={param.key}>
                {showGroup && <div className={styles.paramGroup}>{param.group}</div>}
                <div className={styles.param}>
                  <label>
                    <span>{param.label}</span>
                  </label>
                  <ColorInput
                    value={value as string}
                    onCommit={(v) => updateParam(param.key, v)}
                  />
                </div>
              </div>
            );

          case "text":
            return (
              <div key={param.key}>
                {showGroup && <div className={styles.paramGroup}>{param.group}</div>}
                <div className={styles.param}>
                  <label>
                    <span>{param.label}</span>
                  </label>
                  <input
                    type="text"
                    className={styles.textInput}
                    value={value as string}
                    placeholder={param.placeholder ?? ""}
                    onChange={(e) => updateParam(param.key, e.target.value)}
                  />
                </div>
              </div>
            );

          default:
            return null;
        }
      })}
    </div>
  );
}

export default EffectParams;
