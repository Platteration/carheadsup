import '../common/fonts.ts';
import './hud.css';
import type {
  DiagnosticsFrame,
  DrivingContext,
  HudFrame,
  ProjectionConfig,
  Zone,
} from '@carheadsup/core';
import type { ComponentChildren, RefObject } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { DiagnosticsView } from './diagnostics/Diagnostics.tsx';
import { useHold } from './flash.ts';
import { Guard } from './Guard.tsx';
import {
  ZONES,
  collisionLevel,
  gridAllowed,
  groupByZone,
  planAlerts,
  visibleAlerts,
  zonePosition,
} from './layout.ts';
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
  /**
   * The display's backlight already follows `theme.brightness` (the server drives it), so the
   * content is drawn at full brightness: dimming it as well would give about b × b^2.2.
   */
  hardwareBrightness?: boolean;
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

/**
 * Collision cue and alert banners for the top-centre stack, as one block. The block is never
 * clipped: when it is taller than the top zone it grows down over the centre (see `.hud-lead` in
 * hud.css). With more than one item every banner is compacted to its title and one detail line,
 * and lower-priority alerts beyond {@link planAlerts}' limit collapse into a "+N more" line.
 */
function TopLead({ frame }: { frame: HudFrame }) {
  return (
    <Guard name="alert stack" resetKey={frame}>
      <LeadBlock frame={frame} />
    </Guard>
  );
}

function LeadBlock({ frame }: { frame: HudFrame }) {
  const { shown, more } = planAlerts(visibleAlerts(frame));
  const cue = collisionLevel(frame.collision) !== 'none';
  const items = shown.length + (cue ? 1 : 0) + (more > 0 ? 1 : 0);
  if (items === 0) return null;
  return (
    <div class={cx('hud-lead', items > 1 && 'hud-lead--compact')} data-lead="true">
      <Guard name="collision cue" resetKey={frame}>
        <CollisionCue level={frame.collision} />
      </Guard>
      {shown.map((a, i) => (
        <Guard key={`${a.key}-${i}`} name="alert banner" resetKey={a}>
          <AlertBanner alert={a} />
        </Guard>
      ))}
      {more > 0 && (
        <div class="hud-alert-more" data-alerts-more={more}>
          +{more} more
        </div>
      )}
    </div>
  );
}

/** Safety overlays that are drawn in every mode, even when blanked or calibrating. */
function SafetyOverlays({ frame }: { frame: HudFrame }) {
  return (
    <Guard name="driver-assistance overlays" resetKey={frame}>
      <BlindSpot left={frame.blindSpot.left === true} right={frame.blindSpot.right === true} />
      {collisionLevel(frame.collision) === 'warning' && <CollisionBorder />}
    </Guard>
  );
}

/** Call card and toast for the bottom-centre stack. */
function BottomLead({ frame }: { frame: HudFrame }) {
  if (!frame.call && !frame.toast) return null;
  return (
    <>
      {frame.call && (
        <Guard name="call card" resetKey={frame.call}>
          <CallCard call={frame.call} />
        </Guard>
      )}
      {frame.toast && (
        <Guard name="toast" resetKey={frame.toast}>
          <Toast toast={frame.toast} />
        </Guard>
      )}
    </>
  );
}

function Status({ frame }: { frame: HudFrame }) {
  return (
    <Guard name="status icons" resetKey={frame.status}>
      <StatusIcons status={frame.status} />
    </Guard>
  );
}

