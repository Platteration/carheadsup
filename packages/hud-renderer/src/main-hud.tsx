import { render } from 'preact';
import { useHudFeed } from './common/useHudFeed.ts';
import { HudView } from './hud/HudView.tsx';
import { readKioskParams, useFixture, useKioskKeyboard, useWakeLock } from './hud/kiosk.ts';
import type { KioskParams } from './hud/kiosk.ts';
import './hud/kiosk.css';

/**
 * Kiosk page for the projected display (`/`). Live mode follows the server's frames and
 * projection; `?fixture=<name>` renders a sample frame without a server; `?preview=1` skips
 * mirroring and keystone. Keys map to driver inputs sent over the socket.
 */
function Kiosk({ fixture, preview }: KioskParams) {
  const live = fixture === null;
  const feed = useHudFeed({ enabled: live });
  const sample = useFixture(fixture);
  useKioskKeyboard(feed.send, live);
  useWakeLock();

  if (!live) {
    return (
      <>
        <HudView frame={sample.frame} preview={preview} />
        {sample.status === 'error' && <div class="hud-kiosk-message">{sample.error}</div>}
      </>
    );
  }
  return <HudView frame={feed.frame} projection={feed.projection} preview={preview} />;
}

const root = document.getElementById('app');
if (root) {
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  render(<Kiosk {...readKioskParams(window.location.search)} />, root);
}
