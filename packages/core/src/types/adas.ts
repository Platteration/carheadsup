export type CollisionLevel = 'none' | 'caution' | 'warning';

/**
 * Driver-assistance inputs from an optional external module (camera / radar).
 * The HUD only visualises these; detection happens in the module.
 */
export interface AdasState {
  moduleConnected: boolean;
  blindSpotLeft: boolean;
  blindSpotRight: boolean;
  blindSpotUpdatedAt: number | null;
  collision: CollisionLevel;
  /** Time to collision reported by the module, if any. */
  ttcSeconds: number | null;
  collisionUpdatedAt: number | null;
  /**
   * When the module last reported a 'warning'; the warning stays up for
   * `COLLISION_WARNING_HOLD_MS` after it, whatever the module reports meanwhile.
   */
  collisionWarningAt: number | null;
}
