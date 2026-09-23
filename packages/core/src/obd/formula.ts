import { notImplemented } from '../todo.ts';

/**
 * Compile a Torque-style formula for custom PIDs, e.g. "((A*256)+B)/10 - 40".
 * Variables A–Z map to data bytes 0–25; supports + − * / % ( ), unary minus, decimals,
 * and the functions min, max, abs, round, floor, ceil. Anything else is a compile error
 * (no eval). The compiled function returns NaN if it references a missing byte.
 */
export function compileFormula(expression: string): (data: Uint8Array) => number {
  return notImplemented(`compileFormula(${expression})`);
}
