import type { DtcInfo, DtcSeverity, DtcSystem } from '../types/vehicle.ts';
import { lookupDtc } from './dtc-lookup.ts';
import { describeDtcRange } from './dtc-ranges.ts';

/**
 * Plain-language trouble-code explanations: `explainDtc`.
 *
 * `lookupDtc` answers "what does this code mean" with the official SAE wording.
 * This module answers the driver's two follow-up questions: "what is probably
 * wrong?" and "is it safe to keep driving?" Everything stays pure and I/O-free
 * like the rest of core, and it is exported from the `@carheadsup/core/dtc`
 * entry point so the HUD kiosk bundle never carries it by accident.
 */

/** Driver-facing answer to "is it safe to keep driving?" */
export type DtcVerdict = 'stop-now' | 'drive-cautiously' | 'schedule-service' | 'no-action';

export interface DtcExplanation extends DtcInfo {
  /** Likely causes in plain language, most common first. */
  causes: string[];
  /** The safe-to-drive answer, derived from the code's severity. */
  verdict: DtcVerdict;
  /** One plain-language "what to do next" line. */
  guidance: string;
}

const VERDICT_BY_SEVERITY: Readonly<Record<DtcSeverity, DtcVerdict>> = {
  critical: 'stop-now',
  warning: 'drive-cautiously',
  caution: 'schedule-service',
  info: 'no-action',
};

const GUIDANCE_BY_VERDICT: Readonly<Record<DtcVerdict, string>> = {
  'stop-now':
    'Pull over safely and switch off the engine. Driving on risks serious damage or an unsafe condition — have the car towed to a shop.',
  'drive-cautiously':
    'You can drive gently to the nearest repair shop: avoid hard acceleration and high revs. Get it checked soon — the fault can cause further damage if ignored.',
  'schedule-service':
    'Safe to keep driving normally. Book service soon — the fault affects emissions or economy and can get worse over time.',
  'no-action': 'Informational only — no action needed.',
};

interface CuratedEntry {
  causes: string[];
  /** Overrides the severity-derived guidance when a code needs specific advice. */
  guidance?: string;
}

