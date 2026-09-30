import encodeQR from '@paulmillr/qr';

/**
 * QR codes for the "Pair a phone" page, drawn as SVG: dark modules on a light square with the
 * quiet zone the QR standard asks for, so phone cameras find the code on the panel (and in its
 * mirror image on the windshield).
 */

/** Light modules around the code: the QR standard's quiet zone (4 modules). */
export const QR_QUIET_ZONE = 4;

/**
 * Error correction for the pairing code: 'medium' (15 %) keeps a typical pairing URI at
 * version 10 (57 × 57 modules) — large modules on a small panel — and still survives a glare
 * spot or a fingerprint on the display.
 */
export const QR_ECC = 'medium';

/** The code's modules (rows of true = dark), without a quiet zone; null when `text` does not fit. */
export function qrModules(text: string): boolean[][] | null {
  if (text === '') return null;
  try {
    return encodeQR(text, 'raw', { ecc: QR_ECC, border: 0 });
  } catch {
    return null;
  }
}

/**
 * One SVG path for all dark modules, each horizontal run of them as one rectangle, shifted by
 * `offset` modules (the quiet zone).
 */
export function qrPath(modules: readonly (readonly boolean[])[], offset = QR_QUIET_ZONE): string {
  const parts: string[] = [];
  modules.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row[end]) end += 1;
      parts.push(`M${x + offset} ${y + offset}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  });
  return parts.join('');
}
