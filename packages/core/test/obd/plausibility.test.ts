import { describe, expect, it } from 'vitest';
import { SIGNAL_META, decodeMode01 } from '../../src/obd/pids.ts';
import { SIGNAL_VALID_RANGE, isPlausible } from '../../src/obd/plausibility.ts';
import { SIGNAL_IDS } from '../../src/types/signals.ts';

describe('SIGNAL_VALID_RANGE', () => {
  it('covers every signal and includes its whole gauge range', () => {
    for (const id of SIGNAL_IDS) {
      const [min, max] = SIGNAL_VALID_RANGE[id];
      expect(min, id).toBeLessThan(max);
      expect(min, id).toBeLessThanOrEqual(SIGNAL_META[id].min);
      expect(max, id).toBeGreaterThanOrEqual(SIGNAL_META[id].max);
    }
  });

  it('rejects the all-bits-set fault values of standard PIDs', () => {
    const decoded = (pid: number, ...bytes: number[]) =>
      Object.entries(decodeMode01(pid, Uint8Array.from(bytes)) ?? {}) as Array<
        [keyof typeof SIGNAL_VALID_RANGE, number]
      >;
    for (const [pid, bytes] of [
      [0x05, [0xff]], // coolant 215 °C
      [0x0c, [0xff, 0xff]], // 16 384 rpm
      [0x10, [0xff, 0xff]], // 655 g/s
      [0x5e, [0xff, 0xff]], // 3277 L/h
      [0x42, [0xff, 0xff]], // 65.5 V
      [0x0f, [0xff]], // intake 215 °C
    ] as const) {
      const values = decoded(pid, ...bytes);
      expect(values.length, `PID ${pid}`).toBeGreaterThan(0);
      for (const [signal, value] of values) {
        expect(isPlausible(signal, value), `${signal} ${value}`).toBe(false);
      }
    }
  });

  it('keeps alarming but possible readings', () => {
    expect(isPlausible('coolantTemp', 135)).toBe(true); // overheating: the alert must see it
    expect(isPlausible('batteryVoltage', 17.5)).toBe(true); // failed regulator
    expect(isPlausible('tirePressureFL', 0)).toBe(true); // a flat tyre
    expect(isPlausible('speed', 255)).toBe(true);
    expect(isPlausible('tirePressureFL', -101.3)).toBe(false); // absolute formula on a fault 0
    expect(isPlausible('tirePressureRR', 9999)).toBe(false);
    expect(isPlausible('speed', -1)).toBe(false);
    expect(isPlausible('rpm', Number.NaN)).toBe(false);
  });
});
