import { describe, expect, it } from 'vitest';
import {
  ADS1115_ADDRESSES,
  ADS1115_FULL_SCALES,
  MAX_CAN_BUTTON_RULES,
  MAX_SWC_WINDOWS,
  canRuleKey,
  formatCanId,
  formatVoltageRange,
  parseCanId,
  parseHexByte,
  rangesOverlap,
  valueFitsMask,
} from '../../src/config/buttons.ts';
import {
  DEFAULT_CONFIG,
  hudConfigSchema,
  mergeConfig,
  parseConfig,
} from '../../src/config/config.ts';
import type {
  CanButtonRule,
  CanButtonsConfig,
  DeepPartial,
  HudConfig,
  SwcButtonsConfig,
  SwcWindow,
} from '../../src/types/config.ts';

const rule = (overrides: Partial<CanButtonRule> = {}): CanButtonRule => ({
  id: '5C1',
  byte: 0,
  mask: 'FF',
  value: '01',
  action: 'next-page',
  longPressAction: null,
  ...overrides,
});

const window = (minV: number, maxV: number, overrides: Partial<SwcWindow> = {}): SwcWindow => ({
  minV,
  maxV,
  action: 'primary',
  longPressAction: null,
  ...overrides,
});

const can = (patch: Partial<CanButtonsConfig>) => parseConfig({ sensors: { canButtons: patch } });
const swc = (patch: DeepPartial<SwcButtonsConfig>) =>
  parseConfig({ sensors: { swcButtons: patch } });

describe('CAN id helpers', () => {
  it('parses 3-digit ids as 11-bit and 8-digit ids as 29-bit, as candump prints them', () => {
    expect(parseCanId('5C1')).toEqual({ id: 0x5c1, extended: false });
    expect(parseCanId(' 7ff ')).toEqual({ id: 0x7ff, extended: false });
    expect(parseCanId('000')).toEqual({ id: 0, extended: false });
    expect(parseCanId('18FF1234')).toEqual({ id: 0x18ff1234, extended: true });
    // The same number in the other format is a different frame.
    expect(parseCanId('000005C1')).toEqual({ id: 0x5c1, extended: true });
    expect(parseCanId('1FFFFFFF')).toEqual({ id: 0x1fffffff, extended: true });
  });

  it('rejects ids out of range and other lengths', () => {
    for (const text of ['800', 'FFF', '20000000', 'FFFFFFFF', '5C', '5C12', '5C1234', 'x5C', '']) {
      expect(parseCanId(text), text).toBeNull();
    }
  });

  it('formats ids back the way candump prints them', () => {
    expect(formatCanId({ id: 0x5c1, extended: false })).toBe('5C1');
    expect(formatCanId({ id: 0x21, extended: false })).toBe('021');
    expect(formatCanId({ id: 0x5c1, extended: true })).toBe('000005C1');
  });

  it('parses 2-digit hex bytes and checks values against masks', () => {
    expect(parseHexByte('0f')).toBe(15);
    expect(parseHexByte('FF')).toBe(255);
    expect(parseHexByte('F')).toBeNull();
    expect(parseHexByte('100')).toBeNull();
    expect(parseHexByte('G0')).toBeNull();
    expect(valueFitsMask(0x01, 0x0f)).toBe(true);
    expect(valueFitsMask(0x00, 0x30)).toBe(true);
    expect(valueFitsMask(0x11, 0x0f)).toBe(false);
  });

  it('keys rules by condition, ignoring case and the actions', () => {
    expect(canRuleKey(rule({ id: '5c1', mask: 'ff' }))).toBe('5C1 byte 0 & FF = 01');
    expect(canRuleKey(rule({ action: 'primary' }))).toBe(canRuleKey(rule()));
    expect(canRuleKey(rule({ byte: 1 }))).not.toBe(canRuleKey(rule()));
  });
});

