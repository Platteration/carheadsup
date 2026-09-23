import type { CollisionLevel } from '@carheadsup/core';

/** Glow bars on the screen edges while a vehicle is in the corresponding blind spot. */
export function BlindSpot({ left, right }: { left: boolean; right: boolean }) {
  return (
    <>
      {left && (
        <div
          class="hud-blindspot hud-blindspot--left"
          data-blindspot="left"
          aria-label="Vehicle in left blind spot"
        />
      )}
      {right && (
        <div
          class="hud-blindspot hud-blindspot--right"
          data-blindspot="right"
          aria-label="Vehicle in right blind spot"
        />
      )}
    </>
  );
}

function Chevrons() {
  return (
    <svg viewBox="0 0 60 40" class="hud-collision__chevrons" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={`M8 ${34 - i * 12}L30 ${22 - i * 12}L52 ${34 - i * 12}`}
          fill="none"
          stroke="currentColor"
          stroke-width="6"
          stroke-linecap="round"
          stroke-linejoin="round"
          opacity={1 - i * 0.25}
        />
      ))}
    </svg>
  );
}

/**
 * Forward-collision cue for the top-centre stack: amber chevrons for a caution, flashing red
 * chevrons with "BRAKE" for a warning. Renders nothing when there is no threat.
 */
export function CollisionCue({ level }: { level: CollisionLevel }) {
  if (level === 'caution') {
    return (
      <div
        class="hud-collision hud-collision--caution hud-tone--caution"
        data-collision="caution"
        role="alert"
      >
        <Chevrons />
      </div>
    );
  }
  if (level === 'warning') {
    return (
      <div
        class="hud-collision hud-collision--warning hud-tone--critical hud-flash-fast"
        data-collision="warning"
        role="alert"
      >
        <Chevrons />
        <span class="hud-collision__text">BRAKE</span>
      </div>
    );
  }
  return null;
}

/** Red flashing frame around the whole image during a collision warning. */
export function CollisionBorder() {
  return <div class="hud-collision-border hud-flash-fast" aria-hidden="true" />;
}
