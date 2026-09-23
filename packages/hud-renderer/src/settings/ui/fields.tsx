import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { cx } from '../../hud/util.ts';
import { jsonEqual } from '../model/diff.ts';
import type { KeysOfType, Scope } from '../model/scope.ts';
import {
  describeBound,
  formatForInput,
  parseNumberText,
  plainUnit,
  textMatchesValue,
  toCanonical,
} from '../model/units.ts';
import type { UnitSpec } from '../model/units.ts';
import type { FieldIssue } from '../model/validation.ts';
import { useForm } from './form-context.ts';

/**
 * Form controls bound to a {@link Scope} key: they read the draft value, write edits back through
 * the scope, and show validation (client or server) and "changed" state in place. Every control
 * carries `data-path` so the save bar can jump to a problem.
 */

const NO_UNIT = plainUnit('');

/** An issue as a sentence in the field's display unit; server rejections are marked. */
export function issueText(issue: FieldIssue, unit?: UnitSpec): string {
  const text = issue.bound && unit ? describeBound(issue.bound, unit) : issue.message;
  return issue.source === 'server'
    ? `Not saved: ${text.charAt(0).toLowerCase()}${text.slice(1)}`
    : text;
}

interface ShellProps {
  label: ComponentChildren;
  inputId?: string;
  hint?: ComponentChildren;
  error?: string | null;
  dirty?: boolean;
  path?: string;
  /** Label and control on one row (toggles). */
  inline?: boolean;
  class?: string;
  children: ComponentChildren;
}

/** Label, control, hint and error message, with a dot marking unsaved changes. */
export function FieldShell({
  label,
  inputId,
  hint,
  error,
  dirty,
  path,
  inline,
  class: extra,
  children,
}: ShellProps) {
  const errorId = inputId ? `${inputId}-error` : undefined;
  return (
    <div
      class={cx(
        'field',
        inline && 'field--inline',
        error && 'field--invalid',
        dirty && 'field--dirty',
        extra,
      )}
      data-path={path}
    >
      <div class="field__top">
        <label class="field__label" for={inputId}>
          {label}
          {dirty && (
            <span class="field__dirty" title="Changed, not saved yet" aria-label="changed" />
          )}
        </label>
        {inline && <div class="field__control">{children}</div>}
      </div>
      {!inline && <div class="field__control">{children}</div>}
      {error ? (
        <p class="field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p class="field__hint">{hint}</p>
      ) : null}
    </div>
  );
}

interface BaseProps<T, K> {
  scope: Scope<T>;
  k: K;
  label: ComponentChildren;
  hint?: ComponentChildren;
  disabled?: boolean;
  class?: string;
}

// ---------------------------------------------------------------------------------------------
// Numbers

export interface NumberFieldProps<T, K extends KeysOfType<T, number | null>> extends BaseProps<
  T,
  K
> {
  /** Display unit (the draft holds canonical units). */
  unit?: UnitSpec;
  /** The stored value is an integer (rounded after unit conversion). */
  integer?: boolean;
  /** Empty input stores null. */
  nullable?: boolean;
  /** Allow a minus sign (switches phones to the full keyboard). */
  signed?: boolean;
  placeholder?: string;
}

/**
 * A number typed as text (phone keyboards, decimal commas), converted from the display unit to
 * canonical units on every keystroke. Unparseable text shows an error immediately and blocks
 * saving; it never reaches the draft.
 */