describe('voltage ranges', () => {
  it('overlap when they share any voltage, including a common end', () => {
    expect(rangesOverlap({ minV: 1, maxV: 1.5 }, { minV: 1.4, maxV: 2 })).toBe(true);
    expect(rangesOverlap({ minV: 1, maxV: 1.5 }, { minV: 1.5, maxV: 2 })).toBe(true);
    expect(rangesOverlap({ minV: 1, maxV: 3 }, { minV: 1.5, maxV: 2 })).toBe(true);
    expect(rangesOverlap({ minV: 1, maxV: 1.5 }, { minV: 1.51, maxV: 2 })).toBe(false);
    expect(formatVoltageRange({ minV: 0.25, maxV: 0.6 })).toBe('0.25–0.6 V');
  });
});

describe('sensors.canButtons', () => {
  it('is off by default', () => {
    expect(DEFAULT_CONFIG.sensors.canButtons).toEqual({
      interface: null,
      releaseTimeoutMs: 500,
      rules: [],
    });
  });

  it('accepts standard and extended ids, CAN FD byte indices and long-press actions', () => {
    const rules = [
      rule(),
      rule({ id: '5c1', byte: 1, mask: '0f', value: '0a', action: 'primary' }),
      rule({ id: '18FF1234', byte: 63, mask: '30', value: '10', longPressAction: 'toggle-blank' }),
    ];
    const { config, errors } = can({ interface: 'can0', releaseTimeoutMs: null, rules });
    expect(errors).toEqual([]);
    expect(config.sensors.canButtons).toEqual({ interface: 'can0', releaseTimeoutMs: null, rules });
  });

  it.each<[Partial<CanButtonsConfig>, string]>([
    [
      { interface: '' },
      'sensors.canButtons.interface: expected a network interface name such as "can0"',
    ],
    [
      { interface: '-can0' },
      'sensors.canButtons.interface: expected a network interface name such as "can0"',
    ],
    [
      { interface: 'can0,123:7FF' },
      'sensors.canButtons.interface: expected a network interface name such as "can0"',
    ],
    [
      { interface: 'a'.repeat(16) },
      'sensors.canButtons.interface: expected a network interface name such as "can0"',
    ],
    [{ releaseTimeoutMs: 10 }, 'sensors.canButtons.releaseTimeoutMs: expected number >= 50'],
    [{ releaseTimeoutMs: 20_000 }, 'sensors.canButtons.releaseTimeoutMs: expected number <= 10000'],
    [
      { rules: [rule({ id: '800' })] },
      'sensors.canButtons.rules[0].id: expected 3 hex digits for an 11-bit id (up to 7FF) or 8 for a 29-bit id (up to 1FFFFFFF)',
    ],
    [
      { rules: [rule({ id: '20000000' })] },
      'sensors.canButtons.rules[0].id: expected 3 hex digits for an 11-bit id (up to 7FF) or 8 for a 29-bit id (up to 1FFFFFFF)',
    ],
    [{ rules: [rule({ byte: 64 })] }, 'sensors.canButtons.rules[0].byte: expected number <= 63'],
    [{ rules: [rule({ byte: -1 })] }, 'sensors.canButtons.rules[0].byte: expected number >= 0'],
    [
      { rules: [rule({ mask: '00' })] },
      'sensors.canButtons.rules[0].mask: a mask of 00 would match every frame',
    ],
    [
      { rules: [rule({ mask: 'F' })] },
      'sensors.canButtons.rules[0].mask: expected 2 hex digits such as "0F"',
    ],
    [
      { rules: [rule({ value: '0x1' })] },
      'sensors.canButtons.rules[0].value: expected 2 hex digits such as "01"',
    ],
    [
      { rules: [rule({ mask: '0F', value: '11' })] },
      'sensors.canButtons.rules[0].value: value 11 sets bits outside mask 0F, so the rule could never match',
    ],
    [
      { rules: [rule({ action: 'volume-up' as never })] },
      'sensors.canButtons.rules[0].action: expected one of "primary", "secondary", "next-page", "prev-page", "toggle-blank", "brightness-up", "brightness-down"',
    ],
    [
      { rules: [rule({ longPressAction: 'mute' as never })] },
      'sensors.canButtons.rules[0].longPressAction: expected one of "primary", "secondary", "next-page", "prev-page", "toggle-blank", "brightness-up", "brightness-down"',
    ],
    [
      { rules: [rule(), rule({ id: '5c1', mask: 'ff', action: 'primary' })] },
      'sensors.canButtons.rules[1]: duplicate rule "5C1 byte 0 & FF = 01"',
    ],
    [
      { rules: Array.from({ length: MAX_CAN_BUTTON_RULES + 1 }, (_, i) => rule({ byte: i })) },
      'sensors.canButtons.rules: expected at most 32 items',
    ],
  ])('rejects %j', (patch, error) => {
    const { config, errors } = can(patch);
    expect(errors).toEqual([error]);
    // Only the bad field falls back; a bad rule list is replaced as a whole.
    expect(config.sensors.canButtons).toEqual(DEFAULT_CONFIG.sensors.canButtons);
  });

  it('keeps the current rules when a patch breaks one of them', () => {
    const base = mergeConfig(DEFAULT_CONFIG, {
      sensors: { canButtons: { interface: 'can0', rules: [rule()] } },
    }).config;
    const { config, errors } = mergeConfig(base, {
      sensors: { canButtons: { interface: 'can1', rules: [rule(), rule({ mask: '00' })] } },
    });
    expect(errors).toEqual([
      'sensors.canButtons.rules[1].mask: a mask of 00 would match every frame',
    ]);
    expect(config.sensors.canButtons).toEqual({
      interface: 'can1',
      releaseTimeoutMs: 500,
      rules: [rule()],
    });
  });

  it('turns off with a null interface', () => {
    const on = mergeConfig(DEFAULT_CONFIG, { sensors: { canButtons: { interface: 'can0' } } });
    const off = mergeConfig(on.config, { sensors: { canButtons: { interface: null } } });
    expect(off.errors).toEqual([]);
    expect(off.config.sensors.canButtons.interface).toBeNull();
  });
});

