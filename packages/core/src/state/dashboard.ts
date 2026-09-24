import { diagnosticsPageKinds, pageModulo } from '../compose/diagnostics.ts';
import type { DiagnosticsPageKind } from '../types/frame.ts';
import type { HudState } from '../types/state.ts';

/**
 * `UiState.page` is an index into the dashboard's page list, and that list changes as
 * signals come and go (the engine, fuel and electrical pages exist only with live data). These
 * helpers keep the index pointing at what the driver chose.
 */

function pageKind(state: HudState): DiagnosticsPageKind | undefined {
  const kinds = diagnosticsPageKinds(state);
  return kinds[pageModulo(state.ui.page, kinds.length)];
}

/** The page index `delta` pages away from the current one, wrapping around. */
export function cyclePage(state: HudState, delta: number): number {
  const count = diagnosticsPageKinds(state).length;
  return pageModulo(pageModulo(state.ui.page, count) + delta, count);
}

/**
 * After a transition, keep showing the same kind of page if it still exists (e.g. the driver is
 * on "Trip" when the engine page disappears). A page that vanished is replaced by whichever page
 * now holds its position. The overview is always first, so the common case costs nothing.
 */
export function followPage(prev: HudState, next: HudState): HudState {
  if (prev.ui.page === 0 && next.ui.page === 0) return next;
  const kind = pageKind(prev);
  const kinds = diagnosticsPageKinds(next);
  if (kind === undefined || kinds[pageModulo(next.ui.page, kinds.length)] === kind) return next;
  const index = kinds.indexOf(kind);
  return index < 0 || index === next.ui.page ? next : { ...next, ui: { ...next.ui, page: index } };
}
