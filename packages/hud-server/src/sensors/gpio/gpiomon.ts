/**
 * Pure helpers for libgpiod's command-line tools, whose syntax differs between major versions:
 *
 *  v1 (≤ 1.6, Raspberry Pi OS Bullseye/Bookworm):
 *    gpiomon [--bias=pull-up] [--line-buffered] [--format=FMT] <chip> <offset>…
 *    `%e` prints 1 for a rising and 0 for a falling edge. stdout is block-buffered on a pipe
 *    unless --line-buffered is given (added in 1.5, together with --bias).
 *  v2 (Debian Trixie and later):
 *    gpiomon --chip <chip> [--bias=pull-up] [--format=FMT] <offset>…
 *    `%e` prints 1 rising / 2 falling, `%E` "rising"/"falling"; output is flushed per event.
 *
 * `gpiodetect` prints one chip per line in both versions: "gpiochip0 [pinctrl-bcm2711] (58 lines)".
 */

export type EdgeKind = 'rising' | 'falling';

export interface GpioEdge {
  offset: number;
  edge: EdgeKind;
}

export interface GpiomonFeatures {
  /** libgpiod major version (1 or 2). */
  major: 1 | 2;
  /** Full version string, e.g. "1.6.3", for logs. */
  version: string;
  bias: boolean;
  lineBuffered: boolean;
  format: boolean;
}

/** Parse `gpiomon --version` ("gpiomon (libgpiod) v1.6.3"). Null when unrecognisable. */
export function parseGpiomonVersion(text: string): { major: number; version: string } | null {
  const match = /\bv?(\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
  if (match === null) return null;
  const version = [match[1], match[2], match[3]].filter((p) => p !== undefined).join('.');
  return { major: Number(match[1]), version };
}

/**
 * Features of the installed gpiomon from its `--version` and `--help` output. When the help
 * text is unavailable, assumes what current releases of that major version support.
 */
export function detectGpiomonFeatures(
  versionText: string,
  helpText: string | null,
): GpiomonFeatures {
  const parsed = parseGpiomonVersion(versionText);
  const help = helpText ?? '';
  const looksV2 = /--chip\b/.test(help) || /<line>/.test(help);
  const major: 1 | 2 = parsed !== null ? (parsed.major >= 2 ? 2 : 1) : looksV2 ? 2 : 1;
  if (helpText === null || help.trim().length === 0) {
    return {
      major,
      version: parsed?.version ?? 'unknown',
      bias: true,
      lineBuffered: major === 1,
      format: true,
    };
  }
  return {
    major,
    version: parsed?.version ?? 'unknown',
    bias: /--bias\b/.test(help),
    lineBuffered: major === 1 && /--line-buffered\b/.test(help),
    format: /--format\b/.test(help),
  };
}

/** Output format we ask for: "<offset> <edge>" — numeric edge on v1, the word on v2. */
export function gpiomonFormat(major: 1 | 2): string {
  return major === 1 ? '%o %e' : '%o %E';
}

export interface GpiomonArgsOptions {
  features: GpiomonFeatures;
  chip: string;
  offsets: readonly number[];
  /** Request the internal pull-up (buttons switch to ground). */
  pullUp: boolean;
}

/** Arguments for monitoring `offsets` on `chip` (both edges; no active-low inversion). */
export function buildGpiomonArgs(options: GpiomonArgsOptions): string[] {
  const { features, chip, offsets, pullUp } = options;
  const lines = offsets.map((o) => String(o));
  const bias = pullUp && features.bias ? ['--bias=pull-up'] : [];
  const format = features.format ? [`--format=${gpiomonFormat(features.major)}`] : [];
  if (features.major === 1) {
    const buffered = features.lineBuffered ? ['--line-buffered'] : [];
    return [...bias, ...buffered, ...format, chip, ...lines];
  }
  return [`--chip=${chip}`, '--consumer=carheadsup', ...bias, ...format, ...lines];
}

/**
 * Parse one line of gpiomon output: our custom format ("17 0", "17 1", "17 2", "17 rising") or
 * either version's default format ("event:  RISING EDGE offset: 17 timestamp: […]",
 * "1675271826.573214584\tfalling\tgpiochip0 17"). Null for anything else.
 */
export function parseGpiomonLine(line: string): GpioEdge | null {
  const text = line.trim();
  const custom = /^(\d+)\s+(0|1|2|rising|falling)$/i.exec(text);
  if (custom !== null) {
    const token = (custom[2] ?? '').toLowerCase();
    const edge: EdgeKind = token === '1' || token === 'rising' ? 'rising' : 'falling';
    return { offset: Number(custom[1]), edge };
  }
  const v1 = /\b(RISING|FALLING)\s+EDGE\b.*?\boffset:\s*(\d+)/i.exec(text);
  if (v1 !== null) {
    return { offset: Number(v1[2]), edge: (v1[1] ?? '').toLowerCase() as EdgeKind };
  }
  const v2 = /^\d+(?:\.\d+)?\s+(rising|falling)\s+\S+\s+(\d+)$/i.exec(text);
  if (v2 !== null) {
    return { offset: Number(v2[2]), edge: (v2[1] ?? '').toLowerCase() as EdgeKind };
  }
  return null;
}

export interface GpioChipInfo {
  chip: string;
  label: string;
}

/** Parse `gpiodetect` output. */
export function parseGpiodetect(text: string): GpioChipInfo[] {
  const chips: GpioChipInfo[] = [];
  for (const line of text.split('\n')) {
    const match = /^\s*(gpiochip\d+)\s+\[([^\]]*)\]/.exec(line);
    if (match !== null) chips.push({ chip: match[1] ?? '', label: match[2] ?? '' });
  }
  return chips;
}