/** Hand-curated likely causes for the most common codes, keyed by exact code. */
const CURATED: Readonly<Record<string, CuratedEntry>> = {
  P0300: {
    causes: [
      'Worn spark plugs',
      'Failing ignition coil(s)',
      'Vacuum leak in the intake',
      'Clogged fuel injector',
      'Low fuel pressure',
    ],
    guidance:
      'If the check-engine light is flashing, stop driving — ongoing misfires can overheat and destroy the catalytic converter.',
  },
  P0316: {
    causes: [
      'Fouled spark plugs',
      'Leaking fuel injector flooding a cylinder overnight',
      'Weak battery causing slow cranking',
    ],
  },
  P0420: {
    causes: [
      'Aging catalytic converter losing efficiency',
      'Exhaust leak ahead of the converter',
      'Faulty downstream oxygen sensor',
      'Engine burning oil and contaminating the converter',
    ],
  },
  P0430: {
    causes: [
      'Aging catalytic converter losing efficiency (bank 2)',
      'Exhaust leak ahead of the converter',
      'Faulty downstream oxygen sensor',
      'Engine burning oil and contaminating the converter',
    ],
  },
  P0171: {
    causes: [
      'Vacuum leak in the intake system',
      'Dirty mass airflow sensor',
      'Weak fuel pump or clogged fuel filter',
      'Leaking intake manifold gasket',
    ],
  },
  P0174: {
    causes: [
      'Vacuum leak in the intake system (bank 2)',
      'Dirty mass airflow sensor',
      'Weak fuel pump or clogged fuel filter',
      'Leaking intake manifold gasket',
    ],
  },
  P0172: {
    causes: [
      'Leaking fuel injector',
      'Faulty mass airflow sensor',
      'Failed fuel pressure regulator',
      'Saturated EVAP canister purging raw fuel',
    ],
  },
  P0175: {
    causes: [
      'Leaking fuel injector (bank 2)',
      'Faulty mass airflow sensor',
      'Failed fuel pressure regulator',
      'Saturated EVAP canister purging raw fuel',
    ],
  },
  P0401: {
    causes: [
      'Clogged EGR valve or passages',
      'Faulty EGR valve',
      'Vacuum leak in the EGR control hose',
    ],
  },
  P0402: {
    causes: ['EGR valve stuck open', 'Faulty EGR position sensor'],
  },
  P0440: {
    causes: [
      'Loose, cracked or missing gas cap — the most common cause',
      'Cracked or disconnected EVAP hose',
      'Leaking purge or vent valve',
      'Rusted fuel filler neck',
    ],
    guidance:
      'Check the gas cap first: tighten it until it clicks and the code may clear itself after a few drives.',
  },
  P0442: {
    causes: [
      'Loose, cracked or missing gas cap — the most common cause',
      'Small crack in an EVAP hose',
      'Leaking purge or vent valve',
    ],
    guidance:
      'Check the gas cap first: tighten it until it clicks and the code may clear itself after a few drives.',
  },
  P0455: {
    causes: [
      'Loose, cracked or missing gas cap — the most common cause',
      'Large crack or disconnected EVAP hose',
      'Stuck-open purge or vent valve',
    ],
    guidance:
      'Check the gas cap first: tighten it until it clicks and the code may clear itself after a few drives.',
  },
  P0456: {
    causes: [
      'Loose, cracked or missing gas cap — the most common cause',
      'Pinhole crack in an EVAP hose',
      'Slow leak at the purge or vent valve',
    ],
    guidance:
      'Check the gas cap first: tighten it until it clicks and the code may clear itself after a few drives.',
  },
  P0446: {
    causes: [
      'Faulty EVAP vent valve',
      'Blocked vent filter',
      'Damaged vent valve wiring',
    ],
  },
  P0452: {
    causes: ['Faulty fuel tank pressure sensor', 'Damaged sensor wiring or connector'],
  },
  P0453: {
    causes: ['Faulty fuel tank pressure sensor', 'Damaged sensor wiring or connector'],
  },
  P0128: {
    causes: [
      'Thermostat stuck open',
      'Low coolant level',
      'Faulty coolant temperature sensor',
    ],
    guidance:
      'Check the coolant level when the engine is cold — never open a hot radiator cap.',
  },
  P0113: {
    causes: ['Faulty intake air temperature sensor', 'Damaged sensor wiring'],
  },
  P0118: {
    causes: [
      'Faulty coolant temperature sensor',
      'Low coolant level',
      'Damaged sensor wiring',
    ],
    guidance:
      'If the temperature gauge reads hot, stop driving; otherwise check the coolant level when the engine is cold.',
  },
  P0131: {
    causes: [
      'Failing upstream oxygen sensor',
      'Exhaust leak near the sensor',
      'Damaged sensor wiring',
    ],
  },
  P0132: {
    causes: [
      'Failing upstream oxygen sensor',
      'Exhaust leak near the sensor',
      'Damaged sensor wiring',
    ],
  },
  P0133: {
    causes: [
      'Aging oxygen sensor responding slowly',
      'Exhaust leak',
      'Contaminated sensor from coolant or silicone',
    ],
  },
  P0134: {
    causes: [
      'Dead upstream oxygen sensor',
      'Damaged sensor wiring or connector',
      'Exhaust leak',
    ],
  },
  P0135: {
    causes: [
      'Failed heater element inside the oxygen sensor',
      'Blown heater fuse',
      'Damaged heater wiring',
    ],
  },
  P0140: {
    causes: ['Dead downstream oxygen sensor', 'Damaged sensor wiring'],
  },
  P0141: {
    causes: [
      'Failed heater element inside the oxygen sensor',
      'Blown heater fuse',
      'Damaged heater wiring',
    ],
  },
  P0151: {
    causes: [
      'Failing upstream oxygen sensor (bank 2)',
      'Exhaust leak near the sensor',
      'Damaged sensor wiring',
    ],
  },
  P0152: {
    causes: [
      'Failing upstream oxygen sensor (bank 2)',
      'Exhaust leak near the sensor',
      'Damaged sensor wiring',
    ],
  },
  P0153: {
    causes: [
      'Aging oxygen sensor responding slowly (bank 2)',
      'Exhaust leak',
      'Contaminated sensor from coolant or silicone',
    ],
  },
  P0154: {
    causes: [
      'Dead upstream oxygen sensor (bank 2)',
      'Damaged sensor wiring or connector',
      'Exhaust leak',
    ],
  },
  P0155: {
    causes: [
      'Failed heater element inside the oxygen sensor',
      'Blown heater fuse',
      'Damaged heater wiring',
    ],
  },
  P0160: {
    causes: ['Dead downstream oxygen sensor (bank 2)', 'Damaged sensor wiring'],
  },
  P0161: {
    causes: [
      'Failed heater element inside the oxygen sensor',
      'Blown heater fuse',
      'Damaged heater wiring',
    ],
  },
  P0217: {
    causes: [
      'Low coolant from a leak',
      'Thermostat stuck closed',
      'Failed water pump',
      'Blocked radiator or failed cooling fan',
    ],
  },
  P0325: {
    causes: [
      'Faulty knock sensor',
      'Damaged sensor wiring',
      'Engine mechanical noise fooling the sensor',
    ],
  },
  P0335: {
    causes: [
      'Faulty crankshaft position sensor',
      'Damaged reluctor ring',
      'Damaged sensor wiring',
    ],
    guidance:
      'The engine may stall or refuse to start — drive cautiously straight to a shop.',
  },
  P0340: {
    causes: [
      'Faulty camshaft position sensor',
      'Damaged sensor wiring',
      'Timing component wear',
    ],
  },
  P0011: {
    causes: [
      'Low or dirty engine oil',
      'Faulty variable valve timing solenoid',
      'Worn timing components',
    ],
    guidance:
      'Check the engine oil level and condition first — VVT problems are often just overdue oil.',
  },
  P0014: {
    causes: [
      'Low or dirty engine oil',
      'Faulty variable valve timing solenoid (exhaust)',
      'Worn timing components',
    ],
    guidance:
      'Check the engine oil level and condition first — VVT problems are often just overdue oil.',
  },
  P0021: {
    causes: [
      'Low or dirty engine oil',
      'Faulty variable valve timing solenoid (bank 2)',
      'Worn timing components',
    ],
    guidance:
      'Check the engine oil level and condition first — VVT problems are often just overdue oil.',
  },
  P0024: {
    causes: [
      'Low or dirty engine oil',
      'Faulty variable valve timing solenoid (bank 2 exhaust)',
      'Worn timing components',
    ],
    guidance:
      'Check the engine oil level and condition first — VVT problems are often just overdue oil.',
  },
  P0016: {
    causes: [
      'Stretched timing chain or jumped timing belt',
      'Worn timing guides or tensioner',
      'Faulty crank or cam sensor',
    ],
    guidance:
      'A timing fault can cause severe engine damage — drive gently to a shop, don’t delay.',
  },
  P0017: {
    causes: [
      'Stretched timing chain or jumped timing belt',
      'Worn timing guides or tensioner',
      'Faulty crank or cam sensor',
    ],
    guidance:
      'A timing fault can cause severe engine damage — drive gently to a shop, don’t delay.',
  },
  P0018: {
    causes: [
      'Stretched timing chain or jumped timing belt',
      'Worn timing guides or tensioner',
      'Faulty crank or cam sensor',
    ],
    guidance:
      'A timing fault can cause severe engine damage — drive gently to a shop, don’t delay.',
  },
  P0019: {
    causes: [
      'Stretched timing chain or jumped timing belt',
      'Worn timing guides or tensioner',
      'Faulty crank or cam sensor',
    ],
    guidance:
      'A timing fault can cause severe engine damage — drive gently to a shop, don’t delay.',
  },
  P0500: {
    causes: [
      'Faulty vehicle speed sensor',
      'Damaged wiring to the sensor',
      'ABS module fault',
    ],
  },
  P0507: {
    causes: [
      'Vacuum leak',
      'Carbon-fouled throttle body',
      'Faulty idle air control valve',
    ],
  },
  P0522: {
    causes: [
      'Faulty oil pressure sensor',
      'Low engine oil level',
      'Damaged sensor wiring',
    ],
    guidance: 'Check the oil level immediately — if it is low, do not drive.',
  },
  P0562: {
    causes: [
      'Weak or failing battery',
      'Failing alternator',
      'Corroded battery terminals or ground straps',
    ],
  },
  P0606: {
    causes: [
      'Internal ECU fault',
      'Low-voltage event confusing the ECU',
      'Failing ECU power supply',
    ],
  },
  P0615: {
    causes: ['Faulty starter relay', 'Weak battery', 'Damaged relay wiring'],
  },
  P0700: {
    causes: [
      'A transmission-specific fault is stored — read the transmission computer’s codes',
      'Transmission control module communication issue',
    ],
    guidance:
      'This code just means “ask the transmission computer” — a deeper scan shows the real fault.',
  },
  P0730: {
    causes: [
      'Low transmission fluid',
      'Worn clutches or bands',
      'Faulty shift solenoid',
    ],
  },
  P0741: {
    causes: [
      'Faulty torque converter clutch solenoid',
      'Low or degraded transmission fluid',
      'Worn torque converter',
    ],
  },
  P0780: {
    causes: [
      'Low transmission fluid',
      'Faulty shift solenoid',
      'Internal transmission wear',
    ],
  },
  P2101: {
    causes: [
      'Faulty electronic throttle body',
      'Damaged throttle wiring',
      'Carbon buildup jamming the throttle plate',
    ],
  },
  P2119: {
    causes: [
      'Carbon buildup holding the throttle open',
      'Faulty electronic throttle body',
    ],
  },
  P2135: {
    causes: [
      'Faulty throttle position sensor',
      'Damaged sensor wiring or connector',
    ],
  },
  P2195: {
    causes: [
      'Vacuum leak (stuck lean)',
      'Failing oxygen sensor',
      'Exhaust leak',
    ],
  },
  P2196: {
    causes: [
      'Leaking fuel injector (stuck rich)',
      'Failing oxygen sensor',
      'Exhaust leak',
    ],
  },
  C0040: {
    causes: ['Faulty brake pedal switch', 'Damaged switch wiring'],
  },
  U0100: {
    causes: [
      'Low battery voltage dropping modules offline',
      'Loose or corroded CAN wiring connector',
      'Failing engine control module',
    ],
    guidance:
      'Check the battery and its terminals first — most communication faults are voltage problems.',
  },
  U0101: {
    causes: [
      'Low battery voltage dropping modules offline',
      'Loose or corroded CAN wiring connector',
      'Failing transmission control module',
    ],
    guidance:
      'Check the battery and its terminals first — most communication faults are voltage problems.',
  },
  U0121: {
    causes: [
      'Low battery voltage dropping modules offline',
      'Loose or corroded CAN wiring connector',
      'Failing ABS module',
    ],
    guidance:
      'Check the battery and its terminals first — most communication faults are voltage problems.',
  },
  U0140: {
    causes: [
      'Low battery voltage dropping modules offline',
      'Loose or corroded CAN wiring connector',
      'Failing body control module',
    ],
    guidance:
      'Check the battery and its terminals first — most communication faults are voltage problems.',
  },
  B0001: {
    causes: [
      'Airbag system wiring fault',
      'Faulty impact sensor or module',
      'A previous repair left a connector unseated',
    ],
    guidance:
      'Airbag faults need professional diagnosis — the system may not deploy in a crash. Do not probe airbag wiring yourself.',
  },
  B0020: {
    causes: [
      'Airbag system wiring fault',
      'Faulty impact sensor or module',
      'A previous repair left a connector unseated',
    ],
    guidance:
      'Airbag faults need professional diagnosis — the system may not deploy in a crash. Do not probe airbag wiring yourself.',
  },
  B0028: {
    causes: [
      'Airbag system wiring fault',
      'Faulty impact sensor or module',
      'A previous repair left a connector unseated',
    ],
    guidance:
      'Airbag faults need professional diagnosis — the system may not deploy in a crash. Do not probe airbag wiring yourself.',
  },
};

