import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cx } from "./Button";
import styles from "./ui.module.scss";

// ── Field ────────────────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  /** Right-aligned value readout next to the label (e.g. a slider value). */
  value?: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}

export function Field({ label, value, hint, htmlFor, children }: FieldProps) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={htmlFor}>
        <span>{label}</span>
        {value !== undefined && <span className={styles.fieldValue}>{value}</span>}
      </label>
      {children}
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}

// ── Slider ───────────────────────────────────────────────────────────────────

function formatNumber(value: number, step?: number): string {
  if (!step || step >= 1) return String(Math.round(value));
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return value.toFixed(decimals);
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}

export function Slider({ label, value, min, max, step = 1, onChange, format }: SliderProps) {
  const id = useId();
  const fill = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  return (
    <Field label={label} value={format ? format(value) : formatNumber(value, step)} htmlFor={id}>
      <input
        id={id}
        type="range"
        className={styles.slider}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </Field>
  );
}

// ── Select ───────────────────────────────────────────────────────────────────

export interface SelectOption<T extends string> {
  value: T;
  label?: string;
}

interface SelectProps<T extends string> {
  value: T;
  options: readonly (T | SelectOption<T>)[];
  onChange: (value: T) => void;
  label?: string;
  size?: "sm" | "md";
  title?: string;
  "aria-label"?: string;
}

const normalize = <T extends string>(o: T | SelectOption<T>): SelectOption<T> =>
  typeof o === "string" ? { value: o } : o;

export function Select<T extends string>({ value, options, onChange, label, size = "md", title, ...aria }: SelectProps<T>) {
  const id = useId();
  const select = (
    <select
      id={id}
      className={cx(styles.select, size === "sm" && styles.sm)}
      value={value}
      title={title}
      aria-label={aria["aria-label"]}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map(normalize).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label ?? o.value}
        </option>
      ))}
    </select>
  );
  return label ? <Field label={label} htmlFor={id}>{select}</Field> : select;
}

// ── Segmented control ────────────────────────────────────────────────────────

interface SegmentedControlProps<T extends string | number> {
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  "aria-label": string;
}

/** Mutually exclusive choice rendered as a row of buttons (arrow keys move). */
export function SegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
  ...aria
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={aria["aria-label"]}>
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={cx(styles.segment, active && styles.segmentActive)}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i, -1);
              }
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Checkbox ─────────────────────────────────────────────────────────────────

interface CheckboxProps {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

export function Checkbox({ label, checked, onChange, className }: CheckboxProps) {
  return (
    <label className={cx(styles.checkbox, className)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

// ── Color ────────────────────────────────────────────────────────────────────

interface ColorInputProps {
  label: string;
  value: string;
  /** Called when the picker closes — not on every drag tick, so undo stays clean. */
  onCommit: (value: string) => void;
}

export function ColorInput({ label, value, onCommit }: ColorInputProps) {
  const [draft, setDraft] = useState(value);
  const open = useRef(false);
  useEffect(() => {
    if (!open.current) setDraft(value);
  }, [value]);
  return (
    <Field label={label}>
      <span className={styles.colorInput}>
        <input
          type="color"
          aria-label={label}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => (open.current = true)}
          onBlur={(e) => {
            open.current = false;
            if (e.target.value !== value) onCommit(e.target.value);
          }}
        />
        <span>{draft}</span>
      </span>
    </Field>
  );
}

// ── Text ─────────────────────────────────────────────────────────────────────

interface TextInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function TextInput({ label, value, onChange, placeholder }: TextInputProps) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        type="text"
        className={styles.textInput}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
