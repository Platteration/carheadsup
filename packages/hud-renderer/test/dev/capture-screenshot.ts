/**
 * Screenshot the dev console (not a test — run it by hand):
 *
 *   node packages/hud-renderer/test/dev/capture-screenshot.ts [options]
 *
 *   --out=<file>        output PNG (default docs/screenshots/dev-console.png)
 *   --tab=gallery|live  which tab (default gallery, which needs no server)
 *   --mock              answer /api/* from the in-memory MockHud (simulator on) and stream a
 *                       sample frame over /ws/hud, to see the live tab populated
 *   --frame=<name>      sample frame to stream with --mock (default city-nav)
 *   --backdrop=<b>      none | night | dusk | day
 *   --panel=<index>     panel size index (0 = 800×480 … 3 = 1920×720)
 *
 * Without --mock there is no HUD server: API calls and the socket fail, which is the offline
 * state. Set `PW_CHROMIUM` to use a specific Chromium binary.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { SAMPLE_FRAMES } from '../../src/hud/fixtures.ts';
import { MockHud } from '../settings/mock-hud.ts';

const rendererRoot = fileURLToPath(new URL('../../', import.meta.url));
const repoRoot = resolve(rendererRoot, '../..');

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const out = resolve(repoRoot, arg('out') ?? 'docs/screenshots/dev-console.png');
  const tab = arg('tab') ?? 'gallery';
  const mock = flag('mock');
  const server = await createServer({
    root: rendererRoot,
    configFile: `${rendererRoot}vite.config.ts`,
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: 0, proxy: {} },
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0];
  if (!base) throw new Error('Vite did not report a local URL');

  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  /** Frame streams; cleared on exit so they cannot keep Node alive. */
  const timers: Array<ReturnType<typeof setInterval>> = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const prefs = { tab, panel: Number(arg('panel') ?? 0), backdrop: arg('backdrop') ?? 'night' };
    await context.addInitScript(
      (value) => localStorage.setItem('carheadsup.dev', value),
      JSON.stringify(prefs),
    );
    const page = await context.newPage();
    page.on('pageerror', (err) => console.error(`page error: ${err.message}`));
    if (mock) {
      const hud = new MockHud({ simulated: true });
      await page.route('**/api/**', async (route) => {
        const request = route.request();
        const raw = request.postData();
        const res = hud.handle(
          request.method(),
          request.url(),
          raw ? (JSON.parse(raw) as unknown) : undefined,
          null,
        );
        await route.fulfill({ status: res.status, contentType: res.contentType, body: res.body });
      });
      const frame = SAMPLE_FRAMES[arg('frame') ?? 'city-nav'] ?? SAMPLE_FRAMES['city-nav'];
      await page.routeWebSocket(/\/ws\/hud$/, (ws) => {
        ws.send(
          JSON.stringify({
            t: 'display',
            simulated: true,
            projection: {
              mirrorX: true,
              mirrorY: false,
              rotation: 0,
              scale: 1,
              offsetX: 0,
              offsetY: 0,
              corners: { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] },
              showGrid: false,
            },
          }),
        );
        const timer = setInterval(
          () => ws.send(JSON.stringify({ t: 'frame', frame: { ...frame, at: Date.now() } })),
          66,
        );
        timers.push(timer);
        ws.onClose(() => clearInterval(timer));
      });
    } else {
      await page.route('**/api/**', (route) => route.abort('connectionrefused'));
    }
    await page.goto(`${base}dev.html#${tab}`);
    await page.waitForSelector(tab === 'gallery' ? '.gallery__grid .hud' : '.preview .hud');
    await page.waitForTimeout(mock ? 2500 : 1500);
    await page.evaluate(() => document.fonts.ready);
    await mkdir(dirname(out), { recursive: true });
    await page.screenshot({ path: out, animations: 'disabled' });
    console.log(`saved ${out}`);
  } finally {
    for (const timer of timers) clearInterval(timer);
    await browser.close();
    await server.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