/**
 * Labels of the chip that drives the 40-pin header, by preference: RP1 on the Pi 5 (gpiochip4
 * on early kernels, gpiochip0 on recent ones), BCM2711 on the Pi 4/400/CM4, BCM2835 on older
 * Pis and the Zero family.
 */
export const HEADER_CHIP_LABELS: readonly string[] = [
  'pinctrl-rp1',
  'pinctrl-bcm2711',
  'pinctrl-bcm2835',
];

/** The chip behind the 40-pin header, or null when none of the known labels is present. */
export function pickHeaderChip(chips: readonly GpioChipInfo[]): string | null {
  for (const label of HEADER_CHIP_LABELS) {
    const found = chips.find((c) => c.label === label);
    if (found !== undefined) return found.chip;
  }
  return null;
}

/** Map a device-tree `compatible` string of a GPIO controller onto its pinctrl label. */
export function labelForCompatible(compatible: string): string | null {
  const entries = compatible.split('\0').map((s) => s.trim());
  if (entries.includes('raspberrypi,rp1-gpio')) return 'pinctrl-rp1';
  if (entries.includes('brcm,bcm2711-gpio')) return 'pinctrl-bcm2711';
  if (entries.includes('brcm,bcm2835-gpio')) return 'pinctrl-bcm2835';
  return null;
}

/**
 * Explain a gpiomon failure from its stderr, for the log. Returns 'no-bias' when the tool (or
 * kernel) rejected the bias option, so the caller can retry without it.
 */
export function classifyGpiomonError(stderr: readonly string[]): {
  kind: 'no-bias' | 'busy' | 'permission' | 'other';
  hint: string | null;
} {
  const text = stderr.join('\n');
  if (/unrecognized option|invalid option|unknown option/i.test(text) && /bias|-B\b/i.test(text)) {
    return { kind: 'no-bias', hint: null };
  }
  if (/bias/i.test(text) && /(not supported|invalid argument)/i.test(text)) {
    return { kind: 'no-bias', hint: null };
  }
  if (/busy/i.test(text)) {
    return {
      kind: 'busy',
      hint: 'the GPIO line is in use by another program or a device-tree overlay (e.g. gpio-key)',
    };
  }
  if (/permission denied/i.test(text)) {
    return {
      kind: 'permission',
      hint: 'add the HUD user to the "gpio" group so it can open /dev/gpiochip*',
    };
  }
  return { kind: 'other', hint: null };
}
