import { render } from 'preact';
import { adoptTokenFromUrl, localStorageTokenStore } from './common/api.ts';
import { useHudFeed } from './common/useHudFeed.ts';
import { HudView } from './hud/HudView.tsx';
import { KioskBoundary } from './hud/KioskBoundary.tsx';
import { readKioskParams, useFixture, useKioskKeyboard, useWakeLock } from './hud/kiosk.ts';
import type { KioskParams } from './hud/kiosk.ts';
import './hud/kiosk.css';

/**
 * Kiosk page for the projected display (`/`). Live mode follows the server's frames and
 * projection, and leaves dimming to the backlight when the server drives one;
 * `?fixture=<name>` renders a sample frame without a server; `?preview=1` skips mirroring and
 * keystone (and dims by itself). Keys map to driver inputs sent over the socket.
 *
 * The HUD's own browser is the HUD itself to the server (over loopback, or at the one network
 * address the server listens on) and needs no token. Opened from another device
 * once `server.apiToken` is set, the page uses the token stored on that device (by the settings
 * app, or `?token=` on this page).
 */
function Kiosk({ fixture, preview, token }: KioskParams & { token: string }) {
  const live = fixture === null;
  const feed = useHudFeed({ enabled: live, token });
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
  // The backlight dims only this device's panel: a preview (e.g. on a laptop) keeps dimming.
  return (
    <HudView
      frame={feed.frame}
      projection={feed.projection}
      preview={preview}
      hardwareBrightness={feed.hardwareBrightness && !preview}
    />
  );
}

const root = document.getElementById('app');
if (root) {
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  const tokens = localStorageTokenStore();
  adoptTokenFromUrl(tokens);
  render(
    <KioskBoundary>
      <Kiosk {...readKioskParams(window.location.search)} token={tokens.get()} />
    </KioskBoundary>,
    root,
  );
}
