import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePairingUri } from '@carheadsup/core';
import type { PairingFrame } from '@carheadsup/core';
import decodeQR from '@paulmillr/qr/decode.js';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { PairingPage, QrCode, closesInText } from '../../src/hud/diagnostics/Pairing.tsx';
import { QR_QUIET_ZONE, qrModules, qrPath } from '../../src/hud/diagnostics/qr.ts';
import { PAIRING_URI_SAMPLE, SAMPLE_FRAMES } from '../../src/hud/fixtures.ts';
import { renderHud, textOf } from './render.ts';

/** The modules an SVG path from `qrPath` paints, as a size × size grid. */
function paintedModules(path: string, size: number): boolean[][] {
  const grid = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  for (const m of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
    const [x, y, w, back] = [m[1], m[2], m[3], m[4]].map(Number) as [
      number,
      number,
      number,
      number,
    ];
    expect(back).toBe(w);
    for (let i = 0; i < w; i++) {
      const row = grid[y];
      if (row === undefined || row[x + i] === undefined) throw new Error('outside the code');
      expect(row[x + i]).toBe(false); // no module painted twice
      row[x + i] = true;
    }
  }
  return grid;
}

/** The code as the panel shows it: light square, dark modules, `scale` pixels per module (RGBA). */
function rasterize(modules: boolean[][], scale: number) {
  const size = (modules.length + 2 * QR_QUIET_ZONE) * scale;
  const data = new Uint8Array(size * size * 4).fill(255);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = Math.floor(px / scale) - QR_QUIET_ZONE;
      const y = Math.floor(py / scale) - QR_QUIET_ZONE;
      if (modules[y]?.[x] === true) {
        const i = (py * size + px) * 4;
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
      }
    }
  }
  return { width: size, height: size, data };
}

const READY: PairingFrame = {
  status: 'ready',
  hudName: 'Golf HUD',
  uri: PAIRING_URI_SAMPLE,
  fingerprint: 'FDC1 53EE DCA2 B536 4DD7',
  closesInS: 161,
};

describe('the pairing QR code', () => {
  it('encodes a typical pairing URI with large modules', () => {
    const modules = qrModules(PAIRING_URI_SAMPLE);
    // Version 10 at 15 % error correction: 57 × 57 modules.
    expect(modules?.length).toBe(57);
    expect(modules?.every((row) => row.length === 57)).toBe(true);
  });

  it('paints exactly the dark modules, inside the quiet zone', () => {
    const modules = qrModules(PAIRING_URI_SAMPLE) ?? [];
    const size = modules.length + 2 * QR_QUIET_ZONE;
    const painted = paintedModules(qrPath(modules), size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const inner = modules[y - QR_QUIET_ZONE]?.[x - QR_QUIET_ZONE] === true;
        expect(painted[y]?.[x]).toBe(inner);
      }
    }
  });

  it('decodes back to the pairing URI', () => {
    const modules = qrModules(PAIRING_URI_SAMPLE) ?? [];
    const decoded = decodeQR(rasterize(modules, 4));
    expect(decoded).toBe(PAIRING_URI_SAMPLE);
    expect(parsePairingUri(decoded).ok).toBe(true);
  });

  it('is the code the companion app’s decoder is tested with', () => {
    // companion-android/protocol decodes this file with ZXing (QrDecoderTest), plain and as the
    // mirror image the panel shows: the HUD's encoder and the phone's decoder agree.
    const resource = fileURLToPath(
      new URL(
        '../../../../companion-android/protocol/src/test/resources/pairing/hud-qr.txt',
        import.meta.url,
      ),
    );
    const modules = qrModules(PAIRING_URI_SAMPLE) ?? [];
    const drawn = modules.map((row) => row.map((dark) => (dark ? '#' : '.')).join(''));
    expect(readFileSync(resource, 'utf8')).toBe([PAIRING_URI_SAMPLE, ...drawn].join('\n') + '\n');
  });

  it('refuses nothing it can draw, and says so when a text does not fit', () => {
    expect(qrModules('')).toBeNull();
    expect(qrModules('x'.repeat(5000))).toBeNull();
    const html = renderToString(h(QrCode, { text: 'x'.repeat(5000) }));
    expect(textOf(html)).toBe('Code too long to draw');
  });

  it('is drawn as one light square and one path, scaled by its view box', () => {
    const html = renderToString(h(QrCode, { text: PAIRING_URI_SAMPLE }));
    expect(html).toContain('viewBox="0 0 65 65"');
    expect(html.match(/<rect/g)).toHaveLength(1);
    expect(html.match(/<path/g)).toHaveLength(1);
    // No inline styles: the kiosk's Content Security Policy allows none.
    expect(html).not.toContain('style=');
  });
});

describe('PairingPage', () => {
  it('shows the code with the HUD’s name, the fingerprint and the time left', () => {
    const html = renderToString(h(PairingPage, { pairing: READY }));
    expect(textOf(html)).toBe(
      'Golf HUD Scan with the carheadsup app In the app: Setup → Scan HUD QR code ' +
        'Certificate FDC1 53EE DCA2 B536 4DD7 Closes in 2:41',
    );
    expect(html).toContain('aria-label="Pairing QR code"');
  });

  it('explains an open HUD instead of showing a code', () => {
    const html = renderToString(
      h(PairingPage, { pairing: { ...READY, status: 'open', uri: null } }),
    );
    expect(textOf(html)).toContain('No pairing code set');
    expect(textOf(html)).toContain('Phone → Pairing code → Generate');
    expect(html).not.toContain('<svg');
  });

  it('treats a code without its URI, or a status it does not know, as unavailable', () => {
    for (const pairing of [
      { ...READY, uri: null },
      { ...READY, status: 'later' as PairingFrame['status'] },
      { ...READY, status: 'unavailable' as const, uri: null, fingerprint: null },
    ]) {
      const html = renderToString(h(PairingPage, { pairing }));
      expect(html).toContain('data-status="unavailable"');
      expect(textOf(html)).toContain('Pairing unavailable');
      expect(html).not.toContain('<svg');
    }
  });

  it('formats the time-out', () => {
    expect(closesInText(180)).toBe('3:00');
    expect(closesInText(161)).toBe('2:41');
    expect(closesInText(0.2)).toBe('0:01');
    expect(closesInText(-5)).toBe('0:00');
    expect(closesInText(Number.NaN)).toBe('0:00');
  });

  it('is a page of the parked dashboard like any other', () => {
    const html = renderHud(SAMPLE_FRAMES['parked-pairing'] ?? null);
    expect(html).toContain('data-page="pair"');
    expect(html).toContain('aria-label="Page 8 of 8"');
    expect(textOf(html)).toContain('Pair a phone');
  });
});
