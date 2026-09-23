import type { HudConfig, ProjectionConfig } from '@carheadsup/core';
import { describeError } from '../../common/api.ts';
import type { Scope } from '../model/scope.ts';
import { PERCENT } from '../model/units.ts';
import type { LiveStatus } from '../state/useConfigEditor.ts';
import { Badge, Button, Card, Notice, Section } from '../ui/common.tsx';
import { FieldGroup, SegmentedField, SliderField, ToggleField, issueText } from '../ui/fields.tsx';
import { KeystoneEditor } from '../ui/KeystoneEditor.tsx';

const ROTATIONS: ReadonlyArray<{ value: ProjectionConfig['rotation']; label: string }> = [
  { value: 0, label: '0°' },
  { value: 90, label: '90°' },
  { value: 180, label: '180°' },
  { value: 270, label: '270°' },
];

export interface ProjectionSectionProps {
  root: Scope<HudConfig>;
  live: LiveStatus;
  onRetry: () => void;
}

/** Changes here are applied to the HUD as you make them (debounced), no Save needed. */
export function ProjectionSection({ root, live, onRetry }: ProjectionSectionProps) {
  const projection = root.child('display').child('projection');
  return (
    <Section
      id="projection"
      title="Projection"
      intro="Square the image up on the windshield. Changes apply to the HUD immediately."
      aside={<LiveBadge live={live} />}
    >
      {live.error !== null && (
        <Notice
          tone="critical"
          title="Not applied to the HUD"
          actions={
            <Button size="small" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          {describeError(live.error)}
        </Notice>
      )}
      <Card>
        <ToggleField
          scope={projection}
          k="showGrid"
          label="Show calibration grid on the HUD"
          hint="Draws a grid instead of the HUD so you can line up the corners on the glass. Shown only while the car is stopped or parked; warnings still appear on top."
        />
      </Card>
      <Card>
        <FieldGroup title="Orientation">
          <ToggleField
            scope={projection}
            k="mirrorX"
            label="Mirror left ↔ right"
            hint="Needed when the display reflects off the windshield."
          />
          <ToggleField scope={projection} k="mirrorY" label="Mirror top ↕ bottom" />
          <SegmentedField
            scope={projection}
            k="rotation"
            label="Panel rotation"
            options={ROTATIONS}
          />
        </FieldGroup>
        <FieldGroup title="Size and position">
          <SliderField
            scope={projection}
            k="scale"
            label="Size"
            min={0.5}
            max={1.5}
            step={0.01}
            unit={PERCENT}
          />
          <SliderField
            scope={projection}
            k="offsetX"
            label="Move left / right"
            min={-0.5}
            max={0.5}
            step={0.005}
            unit={{ ...PERCENT, decimals: 1 }}
          />
          <SliderField
            scope={projection}
            k="offsetY"
            label="Move up / down"
            min={-0.5}
            max={0.5}
            step={0.005}
            unit={{ ...PERCENT, decimals: 1 }}
          />
        </FieldGroup>
      </Card>
      <Card>
        <FieldGroup
          title="Keystone"
          description="Drag the corners until the grid on the glass looks square, or select a corner and use the arrow keys."
        >
          <KeystoneEditor
            corners={projection.value.corners}
            onChange={(corners) => projection.set('corners', corners)}
          />
          {projection.child('corners').issuesWithin()[0] && (
            <p class="field__error" role="alert">
              {issueText(projection.child('corners').issuesWithin()[0]!)}
            </p>
          )}
        </FieldGroup>
      </Card>
    </Section>
  );
}

function LiveBadge({ live }: { live: LiveStatus }) {
  if (live.error !== null) return <Badge tone="critical">Not applied</Badge>;
  if (live.pending) return <Badge tone="info">Applying…</Badge>;
  return <Badge tone="ok">Live</Badge>;
}
