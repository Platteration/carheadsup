import type { FuelEconomyUnit, HudConfig, UnitsConfig } from '@carheadsup/core';
import type { Scope } from '../model/scope.ts';
import { Button, Card, Section } from '../ui/common.tsx';
import { FieldGrid, SegmentedField, SelectField, TextField } from '../ui/fields.tsx';
import type { Option } from '../ui/fields.tsx';

const ECONOMY: ReadonlyArray<Option<FuelEconomyUnit>> = [
  { value: 'L/100km', label: 'L/100 km' },
  { value: 'km/L', label: 'km/L' },
  { value: 'mpg-us', label: 'mpg (US gallons)' },
  { value: 'mpg-uk', label: 'mpg (UK gallons)' },
];

/** One-tap regional defaults (currency is left alone). */
export const UNIT_PRESETS: ReadonlyArray<{ label: string; units: Omit<UnitsConfig, 'currency'> }> =
  [
    {
      label: 'Metric',
      units: {
        system: 'metric',
        fuelEconomy: 'L/100km',
        temperature: 'C',
        pressure: 'kPa',
        clock: '24h',
      },
    },
    {
      label: 'US',
      units: {
        system: 'imperial',
        fuelEconomy: 'mpg-us',
        temperature: 'F',
        pressure: 'psi',
        clock: '12h',
      },
    },
    {
      label: 'UK',
      units: {
        system: 'imperial',
        fuelEconomy: 'mpg-uk',
        temperature: 'C',
        pressure: 'psi',
        clock: '24h',
      },
    },
  ];

export function UnitsSection({ root }: { root: Scope<HudConfig> }) {
  const units = root.child('units');
  return (
    <Section id="units" title="Units">
      <Card>
        <div class="restart-row">
          <span class="muted small">Quick set</span>
          {UNIT_PRESETS.map((preset) => (
            <Button
              key={preset.label}
              size="small"
              variant="ghost"
              onClick={() => units.replace({ ...preset.units, currency: units.value.currency })}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <SegmentedField
          scope={units}
          k="system"
          label="Speed and distance"
          options={[
            { value: 'metric', label: 'km/h · km' },
            { value: 'imperial', label: 'mph · miles' },
          ]}
        />
        <SelectField scope={units} k="fuelEconomy" label="Fuel economy" options={ECONOMY} />
        <FieldGrid>
          <SegmentedField
            scope={units}
            k="temperature"
            label="Temperature"
            options={[
              { value: 'C', label: '°C' },
              { value: 'F', label: '°F' },
            ]}
          />
          <SegmentedField
            scope={units}
            k="pressure"
            label="Tyre / boost pressure"
            options={[
              { value: 'kPa', label: 'kPa' },
              { value: 'psi', label: 'psi' },
              { value: 'bar', label: 'bar' },
            ]}
          />
          <SegmentedField
            scope={units}
            k="clock"
            label="Clock"
            options={[
              { value: '24h', label: '24 h' },
              { value: '12h', label: '12 h' },
            ]}
          />
          <TextField
            scope={units}
            k="currency"
            label="Currency"
            placeholder="USD"
            transform={(text) =>
              text
                .toUpperCase()
                .replace(/[^A-Z]/g, '')
                .slice(0, 3)
            }
            monospace
            hint="Three-letter code, e.g. USD, EUR, GBP."
          />
        </FieldGrid>
      </Card>
    </Section>
  );
}
