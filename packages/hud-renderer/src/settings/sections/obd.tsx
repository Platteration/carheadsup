import type { HudConfig, ObdTransportKind } from '@carheadsup/core';
import type { Scope } from '../model/scope.ts';
import { MILLISECONDS, SECONDS_FROM_MS, plainUnit } from '../model/units.ts';
import { Card, Section } from '../ui/common.tsx';
import {
  FieldGrid,
  FieldGroup,
  NumberField,
  SegmentedField,
  SelectField,
  TextField,
} from '../ui/fields.tsx';
import type { Option } from '../ui/fields.tsx';

const TRANSPORTS: ReadonlyArray<Option<ObdTransportKind>> = [
  {
    value: 'serial',
    label: 'Bluetooth / USB',
    hint: 'An ELM327 on a serial port (Bluetooth SPP via rfcomm, or USB).',
  },
  { value: 'tcp', label: 'Wi-Fi', hint: 'A Wi-Fi ELM327 adapter, usually at 192.168.0.10:35000.' },
  {
    value: 'simulator',
    label: 'Simulator',
    hint: 'A built-in simulated car, for testing without a vehicle.',
  },
];

/** ELM327 `AT SP` protocol numbers (ELM327 data sheet). */
export const ELM_PROTOCOLS: ReadonlyArray<Option<string>> = [
  { value: '0', label: 'Automatic' },
  { value: '1', label: '1 · SAE J1850 PWM (41.6 kbaud)' },
  { value: '2', label: '2 · SAE J1850 VPW (10.4 kbaud)' },
  { value: '3', label: '3 · ISO 9141-2 (5 baud init)' },
  { value: '4', label: '4 · ISO 14230-4 KWP (5 baud init)' },
  { value: '5', label: '5 · ISO 14230-4 KWP (fast init)' },
  { value: '6', label: '6 · ISO 15765-4 CAN (11 bit, 500 kbaud)' },
  { value: '7', label: '7 · ISO 15765-4 CAN (29 bit, 500 kbaud)' },
  { value: '8', label: '8 · ISO 15765-4 CAN (11 bit, 250 kbaud)' },
  { value: '9', label: '9 · ISO 15765-4 CAN (29 bit, 250 kbaud)' },
  { value: 'A', label: 'A · SAE J1939 CAN (29 bit, 250 kbaud)' },
  { value: 'B', label: 'B · User1 CAN (11 bit, 125 kbaud)' },
  { value: 'C', label: 'C · User2 CAN (11 bit, 50 kbaud)' },
];

const BAUD_RATES: ReadonlyArray<Option<number>> = [
  9600, 38_400, 57_600, 115_200, 230_400, 500_000,
].map((b) => ({
  value: b,
  label: `${b.toLocaleString('en-US')} baud`,
}));

export function ObdSection({ root }: { root: Scope<HudConfig> }) {
  const obd = root.child('obd');
  const transport = obd.value.transport;
  return (
    <Section id="obd" title="OBD connection" intro="How the HUD talks to the car’s OBD-II adapter.">
      <Card>
        <SegmentedField scope={obd} k="transport" label="Adapter" options={TRANSPORTS} />
        {transport === 'serial' && (
          <FieldGrid>
            <TextField
              scope={obd}
              k="serialPath"
              label="Serial device"
              monospace
              placeholder="/dev/rfcomm0"
              hint="/dev/rfcomm0 for Bluetooth, /dev/ttyUSB0 for USB."
            />
            <SelectField
              scope={obd}
              k="baudRate"
              label="Speed"
              options={BAUD_RATES}
              hint="38 400 for most ELM327 clones."
            />
          </FieldGrid>
        )}
        {transport === 'tcp' && (
          <FieldGrid>
            <TextField
              scope={obd}
              k="tcpHost"
              label="Adapter address"
              monospace
              placeholder="192.168.0.10"
              inputMode="url"
            />
            <NumberField scope={obd} k="tcpPort" label="Port" unit={plainUnit('')} integer />
          </FieldGrid>
        )}
        <SelectField
          scope={obd}
          k="protocol"
          label="Protocol"
          options={ELM_PROTOCOLS}
          hint="Automatic works for almost every car."
        />
        <details class="disclosure">
          <summary>Timing</summary>
          <FieldGrid>
            <NumberField
              scope={obd}
              k="timeoutMs"
              label="Response timeout"
              unit={MILLISECONDS}
              integer
            />
            <NumberField
              scope={obd}
              k="reconnectDelayMs"
              label="Reconnect after"
              unit={SECONDS_FROM_MS}
              integer
            />
            <NumberField
              scope={obd}
              k="dtcIntervalMs"
              label="Check for trouble codes every"
              unit={SECONDS_FROM_MS}
              integer
            />
          </FieldGrid>
        </details>
      </Card>
      <FieldGroup>
        <p class="muted small">Manufacturer-specific PIDs are set up under Vehicle.</p>
      </FieldGroup>
    </Section>
  );
}