describe('sensors.swcButtons', () => {
  const ladder = [
    window(0.1, 0.4, { action: 'next-page' }),
    window(0.8, 1.2, { action: 'prev-page' }),
    window(1.6, 2.1, { action: 'primary', longPressAction: 'toggle-blank' }),
  ];

  it('is off by default, expecting an idle ladder pulled up to 3.3 V', () => {
    expect(DEFAULT_CONFIG.sensors.swcButtons).toEqual({
      enabled: false,
      address: 0x48,
      channel: 0,
      fullScaleV: 4.096,
      idle: { minV: 3, maxV: 3.6 },
      windows: [],
    });
  });

  it('accepts every address, channel and range the ADS1115 offers', () => {
    for (const address of ADS1115_ADDRESSES) {
      expect(swc({ address }).errors).toEqual([]);
    }
    for (const channel of [0, 1, 2, 3] as const) expect(swc({ channel }).errors).toEqual([]);
    for (const fullScaleV of ADS1115_FULL_SCALES) {
      const idle = { minV: fullScaleV / 2, maxV: fullScaleV };
      expect(swc({ fullScaleV, idle }).errors).toEqual([]);
    }
  });

  it('accepts non-overlapping windows below the idle range', () => {
    const { config, errors } = swc({ enabled: true, windows: ladder });
    expect(errors).toEqual([]);
    expect(config.sensors.swcButtons.windows).toEqual(ladder);
    expect(hudConfigSchema.safeParse(config).success).toBe(true);
  });

  it.each<[DeepPartial<SwcButtonsConfig>, string]>([
    [
      { address: 0x40 as never },
      'sensors.swcButtons.address: expected an ADS1115 address: 0x48–0x4B (72–75)',
    ],
    [{ channel: 4 as never }, 'sensors.swcButtons.channel: expected one of 0, 1, 2, 3'],
    [
      { fullScaleV: 5 as never },
      'sensors.swcButtons.fullScaleV: expected one of 6.144, 4.096, 2.048, 1.024, 0.512, 0.256',
    ],
    [{ enabled: 'yes' as never }, 'sensors.swcButtons.enabled: expected boolean, got string'],
    [
      { idle: { minV: 3.6, maxV: 3 } },
      'sensors.swcButtons.idle.minV: minV must be below maxV (3.6 >= 3)',
    ],
    [{ idle: { minV: -0.1 } }, 'sensors.swcButtons.idle.minV: expected number >= 0'],
    [{ idle: { maxV: 7 } }, 'sensors.swcButtons.idle.maxV: expected number <= 6.144'],
    [
      { windows: [window(1.2, 0.8)] },
      'sensors.swcButtons.windows[0].minV: minV must be below maxV (1.2 >= 0.8)',
    ],
    [
      { windows: [window(0.8, 1.2), window(0.1, 0.4), window(1.2, 1.5)] },
      'sensors.swcButtons.windows[2]: overlaps window 1 (0.8–1.2 V)',
    ],
    [
      { windows: [window(0.1, 0.4, { action: 'eject' as never })] },
      'sensors.swcButtons.windows[0].action: expected one of "primary", "secondary", "next-page", "prev-page", "toggle-blank", "brightness-up", "brightness-down"',
    ],
    [
      { windows: [window(0.1, 0.4), window(2.9, 3.1)] },
      'sensors.swcButtons.windows: window 2 (2.9–3.1 V) overlaps the idle range (3–3.6 V)',
    ],
    [
      { windows: [window(4, 4.5)], idle: { minV: 3, maxV: 3.6 } },
      'sensors.swcButtons.windows: window 1 (4–4.5 V) must lie within the ±4.096 V input range',
    ],
    [
      {
        windows: Array.from({ length: MAX_SWC_WINDOWS + 1 }, (_, i) =>
          window(i * 0.1, i * 0.1 + 0.05),
        ),
      },
      'sensors.swcButtons.windows: expected at most 16 items',
    ],
  ])('rejects %j', (patch, error) => {
    const { config, errors } = swc(patch);
    expect(errors).toEqual([error]);
    expect(config.sensors.swcButtons).toEqual(DEFAULT_CONFIG.sensors.swcButtons);
  });

  it('reverts a narrower input range that would cut off the idle range or a window', () => {
    const base = mergeConfig(DEFAULT_CONFIG, {
      sensors: { swcButtons: { enabled: true, windows: ladder } },
    }).config;
    const narrowed = mergeConfig(base, { sensors: { swcButtons: { fullScaleV: 2.048 } } });
    expect(narrowed.errors).toEqual([
      'sensors.swcButtons.fullScaleV: the idle range (3–3.6 V) must lie within the ±2.048 V input range',
    ]);
    expect(narrowed.config.sensors.swcButtons.fullScaleV).toBe(4.096);

    // Moving the idle range down as well: the top window now sticks out of the range and
    // overlaps the new idle range, so both changes are reverted and named.
    const lowered = mergeConfig(base, {
      sensors: { swcButtons: { fullScaleV: 2.048, idle: { minV: 1.95, maxV: 2.048 } } },
    });
    expect(lowered.errors).toEqual([
      'sensors.swcButtons.fullScaleV: window 3 (1.6–2.1 V) must lie within the ±2.048 V input range',
      'sensors.swcButtons.idle: window 3 (1.6–2.1 V) overlaps the idle range (1.95–2.048 V)',
    ]);
    expect(lowered.config.sensors.swcButtons).toEqual(base.sensors.swcButtons);
  });

  it('reverts a window added over the idle range, keeping the rest of the patch', () => {
    const base = mergeConfig(DEFAULT_CONFIG, {
      sensors: { swcButtons: { enabled: true, windows: ladder } },
    }).config;
    const { config, errors } = mergeConfig(base, {
      sensors: { swcButtons: { channel: 1, windows: [...ladder, window(3.2, 3.3)] } },
    });
    expect(errors).toEqual([
      'sensors.swcButtons.windows: window 4 (3.2–3.3 V) overlaps the idle range (3–3.6 V)',
    ]);
    expect(config.sensors.swcButtons).toMatchObject({ channel: 1, windows: ladder });
  });

  it('the strict schema reports the same problems', () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as HudConfig;
    config.sensors.swcButtons.windows = [window(0.1, 0.4), window(0.3, 0.6)];
    config.sensors.canButtons.rules = [rule({ mask: '0F', value: 'F0' })];
    const result = hudConfigSchema.safeParse(config);
    expect(result.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      [
        'sensors.canButtons.rules.0.value',
        'value F0 sets bits outside mask 0F, so the rule could never match',
      ],
      ['sensors.swcButtons.windows.1', 'overlaps window 1 (0.1–0.4 V)'],
    ]);
  });
});
