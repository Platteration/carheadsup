import { Component } from 'preact';
import type { ComponentChildren } from 'preact';
import { NoSignal } from './overlays/Status.tsx';

/**
 * How long the kiosk shows "no signal" after an unexpected error before reloading itself, and
 * between checks while the server does not answer.
 */
export const KIOSK_RELOAD_MS = 3000;

/**
 * Whether the HUD server answers (so a reload will load the HUD): a HEAD request for the page,
 * 2xx or 3xx. Default of {@link KioskBoundaryProps.serverAnswers}.
 */
export async function pageAnswers(): Promise<boolean> {
  try {
    const response = await fetch(window.location.pathname || '/', {
      method: 'HEAD',
      cache: 'no-store',
      redirect: 'manual',
    });
    return response.type === 'opaqueredirect' || (response.status >= 200 && response.status < 400);
  } catch {
    return false;
  }
}

export interface KioskBoundaryProps {
  children?: ComponentChildren;
  /** Default `location.reload()`. */
  reload?: () => void;
  /**
   * Checked before reloading: a reload while the server is down would put the browser's own
   * error page on the windshield. Default {@link pageAnswers}.
   */
  serverAnswers?: () => Promise<boolean>;
  reloadAfterMs?: number;
}

interface KioskBoundaryState {
  failed: boolean;
}

/**
 * Last line of defence around the whole kiosk page. The HUD view guards each piece it draws, so
 * this only catches bugs outside it (hooks, the feed): the page goes dark apart from the
 * "no signal" dot — never a frozen image — and reloads itself to start over, as soon as the
 * server answers (it stays dark and checks again every {@link KIOSK_RELOAD_MS} until then).
 */
export class KioskBoundary extends Component<KioskBoundaryProps, KioskBoundaryState> {
  override state: KioskBoundaryState = { failed: false };
  private timer: ReturnType<typeof setTimeout> | null = null;

  static override getDerivedStateFromError(): KioskBoundaryState {
    return { failed: true };
  }

  private unmounted = false;

  override componentDidCatch(error: unknown): void {
    console.error('HUD: the kiosk page failed; reloading', error);
    if (this.timer === null) this.scheduleReload();
  }

  override componentWillUnmount(): void {
    this.unmounted = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Reload after the delay if the server answers then; otherwise wait and check again. */
  private scheduleReload(): void {
    this.timer = setTimeout(() => {
      const check = this.props.serverAnswers ?? pageAnswers;
      void check()
        .catch(() => false)
        .then((answers) => {
          if (this.unmounted) return;
          if (!answers) {
            this.scheduleReload();
            return;
          }
          this.timer = null;
          (this.props.reload ?? (() => window.location.reload()))();
        });
    }, this.props.reloadAfterMs ?? KIOSK_RELOAD_MS);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    // Plain markup, not HudView: whatever failed must not be needed to draw this.
    return (
      <div class="hud" data-kiosk-failed="true">
        <div class="hud-stage">
          <div class="hud-content" data-mode="no-signal">
            <NoSignal />
          </div>
        </div>
      </div>
    );
  }
}
