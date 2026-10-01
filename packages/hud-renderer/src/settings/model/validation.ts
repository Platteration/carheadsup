import { hudConfigSchema, pairingTokenTextProblem } from '@carheadsup/core';
import type { HudConfig } from '@carheadsup/core';
import { pathKey, pathWithin } from './diff.ts';
import type { PathKey } from './diff.ts';

/**
 * Instant validation for the settings form. The draft is checked against the same zod schema the
 * HUD uses (`core/src/config/schema.ts`), so the phone flags exactly what the server would reject;
 * the server's own `errors` from a PATCH are parsed into the same shape and shown in place.
 */

/** A numeric limit that was crossed, in canonical units (fields re-phrase it in display units). */
export interface IssueBound {
  kind: 'min' | 'max';
  value: number;
  inclusive: boolean;
}

export interface FieldIssue {
  /** Sentence-case message, used when there is no `bound` (or the field has no unit). */
  message: string;
  bound?: IssueBound;
  source: 'client' | 'server';
}

/** Issues keyed by path in server format (`a.b[2].c`); at most one per path. */
export type IssueMap = ReadonlyMap<string, FieldIssue>;

export const NO_ISSUES: IssueMap = new Map();

type SchemaIssue = NonNullable<
  ReturnType<typeof hudConfigSchema.safeParse>['error']
>['issues'][number];

/**
 * Friendlier wording for the schema's cross-field rules, which are reported on the rule's first
 * field. Keys use `[]` for any array index.
 */
const RULE_MESSAGES: Readonly<Record<string, string>> = {
  'vehicle.idleRpm': 'Idle speed must be below the redline',
  'display.projection.corners.tl': 'The corners must form a convex shape',
  'display.brightness.minLevel': 'Minimum must not be above maximum',
  'display.brightness.nightEnterLux': 'Must be below the “night off” light level',
  'display.context.highwayExitKph': 'Must be below the highway entry speed',
  'display.context.stationaryKph': 'Must be below the highway exit speed',
  'shiftLight.startRpm': 'Must be below the shift point',
  'shiftLight.shiftRpm': 'Must not be above the flash point',
  'alerts.coolantHighC': 'Must be below the critical temperature',
  'alerts.voltageLowRunningV': 'Must be below the over-voltage threshold',
  'alerts.voltageLowOffV': 'Must be below the over-voltage threshold',
  'maintenance.items[].intervalKm': 'Set a distance or a time interval (or both)',
  'sensors.buttons.primary': 'Each button needs its own GPIO line',
  'sensors.canButtons.rules[]': 'Same frame, byte, mask and value as another rule',
  'sensors.canButtons.rules[].id': '3 hex digits (up to 7FF), or 8 for a 29-bit id',
  'sensors.canButtons.rules[].mask': 'A mask of 00 would match every frame',
  'sensors.canButtons.rules[].value': 'Has bits outside the mask, so it could never match',
  'sensors.swcButtons.idle.minV': 'Must be below the upper end',
  'sensors.swcButtons.windows[].minV': 'Must be below the upper end',
};

/** Short wording for format checks on fields that sit in narrow columns. */
const FORMAT_MESSAGES: Readonly<Record<string, string>> = {
  'obd.customPids[].mode': '2 hex digits',
  'obd.customPids[].pid': '2, 4 or 6 hex digits',
  'obd.customPids[].header': '3, 6 or 8 hex digits',
  'sensors.canButtons.rules[].mask': '2 hex digits',
  'sensors.canButtons.rules[].value': '2 hex digits',
};

/** `a.b[3].c` → `a.b[].c`, for looking up per-row messages. */
export function wildcardIndices(path: string): string {
  return path.replace(/\[\d+\]/g, '[]');
}

