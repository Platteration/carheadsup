import type { ButtonHTMLAttributes, ComponentChildren, Ref } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { useFocusTrap } from '../../common/focus-trap.ts';
import { cx } from '../../hud/util.ts';

/** Presentational building blocks shared by the settings sections. */

export type Tone = 'neutral' | 'info' | 'ok' | 'caution' | 'warning' | 'critical';

export interface SectionProps {
  id: string;
  title: string;
  intro?: ComponentChildren;
  /** Right side of the heading (badges, live status). */
  aside?: ComponentChildren;
  sectionRef?: Ref<HTMLElement>;
  children: ComponentChildren;
}

export function Section({ id, title, intro, aside, sectionRef, children }: SectionProps) {
  return (
    <section
      id={id}
      class="section"
      aria-labelledby={`${id}-title`}
      ref={sectionRef}
      data-section={id}
    >
      <header class="section__head">
        <h2 class="section__title" id={`${id}-title`}>
          {title}
        </h2>
        {aside && <div class="section__aside">{aside}</div>}
      </header>
      {intro && <p class="section__intro">{intro}</p>}
      <div class="section__body">{children}</div>
    </section>
  );
}

export function Card({ children, class: extra }: { children: ComponentChildren; class?: string }) {
  return <div class={cx('card', extra)}>{children}</div>;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'normal' | 'small';
  busy?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'normal',
  busy,
  class: extra,
  children,
  disabled,
  type,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      class={cx(
        'btn',
        `btn--${variant}`,
        size === 'small' && 'btn--small',
        busy && 'btn--busy',
        extra as string | undefined,
      )}
      disabled={disabled || busy}
      aria-busy={busy ? true : undefined}
      {...rest}
    >
      {busy && <span class="spinner spinner--inline" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Badge({
  tone = 'neutral',
  children,
  title,
}: {
  tone?: Tone;
  children: ComponentChildren;
  title?: string;
}) {
  return (
    <span class={cx('badge', `badge--${tone}`)} title={title}>
      {children}
    </span>
  );
}

export function StatusDot({ tone, label }: { tone: Tone; label?: string }) {
  return (
    <span class={cx('dot', `dot--${tone}`)} role={label ? 'img' : undefined} aria-label={label} />
  );
}

export interface NoticeProps {
  tone?: Tone;
  title?: ComponentChildren;
  children?: ComponentChildren;
  actions?: ComponentChildren;
  role?: 'status' | 'alert';
}

/** An inline message box (errors, confirmations, explanations). */
export function Notice({ tone = 'info', title, children, actions, role }: NoticeProps) {
  return (
    <div
      class={cx('notice', `notice--${tone}`)}
      role={role ?? (tone === 'critical' || tone === 'warning' ? 'alert' : 'status')}
    >
      <div class="notice__body">
        {title && <p class="notice__title">{title}</p>}
        {children && <div class="notice__text">{children}</div>}
      </div>
      {actions && <div class="notice__actions">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div class="loading" role="status">
      <span class="spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

/** Placeholder card while the HUD's config has not loaded. */
export function Placeholder({ children }: { children: ComponentChildren }) {
  return <div class="placeholder">{children}</div>;
}

/** A key/value line in read-only summaries. */
export function Stat({
  label,
  children,
  tone,
}: {
  label: string;
  children: ComponentChildren;
  tone?: Tone;
}) {
  return (
    <div class={cx('stat', tone && `stat--${tone}`)}>
      <dt class="stat__label">{label}</dt>
      <dd class="stat__value">{children}</dd>
    </div>
  );
}

export interface DialogProps {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  actions: ComponentChildren;
}

/**
 * Modal dialog (not the native `<dialog>`, whose support in Android WebViews varies): keeps
 * keyboard focus inside while open (see `useFocusTrap`), returns it afterwards, and closes on
 * Escape and on a backdrop tap.
 */
export function Dialog({ title, onClose, children, actions }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div
      class="dialog-backdrop"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        ref={panel}
      >
        <h2 class="dialog__title" id="dialog-title">
          {title}
        </h2>
        <div class="dialog__body">{children}</div>
        <div class="dialog__actions">{actions}</div>
      </div>
    </div>
  );
}
