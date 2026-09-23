import type { Clock } from '@carheadsup/obd';

/**
 * Token-bucket rate limiter: holds up to `burst` tokens, refilled at `perSecond`; each message
 * costs one. A clock step backwards refills nothing (and never drains the bucket).
 */
export class TokenBucket {
  private readonly perMs: number;
  private readonly burst: number;
  private readonly now: Clock;
  private tokens: number;
  private last: number;

  constructor(perSecond: number, burst: number, now: Clock) {
    this.perMs = Math.max(0, perSecond) / 1000;
    this.burst = Math.max(1, burst);
    this.now = now;
    this.tokens = this.burst;
    this.last = now();
  }

  /** Take one token; false (nothing taken) when the bucket is empty. */
  take(): boolean {
    const t = this.now();
    const elapsed = t - this.last;
    if (Number.isFinite(elapsed) && elapsed > 0) {
      this.tokens = Math.min(this.burst, this.tokens + elapsed * this.perMs);
    }
    // After a backwards step, refilling resumes from the new time rather than stalling.
    if (Number.isFinite(t)) this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