export function NumberField<T, K extends KeysOfType<T, number | null>>(
  props: NumberFieldProps<T, K>,
) {
  const { scope, k, unit = NO_UNIT, integer = false, nullable = false, signed = false } = props;
  const value = scope.value[k] as unknown as number | null;
  const key = scope.keyOf(k);
  const form = useForm();
  const id = useId();
  const [text, setText] = useState(() => formatForInput(value, unit));
  const [localError, setLocalError] = useState<string | null>(null);
  const textRef = useRef(text);
  textRef.current = text;

  // Follow outside changes (unit switch, server rebase) unless the text already says the same.
  // Keyed on the value as displayed, so a unit switch re-syncs even when the label stays the
  // same (or is hidden, like the gear-ratio fields').
  const formatted = formatForInput(value, unit);
  useEffect(() => {
    if (!textMatchesValue(textRef.current, value, unit, integer)) {
      setText(formatted);
      setLocalError(null);
    }
  }, [formatted]);

  // Discard / reload: always re-sync, even when the value itself did not change.
  const firstRevision = useRef(form.revision);
  useEffect(() => {
    if (form.revision === firstRevision.current) return;
    setText(formatForInput(value, unit));
    setLocalError(null);
  }, [form.revision]);

  useEffect(() => {
    form.setLocalError(key, localError);
  }, [key, localError]);
  useEffect(() => () => form.setLocalError(key, null), [key]);

  const wholeOnly = integer && unit.decimals === 0;
  const onInput = (event: JSX.TargetedEvent<HTMLInputElement>) => {
    const next = event.currentTarget.value;
    setText(next);
    const parsed = parseNumberText(next, { allowEmpty: nullable, integer: wholeOnly });
    if (!parsed.ok) {
      setLocalError(parsed.error);
      return;
    }
    setLocalError(null);
    const canonical = parsed.value === null ? null : toCanonical(parsed.value, unit, integer);
    if (!jsonEqual(canonical, value)) scope.set(k, canonical as T[K]);
  };
  const onBlur = () => {
    if (localError === null) setText(formatForInput(value, unit));
  };

  const issue = scope.issue(k);
  const error = localError ?? (issue ? issueText(issue, unit) : null);
  return (
    <FieldShell
      label={props.label}
      inputId={id}
      hint={props.hint}
      error={error}
      dirty={scope.dirty(k)}
      path={key}
      class={props.class}
    >
      <div class="input-unit">
        <input
          id={id}
          class="input input--number"
          type="text"
          inputMode={signed ? undefined : wholeOnly ? 'numeric' : 'decimal'}
          autoComplete="off"
          spellcheck={false}
          value={text}
          placeholder={props.placeholder ?? (nullable ? 'Not set' : undefined)}
          disabled={props.disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onInput={onInput}
          onBlur={onBlur}
        />
        {unit.label !== '' && <span class="input-unit__label">{unit.label}</span>}
      </div>
    </FieldShell>
  );
}

export interface SliderFieldProps<T, K extends KeysOfType<T, number>> extends BaseProps<T, K> {
  min: number;
  max: number;
  step: number;
  unit?: UnitSpec;
}

/** A range slider over a canonical value, with its value in display units beside it. */
export function SliderField<T, K extends KeysOfType<T, number>>(props: SliderFieldProps<T, K>) {
  const { scope, k, unit = NO_UNIT } = props;
  const value = scope.value[k] as unknown as number;
  const id = useId();
  const issue = scope.issue(k);
  const error = issue ? issueText(issue, unit) : null;
  const shown = formatForInput(value, unit);
  return (
    <FieldShell
      label={props.label}
      inputId={id}
      hint={props.hint}
      error={error}
      dirty={scope.dirty(k)}
      path={scope.keyOf(k)}
      class={props.class}
    >
      <div class="slider">
        <input
          id={id}
          class="slider__input"
          type="range"
          min={props.min}
          max={props.max}
          step={props.step}
          value={value}
          disabled={props.disabled}
          aria-valuetext={`${shown} ${unit.label}`.trim()}
          onInput={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next) && next !== value) scope.set(k, next as T[K]);
          }}
        />
        <output class="slider__value" for={id}>
          {shown}
          {unit.label === '%' ? '%' : unit.label !== '' ? ` ${unit.label}` : ''}
        </output>
      </div>
    </FieldShell>
  );
}

// ---------------------------------------------------------------------------------------------
// Choices

export interface Option<V> {
  value: V;
  label: string;
  hint?: string;
}

export interface SelectFieldProps<T, K extends keyof T & (string | number)> extends BaseProps<
  T,
  K
> {
  options: ReadonlyArray<Option<T[K]>>;
}

