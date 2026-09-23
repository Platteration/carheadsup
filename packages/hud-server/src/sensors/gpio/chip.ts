/**
 * Find the GPIO chip behind the Raspberry Pi's 40-pin header: first from `gpiodetect`, then
 * from sysfs (which needs no access to /dev/gpiochip*), falling back to gpiochip0.
 */
import { readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Timers } from '@carheadsup/obd';
import { runCommand, type SpawnFn } from '../process.ts';
import {
  labelForCompatible,
  parseGpiodetect,
  pickHeaderChip,
  type GpioChipInfo,
} from './gpiomon.ts';

/** Read-only filesystem access to sysfs (injectable for tests). */
export interface SysFs {
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
  realpath(path: string): Promise<string>;
}

export const nodeSysFs: SysFs = {
  readdir: (path) => readdir(path),
  readFile: (path) => readFile(path, 'utf8'),
  realpath: (path) => realpath(path),
};

export const SYS_BUS_GPIO_DEVICES = '/sys/bus/gpio/devices';

/**
 * Chips and labels from sysfs: each /sys/bus/gpio/devices/gpiochipN resolves into its
 * controller's device directory, which carries the legacy `gpio/gpiochip<base>/label` and the
 * device-tree `of_node/compatible`.
 */
export async function listChipsFromSysfs(fs: SysFs): Promise<GpioChipInfo[]> {
  let names: string[];
  try {
    names = await fs.readdir(SYS_BUS_GPIO_DEVICES);
  } catch {
    return [];
  }
  const chips: GpioChipInfo[] = [];
  for (const chip of names.filter((n) => /^gpiochip\d+$/.test(n)).sort(byChipNumber)) {
    let controller: string;
    try {
      controller = dirname(await fs.realpath(join(SYS_BUS_GPIO_DEVICES, chip)));
    } catch {
      continue;
    }
    const label = (await legacyLabel(fs, controller)) ?? (await compatibleLabel(fs, controller));
    if (label !== null) chips.push({ chip, label });
  }
  return chips;
}

function byChipNumber(a: string, b: string): number {
  return Number(a.slice(8)) - Number(b.slice(8));
}

async function legacyLabel(fs: SysFs, controller: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(join(controller, 'gpio'));
    for (const entry of entries.filter((e) => e.startsWith('gpiochip'))) {
      const label = (await fs.readFile(join(controller, 'gpio', entry, 'label'))).trim();
      if (label.length > 0) return label;
    }
  } catch {
    // no legacy sysfs interface
  }
  return null;
}

async function compatibleLabel(fs: SysFs, controller: string): Promise<string | null> {
  try {
    return labelForCompatible(await fs.readFile(join(controller, 'of_node', 'compatible')));
  } catch {
    return null;
  }
}

export interface ChipDetection {
  chip: string;
  /** How it was found, for the log. */
  source: 'gpiodetect' | 'sysfs' | 'default';
  label: string | null;
}

export async function detectHeaderChip(deps: {
  spawn: SpawnFn;
  timers: Timers;
  fs: SysFs;
}): Promise<ChipDetection> {
  let chips: GpioChipInfo[] = [];
  try {
    const result = await runCommand(deps.spawn, deps.timers, 'gpiodetect', [], 3000);
    chips = parseGpiodetect(result.stdout);
  } catch {
    // not installed or failed: fall through to sysfs
  }
  let chip = pickHeaderChip(chips);
  if (chip !== null) {
    return { chip, source: 'gpiodetect', label: chips.find((c) => c.chip === chip)?.label ?? null };
  }
  chips = await listChipsFromSysfs(deps.fs);
  chip = pickHeaderChip(chips);
  if (chip !== null) {
    return { chip, source: 'sysfs', label: chips.find((c) => c.chip === chip)?.label ?? null };
  }
  return { chip: 'gpiochip0', source: 'default', label: null };
}
