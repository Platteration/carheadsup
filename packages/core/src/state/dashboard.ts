import {
  PAIRING_PAGE_TIMEOUT_MS,
  diagnosticsPageKind,
  diagnosticsPageKinds,
  pageModulo,
} from '../compose/diagnostics.ts';
import type { HudState, PairingEndpoint } from '../types/state.ts';

/**
 * `UiState.page` is an index into the dashboard's page list, and that list changes as
 * signals come and go (the engine, fuel and electrical pages exist only with live data), and
 * with the context ("Pair a phone" only while parked). These helpers keep the index pointing at
 * what the driver chose.
 */

/** The page index `delta` pages away from the current one, wrapping around. */
export function cyclePage(state: HudState, delta: number): number {
  const count = diagnosticsPageKinds(state).length;
  return pageModulo(pageModulo(state.ui.page, count) + delta, count);
}

/**
 * After a transition, keep showing the same kind of page if it still exists (e.g. the driver is
 * on "Trip" when the engine page disappears). A page that vanished is replaced by whichever page
 * now holds its position — except "Pair a phone", which gives way to the overview when the car
 * drives off, so that it never comes back by itself at the next stop. The overview is always
 * first, so the common case costs nothing.
 */
export function followPage(prev: HudState, next: HudState): HudState {
  if (prev.ui.page === 0 && next.ui.page === 0) return next;
  const kind = diagnosticsPageKind(prev);
  const kinds = diagnosticsPageKinds(next);
  const current = pageModulo(next.ui.page, kinds.length);
  if (kinds[current] === kind) return next;
  const index = kinds.indexOf(kind);
  const page = index >= 0 ? index : kind === 'pair' ? 0 : next.ui.page;
  return page === next.ui.page ? next : { ...next, ui: { ...next.ui, page } };
}

/**
 * The settings app's "Show pairing code on the HUD": turn the parked dashboard to its "Pair a
 * phone" page (restarting its time-out) and unblank the HUD. Nothing happens unless parked.
 */
export function showPairingPage(state: HudState): HudState {
  if (state.context.context !== 'parked') return state;
  const page = diagnosticsPageKinds(state).indexOf('pair');
  if (page < 0) return state;
  return { ...state, ui: { ...state.ui, page, blanked: false, pairingShownAt: state.now } };
}

/**
 * Keep `UiState.pairingShownAt` with the "Pair a phone" page — stamped when the page comes up,
 * cleared when it goes — and once the page has been up for {@link PAIRING_PAGE_TIMEOUT_MS}, turn
 * the dashboard back to the overview: the page shows the pairing token to anyone who can see the
 * display.
 */
export function trackPairingPage(state: HudState): HudState {
  const { pairingShownAt } = state.ui;
  // The page exists only while parked (see `diagnosticsPageKinds`).
  const onPage = state.context.context === 'parked' && diagnosticsPageKind(state) === 'pair';
  if (!onPage) {
    return pairingShownAt === null
      ? state
      : { ...state, ui: { ...state.ui, pairingShownAt: null } };
  }
  if (pairingShownAt === null) return { ...state, ui: { ...state.ui, pairingShownAt: state.now } };
  if (state.now - pairingShownAt < PAIRING_PAGE_TIMEOUT_MS) return state;
  return { ...state, ui: { ...state.ui, page: 0, pairingShownAt: null } };
}

function sameEndpoint(a: PairingEndpoint | null, b: PairingEndpoint | null): boolean {
  if (a === b) return true;
  return (
    a !== null &&
    b !== null &&
    a.hudId === b.hudId &&
    a.certFingerprint === b.certFingerprint &&
    a.tlsPort === b.tlsPort &&
    a.hosts.length === b.hosts.length &&
    a.hosts.every((host, i) => host === b.hosts[i])
  );
}

/** Where phones reach this HUD (from the server); an unchanged endpoint keeps the state as is. */
export function applyPairingEndpoint(state: HudState, endpoint: PairingEndpoint | null): HudState {
  const next =
    endpoint === null
      ? null
      : {
          hudId: endpoint.hudId,
          certFingerprint: endpoint.certFingerprint,
          tlsPort: endpoint.tlsPort,
          hosts: [...endpoint.hosts],
        };
  return sameEndpoint(state.pairing, next) ? state : { ...state, pairing: next };
}
