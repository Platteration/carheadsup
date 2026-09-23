import { Component } from 'preact';
import type { ComponentChildren } from 'preact';

export interface GuardProps {
  /**
   * The input the children are drawn from (normally the frame, or the piece of it they show). An
   * error hides the children only while this stays the same: the next frame draws them again.
   */
  resetKey: unknown;
  /** Drawn instead of the children while they fail (default: nothing). */
  fallback?: ComponentChildren;
  /** What is guarded, for the console message. */
  name: string;
  children?: ComponentChildren;
}

interface GuardState {
  /** The `resetKey` the children failed to render, or {@link NONE}. */
  failedFor: unknown;
}

const NONE: unique symbol = Symbol('none');

/**
 * Error boundary for one piece of the HUD. Frames may come from a newer (or buggy) server, and an
 * exception that escapes a render leaves Preact with the component marked dirty, so every later
 * update is ignored and the last image stays on the glass — frozen values shown as live. A guard
 * instead hides just the piece that failed, for just that frame.
 */
export class Guard extends Component<GuardProps, GuardState> {
  override state: GuardState = { failedFor: NONE };
  private reported = false;

  override componentDidCatch(error: unknown): void {
    if (!this.reported) {
      // Once per guard: a malformed widget would otherwise log at the frame rate.
      this.reported = true;
      console.error(`HUD: could not draw the ${this.props.name}; hidden until it can be`, error);
    }
    this.setState({ failedFor: this.props.resetKey });
  }

  override render() {
    const { failedFor } = this.state;
    if (failedFor !== NONE && failedFor === this.props.resetKey) return this.props.fallback ?? null;
    return this.props.children;
  }
}
