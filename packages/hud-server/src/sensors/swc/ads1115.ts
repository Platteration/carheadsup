/**
 * Register-level helpers for the TI ADS1115 16-bit ADC (ADS1115 data sheet, SBAS444): the config
 * register layout, the conversion result and its scaling. Pure; the driver lives in `source.ts`.
 *
 * Registers are 16 bits wide and big-endian on the wire (MSB first) — the opposite of SMBus
 * "word" transfers — so the driver writes them as raw bytes after the register pointer and reads
 * them with an I²C block read. The pin-compatible 12-bit ADS1015 has the same registers and
 * left-aligns its results, so the same scaling applies to it.
 */
import type { AdcChannel, Ads1115FullScaleV } from '@carheadsup/core';

export const ADS1115_REGISTERS = {
  CONVERSION: 0x00,
  CONFIG: 0x01,
  LO_THRESH: 0x02,
  HI_THRESH: 0x03,
} as const;

/** Config register value after power-up: single-shot, AIN0−AIN1, ±2.048 V, 128 SPS, comparator off. */
export const ADS1115_RESET_CONFIG = 0x8583;

/** Config bit 15, OS: write 1 to start a single-shot conversion; reads 1 while idle. */
export const CONFIG_OS = 0x8000;
/** Everything but OS reads back as written. */
export const CONFIG_READBACK_MASK = 0x7fff;

/** Samples per second selectable with the DR bits (000 … 111). */
export const ADS1115_DATA_RATES = [8, 16, 32, 64, 128, 250, 475, 860] as const;
export type Ads1115DataRate = (typeof ADS1115_DATA_RATES)[number];

/** PGA bits (11:9) per full-scale range. */
const PGA_BITS: Readonly<Record<Ads1115FullScaleV, number>> = {
  6.144: 0b000,
  4.096: 0b001,
  2.048: 0b010,
  1.024: 0b011,
  0.512: 0b100,
  0.256: 0b101,
};

export interface Ads1115Setup {
  /** Single-ended input AIN0–AIN3 (measured against GND). */
  channel: AdcChannel;
  fullScaleV: Ads1115FullScaleV;
  /** Continuous conversions (true) or one conversion per start (false, then powers down). */
  continuous: boolean;
  dataRate: Ads1115DataRate;
}

/**
 * The config register for a setup: MUX = AINx−GND, PGA, MODE, DR, and the comparator disabled
 * (COMP_QUE = 11), which also leaves the ALERT/RDY pin idle. `start` sets OS to begin a
 * single-shot conversion.
 */
export function ads1115Config(setup: Ads1115Setup, start = false): number {
  const mux = 0b100 | setup.channel;
  const pga = PGA_BITS[setup.fullScaleV];
  const mode = setup.continuous ? 0 : 1;
  const rate = ADS1115_DATA_RATES.indexOf(setup.dataRate);
  const os = start ? 1 : 0;
  return (
    ((os << 15) | (mux << 12) | (pga << 9) | (mode << 8) | (Math.max(0, rate) << 5) | 0b11) >>> 0
  );
}

/** Bytes for an I²C write of `value` to `register`: the pointer, then MSB and LSB. */
export function registerWrite(register: number, value: number): number[] {
  return [register & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** A register value from the two bytes read (MSB first). */
export function registerValue(bytes: ArrayLike<number>): number {
  return (((bytes[0] ?? 0) & 0xff) << 8) | ((bytes[1] ?? 0) & 0xff);
}

/** A conversion register value as the signed 16-bit result it is. */
export function toSigned16(word: number): number {
  const value = word & 0xffff;
  return value >= 0x8000 ? value - 0x10000 : value;
}

/** Volts for a signed conversion result: full scale is ±32768 counts. */
export function conversionToVolts(raw: number, fullScaleV: Ads1115FullScaleV): number {
  return (raw * fullScaleV) / 32768;
}