/**
 * Code families handled by pattern, in first-match order. Patterns see the
 * normalised five-character code.
 */
const FAMILIES: ReadonlyArray<{ test: RegExp; entry: CuratedEntry }> = [
  {
    test: /^P030[1-9]$/,
    entry: {
      causes: [
        'Worn spark plug on the indicated cylinder',
        'Failing ignition coil on the indicated cylinder',
        'Faulty fuel injector on the indicated cylinder',
        'Low compression on the indicated cylinder',
      ],
      guidance:
        'If the check-engine light is flashing, stop driving — ongoing misfires can overheat and destroy the catalytic converter.',
    },
  },
  {
    test: /^P035[1-9]$/,
    entry: {
      causes: [
        'Failing ignition coil',
        'Damaged coil wiring or connector',
        'Blown ignition fuse',
      ],
    },
  },
  {
    test: /^P02(0[1-9]|1[0-2])$/,
    entry: {
      causes: [
        'Faulty fuel injector',
        'Damaged injector wiring or connector',
        'ECU injector driver fault',
      ],
    },
  },
  {
    test: /^P075[0-9]$/,
    entry: {
      causes: [
        'Faulty shift solenoid',
        'Low or dirty transmission fluid',
        'Damaged solenoid wiring',
      ],
    },
  },
  {
    test: /^C00(3[5-9]|4[0-9]|5[0-9])$/,
    entry: {
      causes: [
        'Faulty wheel speed sensor',
        'Damaged tone ring on the hub',
        'Wiring damage near the wheel',
      ],
    },
  },
];

