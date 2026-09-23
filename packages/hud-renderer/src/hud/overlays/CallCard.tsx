import type { CallFrame, CallState } from '@carheadsup/core';
import { formatTimer } from '../../common/format.ts';
import { Glyph } from '../icons/index.ts';
import { cx, lookup } from '../util.ts';

const STATE_LABEL: Record<CallState, string> = {
  ringing: 'Incoming call',
  dialing: 'Calling',
  active: 'On call',
  held: 'On hold',
  ended: 'Call ended',
};

/**
 * Phone call card: caller, number, timer and the available actions. Accept is a swipe right /
 * primary button (→), decline or hang up a swipe left / secondary button (←).
 */
export function CallCard({ call }: { call: CallFrame }) {
  const showNumber = call.number !== null && call.number.trim() !== '' && call.number !== call.name;
  const timer =
    call.durationS !== null &&
    Number.isFinite(call.durationS) &&
    (call.state === 'active' || call.state === 'held')
      ? formatTimer(call.durationS)
      : null;
  const declineLabel = call.state === 'ringing' ? 'Decline' : 'End';
  return (
    <div class={cx('hud-call', `hud-call--${call.state}`)} data-call={call.state} role="status">
      <div class="hud-call__head">
        <Glyph name="phone" class="hud-call__icon" />
        <span class="hud-call__state">{lookup(STATE_LABEL, call.state, call.state)}</span>
        {timer && <span class="hud-num hud-call__timer">{timer}</span>}
      </div>
      <div class="hud-call__name">{call.name}</div>
      {showNumber && <div class="hud-call__number">{call.number}</div>}
      {(call.canAccept || call.canDecline) && (
        <div class="hud-call__actions">
          {call.canDecline && (
            <span class="hud-call__action hud-call__action--decline">
              <Glyph name="arrow-left" class="hud-call__hint" />
              {declineLabel}
            </span>
          )}
          {call.canAccept && (
            <span class="hud-call__action hud-call__action--accept">
              Accept
              <Glyph name="arrow-right" class="hud-call__hint" />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
