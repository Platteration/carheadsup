/**
 * B612 — the typeface Airbus designed for cockpit displays (legible at small sizes, distinct
 * 0/O, 1/l/I) — bundled locally: the car has no network, so no web-font CDNs.
 * B612 Mono is used for numerals so changing values keep a constant width.
 */
import '@fontsource/b612/400.css';
import '@fontsource/b612/700.css';
import '@fontsource/b612-mono/400.css';
import '@fontsource/b612-mono/700.css';

export const FONT_SANS = "'B612', system-ui, sans-serif";
export const FONT_MONO = "'B612 Mono', ui-monospace, monospace";