/** Upper-case the first letter. */
export function sentence(text: string): string {
  const trimmed = text.trim();
  return trimmed === '' ? trimmed : trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function toNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

/** Turn one zod issue into a FieldIssue (exported for tests). */
export function fieldIssueFromSchema(issue: SchemaIssue): FieldIssue {
  const path = pathKey(issue.path.filter((k): k is PathKey => typeof k !== 'symbol'));
  switch (issue.code) {
    case 'too_big': {
      if (issue.origin === 'string') {
        const max = toNumber(issue.maximum);
        return {
          source: 'client',
          message: max === 0 ? 'Must be empty' : `At most ${max} characters`,
        };
      }
      if (issue.origin === 'array' || issue.origin === 'set') {
        return { source: 'client', message: `At most ${toNumber(issue.maximum)} entries` };
      }
      const value = toNumber(issue.maximum);
      const inclusive = issue.inclusive !== false;
      return {
        source: 'client',
        message: `Must be ${inclusive ? 'at most' : 'below'} ${value}`,
        bound: { kind: 'max', value, inclusive },
      };
    }
    case 'too_small': {
      if (issue.origin === 'string') {
        const min = toNumber(issue.minimum);
        return {
          source: 'client',
          message: min <= 1 ? 'Must not be empty' : `At least ${min} characters`,
        };
      }
      if (issue.origin === 'array' || issue.origin === 'set') {
        const min = toNumber(issue.minimum);
        return {
          source: 'client',
          message: min <= 1 ? 'Add at least one entry' : `At least ${min} entries`,
        };
      }
      const value = toNumber(issue.minimum);
      const inclusive = issue.inclusive !== false;
      return {
        source: 'client',
        message: `Must be ${inclusive ? 'at least' : 'above'} ${value}`,
        bound: { kind: 'min', value, inclusive },
      };
    }
    case 'invalid_type':
      if (issue.input === undefined || issue.input === null)
        return { source: 'client', message: 'Required' };
      if (issue.expected === 'int') return { source: 'client', message: 'Must be a whole number' };
      if (issue.expected === 'number') return { source: 'client', message: 'Enter a number' };
      return { source: 'client', message: `Expected ${issue.expected}` };
    case 'invalid_value':
    case 'invalid_union':
      return { source: 'client', message: 'Choose one of the options' };
    case 'custom':
      return {
        source: 'client',
        message: RULE_MESSAGES[wildcardIndices(path)] ?? sentence(issue.message),
      };
    case 'invalid_format':
      return {
        source: 'client',
        message: FORMAT_MESSAGES[wildcardIndices(path)] ?? sentence(issue.message),
      };
    default:
      return { source: 'client', message: sentence(issue.message) };
  }
}

/**
 * Why `token` should not be used as an API or pairing token, or null when it is fine: the
 * pairing-token rule (`pairingTokenProblem` in core — the HUD's schema, the pairing QR code and
 * the companion app's field take exactly these), one word of printable ASCII. The API token
 * travels in `Authorization: Bearer …` headers (browsers and the companion's HTTP client send
 * only printable ASCII there) and in `?token=` URLs, so a non-ASCII token would lock out every
 * device, including the one that set it — the HUD refuses those. Spaces would work there but are
 * easily lost when a token is copied or typed on a phone, so new API tokens are one word too.
 */
export function tokenProblem(token: string): string | null {
  const problem = pairingTokenTextProblem(token);
  return problem === null ? null : sentence(problem);
}

/** Input transform for token fields: pasted tokens often carry a stray space or line break. */
export function trimToken(text: string): string {
  return text.trim();
}

/**
 * Validate a whole draft; the first problem per path wins. A pairing token the HUD keeps from its
 * config file although it breaks today's rule (see `parseStoredConfig`) is no problem while it
 * is left as it is (`base`: the config the HUD has): phones paired with it still connect, and the
 * phone section says so instead of blocking every save.
 */
export function validateConfig(draft: HudConfig, base?: HudConfig | null): IssueMap {
  // reportInput: zod leaves the offending value out of issues by default; the messages need it.
  const result = hudConfigSchema.safeParse(draft, { reportInput: true });
  if (result.success) return NO_ISSUES;
  const map = new Map<string, FieldIssue>();
  for (const issue of result.error.issues) {
    const key = pathKey(issue.path.filter((k): k is PathKey => typeof k !== 'symbol'));
    if (!map.has(key)) map.set(key, fieldIssueFromSchema(issue));
  }
  if (base && draft.phone.pairingToken === base.phone.pairingToken) {
    map.delete('phone.pairingToken');
  }
  return map;
}

const SERVER_BOUND = /^expected number (<=|<|>=|>) (-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i;

/** One server message ("expected number <= 1", "minLevel must not exceed …") as a FieldIssue. */
export function fieldIssueFromServer(message: string): FieldIssue {
  const match = SERVER_BOUND.exec(message.trim());
  if (match) {
    const [, op = '<=', raw = '0'] = match;
    const value = Number(raw);
    const kind = op.startsWith('<') ? 'max' : 'min';
    const inclusive = op.endsWith('=');
    const words =
      kind === 'max' ? (inclusive ? 'at most' : 'below') : inclusive ? 'at least' : 'above';
    return {
      source: 'server',
      message: `Must be ${words} ${value}`,
      bound: { kind, value, inclusive },
    };
  }
  return { source: 'server', message: sentence(message) };
}

/**
 * Split the server's `errors` ("dotted.path: message") into per-field issues and general
 * messages (lines without a usable path, e.g. "(root): expected object").
 */
export function parseServerErrors(errors: readonly string[]): {
  byPath: Map<string, FieldIssue>;
  general: string[];
} {
  const byPath = new Map<string, FieldIssue>();
  const general: string[] = [];
  for (const line of errors) {
    const sep = line.indexOf(': ');
    const path = sep > 0 ? line.slice(0, sep).trim() : '';
    const message = sep > 0 ? line.slice(sep + 2) : line;
    if (path === '' || path === '(root)' || /\s/.test(path)) {
      general.push(sentence(line));
    } else if (!byPath.has(path)) {
      byPath.set(path, fieldIssueFromServer(message));
    }
  }
  return { byPath, general };
}

/** Issues at `prefix` or anywhere below it, in path order. */
export function issuesWithin(map: IssueMap, prefix: string): Array<[string, FieldIssue]> {
  return [...map.entries()].filter(([path]) => pathWithin(path, prefix));
}

/** Server issues that no longer apply once `path` was edited: the path itself, its parents and children. */
export function dropIssuesTouching(map: IssueMap, path: string): Map<string, FieldIssue> {
  const next = new Map<string, FieldIssue>();
  for (const [key, issue] of map) {
    if (!pathWithin(key, path) && !pathWithin(path, key)) next.set(key, issue);
  }
  return next;
}
