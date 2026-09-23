/**
 * Text-level handling of ELM327 responses: everything the adapter printed before its `>`
 * prompt is split into lines, stripped of noise (echo, blank lines, "SEARCHING...",
 * "BUS INIT: ...OK", NUL bytes some clones emit) and classified. Adapter status messages
 * become typed {@link ElmError}s; "NO DATA" becomes an empty result.
 */
import { ElmError, type ElmErrorCode } from './errors.ts';

/** Split raw adapter text into trimmed, non-empty lines. */
export function splitLines(raw: string): string[] {
  return raw
    .replace(/\0/g, '')
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const normalizeCommand = (text: string): string => text.replace(/\s+/g, '').toUpperCase();

const SEARCHING_RE = /^SEARCHING\.*\s*/i;
const BUS_INIT_OK_RE = /^BUS INIT:?\s*\.*\s*OK\s*/i;

/**
 * Lines of a response with the command echo, "SEARCHING..." and "BUS INIT: ...OK" removed.
 * Echo lines are dropped wherever they appear at the start (clones sometimes keep echoing
 * after `ATE0`); progress messages may be followed by data on the same line.
 */
export function cleanResponse(raw: string, command: string): string[] {
  const echo = normalizeCommand(command);
  const lines = splitLines(raw);
  const out: string[] = [];
  for (const line of lines) {
    if (out.length === 0 && echo.length > 0 && normalizeCommand(line) === echo) continue;
    const stripped = line.replace(SEARCHING_RE, '').replace(BUS_INIT_OK_RE, '').trim();
    if (stripped.length > 0) out.push(stripped);
  }
  return out;
}

interface LinePattern {
  re: RegExp;
  code: ElmErrorCode;
  message: string;
}

/** Adapter status messages, checked against upper-cased lines. */
const ERROR_PATTERNS: readonly LinePattern[] = [
  { re: /^\?$/, code: 'UNSUPPORTED', message: 'The adapter did not understand the command' },
  {
    re: /UNABLE TO CONNECT/,
    code: 'UNABLE_TO_CONNECT',
    message: 'The adapter could not connect to the vehicle (ignition off?)',
  },
  {
    re: /BUS INIT:.*ERR/,
    code: 'BUS_INIT_ERROR',
    message: 'Bus initialisation failed (ignition off?)',
  },
  { re: /^CAN ERROR/, code: 'CAN_ERROR', message: 'CAN bus error' },
  { re: /^BUS ERROR/, code: 'BUS_ERROR', message: 'Bus error (check the wiring)' },
  { re: /^BUS BUSY/, code: 'BUS_BUSY', message: 'Bus busy' },
  { re: /^FB ERROR/, code: 'FB_ERROR', message: 'J1850 feedback error' },
  { re: /^BUFFER FULL/, code: 'BUFFER_FULL', message: 'Adapter buffer full' },
  { re: /^STOPPED/, code: 'STOPPED', message: 'Request interrupted' },
  { re: /(^|<)DATA ERROR/, code: 'DATA_ERROR', message: 'Corrupt response (data error)' },
  { re: /(^|<)RX ERROR/, code: 'RX_ERROR', message: 'CAN receive error' },
  { re: /^ACT ALERT/, code: 'ACT_ALERT', message: 'Adapter activity alert' },
  { re: /^LP ALERT/, code: 'LP_ALERT', message: 'Adapter low-power alert' },
  { re: /^LV RESET/, code: 'LV_RESET', message: 'Adapter reset after a voltage dip' },
  { re: /^ERR\d{2}$/, code: 'INTERNAL_ERROR', message: 'Internal adapter error' },
];

const NO_DATA_RE = /^NO DATA$/;
const BANNER_RE = /^ELM327/;
/** Commands whose answer is (or may contain) the identification banner: reset, ATI, ST… */
const IDENTIFYING_RE = /^(ATZ|ATWS|ATI|AT@\d|ST)/;

export type CommandKind = 'at' | 'obd';

/**
 * Classify cleaned response lines. Returns the data lines ([] for "NO DATA") or throws an
 * {@link ElmError} for adapter error messages. An identification banner in the response to
 * anything but a reset or identification command means the adapter reset mid-command (all
 * settings lost) → ADAPTER_RESET.
 */
export function classifyResponse(
  lines: readonly string[],
  command: string,
  kind: CommandKind,
): string[] {
  const data: string[] = [];
  let sawNoData = false;
  const bannerMeansReset = kind === 'obd' || !IDENTIFYING_RE.test(normalizeCommand(command));
  for (const line of lines) {
    const upper = line.toUpperCase();
    for (const pattern of ERROR_PATTERNS) {
      if (pattern.re.test(upper)) {
        throw new ElmError(pattern.code, `${pattern.message} [${command}: ${line}]`, {
          command,
          response: lines,
        });
      }
    }
    if (NO_DATA_RE.test(upper)) {
      sawNoData = true;
      continue;
    }
    if (bannerMeansReset && BANNER_RE.test(upper)) {
      throw new ElmError('ADAPTER_RESET', `The adapter reset during ${command} (${line})`, {
        command,
        response: lines,
      });
    }
    data.push(line);
  }
  // Some clones print NO DATA next to partial output; data from any ECU wins.
  return data.length === 0 && sawNoData ? [] : data;
}

/** Parse an `AT RV` answer such as "12.6V" or "12.60 V". Returns null when implausible. */
export function parseVoltage(lines: readonly string[]): number | null {
  for (const line of lines) {
    const match = /^(\d{1,2}(?:\.\d+)?)\s*V?$/i.exec(line.trim());
    if (!match?.[1]) continue;
    const volts = Number(match[1]);
    if (Number.isFinite(volts) && volts >= 0 && volts <= 40) return volts;
  }
  return null;
}
