import '../common/fonts.ts';
import './hud.css';
import type { DiagnosticsFrame, HudFrame, ProjectionConfig, Zone } from '@carheadsup/core';
import type { ComponentChildren, RefObject } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { DiagnosticsView } from './diagnostics/Diagnostics.tsx';
import { ZONES, groupByZone, visibleAlerts, zonePosition } from './layout.ts';
import { AlertBanner } from './overlays/AlertBanner.tsx';
import { AlignmentGrid } from './overlays/AlignmentGrid.tsx';
import { BlindSpot, CollisionBorder, CollisionCue } from './overlays/Adas.tsx';
import { CallCard } from './overlays/CallCard.tsx';
import { ShiftLight } from './overlays/ShiftLight.tsx';
import { BlankIndicator, NoSignal, StatusIcons } from './overlays/Status.tsx';
import { Toast } from './overlays/Toast.tsx';
import { ProjectionStage } from './ProjectionStage.tsx';
import type { StageSize } from './ProjectionStage.tsx';
import { contentBrightness, cx } from './util.ts';
import { Widget } from './widgets/index.tsx';

export interface HudViewProps {
  /** The frame to draw; null draws nothing but the tiny "no signal" dot. */
  frame: HudFrame | null;
  /** Mirroring / rotation / keystone from the server's display config. */
  projection?: ProjectionConfig | null;
  /** Ignore mirroring, rotation and keystone (e.g. when embedded in the dev console). */
  preview?: boolean;
  className?: string;
}

/** Track an element's layout size (unaffected by CSS transforms on ancestors). */
function useElementSize(ref: RefObject<HTMLElement>): StageSize | null {
  const [size, setSize] = useState<StageSize | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      setSize((prev) =>
        prev && prev.width === next.width && prev.height === next.height ? prev : next,
      );
    };
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [ref]);
  return size;
}

function ZoneBox({
  zone,
  lead,
  children,
}: {
  zone: Zone;
  lead?: ComponentChildren;
  children?: ComponentChildren;
}) {
  const { row, column } = zonePosition(zone);
  return (
    <div
      class={cx('hud-zone', `hud-zone--${zone}`, `hud-row--${row}`, `hud-col--${column}`)}
      data-zone={zone}
    >
      {lead}
      {children}
    </div>
  );
}

/** Collision cue and alert banners for the top-centre stack. */
function TopLead({ frame }: { frame: HudFrame }) {
  return (
    <>
      <CollisionCue level={frame.collision} />
      {visibleAlerts(frame).map((a) => (
        <AlertBanner key={a.key} alert={a} />
      ))}
    </>
  );
}

/** Safety overlays that are drawn in every mode, even when blanked. */
function SafetyOverlays({ frame }: { frame: HudFrame }) {
  return (
    <>
      <BlindSpot left={frame.blindSpot.left} right={frame.blindSpot.right} />
      {frame.collision === 'warning' && <CollisionBorder />}
    </>
  );
}

function DrivingContent({ frame }: { frame: HudFrame }) {
  const groups = groupByZone(frame.widgets);
  return (
    <div class="hud-content" data-mode="driving">
      {frame.shiftLight && <ShiftLight shift={frame.shiftLight} />}
      <StatusIcons status={frame.status} />
      <SafetyOverlays frame={frame} />
      <div class="hud-grid">
        {ZONES.map((zone) => (
          <ZoneBox
            key={zone}
            zone={zone}
            lead={
              zone === 'top' ? (
                <TopLead frame={frame} />
              ) : zone === 'bottom' ? (
                <>
                  {frame.call && <CallCard call={frame.call} />}
                  {frame.toast && <Toast toast={frame.toast} />}
                </>
              ) : undefined
            }
          >
            {groups[zone].map((w, i) => (
              <div key={`${w.id}-${i}`} class="hud-slot">
                <Widget w={w} />
              </div>
            ))}
          </ZoneBox>
        ))}
      </div>
    </div>
  );
}

/** Blanked: black apart from a tiny indicator, critical alerts and ADAS warnings. */
function BlankedContent({ frame }: { frame: HudFrame }) {
  return (
    <div class="hud-content hud-content--blanked" data-mode="blanked">
      <BlankIndicator />
      <SafetyOverlays frame={frame} />
      <div class="hud-grid">
        <ZoneBox zone="top" lead={<TopLead frame={frame} />} />
      </div>
    </div>
  );
}

function DiagnosticsContent({
  frame,
  diagnostics,
}: {
  frame: HudFrame;
  diagnostics: DiagnosticsFrame;
}) {
  const alerts = visibleAlerts(frame);
  const top =
    frame.collision !== 'none' || alerts.length > 0 ? <TopLead frame={frame} /> : undefined;
  const bottom =
    frame.call || frame.toast ? (
      <>
        {frame.call && <CallCard call={frame.call} />}
        {frame.toast && <Toast toast={frame.toast} />}
      </>
    ) : undefined;
  return (
    <div class="hud-content hud-content--diagnostics" data-mode="diagnostics">
      <StatusIcons status={frame.status} />
      <SafetyOverlays frame={frame} />
      <DiagnosticsView d={diagnostics} top={top} bottom={bottom} />
    </div>
  );
}

function FrameContent({ frame }: { frame: HudFrame }) {
  if (frame.blanked) return <BlankedContent frame={frame} />;
  if (frame.diagnostics) {
    return <DiagnosticsContent frame={frame} diagnostics={frame.diagnostics} />;
  }
  return <DrivingContent frame={frame} />;
}

/**
 * The projected heads-up display. Draws light on black (black is transparent on the glass),
 * scales with its container (give it a definite size), and applies the frame's night palette and
 * brightness. Pure view: every value comes from the frame, already in display units.
 */
export function HudView({ frame, projection = null, preview = false, className }: HudViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(rootRef);
  const brightness = frame ? contentBrightness(frame.theme.brightness) : 1;
  const showGrid = projection?.showGrid === true;
  return (
    <div
      ref={rootRef}
      class={cx('hud', frame?.theme.night && 'hud--night', preview && 'hud--preview', className)}
      style={brightness < 1 ? { filter: `brightness(${brightness})` } : undefined}
      data-context={frame?.context}
      data-brightness={brightness}
    >
      <ProjectionStage projection={preview ? null : projection} size={size}>
        {showGrid ? (
          <AlignmentGrid />
        ) : frame === null ? (
          <div class="hud-content" data-mode="no-signal">
            <NoSignal />
          </div>
        ) : (
          <FrameContent frame={frame} />
        )}
      </ProjectionStage>
    </div>
  );
}
