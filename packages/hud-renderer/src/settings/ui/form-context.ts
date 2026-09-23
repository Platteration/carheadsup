import type { UnitsConfig } from '@carheadsup/core';
import { DEFAULT_CONFIG } from '@carheadsup/core';
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { driverUnits } from '../model/units.ts';
import type { DriverUnits } from '../model/units.ts';

/** What form fields need from the editor besides their scope. */
export interface FormContextValue {
  /** Report (or clear with null) text in an input that does not parse. */
  setLocalError(key: string, message: string | null): void;
  /** Changes when edits are discarded or reloaded; inputs then re-sync their text. */
  revision: number;
  /** The draft's unit preferences, for unit-aware fields. */
  units: UnitsConfig;
  driverUnits: DriverUnits;
}

export const FormContext = createContext<FormContextValue>({
  setLocalError: () => undefined,
  revision: 0,
  units: DEFAULT_CONFIG.units,
  driverUnits: driverUnits(DEFAULT_CONFIG.units),
});

export function useForm(): FormContextValue {
  return useContext(FormContext);
}
