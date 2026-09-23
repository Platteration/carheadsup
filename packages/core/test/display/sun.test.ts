import { describe, expect, it } from 'vitest';
import { atmosphericRefractionDeg, solarPosition, sunElevationDeg } from '../../src/display/sun.ts';

/** Highest / lowest value of `f` over one UTC day, sampled every minute. */
function extremeOverDay(
  dayStartMs: number,
  f: (at: number) => number,
  pick: 'max' | 'min',
): number {
  let best = pick === 'max' ? -Infinity : Infinity;
  for (let m = 0; m < 1440; m++) {
    const v = f(dayStartMs + m * 60_000);
    best = pick === 'max' ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}

describe('solarPosition — published reference values', () => {
  it('matches the NREL SPA worked example (Reda & Andreas 2004)', () => {
    // 2003-10-17 12:30:30 local (UTC−7), Golden CO: topocentric zenith 50.11162°, azimuth
    // 194.34024°, declination −9.31434°, equation of time 14.641503 min. SPA's refraction uses
    // 820 mbar / 11 °C; the NOAA standard atmosphere adds ~0.003° more, well inside tolerance.
    const p = solarPosition(39.742476, -105.1786, Date.UTC(2003, 9, 17, 19, 30, 30));
    expect(Math.abs(p.elevationDeg - (90 - 50.11162))).toBeLessThan(0.02);
    expect(Math.abs(p.azimuthDeg - 194.34024)).toBeLessThan(0.02);
    expect(Math.abs(p.declinationDeg - -9.31434)).toBeLessThan(0.01);
    expect(Math.abs(p.equationOfTimeMin - 14.641503)).toBeLessThan(0.02);
  });

  it('matches Meeus, Astronomical Algorithms, examples 25.a / 28.b (1992 Oct 13.0 TD)', () => {
    // δ = −7°47′06″ (−7.7851°), equation of time 13m42.6s (13.71 min). TD − UT ≈ 59 s.
    const p = solarPosition(0, 0, Date.UTC(1992, 9, 12, 23, 59, 1));
    expect(Math.abs(p.declinationDeg - -7.7851)).toBeLessThan(0.01);
    expect(Math.abs(p.equationOfTimeMin - 13.71)).toBeLessThan(0.02);
  });

  it('has zero declination at the March 2024 equinox and maximal at the June solstice', () => {
    // Equinox 2024-03-20 03:06 UTC; solstice 2024-06-20 20:51 UTC (true obliquity ≈ 23.438°).
    expect(Math.abs(solarPosition(0, 0, Date.UTC(2024, 2, 20, 3, 6)).declinationDeg)).toBeLessThan(
      0.01,
    );
    const solstice = solarPosition(0, 0, Date.UTC(2024, 5, 20, 20, 51)).declinationDeg;
    expect(Math.abs(solstice - 23.438)).toBeLessThan(0.01);
  });

  it('reproduces the well-known equation-of-time extremes', () => {
    // ≈ +16.4 min in early November, ≈ −14.2 min in mid February.
    expect(
      Math.abs(solarPosition(0, 0, Date.UTC(2024, 10, 3, 12)).equationOfTimeMin - 16.45),
    ).toBeLessThan(0.1);
    expect(
      Math.abs(solarPosition(0, 0, Date.UTC(2024, 1, 11, 12)).equationOfTimeMin - -14.2),
    ).toBeLessThan(0.1);
  });
});

describe('sunElevationDeg — solar-noon geometry (90° − |φ − δ|)', () => {
  const noonMax = (lat: number, lon: number, day: number) =>
    extremeOverDay(day, (at) => sunElevationDeg(lat, lon, at), 'max');

  it('40° N at the June solstice ≈ 73.44°', () => {
    expect(Math.abs(noonMax(40, 0, Date.UTC(2024, 5, 20)) - (90 - 40 + 23.438))).toBeLessThan(0.05);
  });

  it('the equator at the March equinox is almost overhead', () => {
    // δ ≈ +0.15° at noon (the equinox was at 03:06 UTC).
    expect(Math.abs(noonMax(0, 0, Date.UTC(2024, 2, 20)) - 89.85)).toBeLessThan(0.05);
  });

  it('London at the December solstice ≈ 15.06° (+ refraction)', () => {
    const expected = 90 - 51.5074 - 23.437;
    const got = noonMax(51.5074, -0.1278, Date.UTC(2024, 11, 21));
    expect(Math.abs(got - expected - atmosphericRefractionDeg(expected))).toBeLessThan(0.05);
  });

  it('Sydney at the December solstice ≈ 79.6° (southern hemisphere)', () => {
    const expected = 90 - Math.abs(-33.8688 - -23.437);
    expect(Math.abs(noonMax(-33.8688, 151.2093, Date.UTC(2024, 11, 21)) - expected)).toBeLessThan(
      0.05,
    );
  });

  it('shows the polar night and the midnight sun at Tromsø (69.65° N)', () => {
    const geometric = (at: number) => solarPosition(69.6492, 18.9553, at).geometricElevationDeg;
    // Noon in December: −(90 − 69.65 − 23.44) ≈ −3.09°. Midnight in June: +3.09°.
    const decMax = extremeOverDay(Date.UTC(2024, 11, 21), geometric, 'max');
    const junMin = extremeOverDay(Date.UTC(2024, 5, 20, 12), geometric, 'min');
    expect(Math.abs(decMax - -3.09)).toBeLessThan(0.05);
    expect(Math.abs(junMin - 3.09)).toBeLessThan(0.05);
  });

  it('culminates when the hour angle is zero, due south at northern mid-latitudes', () => {
    // At 0° longitude local noon is 12:00 UTC minus the equation of time.
    const day = Date.UTC(2024, 5, 20);
    const eot = solarPosition(45, 0, day + 12 * 3_600_000).equationOfTimeMin;
    const noon = day + (12 * 60 - eot) * 60_000;
    const p = solarPosition(45, 0, noon);
    expect(Math.abs(p.hourAngleDeg)).toBeLessThan(0.01);
    expect(Math.abs(p.azimuthDeg - 180)).toBeLessThan(0.1);
    expect(sunElevationDeg(45, 0, noon - 3_600_000)).toBeLessThan(p.elevationDeg);
    expect(sunElevationDeg(45, 0, noon + 3_600_000)).toBeLessThan(p.elevationDeg);
  });

  it('is below the horizon at local midnight in mid-latitudes and rises in the east', () => {
    expect(sunElevationDeg(48.1, 11.6, Date.UTC(2024, 8, 23, 23, 0))).toBeLessThan(-30);
    const morning = solarPosition(48.1, 11.6, Date.UTC(2024, 8, 23, 6, 0));
    expect(morning.azimuthDeg).toBeGreaterThan(60);
    expect(morning.azimuthDeg).toBeLessThan(120);
    expect(morning.hourAngleDeg).toBeLessThan(0);
  });

  it('keeps the elevation within [−90, 90] for extreme latitudes', () => {
    for (const lat of [-90, -89.9, 89.9, 90]) {
      const e = sunElevationDeg(lat, 0, Date.UTC(2024, 5, 20, 12));
      expect(e).toBeGreaterThanOrEqual(-90);
      expect(e).toBeLessThanOrEqual(90);
    }
    // At the North Pole on the solstice the elevation equals the declination.
    expect(
      Math.abs(solarPosition(90, 0, Date.UTC(2024, 5, 20, 20, 51)).geometricElevationDeg - 23.438),
    ).toBeLessThan(0.01);
  });

  it('returns NaN for non-finite inputs', () => {
    expect(sunElevationDeg(Number.NaN, 0, 0)).toBeNaN();
    expect(sunElevationDeg(0, Number.POSITIVE_INFINITY, 0)).toBeNaN();
    expect(sunElevationDeg(0, 0, Number.NaN)).toBeNaN();
  });
});

describe('atmosphericRefractionDeg', () => {
  it('follows the NOAA piecewise approximation', () => {
    expect(atmosphericRefractionDeg(90)).toBe(0);
    expect(atmosphericRefractionDeg(86)).toBe(0);
    // Horizon: 1735″ ≈ 0.482°.
    expect(atmosphericRefractionDeg(0)).toBeCloseTo(1735 / 3600, 10);
    // 45°: 58.1″ − 0.07″ + 0.000086″.
    expect(atmosphericRefractionDeg(45)).toBeCloseTo((58.1 - 0.07 + 0.000086) / 3600, 10);
    // Below the horizon it shrinks again.
    expect(atmosphericRefractionDeg(-4)).toBeCloseTo(
      -20.772 / Math.tan((-4 * Math.PI) / 180) / 3600,
      10,
    );
  });

  it('is continuous enough across the branch boundaries', () => {
    for (const edge of [85, 5, -0.575]) {
      const jump = Math.abs(
        atmosphericRefractionDeg(edge + 1e-6) - atmosphericRefractionDeg(edge - 1e-6),
      );
      expect(jump).toBeLessThan(0.01);
    }
  });
});