function findCurated(code: string): CuratedEntry | undefined {
  if (Object.hasOwn(CURATED, code)) return CURATED[code];
  return FAMILIES.find((family) => family.test.test(code))?.entry;
}

const FALLBACK_CAUSES: Readonly<Record<DtcSystem, string[]>> = {
  powertrain: [
    'A worn or failing sensor in the affected circuit',
    'Damaged wiring or a corroded connector',
    'A vacuum, exhaust or fluid leak near the affected component',
    'An aging part reaching the end of its service life',
  ],
  chassis: [
    'A faulty wheel-speed or brake-system sensor',
    'Damaged wiring near a wheel or suspension component',
    'Low brake fluid or worn brake hardware',
  ],
  body: [
    'A faulty body-system sensor or switch',
    'Damaged wiring or a corroded connector',
    'A failing body control module',
  ],
  network: [
    'Low battery voltage causing modules to drop offline',
    'A loose or corroded CAN wiring connector',
    'A failing control module',
  ],
};

function fallbackCauses(info: DtcInfo): string[] {
  const lead = info.manufacturerSpecific
    ? 'Manufacturer-specific fault — see the vehicle’s service information for this code'
    : info.known
      ? `Fault with the ${info.short.toLowerCase()}`
      : `Unlisted code in the ${describeDtcRange(info.code).description.toLowerCase()} area`;
  return [lead, ...FALLBACK_CAUSES[info.system]];
}

/**
 * Plain-language explanation of a trouble code: what it means, what is probably
 * wrong, and whether it is safe to keep driving. Never throws; syntactically
 * invalid input yields a "caution" explanation for an unrecognised code.
 */
export function explainDtc(code: string): DtcExplanation {
  const info = lookupDtc(code);
  const curated = findCurated(info.code);
  const verdict = VERDICT_BY_SEVERITY[info.severity];
  return {
    ...info,
    causes: curated?.causes ?? fallbackCauses(info),
    verdict,
    guidance: curated?.guidance ?? GUIDANCE_BY_VERDICT[verdict],
  };
}
