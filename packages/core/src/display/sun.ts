/**
 * Solar position after the NOAA Solar Calculator spreadsheet (itself based on Jean Meeus,
 * "Astronomical Algorithms"). Accurate to roughly ±0.01° for dates within a few centuries of
 * 2000, far better than needed to decide between day and night.
 */

const DEG = Math.PI / 180;
const MS_PER_DAY = 86_400_000;
/** Julian Day of the Unix epoch (1970-01-01T00:00Z). */
const JD_UNIX_EPOCH = 2_440_587.5;
/** Julian Day of J2000.0 (2000-01-01T12:00 TT). */
const JD_J2000 = 2_451_545;

const sinD = (deg: number): number => Math.sin(deg * DEG);
const cosD = (deg: number): number => Math.cos(deg * DEG);
const tanD = (deg: number): number => Math.tan(deg * DEG);
const mod = (value: number, m: number): number => ((value % m) + m) % m;

export interface SolarPosition {
  /** Apparent elevation above the horizon, corrected for standard atmospheric refraction (°). */
  elevationDeg: number;
  /** Geometric elevation of the sun's centre, without refraction (°). */
  geometricElevationDeg: number;
  /** Azimuth clockwise from true north (°, 0–360). */
  azimuthDeg: number;
  /** Solar declination (°). */
  declinationDeg: number;
  /** Equation of time: apparent minus mean solar time (minutes). */
  equationOfTimeMin: number;
  /** Hour angle (°, −180–180, negative in the morning). */
  hourAngleDeg: number;
}

/**
 * Approximate atmospheric refraction (°) for a geometric elevation, as in the NOAA spreadsheet
 * (standard pressure and temperature).
 */
export function atmosphericRefractionDeg(elevationDeg: number): number {
  const e = elevationDeg;
  let arcsec: number;
  if (e > 85) {
    arcsec = 0;
  } else if (e > 5) {
    const t = tanD(e);
    arcsec = 58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5;
  } else if (e > -0.575) {
    arcsec = 1735 + e * (-518.2 + e * (103.4 + e * (-12.79 + e * 0.711)));
  } else {
    arcsec = -20.772 / tanD(e);
  }
  return arcsec / 3600;
}

/**
 * Solar position for an observer at `lat`/`lon` (degrees, north and east positive) at an
 * absolute instant. Every field is NaN when an input is not finite.
 */
export function solarPosition(lat: number, lon: number, epochMs: number): SolarPosition {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(epochMs)) {
    return {
      elevationDeg: Number.NaN,
      geometricElevationDeg: Number.NaN,
      azimuthDeg: Number.NaN,
      declinationDeg: Number.NaN,
      equationOfTimeMin: Number.NaN,
      hourAngleDeg: Number.NaN,
    };
  }
  const phi = Math.max(-90, Math.min(90, lat));

  // Julian centuries since J2000.0 (UT used for TT; the ~1 min difference is negligible here).
  const jd = epochMs / MS_PER_DAY + JD_UNIX_EPOCH;
  const t = (jd - JD_J2000) / 36_525;

  const meanLong = mod(280.46646 + t * (36_000.76983 + t * 0.0003032), 360);
  const meanAnom = 357.52911 + t * (35_999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre =
    sinD(meanAnom) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    sinD(2 * meanAnom) * (0.019993 - 0.000101 * t) +
    sinD(3 * meanAnom) * 0.000289;
  const trueLong = meanLong + centre;
  const omega = 125.04 - 1934.136 * t;
  const apparentLong = trueLong - 0.00569 - 0.00478 * sinD(omega);
  const meanObliquity =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * cosD(omega);

  const declination = Math.asin(sinD(obliquity) * sinD(apparentLong)) / DEG;

  const y = tanD(obliquity / 2) ** 2;
  const equationOfTime =
    (4 / DEG) *
    (y * sinD(2 * meanLong) -
      2 * eccentricity * sinD(meanAnom) +
      4 * eccentricity * y * sinD(meanAnom) * cosD(2 * meanLong) -
      0.5 * y * y * sinD(4 * meanLong) -
      1.25 * eccentricity * eccentricity * sinD(2 * meanAnom));

  const minutesUtc = mod(epochMs, MS_PER_DAY) / 60_000;
  const trueSolarTime = mod(minutesUtc + equationOfTime + 4 * lon, 1440);
  const hourAngle = trueSolarTime / 4 - 180;

  const cosZenith = Math.max(
    -1,
    Math.min(1, sinD(phi) * sinD(declination) + cosD(phi) * cosD(declination) * cosD(hourAngle)),
  );
  const zenith = Math.acos(cosZenith) / DEG;
  const geometricElevation = 90 - zenith;

  // Azimuth from north, clockwise (NOAA spreadsheet form); undefined at the poles / zenith.
  const denom = cosD(phi) * sinD(zenith);
  let azimuth: number;
  if (Math.abs(denom) < 1e-12) {
    azimuth = phi > 0 ? 180 : 0;
  } else {
    const cosAz = Math.max(-1, Math.min(1, (sinD(phi) * cosZenith - sinD(declination)) / denom));
    const a = Math.acos(cosAz) / DEG;
    azimuth = hourAngle > 0 ? mod(a + 180, 360) : mod(540 - a, 360);
  }

  return {
    elevationDeg: geometricElevation + atmosphericRefractionDeg(geometricElevation),
    geometricElevationDeg: geometricElevation,
    azimuthDeg: azimuth,
    declinationDeg: declination,
    equationOfTimeMin: equationOfTime,
    hourAngleDeg: hourAngle,
  };
}

/**
 * Solar elevation angle in degrees (NOAA algorithm, ±0.5° is plenty), negative below the
 * horizon. Apparent elevation (refraction-corrected), matching the NOAA calculator; NaN when
 * an input is not finite.
 */
export function sunElevationDeg(lat: number, lon: number, epochMs: number): number {
  return solarPosition(lat, lon, epochMs).elevationDeg;
}
