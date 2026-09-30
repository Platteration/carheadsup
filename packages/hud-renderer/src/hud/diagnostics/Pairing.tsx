import type { PairingFrame, PairingPageStatus } from '@carheadsup/core';
import { useMemo } from 'preact/hooks';
import { cx, lookup } from '../util.ts';
import { QR_QUIET_ZONE, qrModules, qrPath } from './qr.ts';

/**
 * The parked dashboard's "Pair a phone" page: the pairing URI as a QR code for the companion
 * app to scan, with the HUD's name and its certificate's fingerprint. The QR code is the one
 * large light area the HUD ever draws — only here, and the page exists only while parked.
 */

/** "2:41" for the page's time-out. */
export function closesInText(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The QR code on its light square, scaled to the room it gets. */
export function QrCode({ text }: { text: string }) {
  const modules = useMemo(() => qrModules(text), [text]);
  if (modules === null) {
    return <div class="hud-pair__qr hud-pair__qr--failed">Code too long to draw</div>;
  }
  const size = modules.length + 2 * QR_QUIET_ZONE;
  return (
    <svg
      class="hud-pair__qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Pairing QR code"
      data-modules={modules.length}
    >
      <rect class="hud-pair__qr-light" width={size} height={size} />
      <path class="hud-pair__qr-dark" d={qrPath(modules)} />
    </svg>
  );
}

const HEADLINE: Readonly<Record<PairingPageStatus, string>> = {
  ready: 'Scan with the carheadsup app',
  open: 'No pairing code set',
  unavailable: 'Pairing unavailable',
};

function Advice({ status }: { status: PairingPageStatus }) {
  switch (status) {
    case 'ready':
      return <>In the app: Setup → Scan HUD QR code</>;
    case 'open':
      return (
        <>
          Any phone on the car’s Wi-Fi can connect. Set one in the settings app (Phone → Pairing
          code → Generate, then Save) and open this page again.
        </>
      );
    default:
      return (
        <>The HUD’s phone link (TLS) is not running, or the HUD has no address a phone can reach.</>
      );
  }
}

export function PairingPage({ pairing }: { pairing: PairingFrame }) {
  // A status this renderer does not know (a newer server), or a code without its URI, shows as
  // unavailable rather than as a broken page.
  const known = lookup(HEADLINE, pairing.status, null) !== null;
  const uri = known && pairing.status === 'ready' ? pairing.uri : null;
  const status: PairingPageStatus =
    !known || (pairing.status === 'ready' && !uri) ? 'unavailable' : pairing.status;
  return (
    <div class={cx('hud-pair', `hud-pair--${status}`)} data-status={status}>
      {uri && <QrCode text={uri} />}
      <div class="hud-pair__text">
        <div class="hud-pair__name">{pairing.hudName}</div>
        <div class={cx('hud-pair__lead', status !== 'ready' && 'hud-tone--caution')}>
          {HEADLINE[status]}
        </div>
        <div class="hud-pair__advice">
          <Advice status={status} />
        </div>
        {pairing.fingerprint !== null && (
          <div class="hud-pair__fingerprint">
            <span class="hud-pair__label">Certificate</span>
            <span class="hud-pair__fp">{pairing.fingerprint}</span>
          </div>
        )}
        <div class="hud-pair__closes">Closes in {closesInText(pairing.closesInS)}</div>
      </div>
    </div>
  );
}
