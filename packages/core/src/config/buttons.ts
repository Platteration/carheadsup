import type {
  AdcChannel,
  Ads1115Address,
  Ads1115FullScaleV,
  CanButtonRule,
  VoltageRange,
} from '../types/config.ts';

/**
 * Pure helpers for the steering-wheel button settings (`sensors.canButtons`,
 * `sensors.swcButtons`), shared by the config schema, the server's input sources and the
 * settings app.
 */

/** Largest 11-bit (standard) CAN identifier. */
export const CAN_MAX_STANDARD_ID = 0x7ff;
/** Largest 29-bit (extended) CAN identifier. */
export const CAN_MAX_EXTENDED_ID = 0x1fffffff;
/** Highest data byte index a rule may test (CAN FD frames carry up to 64 bytes). */
export const CAN_MAX_BYTE_INDEX = 63;
/** Most rules `sensors.canButtons.rules` may hold. */
export const MAX_CAN_BUTTON_RULES = 32;
/** Most windows `sensors.swcButtons.windows` may hold. */
export const MAX_SWC_WINDOWS = 16;

/** A CAN identifier and its format. */
export interface CanId {
  id: number;
  /** 29-bit extended identifier (otherwise 11-bit standard). */
  extended: boolean;
}

/**
 * Parse a CAN identifier written the way `candump` prints it: 3 hex digits for an 11-bit id
 * (up to 7FF), 8 hex digits for a 29-bit id (up to 1FFFFFFF). Surrounding spaces and either
 * case are fine. Null for anything else, including ids out of range.
 */
export function parseCanId(text: string): CanId | null {
  const hex = text.trim();
  if (/^[0-9A-Fa-f]{3}$/.test(hex)) {
    const id = Number.parseInt(hex, 16);
    return id <= CAN_MAX_STANDARD_ID ? { id, extended: false } : null;
  }
  if (/^[0-9A-Fa-f]{8}$/.test(hex)) {
    const id = Number.parseInt(hex, 16);
    return id <= CAN_MAX_EXTENDED_ID ? { id, extended: true } : null;
  }
  return null;
}

/** A CAN identifier as `candump` prints it: upper-case, 3 or 8 digits. */
export function formatCanId(canId: CanId): string {
  return canId.id
    .toString(16)
    .toUpperCase()
    .padStart(canId.extended ? 8 : 3, '0');
}

/** A byte written as exactly 2 hex digits ("0F", "a0"), or null. */
export function parseHexByte(text: string): number | null {
  return /^[0-9A-Fa-f]{2}$/.test(text) ? Number.parseInt(text, 16) : null;
}

/** Whether `value` sets no bit outside `mask` (else a rule could never match). */
export function valueFitsMask(value: number, mask: number): boolean {
  return (value & ~mask & 0xff) === 0;
}

/**
 * What identifies a rule's condition — frame, byte, mask and value, case-insensitively — for
 * spotting duplicates, e.g. "5C1 byte 0 & 0F = 01".
 */
export function canRuleKey(rule: Pick<CanButtonRule, 'id' | 'byte' | 'mask' | 'value'>): string {
  const parsed = parseCanId(rule.id);
  const id = parsed === null ? rule.id.trim().toUpperCase() : formatCanId(parsed);
  return `${id} byte ${rule.byte} & ${rule.mask.toUpperCase()} = ${rule.value.toUpperCase()}`;
}

/** Whether two closed voltage ranges share any voltage (touching ends count). */
export function rangesOverlap(a: VoltageRange, b: VoltageRange): boolean {
  return a.minV <= b.maxV && b.minV <= a.maxV;
}

/** A voltage range for messages, e.g. "1.2–1.5 V". */
export function formatVoltageRange(range: VoltageRange): string {
  return `${range.minV}–${range.maxV} V`;
}

/** ADS1115 full-scale ranges, widest first (gain 2/3, 1, 2, 4, 8, 16). */
export const ADS1115_FULL_SCALES = [
  6.144, 4.096, 2.048, 1.024, 0.512, 0.256,
] as const satisfies readonly Ads1115FullScaleV[];

/** ADS1115 I²C addresses with the ADDR pin tied to GND, VDD, SDA and SCL respectively. */
export const ADS1115_ADDRESSES = [
  0x48, 0x49, 0x4a, 0x4b,
] as const satisfies readonly Ads1115Address[];

/** The ADS1115's single-ended inputs. */
export const ADC_CHANNELS = [0, 1, 2, 3] as const satisfies readonly AdcChannel[];
