import type { HudConfig } from '@carheadsup/core';
import type { Scope } from '../model/scope.ts';
import { VOLTS, plainUnit } from '../model/units.ts';
import { Card, Section } from '../ui/common.tsx';
import { FieldGrid, FieldGroup, NumberField, ToggleField } from '../ui/fields.tsx';
import { useForm } from '../ui/form-context.ts';

const PERCENT_POINTS = plainUnit('%');

export function AlertsSection({ root }: { root: Scope<HudConfig> }) {
  const alerts = root.child('alerts');
  const { driverUnits: u } = useForm();
  return (
    <Section
      id="alerts"
      title="Alerts"
      intro="When the HUD warns you. Readings in range stay hidden."
    >
      <Card>
        <FieldGroup title="Engine temperature">
          <FieldGrid>
            <NumberField scope={alerts} k="coolantHighC" label="Warn at" unit={u.temperature} />
            <NumberField
              scope={alerts}
              k="coolantCriticalC"
              label="Critical at"
              unit={u.temperature}
            />
            <NumberField
              scope={alerts}
              k="coolantHysteresisC"
              label="Clear after cooling by"
              unit={u.temperatureDelta}
            />
          </FieldGrid>
        </FieldGroup>
        <FieldGroup title="Battery and charging">
          <FieldGrid>
            <NumberField
              scope={alerts}
              k="voltageLowRunningV"
              label="Not charging below"
              unit={VOLTS}
              hint="With the engine running."
            />
            <NumberField
              scope={alerts}
              k="voltageLowOffV"
              label="Weak battery below"
              unit={VOLTS}
              hint="With the engine off."
            />
            <NumberField scope={alerts} k="voltageHighV" label="Over-voltage above" unit={VOLTS} />
            <NumberField
              scope={alerts}
              k="voltageHysteresisV"
              label="Hysteresis"
              unit={{ ...VOLTS, decimals: 2 }}
            />
          </FieldGrid>
        </FieldGroup>
      </Card>
      <Card>
        <FieldGroup
          title="Speeding"
          description="Your speed turns red above the limit plus whichever tolerance is larger."
        >
          <FieldGrid>
            <NumberField
              scope={alerts}
              k="overspeedToleranceKph"
              label="Tolerance"
              unit={u.speedDelta}
            />
            <NumberField
              scope={alerts}
              k="overspeedTolerancePct"
              label="…or"
              unit={PERCENT_POINTS}
            />
          </FieldGrid>
        </FieldGroup>
        <FieldGroup title="Other warnings">
          <FieldGrid>
            <NumberField
              scope={alerts}
              k="fuelLowPct"
              label="Low fuel below"
              unit={PERCENT_POINTS}
            />
            <NumberField
              scope={alerts}
              k="tpmsLowKpa"
              label="Low tyre pressure below"
              unit={u.pressure}
            />
            <NumberField
              scope={alerts}
              k="iceRiskC"
              label="Ice warning at or below"
              unit={u.temperature}
              signed
            />
          </FieldGrid>
          <ToggleField
            scope={alerts}
            k="showDtcWhileDriving"
            label="Show minor check-engine alerts while driving"
            hint="When off, informational codes wait until you stop."
          />
        </FieldGroup>
      </Card>
    </Section>
  );
}