/** Native select (best on phones). Values are matched by index, so any JSON value works. */
export function SelectField<T, K extends keyof T & (string | number)>(
  props: SelectFieldProps<T, K>,
) {
  const { scope, k, options } = props;
  const value = scope.value[k];
  const id = useId();
  const index = options.findIndex((o) => jsonEqual(o.value, value));
  const issue = scope.issue(k);
  return (
    <FieldShell
      label={props.label}
      inputId={id}
      hint={props.hint ?? (index >= 0 ? options[index]?.hint : undefined)}
      error={issue ? issueText(issue) : null}
      dirty={scope.dirty(k)}
      path={scope.keyOf(k)}
      class={props.class}
    >
      <select
        id={id}
        class="input select"
        value={index >= 0 ? String(index) : ''}
        disabled={props.disabled}
        onChange={(event) => {
          const option = options[Number(event.currentTarget.value)];
          if (option) scope.set(k, option.value);
        }}
      >
        {index < 0 && <option value="">{String(value)}</option>}
        {options.map((o, i) => (
          <option key={i} value={String(i)}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/** A row of mutually exclusive buttons (2–4 short options). */
export function SegmentedField<T, K extends keyof T & (string | number)>(
  props: SelectFieldProps<T, K>,
) {
  const { scope, k, options } = props;
  const value = scope.value[k];
  const name = useId();
  const issue = scope.issue(k);
  const current = options.find((o) => jsonEqual(o.value, value));
  return (
    <FieldShell
      label={<span id={`${name}-label`}>{props.label}</span>}
      hint={props.hint ?? current?.hint}
      error={issue ? issueText(issue) : null}
      dirty={scope.dirty(k)}
      path={scope.keyOf(k)}
      class={props.class}
    >
      <Segmented
        name={name}
        labelledBy={`${name}-label`}
        options={options}
        value={value}
        disabled={props.disabled}
        onChange={(v) => scope.set(k, v)}
      />
    </FieldShell>
  );
}

export interface SegmentedProps<V> {
  name: string;
  options: ReadonlyArray<Option<V>>;
  value: V;
  onChange: (value: V) => void;
  labelledBy?: string;
  ariaLabel?: string;
  disabled?: boolean;
  size?: 'normal' | 'small';
}

/** Unbound segmented control (radio group styled as buttons). */
export function Segmented<V>({
  name,
  options,
  value,
  onChange,
  labelledBy,
  ariaLabel,
  disabled,
  size,
}: SegmentedProps<V>) {
  return (
    <div
      class={cx('segmented', size === 'small' && 'segmented--small')}
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={ariaLabel}
    >
      {options.map((o, i) => {
        const checked = jsonEqual(o.value, value);
        return (
          <label key={i} class={cx('segmented__item', checked && 'segmented__item--on')}>
            <input
              type="radio"
              class="visually-hidden"
              name={name}
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(o.value)}
            />
            <span>{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Toggles and text

export function ToggleField<T, K extends KeysOfType<T, boolean>>(props: BaseProps<T, K>) {
  const { scope, k } = props;
  const checked = scope.value[k] as unknown as boolean;
  const id = useId();
  return (
    <FieldShell
      label={props.label}
      inputId={id}
      hint={props.hint}
      dirty={scope.dirty(k)}
      path={scope.keyOf(k)}
      inline
      class={props.class}
    >
      <Switch
        id={id}
        checked={checked}
        disabled={props.disabled}
        onChange={(v) => scope.set(k, v as T[K])}
      />
    </FieldShell>
  );
}

export interface SwitchProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}

/** Unbound on/off switch (a checkbox with switch semantics). */
export function Switch({ id, checked, onChange, disabled, label }: SwitchProps) {
  return (
    <span class="switch">
      <input
        id={id}
        type="checkbox"
        role="switch"
        class="switch__input"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span class="switch__track" aria-hidden="true">
        <span class="switch__thumb" />
      </span>
    </span>
  );
}

export interface TextFieldProps<T, K extends KeysOfType<T, string | null>> extends BaseProps<T, K> {
  /** Store null instead of an empty string (for optional values such as a CAN header). */
  emptyAsNull?: boolean;
  placeholder?: string;
  /** Applied to what is typed before storing (e.g. upper-casing). */
  transform?: (text: string) => string;
  monospace?: boolean;
  autoComplete?: string;
  inputMode?: 'text' | 'url' | 'numeric';
  /** Extra controls after the input (e.g. copy / generate buttons). */
  actions?: ComponentChildren;
  /**
   * Extra client-side check beyond the schema (e.g. compiling a PID formula). A message blocks
   * saving like an unparseable number does. It judges only a value being edited: a stored value
   * the HUD accepted (say, a token set before the check existed) never blocks saving other
   * changes.
   */
  validate?: (value: string) => string | null;
  /** Shown under the field when the value is valid (overrides `hint`). */
  status?: (value: string) => ComponentChildren;
}

export function TextField<T, K extends KeysOfType<T, string | null>>(props: TextFieldProps<T, K>) {
  const { scope, k, transform, validate } = props;
  const stored = scope.value[k] as unknown as string | null;
  const value = stored ?? '';
  const key = scope.keyOf(k);
  const form = useForm();
  const id = useId();
  const localError = validate && scope.dirty(k) ? validate(value) : null;
  useEffect(() => {
    form.setLocalError(key, localError);
  }, [key, localError]);
  useEffect(() => () => form.setLocalError(key, null), [key]);
  const issue = scope.issue(k);
  const error = localError ?? (issue ? issueText(issue) : null);
  return (
    <FieldShell
      label={props.label}
      inputId={id}
      hint={props.status ? props.status(value) : props.hint}
      error={error}
      dirty={scope.dirty(k)}
      path={key}
      class={props.class}
    >
      <div class={cx('input-row', props.actions !== undefined && 'input-row--actions')}>
        <input
          id={id}
          class={cx('input', props.monospace && 'input--mono')}
          type="text"
          value={value}
          placeholder={props.placeholder}
          disabled={props.disabled}
          autoComplete={props.autoComplete ?? 'off'}
          autoCapitalize="off"
          spellcheck={false}
          inputMode={props.inputMode}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onInput={(event) => {
            const raw = event.currentTarget.value;
            const next = transform ? transform(raw) : raw;
            if (next !== raw) event.currentTarget.value = next;
            const nextValue = props.emptyAsNull && next === '' ? null : next;
            if (nextValue !== stored) scope.set(k, nextValue as T[K]);
          }}
        />
        {props.actions}
      </div>
    </FieldShell>
  );
}

/** Fields laid out two per row on wider screens. */
export function FieldGrid({ children }: { children: ComponentChildren }) {
  return <div class="field-grid">{children}</div>;
}

/** A titled group of fields inside a section card. */
export function FieldGroup({
  title,
  description,
  children,
}: {
  title?: string;
  description?: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <div class="field-group">
      {title && <h3 class="field-group__title">{title}</h3>}
      {description && <p class="field-group__description">{description}</p>}
      {children}
    </div>
  );
}