function DrivingContent({ frame }: { frame: HudFrame }) {
  const groups = groupByZone(frame.widgets);
  return (
    <div class="hud-content" data-mode="driving">
      {frame.shiftLight && (
        <Guard name="shift light" resetKey={frame.shiftLight}>
          <ShiftLight shift={frame.shiftLight} />
        </Guard>
      )}
      <Status frame={frame} />
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
                <BottomLead frame={frame} />
              ) : undefined
            }
          >
            {groups[zone].map((w, i) => (
              <div key={`${w.id}-${i}`} class="hud-slot">
                <Guard name={`${w.id} widget`} resetKey={w}>
                  <Widget w={w} />
                </Guard>
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

/**
 * Calibrating (grid on while standing still): the grid, with every safety cue still drawn on top
 * of it — blind spots, collision warnings and alerts never disappear behind the pattern.
 */
function CalibrationContent({ frame }: { frame: HudFrame }) {
  return (
    <>
      <AlignmentGrid />
      <div class="hud-content hud-content--calibration" data-mode="calibration">
        <SafetyOverlays frame={frame} />
        <div class="hud-grid">
          <ZoneBox zone="top" lead={<TopLead frame={frame} />} />
        </div>
      </div>
    </>
  );
}

function DiagnosticsContent({
  frame,
  diagnostics,
}: {
  frame: HudFrame;
  diagnostics: DiagnosticsFrame;
}) {
  const top =
    collisionLevel(frame.collision) !== 'none' || visibleAlerts(frame).length > 0 ? (
      <TopLead frame={frame} />
    ) : undefined;
  const bottom = frame.call || frame.toast ? <BottomLead frame={frame} /> : undefined;
  return (
    <div class="hud-content hud-content--diagnostics" data-mode="diagnostics">
      <Status frame={frame} />
      <SafetyOverlays frame={frame} />
      <Guard name="diagnostics dashboard" resetKey={diagnostics}>
        <DiagnosticsView d={diagnostics} top={top} bottom={bottom} />
      </Guard>
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

function NoSignalContent() {
  return (
    <div class="hud-content" data-mode="no-signal">
      <NoSignal />
    </div>
  );
}

/**
 * The frame as drawn: flashing states (collision warning, shift flash) held on for at least
 * `FLASH_HOLD_MS` (flash.ts) once shown, so input dithering at a threshold can never make them
 * flash faster than the blink itself. Kept referentially stable while nothing changes.
 */
function useDrawnFrame(frame: HudFrame | null): HudFrame | null {
  const warning = useHold(frame !== null && collisionLevel(frame.collision) === 'warning');
  const shiftFlash = useHold(frame?.shiftLight?.flash === true);
  return useMemo(() => {
    if (frame === null) return null;
    let drawn = frame;
    if (warning && collisionLevel(frame.collision) !== 'warning') {
      drawn = { ...drawn, collision: 'warning' };
    }
    if (shiftFlash && drawn.shiftLight && drawn.shiftLight.flash !== true) {
      drawn = { ...drawn, shiftLight: { ...drawn.shiftLight, flash: true } };
    }
    return drawn;
  }, [frame, warning, shiftFlash]);
}

/**
 * The projected heads-up display. Draws light on black (black is transparent on the glass),
 * scales with its container (give it a definite size), and applies the frame's night palette and
 * brightness (a CSS filter, unless `hardwareBrightness`). Pure view: every value comes from the
 * frame, already in display units.
 *
 * Every piece is drawn inside an error boundary ({@link Guard}): a frame this renderer cannot
 * draw costs only the broken piece (or, at worst, blanks the HUD) for that frame — it can never
 * freeze the last image on the glass.
 */
export function HudView({
  frame,
  projection = null,
  preview = false,
  hardwareBrightness = false,
  className,
}: HudViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(rootRef);
  const drawn = useDrawnFrame(frame);
  const brightness = frame && !hardwareBrightness ? contentBrightness(frame.theme.brightness) : 1;
  // The calibration grid only while standing still; without a frame, the last known context.
  const lastContext = useRef<DrivingContext | null>(null);
  if (frame) lastContext.current = frame.context;
  const showGrid = projection?.showGrid === true && gridAllowed(lastContext.current);
  return (
    <div
      ref={rootRef}
      class={cx('hud', frame?.theme.night && 'hud--night', preview && 'hud--preview', className)}
      style={brightness < 1 ? { filter: `brightness(${brightness})` } : undefined}
      data-context={frame?.context}
      data-brightness={brightness}
    >
      <ProjectionStage projection={preview ? null : projection} size={size}>
        {drawn === null ? (
          showGrid ? (
            <AlignmentGrid />
          ) : (
            <NoSignalContent />
          )
        ) : (
          <Guard name="frame" resetKey={drawn} fallback={<NoSignalContent />}>
            {showGrid ? <CalibrationContent frame={drawn} /> : <FrameContent frame={drawn} />}
          </Guard>
        )}
      </ProjectionStage>
    </div>
  );
}
