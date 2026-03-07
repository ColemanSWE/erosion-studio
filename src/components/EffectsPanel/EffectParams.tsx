import type { Effect, EffectType } from "../../lib/effects/types";
import { getEffectDefinition } from "../../lib/effects/effect-registry";
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

  const effectDef = getEffectDefinition(effect.type);
  const params = effectDef?.paramsConfig || [];
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

export default EffectParams;
