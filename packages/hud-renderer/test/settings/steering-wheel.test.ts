import { INPUT_ACTIONS, type CanButtonRule, type SwcWindow } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import {
  INPUT_ACTION_LABELS,
  describeCanRule,
  hexDigits,
  newCanRule,
  newSwcWindow,
} from '../../src/settings/model/steering-wheel.ts';

const rule = (overrides: Partial<CanButtonRule> = {}): CanButtonRule => ({
  id: '5C1',
  byte: 0,
  mask: 'FF',
  value: '01',
  action: 'next-page',
  longPressAction: null,
  ...overrides,
});

const win = (minV: number, maxV: number, action: SwcWindow['action']): SwcWindow => ({
  minV,
  maxV,
  action,
  longPressAction: null,
});

describe('steering-wheel settings helpers', () => {
  it('labels every input action', () => {
    for (const action of INPUT_ACTIONS) expect(INPUT_ACTION_LABELS[action]).toBeTruthy();
  });

  it('keeps hex digits only', () => {
    expect(hexDigits(' 5c1 ', 8)).toBe('5C1');
    expect(hexDigits('0x1f', 2)).toBe('01');
    expect(hexDigits('18ff1234ab', 8)).toBe('18FF1234');
  });

  it('describes complete rules and nothing else', () => {
    expect(describeCanRule(rule())).toBe('Held while byte 0 reads 01 in 11-bit frame 5C1');
    expect(describeCanRule(rule({ id: '18ff1234', byte: 12, mask: '30', value: '10' }))).toBe(
      'Held while bits 30 of byte 12 read 10 in 29-bit frame 18FF1234',
    );
    for (const bad of [
      rule({ id: '' }),
      rule({ id: '800' }),
      rule({ mask: '00' }),
      rule({ mask: '0F', value: '10' }),
      rule({ value: '1' }),
    ]) {
      expect(describeCanRule(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('suggests the next button on the same frame, with the next free value and action', () => {
    expect(newCanRule([])).toEqual(rule({ id: '' }));
    expect(newCanRule([rule()])).toEqual(rule({ value: '02', action: 'prev-page' }));
    expect(
      newCanRule([
        rule({ mask: '0C', value: '04' }),
        rule({ mask: '0C', value: '08', action: 'prev-page' }),
      ]),
    ).toEqual(rule({ mask: '0C', value: '0C', action: 'primary' }));
    // Every value of the mask taken: falls back to 00 for the person to fix.
    expect(newCanRule([rule({ mask: '01', value: '01' })])).toMatchObject({ value: '00' });
    // All suggested actions mapped already: starts over.
    const all = INPUT_ACTIONS.map((action, i) => rule({ value: `0${i + 1}`, action }));
    expect(newCanRule(all).action).toBe('next-page');
  });

  it('places a new ladder window above the others, below the idle range', () => {
    const idle = { minV: 3, maxV: 3.6 };
    expect(newSwcWindow([], idle)).toEqual(win(0, 0.3, 'next-page'));
    expect(newSwcWindow([win(0, 0.3, 'next-page'), win(1.2, 1.5, 'primary')], idle)).toEqual(
      win(1.6, 1.9, 'prev-page'),
    );
    // Squeezed under the idle range …
    expect(newSwcWindow([win(2.5, 2.7, 'primary')], idle)).toEqual(win(2.8, 2.95, 'next-page'));
    // … or, without room, just above the last window (validation then flags it).
    expect(newSwcWindow([win(2.5, 2.95, 'primary')], idle)).toEqual(win(3.05, 3.1, 'next-page'));
  });
});
