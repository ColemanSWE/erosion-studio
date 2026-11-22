import { Fragment } from "react";
import type { Effect, EffectParamConfig } from "../../lib/effects/types";
import { getEffectDefinition } from "../../lib/effects/effect-registry";
import { Checkbox, ColorInput, Select, Slider, TextInput } from "../ui";
import styles from "./EffectParams.module.scss";

interface EffectParamsProps {
  effect: Effect;
  onUpdate: (updates: Partial<Effect>) => void;
}

function ParamControl({
  param,
  value,
  onChange,
}: {
  param: EffectParamConfig;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  switch (param.type) {
    case "slider":
      return (
        <Slider
          label={param.label}
          value={value as number}
          min={param.min ?? 0}
          max={param.max ?? 100}
          step={param.step}
          onChange={onChange}
        />
      );
    case "checkbox":
      return <Checkbox label={param.label} checked={!!value} onChange={onChange} />;
    case "select":
      return <Select label={param.label} value={String(value)} options={param.options ?? []} onChange={onChange} />;
    case "color":
      return <ColorInput label={param.label} value={value as string} onCommit={onChange} />;
    case "text":
      return (
        <TextInput label={param.label} value={(value as string) ?? ""} placeholder={param.placeholder} onChange={onChange} />
      );
    default:
      return null;
  }
}

/** Controls for one effect, generated from its `paramsConfig`. */
function EffectParams({ effect, onUpdate }: EffectParamsProps) {
  const params = getEffectDefinition(effect.type)?.paramsConfig ?? [];
  if (params.length === 0) return null;

  const updateParam = (key: string, value: unknown) => {
    onUpdate({ params: { ...effect.params, [key]: value } });
  };

  let lastGroup: string | undefined;

  return (
    <div className={styles.effectParams}>
      {params.map((param) => {
        const showGroup = param.group !== undefined && param.group !== lastGroup;
        if (param.group !== undefined) lastGroup = param.group;
        return (
          <Fragment key={param.key}>
            {showGroup && <div className={styles.paramGroup}>{param.group}</div>}
            <ParamControl
              param={param}
              value={effect.params[param.key] ?? param.default}
              onChange={(v) => updateParam(param.key, v)}
            />
          </Fragment>
        );
      })}
    </div>
  );
}

export default EffectParams;
