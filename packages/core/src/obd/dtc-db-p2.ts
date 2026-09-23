import type { DtcDbEntry } from './dtc-database.ts';

/**
 * Generic powertrain codes P2000–P2FFF and P3400–P3FFF (SAE J2012).
 *
 * Coverage: every code defined in the 2002 J2012 table and the ISO 15031-6 generic list, plus the
 * later J2012 additions that two independent code lists agree on word for word: diesel
 * aftertreatment (reductant/DEF dosing P20xx, SCR NOx catalyst P20EE–P20F3, NOx sensors,
 * particulate filter P24xx, NOx exceedence P2BA7–P2BAF), throttle actuator P2100–P2119 and pedal
 * sensors P2120–P2140, intake runners, wide-band O2 sensors, turbocharger, ignition coils,
 * transmission P27xx/P28xx and cylinder deactivation P34xx. Later J2012 additions found in a single
 * list only (most of P2Bxx–P2Exx) are left out on purpose, and so is P26EA (both lists carry a
 * truncated description): an omitted code still decodes through the range fallback in
 * `dtc-ranges.ts`, whereas a wrong description would mislead the driver.
 *
 * `description` uses J2012 wording and typography: letter designators in quotes ("A" is the first
 * of several), bank/sensor qualifiers in parentheses. Bank 1 is the bank containing cylinder 1;
 * sensor 1 is the sensor closest to the engine. Where revisions only reworded a code (e.g. "Diesel
 * Particulate Filter" became "Particulate Filter"), the current wording is used.
 *
 * `short` is the glanceable HUD label (at most 32 characters, plain English, no code prefix):
 *   - "(B1)" / "(B2)" name the engine bank.
 *   - "Upstream O2" is sensor 1 (before the catalytic converter), "Downstream O2" sensor 2; NOx and
 *     exhaust-temperature sensors keep their J2012 sensor number.
 *   - "DEF" is diesel exhaust fluid (J2012 "reductant"); "exhaust filter" is the diesel/gasoline
 *     particulate filter; "NOx catalyst" is the SCR catalyst; "soot sensor" is the particulate
 *     matter sensor.
 *   - "low" / "high" on a sensor, switch or circuit describe the electrical signal, not the
 *     measured quantity. Where the component name is itself a quantity (exhaust temperature,
 *     pressure regulator, brake vacuum, piston cooling oil) the label says "sensor", "circuit" or
 *     "control", so "Exhaust temp sensor 2 high" can never be read as an overheating exhaust.
 *   - "+current" / "-current" are a wide-band O2 sensor's positive / negative current control
 *     circuits; "control" vs "circuit" separates an actuator's control (driver) circuit from its
 *     own circuit where J2012 defines both (exhaust aftertreatment injector and glow plug).
 *
 * `severity` follows the rubric in `dtc-ranges.ts`: critical only where continuing to drive risks
 * immediate damage or safety (forced engine shutdown, throttle stuck open, alternative-fuel leaks,
 * engine oil level too low, transmission fluid/torque converter/clutch over-temperature); warning
 * for throttle, pedal, fuel, ignition, starter, turbo, cooling and transmission faults and for
 * catalyst/filter over-temperature, DPF clogging and NOx inducement; caution for emissions and
 * economy (O2 sensors and heaters, NOx, catalysts, DEF, EGR, EVAP, DPF efficiency, the engine-off
 * timers that gate the EVAP monitor); info for minor accessories (A/C, PTO, hood switch, lamps).
 */
export const P2_P3_CODES: Readonly<Record<string, DtcDbEntry>> = {
  // P20xx — NOx adsorber, particulate filter, intake runners, reductant (DEF) and SCR
  P2000: {
    description: 'NOx Adsorber Efficiency Below Threshold (Bank 1)',
    short: 'NOx trap efficiency low (B1)',
    severity: 'caution',
  },
  P2001: {
    description: 'NOx Adsorber Efficiency Below Threshold (Bank 2)',
    short: 'NOx trap efficiency low (B2)',
    severity: 'caution',
  },
  P2002: {
    description: 'Particulate Filter Efficiency Below Threshold (Bank 1)',
    short: 'Exhaust filter inefficient (B1)',
    severity: 'caution',
  },
  P2003: {
    description: 'Particulate Filter Efficiency Below Threshold (Bank 2)',
    short: 'Exhaust filter inefficient (B2)',
    severity: 'caution',
  },
  P2004: {
    description: 'Intake Manifold Runner Control Stuck Open (Bank 1)',
    short: 'Intake runner stuck open (B1)',
    severity: 'caution',
  },
  P2005: {
    description: 'Intake Manifold Runner Control Stuck Open (Bank 2)',
    short: 'Intake runner stuck open (B2)',
    severity: 'caution',
  },
  P2006: {
    description: 'Intake Manifold Runner Control Stuck Closed (Bank 1)',
    short: 'Intake runner stuck closed (B1)',
    severity: 'caution',
  },
  P2007: {
    description: 'Intake Manifold Runner Control Stuck Closed (Bank 2)',
    short: 'Intake runner stuck closed (B2)',
    severity: 'caution',
  },
  P2008: {
    description: 'Intake Manifold Runner Control Circuit/Open (Bank 1)',
    short: 'Intake runner circuit open (B1)',
    severity: 'caution',
  },
  P2009: {
    description: 'Intake Manifold Runner Control Circuit Low (Bank 1)',
    short: 'Intake runner low (B1)',
    severity: 'caution',
  },
  P200A: {
    description: 'Intake Manifold Runner Performance (Bank 1)',
    short: 'Intake runner fault (B1)',
    severity: 'caution',
  },
  P200B: {
    description: 'Intake Manifold Runner Performance (Bank 2)',
    short: 'Intake runner fault (B2)',
    severity: 'caution',
  },
  P200C: {
    description: 'Particulate Filter Over Temperature (Bank 1)',
    short: 'Exhaust filter overheating (B1)',
    severity: 'warning',
  },
  P200D: {
    description: 'Particulate Filter Over Temperature (Bank 2)',
    short: 'Exhaust filter overheating (B2)',
    severity: 'warning',
  },
  P200E: {
    description: 'Catalyst System Over Temperature (Bank 1)',
    short: 'Catalyst overheating (B1)',
    severity: 'warning',
  },
  P200F: {
    description: 'Catalyst System Over Temperature (Bank 2)',
    short: 'Catalyst overheating (B2)',
    severity: 'warning',
  },
  P2010: {
    description: 'Intake Manifold Runner Control Circuit High (Bank 1)',
    short: 'Intake runner high (B1)',
    severity: 'caution',
  },
  P2011: {
    description: 'Intake Manifold Runner Control Circuit/Open (Bank 2)',
    short: 'Intake runner circuit open (B2)',
    severity: 'caution',
  },
  P2012: {
    description: 'Intake Manifold Runner Control Circuit Low (Bank 2)',
    short: 'Intake runner low (B2)',
    severity: 'caution',
  },
  P2013: {
    description: 'Intake Manifold Runner Control Circuit High (Bank 2)',
    short: 'Intake runner high (B2)',
    severity: 'caution',
  },
  P2014: {
    description: 'Intake Manifold Runner Position Sensor/Switch Circuit (Bank 1)',
    short: 'Runner sensor circuit (B1)',
    severity: 'caution',
  },
  P2015: {
    description: 'Intake Manifold Runner Position Sensor/Switch Circuit Range/Performance (Bank 1)',
    short: 'Runner sensor out of range (B1)',
    severity: 'caution',
  },
  P2016: {
    description: 'Intake Manifold Runner Position Sensor/Switch Circuit Low (Bank 1)',
    short: 'Runner sensor low (B1)',
    severity: 'caution',
  },
  P2017: {
    description: 'Intake Manifold Runner Position Sensor/Switch Circuit High (Bank 1)',
    short: 'Runner sensor high (B1)',
    severity: 'caution',
  },
  P2018: {
    description: 'Intake Manifold Runner Position Sensor/Switch Circuit Intermittent (Bank 1)',
    short: 'Runner sensor erratic (B1)',
    severity: 'caution',
  },
  P2019: {
    description: 'Intake Manifold Runner Position Sensor/Switch Circuit (Bank 2)',
    short: 'Runner sensor circuit (B2)',
    severity: 'caution',
  },
  P201A: {
    description: 'Reductant Injection Valve Circuit Range/Performance (Bank 2 Unit 1)',
    short: 'DEF injector out of range (B2)',
    severity: 'caution',
  },
  P201B: {
    description: 'Intake Manifold Runner Control Actuator Supply Voltage Low (Bank 1)',
    short: 'Intake runner supply low (B1)',
    severity: 'caution',
  },
  P201C: {
    description: 'Intake Manifold Runner Control Actuator Supply Voltage Low (Bank 2)',
    short: 'Intake runner supply low (B2)',
    severity: 'caution',
  },
  P201D: {
    description: 'Intake Manifold Runner Control Actuator Internal Performance (Bank 1)',
    short: 'Runner actuator fault (B1)',
    severity: 'caution',
  },
  P201E: {
    description: 'Intake Manifold Runner Control Actuator Internal Performance (Bank 2)',
    short: 'Runner actuator fault (B2)',
    severity: 'caution',
  },
  P201F: {
    description: 'Reductant Pump "A" Stuck On',
    short: 'DEF pump A stuck on',
    severity: 'caution',
  },
  P2020: {
    description: 'Intake Manifold Runner Position Sensor/Switch Circuit Range/Performance (Bank 2)',
    short: 'Runner sensor out of range (B2)',
    severity: 'caution',
  },
  P2021: {
    description: 'Intake Manifold Runner Position Sensor/Switch Circuit Low (Bank 2)',
    short: 'Runner sensor low (B2)',
    severity: 'caution',
  },
  P2022: {
    description: 'Intake Manifold Runner Position Sensor/Switch Circuit High (Bank 2)',
    short: 'Runner sensor high (B2)',
    severity: 'caution',
  },
  P2023: {
    description: 'Intake Manifold Runner Position Sensor/Switch Circuit Intermittent (Bank 2)',
    short: 'Runner sensor erratic (B2)',
    severity: 'caution',
  },
  P2024: {
    description: 'Evaporative Emission Fuel Vapor Temperature Sensor Circuit',
    short: 'EVAP vapor temp sensor circuit',
    severity: 'caution',
  },
  P2025: {
    description: 'Evaporative Emission Fuel Vapor Temperature Sensor Performance',
    short: 'EVAP vapor temp sensor fault',
    severity: 'caution',
  },
  P2026: {
    description: 'Evaporative Emission Fuel Vapor Temperature Sensor Circuit Low Voltage',
    short: 'EVAP vapor temp sensor low',
    severity: 'caution',
  },
  P2027: {
    description: 'Evaporative Emission Fuel Vapor Temperature Sensor Circuit High Voltage',
    short: 'EVAP vapor temp sensor high',
    severity: 'caution',
  },
  P2028: {
    description: 'Evaporative Emission Fuel Vapor Temperature Sensor Circuit Intermittent',
    short: 'EVAP vapor temp sensor erratic',
    severity: 'caution',
  },
  P2029: {
    description: 'Fuel Fired Heater Disabled',
    short: 'Fuel-fired heater disabled',
    severity: 'info',
  },
  P202A: {
    description: 'Reductant Tank Heater Control Circuit/Open',
    short: 'DEF tank heater circuit open',
    severity: 'caution',
  },
  P202B: {
    description: 'Reductant Tank Heater Control Circuit Low',
    short: 'DEF tank heater low',
    severity: 'caution',
  },
  P202C: {
    description: 'Reductant Tank Heater Control Circuit High',
    short: 'DEF tank heater high',
    severity: 'caution',
  },
  P202D: {
    description: 'Reductant Leakage',
    short: 'DEF leak',
    severity: 'caution',
  },
  P202E: {
    description: 'Reductant Injection Valve Circuit Range/Performance (Bank 1 Unit 1)',
    short: 'DEF injector out of range (B1)',
    severity: 'caution',
  },
  P202F: {
    description: 'Reductant/Regeneration Supply Control Circuit Range/Performance',
    short: 'DEF/regen supply out of range',
    severity: 'caution',
  },
  P2030: {
    description: 'Fuel Fired Heater Performance',
    short: 'Fuel-fired heater fault',
    severity: 'info',
  },
  P2031: {
    description: 'Exhaust Gas Temperature Sensor Circuit (Bank 1 Sensor 2)',
    short: 'Exhaust temp 2 circuit (B1)',
    severity: 'caution',
  },
  P2032: {
    description: 'Exhaust Gas Temperature Sensor Circuit Low (Bank 1 Sensor 2)',
    short: 'Exhaust temp sensor 2 low (B1)',
    severity: 'caution',
  },
  P2033: {
    description: 'Exhaust Gas Temperature Sensor Circuit High (Bank 1 Sensor 2)',
    short: 'Exhaust temp sensor 2 high (B1)',
    severity: 'caution',
  },
  P2034: {
    description: 'Exhaust Gas Temperature Sensor Circuit (Bank 2 Sensor 2)',
    short: 'Exhaust temp 2 circuit (B2)',
    severity: 'caution',
  },
  P2035: {
    description: 'Exhaust Gas Temperature Sensor Circuit Low (Bank 2 Sensor 2)',
    short: 'Exhaust temp sensor 2 low (B2)',
    severity: 'caution',
  },
  P2036: {
    description: 'Exhaust Gas Temperature Sensor Circuit High (Bank 2 Sensor 2)',
    short: 'Exhaust temp sensor 2 high (B2)',
    severity: 'caution',
  },
  P2037: {
    description: 'Reductant Injection Air Pressure Sensor "A" Circuit',
    short: 'DEF air sensor A circuit',
    severity: 'caution',
  },
  P2038: {
    description: 'Reductant Injection Air Pressure Sensor "A" Circuit Range/Performance',
    short: 'DEF air sensor A out of range',
    severity: 'caution',
  },
  P2039: {
    description: 'Reductant Injection Air Pressure Sensor "A" Circuit Low',
    short: 'DEF air sensor A low',
    severity: 'caution',
  },
  P203A: {
    description: 'Reductant Level Sensor "A" Circuit',
    short: 'DEF level sensor A circuit',
    severity: 'caution',
  },
  P203B: {
    description: 'Reductant Level Sensor "A" Circuit Range/Performance',
    short: 'DEF level sensor A out of range',
    severity: 'caution',
  },
  P203C: {
    description: 'Reductant Level Sensor "A" Circuit Low',
    short: 'DEF level sensor A low',
    severity: 'caution',
  },
  P203D: {
    description: 'Reductant Level Sensor "A" Circuit High',
    short: 'DEF level sensor A high',
    severity: 'caution',
  },
  P203E: {
    description: 'Reductant Level Sensor "A" Circuit Intermittent/Erratic',
    short: 'DEF level sensor A erratic',
    severity: 'caution',
  },
  P203F: {
    description: 'Reductant Level Too Low',
    short: 'DEF level too low',
    severity: 'warning',
  },
  P2040: {
    description: 'Reductant Injection Air Pressure Sensor "A" Circuit High',
    short: 'DEF air sensor A high',
    severity: 'caution',
  },
  P2041: {
    description: 'Reductant Injection Air Pressure Sensor "A" Circuit Intermittent',
    short: 'DEF air sensor A erratic',
    severity: 'caution',
  },
  P2042: {
    description: 'Reductant Temperature Sensor Circuit',
    short: 'DEF temp sensor circuit',
    severity: 'caution',
  },
  P2043: {
    description: 'Reductant Temperature Sensor Circuit Range/Performance',
    short: 'DEF temp sensor out of range',
    severity: 'caution',
  },
  P2044: {
    description: 'Reductant Temperature Sensor Circuit Low',
    short: 'DEF temp sensor low',
    severity: 'caution',
  },
  P2045: {
    description: 'Reductant Temperature Sensor Circuit High',
    short: 'DEF temp sensor high',
    severity: 'caution',
  },
  P2046: {
    description: 'Reductant Temperature Sensor Circuit Intermittent',
    short: 'DEF temp sensor erratic',
    severity: 'caution',
  },
  P2047: {
    description: 'Reductant Injection Valve Circuit/Open (Bank 1 Unit 1)',
    short: 'DEF injector circuit open (B1)',
    severity: 'caution',
  },
  P2048: {
    description: 'Reductant Injection Valve Circuit Low (Bank 1 Unit 1)',
    short: 'DEF injector low (B1)',
    severity: 'caution',
  },
  P2049: {
    description: 'Reductant Injection Valve Circuit High (Bank 1 Unit 1)',
    short: 'DEF injector high (B1)',
    severity: 'caution',
  },
  P204A: {
    description: 'Reductant Pressure Sensor Circuit',
    short: 'DEF pressure sensor circuit',
    severity: 'caution',
  },
  P204B: {
    description: 'Reductant Pressure Sensor Circuit Range/Performance',
    short: 'DEF pressure sensor out of range',
    severity: 'caution',
  },
  P204C: {
    description: 'Reductant Pressure Sensor Circuit Low',
    short: 'DEF pressure sensor low',
    severity: 'caution',
  },
  P204D: {
    description: 'Reductant Pressure Sensor Circuit High',
    short: 'DEF pressure sensor high',
    severity: 'caution',
  },
  P204E: {
    description: 'Reductant Pressure Sensor Circuit Intermittent/Erratic',
    short: 'DEF pressure sensor erratic',
    severity: 'caution',
  },
  P204F: {
    description: 'Reductant System Performance (Bank 1)',
    short: 'DEF system fault (B1)',
    severity: 'caution',
  },
  P2050: {
    description: 'Reductant Injection Valve Circuit/Open (Bank 2 Unit 1)',
    short: 'DEF injector circuit open (B2)',
    severity: 'caution',
  },
  P2051: {
    description: 'Reductant Injection Valve Circuit Low (Bank 2 Unit 1)',
    short: 'DEF injector low (B2)',
    severity: 'caution',
  },
  P2052: {
    description: 'Reductant Injection Valve Circuit High (Bank 2 Unit 1)',
    short: 'DEF injector high (B2)',
    severity: 'caution',
  },
  P2053: {
    description: 'Reductant Injection Valve Circuit/Open (Bank 1 Unit 2)',
    short: 'DEF injector 2 circuit open (B1)',
    severity: 'caution',
  },
  P2054: {
    description: 'Reductant Injection Valve Circuit Low (Bank 1 Unit 2)',
    short: 'DEF injector 2 low (B1)',
    severity: 'caution',
  },
  P2055: {
    description: 'Reductant Injection Valve Circuit High (Bank 1 Unit 2)',
    short: 'DEF injector 2 high (B1)',
    severity: 'caution',
  },
  P2056: {
    description: 'Reductant Injection Valve Circuit/Open (Bank 2 Unit 2)',
    short: 'DEF injector 2 circuit open (B2)',
    severity: 'caution',
  },
  P2057: {
    description: 'Reductant Injection Valve Circuit Low (Bank 2 Unit 2)',
    short: 'DEF injector 2 low (B2)',
    severity: 'caution',
  },
  P2058: {
    description: 'Reductant Injection Valve Circuit High (Bank 2 Unit 2)',
    short: 'DEF injector 2 high (B2)',
    severity: 'caution',
  },
  P2059: {
    description: 'Reductant Injection Air Pump Control Circuit/Open',
    short: 'DEF air pump circuit open',
    severity: 'caution',
  },
  P205A: {
    description: 'Reductant Tank Temperature Sensor Circuit',
    short: 'DEF tank temp sensor circuit',
    severity: 'caution',
  },
  P205B: {
    description: 'Reductant Tank Temperature Sensor Circuit Range/Performance',
    short: 'DEF tank temp sensor fault',
    severity: 'caution',
  },
  P205C: {
    description: 'Reductant Tank Temperature Sensor Circuit Low',
    short: 'DEF tank temp sensor low',
    severity: 'caution',
  },
  P205D: {
    description: 'Reductant Tank Temperature Sensor Circuit High',
    short: 'DEF tank temp sensor high',
    severity: 'caution',
  },
  P205E: {
    description: 'Reductant Tank Temperature Sensor Circuit Intermittent/Erratic',
    short: 'DEF tank temp sensor erratic',
    severity: 'caution',
  },
  P205F: {
    description: 'Reductant System Performance (Bank 2)',
    short: 'DEF system fault (B2)',
    severity: 'caution',
  },
  P2060: {
    description: 'Reductant Injection Air Pump Control Circuit Low',
    short: 'DEF air pump low',
    severity: 'caution',
  },
  P2061: {
    description: 'Reductant Injection Air Pump Control Circuit High',
    short: 'DEF air pump high',
    severity: 'caution',
  },
  P2062: {
    description: 'Reductant/Regeneration Supply Control Circuit/Open',
    short: 'DEF/regen supply circuit open',
    severity: 'caution',
  },
  P2063: {
    description: 'Reductant/Regeneration Supply Control Circuit Low',
    short: 'DEF/regen supply low',
    severity: 'caution',
  },
  P2064: {
    description: 'Reductant/Regeneration Supply Control Circuit High',
    short: 'DEF/regen supply high',
    severity: 'caution',
  },
  P2065: {
    description: 'Fuel Level Sensor "B" Circuit',
    short: 'Fuel level sensor B circuit',
    severity: 'caution',
  },
  P2066: {
    description: 'Fuel Level Sensor "B" Performance',
    short: 'Fuel level sensor B fault',
    severity: 'caution',
  },
  P2067: {
    description: 'Fuel Level Sensor "B" Circuit Low',
    short: 'Fuel level sensor B low',
    severity: 'caution',
  },
  P2068: {
    description: 'Fuel Level Sensor "B" Circuit High',
    short: 'Fuel level sensor B high',
    severity: 'caution',
  },
  P2069: {
    description: 'Fuel Level Sensor "B" Circuit Intermittent',
    short: 'Fuel level sensor B erratic',
    severity: 'caution',
  },
  P206A: {
    description: 'Reductant Quality Sensor Circuit',
    short: 'DEF quality sensor circuit',
    severity: 'caution',
  },
  P206B: {
    description: 'Reductant Quality Sensor Circuit Range/Performance',
    short: 'DEF quality sensor out of range',
    severity: 'caution',
  },
  P206C: {
    description: 'Reductant Quality Sensor Circuit Low',
    short: 'DEF quality sensor low',
    severity: 'caution',
  },
  P206D: {
    description: 'Reductant Quality Sensor Circuit High',
    short: 'DEF quality sensor high',
    severity: 'caution',
  },
  P206E: {
    description: 'Intake Manifold Tuning (IMT) Valve Stuck Open (Bank 2)',
    short: 'Tuning valve stuck open (B2)',
    severity: 'caution',
  },
  P206F: {
    description: 'Intake Manifold Tuning (IMT) Valve Stuck Closed (Bank 2)',
    short: 'Tuning valve stuck closed (B2)',
    severity: 'caution',
  },
  P2070: {
    description: 'Intake Manifold Tuning (IMT) Valve Stuck Open (Bank 1)',
    short: 'Tuning valve stuck open (B1)',
    severity: 'caution',
  },
  P2071: {
    description: 'Intake Manifold Tuning (IMT) Valve Stuck Closed (Bank 1)',
    short: 'Tuning valve stuck closed (B1)',
    severity: 'caution',
  },
  P2072: {
    description: 'Throttle Actuator Control System - Ice Blockage (Bank 1)',
    short: 'Throttle blocked by ice (B1)',
    severity: 'warning',
  },
  P2073: {
    description: 'Manifold Absolute Pressure/Mass Air Flow - Throttle Position Correlation at Idle',
    short: 'Airflow/throttle mismatch (idle)',
    severity: 'warning',
  },
  P2074: {
    description:
      'Manifold Absolute Pressure/Mass Air Flow - Throttle Position Correlation at Higher Load',
    short: 'Airflow/throttle mismatch (load)',
    severity: 'warning',
  },
  P2075: {
    description: 'Intake Manifold Tuning (IMT) Valve Position Sensor/Switch Circuit (Bank 1)',
    short: 'Tuning valve sensor circuit (B1)',
    severity: 'caution',
  },
  P2076: {
    description:
      'Intake Manifold Tuning (IMT) Valve Position Sensor/Switch Circuit Range/Performance (Bank 1)',
    short: 'Tuning valve sensor fault (B1)',
    severity: 'caution',
  },
  P2077: {
    description: 'Intake Manifold Tuning (IMT) Valve Position Sensor/Switch Circuit Low (Bank 1)',
    short: 'Tuning valve sensor low (B1)',
    severity: 'caution',
  },
  P2078: {
    description: 'Intake Manifold Tuning (IMT) Valve Position Sensor/Switch Circuit High (Bank 1)',
    short: 'Tuning valve sensor high (B1)',
    severity: 'caution',
  },
  P2079: {
    description:
      'Intake Manifold Tuning (IMT) Valve Position Sensor/Switch Circuit Intermittent (Bank 1)',
    short: 'Tuning valve sensor erratic (B1)',
    severity: 'caution',
  },
  P207A: {
    description: 'Intake Manifold Tuning (IMT) Valve Position Sensor/Switch Circuit (Bank 2)',
    short: 'Tuning valve sensor circuit (B2)',
    severity: 'caution',
  },
  P207B: {
    description:
      'Intake Manifold Tuning (IMT) Valve Position Sensor/Switch Circuit Range/Performance (Bank 2)',
    short: 'Tuning valve sensor fault (B2)',
    severity: 'caution',
  },
  P207C: {
    description: 'Intake Manifold Tuning (IMT) Valve Position Sensor/Switch Circuit Low (Bank 2)',
    short: 'Tuning valve sensor low (B2)',
    severity: 'caution',
  },
  P207D: {
    description: 'Intake Manifold Tuning (IMT) Valve Position Sensor/Switch Circuit High (Bank 2)',
    short: 'Tuning valve sensor high (B2)',
    severity: 'caution',
  },
  P207E: {
    description:
      'Intake Manifold Tuning (IMT) Valve Position Sensor/Switch Circuit Intermittent (Bank 2)',
    short: 'Tuning valve sensor erratic (B2)',
    severity: 'caution',
  },
  P207F: {
    description: 'Reductant Quality Performance',
    short: 'Poor DEF quality',
    severity: 'warning',
  },
  P2080: {
    description: 'Exhaust Gas Temperature Sensor Circuit Range/Performance (Bank 1 Sensor 1)',
    short: 'Exhaust temp sensor 1 fault (B1)',
    severity: 'caution',
  },
  P2081: {
    description: 'Exhaust Gas Temperature Sensor Circuit Intermittent (Bank 1 Sensor 1)',
    short: 'Exhaust temp 1 erratic (B1)',
    severity: 'caution',
  },
  P2082: {
    description: 'Exhaust Gas Temperature Sensor Circuit Range/Performance (Bank 2 Sensor 1)',
    short: 'Exhaust temp sensor 1 fault (B2)',
    severity: 'caution',
  },
  P2083: {
    description: 'Exhaust Gas Temperature Sensor Circuit Intermittent (Bank 2 Sensor 1)',
    short: 'Exhaust temp 1 erratic (B2)',
    severity: 'caution',
  },
  P2084: {
    description: 'Exhaust Gas Temperature Sensor Circuit Range/Performance (Bank 1 Sensor 2)',
    short: 'Exhaust temp sensor 2 fault (B1)',
    severity: 'caution',
  },
  P2085: {
    description: 'Exhaust Gas Temperature Sensor Circuit Intermittent (Bank 1 Sensor 2)',
    short: 'Exhaust temp 2 erratic (B1)',
    severity: 'caution',
  },
  P2086: {
    description: 'Exhaust Gas Temperature Sensor Circuit Range/Performance (Bank 2 Sensor 2)',
    short: 'Exhaust temp sensor 2 fault (B2)',
    severity: 'caution',
  },
  P2087: {
    description: 'Exhaust Gas Temperature Sensor Circuit Intermittent (Bank 2 Sensor 2)',
    short: 'Exhaust temp 2 erratic (B2)',
    severity: 'caution',
  },
  P2088: {
    description: '"A" Camshaft Position Actuator Control Circuit Low (Bank 1)',
    short: 'Cam timing A control low (B1)',
    severity: 'warning',
  },
  P2089: {
    description: '"A" Camshaft Position Actuator Control Circuit High (Bank 1)',
    short: 'Cam timing A control high (B1)',
    severity: 'warning',
  },
  P208A: {
    description: 'Reductant Pump "A" Control Circuit/Open',
    short: 'DEF pump A circuit open',
    severity: 'caution',
  },
  P208B: {
    description: 'Reductant Pump "A" Control Performance/Stuck Off',
    short: 'DEF pump A stuck off',
    severity: 'caution',
  },
  P208C: {
    description: 'Reductant Pump "A" Control Circuit Low',
    short: 'DEF pump A low',
    severity: 'caution',
  },
  P208D: {
    description: 'Reductant Pump "A" Control Circuit High',
    short: 'DEF pump A high',
    severity: 'caution',
  },
  P208E: {
    description: 'Reductant Injection Valve Stuck Closed (Bank 1 Unit 1)',
    short: 'DEF injector stuck closed (B1)',
    severity: 'caution',
  },
  P208F: {
    description: 'Reductant Injection Valve Stuck Closed (Bank 2 Unit 1)',
    short: 'DEF injector stuck closed (B2)',
    severity: 'caution',
  },
  P2090: {
    description: '"B" Camshaft Position Actuator Control Circuit Low (Bank 1)',
    short: 'Cam timing B control low (B1)',
    severity: 'warning',
  },
  P2091: {
    description: '"B" Camshaft Position Actuator Control Circuit High (Bank 1)',
    short: 'Cam timing B control high (B1)',
    severity: 'warning',
  },
  P2092: {
    description: '"A" Camshaft Position Actuator Control Circuit Low (Bank 2)',
    short: 'Cam timing A control low (B2)',
    severity: 'warning',
  },
  P2093: {
    description: '"A" Camshaft Position Actuator Control Circuit High (Bank 2)',
    short: 'Cam timing A control high (B2)',
    severity: 'warning',
  },
  P2094: {
    description: '"B" Camshaft Position Actuator Control Circuit Low (Bank 2)',
    short: 'Cam timing B control low (B2)',
    severity: 'warning',
  },
  P2095: {
    description: '"B" Camshaft Position Actuator Control Circuit High (Bank 2)',
    short: 'Cam timing B control high (B2)',
    severity: 'warning',
  },
  P2096: {
    description: 'Post Catalyst Fuel Trim System Too Lean (Bank 1)',
    short: 'Lean after catalyst (B1)',
    severity: 'caution',
  },
  P2097: {
    description: 'Post Catalyst Fuel Trim System Too Rich (Bank 1)',
    short: 'Rich after catalyst (B1)',
    severity: 'caution',
  },
  P2098: {
    description: 'Post Catalyst Fuel Trim System Too Lean (Bank 2)',
    short: 'Lean after catalyst (B2)',
    severity: 'caution',
  },
  P2099: {
    description: 'Post Catalyst Fuel Trim System Too Rich (Bank 2)',
    short: 'Rich after catalyst (B2)',
    severity: 'caution',
  },
  P209A: {
    description: 'Reductant Injection Air Pressure Sensor "B" Circuit',
    short: 'DEF air sensor B circuit',
    severity: 'caution',
  },
  P209B: {
    description: 'Reductant Injection Air Pressure Sensor "B" Circuit Range/Performance',
    short: 'DEF air sensor B out of range',
    severity: 'caution',
  },
  P209C: {
    description: 'Reductant Injection Air Pressure Sensor "B" Circuit Low',
    short: 'DEF air sensor B low',
    severity: 'caution',
  },
  P209D: {
    description: 'Reductant Injection Air Pressure Sensor "B" Circuit High',
    short: 'DEF air sensor B high',
    severity: 'caution',
  },
  P209E: {
    description: 'Reductant Injection Air Pressure Sensor "A"/"B" Correlation',
    short: 'DEF air sensors A/B mismatch',
    severity: 'caution',
  },
  P209F: {
    description: 'Reductant Tank Heater Control Circuit Performance',
    short: 'DEF tank heater fault',
    severity: 'caution',
  },
  P20A0: {
    description: 'Reductant Purge Control Valve "A" Circuit/Open',
    short: 'DEF purge valve A circuit open',
    severity: 'caution',
  },
  P20A1: {
    description: 'Reductant Purge Control Valve "A" Performance',
    short: 'DEF purge valve A fault',
    severity: 'caution',
  },
  P20A2: {
    description: 'Reductant Purge Control Valve "A" Circuit Low',
    short: 'DEF purge valve A low',
    severity: 'caution',
  },
  P20A3: {
    description: 'Reductant Purge Control Valve "A" Circuit High',
    short: 'DEF purge valve A high',
    severity: 'caution',
  },
  P20A4: {
    description: 'Reductant Purge Control Valve "A" Stuck Open',
    short: 'DEF purge valve A stuck open',
    severity: 'caution',
  },
  P20A5: {
    description: 'Reductant Purge Control Valve "A" Stuck Closed',
    short: 'DEF purge valve A stuck closed',
    severity: 'caution',
  },
  P20A6: {
    description: 'Reductant Injection Air Pressure Control Valve Circuit/Open',
    short: 'DEF air valve circuit open',
    severity: 'caution',
  },
  P20A7: {
    description: 'Reductant Injection Air Pressure Control Valve Performance',
    short: 'DEF air valve fault',
    severity: 'caution',
  },
  P20A8: {
    description: 'Reductant Injection Air Pressure Control Valve Circuit Low',
    short: 'DEF air valve low',
    severity: 'caution',
  },
  P20A9: {
    description: 'Reductant Injection Air Pressure Control Valve Circuit High',
    short: 'DEF air valve high',
    severity: 'caution',
  },
  P20AA: {
    description: 'Reductant Injection Air Pressure Control Valve Stuck Open',
    short: 'DEF air valve stuck open',
    severity: 'caution',
  },
  P20AB: {
    description: 'Reductant Injection Air Pressure Control Valve Stuck Closed',
    short: 'DEF air valve stuck closed',
    severity: 'caution',
  },
  P20AC: {
    description: 'Reductant Metering Unit Temperature Sensor Circuit',
    short: 'DEF doser temp sensor circuit',
    severity: 'caution',
  },
  P20AD: {
    description: 'Reductant Metering Unit Temperature Sensor Circuit Range/Performance',
    short: 'DEF doser temp sensor fault',
    severity: 'caution',
  },
  P20AE: {
    description: 'Reductant Metering Unit Temperature Sensor Circuit Low',
    short: 'DEF doser temp sensor low',
    severity: 'caution',
  },
  P20AF: {
    description: 'Reductant Metering Unit Temperature Sensor Circuit High',
    short: 'DEF doser temp sensor high',
    severity: 'caution',
  },
  P20B0: {
    description: 'Reductant Metering Unit Temperature Sensor Circuit Intermittent/Erratic',
    short: 'DEF doser temp sensor erratic',
    severity: 'caution',
  },
  P20B1: {
    description: 'Reductant Heater Coolant Control Valve Circuit/Open',
    short: 'DEF coolant valve circuit open',
    severity: 'caution',
  },
  P20B2: {
    description: 'Reductant Heater Coolant Control Valve Performance/Stuck Open',
    short: 'DEF coolant valve stuck open',
    severity: 'caution',
  },
  P20B3: {
    description: 'Reductant Heater Coolant Control Valve Circuit Low',
    short: 'DEF coolant valve low',
    severity: 'caution',
  },
  P20B4: {
    description: 'Reductant Heater Coolant Control Valve Circuit High',
    short: 'DEF coolant valve high',
    severity: 'caution',
  },
  P20B5: {
    description: 'Reductant Metering Unit Heater Control Circuit/Open',
    short: 'DEF doser heater circuit open',
    severity: 'caution',
  },
  P20B6: {
    description: 'Reductant Metering Unit Heater Control Circuit Performance',
    short: 'DEF doser heater fault',
    severity: 'caution',
  },
  P20B7: {
    description: 'Reductant Metering Unit Heater Control Circuit Low',
    short: 'DEF doser heater low',
    severity: 'caution',
  },
  P20B8: {
    description: 'Reductant Metering Unit Heater Control Circuit High',
    short: 'DEF doser heater high',
    severity: 'caution',
  },
  P20B9: {
    description: 'Reductant Heater "A" Control Circuit/Open',
    short: 'DEF heater A circuit open',
    severity: 'caution',
  },
  P20BA: {
    description: 'Reductant Heater "A" Control Circuit Performance',
    short: 'DEF heater A fault',
    severity: 'caution',
  },
  P20BB: {
    description: 'Reductant Heater "A" Control Circuit Low',
    short: 'DEF heater A low',
    severity: 'caution',
  },
  P20BC: {
    description: 'Reductant Heater "A" Control Circuit High',
    short: 'DEF heater A high',
    severity: 'caution',
  },
  P20BD: {
    description: 'Reductant Heater "B" Control Circuit/Open',
    short: 'DEF heater B circuit open',
    severity: 'caution',
  },
  P20BE: {
    description: 'Reductant Heater "B" Control Circuit Performance',
    short: 'DEF heater B fault',
    severity: 'caution',
  },
  P20BF: {
    description: 'Reductant Heater "B" Control Circuit Low',
    short: 'DEF heater B low',
    severity: 'caution',
  },
  P20C0: {
    description: 'Reductant Heater "B" Control Circuit High',
    short: 'DEF heater B high',
    severity: 'caution',
  },
  P20C1: {
    description: 'Reductant Heater "C" Control Circuit/Open',
    short: 'DEF heater C circuit open',
    severity: 'caution',
  },
  P20C2: {
    description: 'Reductant Heater "C" Control Circuit Performance',
    short: 'DEF heater C fault',
    severity: 'caution',
  },
  P20C3: {
    description: 'Reductant Heater "C" Control Circuit Low',
    short: 'DEF heater C low',
    severity: 'caution',
  },
  P20C4: {
    description: 'Reductant Heater "C" Control Circuit High',
    short: 'DEF heater C high',
    severity: 'caution',
  },
  P20C5: {
    description: 'Reductant Heater "D" Control Circuit/Open',
    short: 'DEF heater D circuit open',
    severity: 'caution',
  },
  P20C6: {
    description: 'Reductant Heater "D" Control Circuit Performance',
    short: 'DEF heater D fault',
    severity: 'caution',
  },
  P20C7: {
    description: 'Reductant Heater "D" Control Circuit Low',
    short: 'DEF heater D low',
    severity: 'caution',
  },
  P20C8: {
    description: 'Reductant Heater "D" Control Circuit High',
    short: 'DEF heater D high',
    severity: 'caution',
  },
  P20C9: {
    description: 'Reductant Control Module Requested MIL Illumination',
    short: 'DEF system fault reported',
    severity: 'caution',
  },
  P20CA: {
    description: 'Reductant Injection Air Pressure Leakage',
    short: 'DEF air pressure leak',
    severity: 'caution',
  },
  P20CB: {
    description: 'Exhaust Aftertreatment Fuel Injector "A" Control Circuit/Open',
    short: 'Exhaust injector A control open',
    severity: 'caution',
  },
  P20CC: {
    description: 'Exhaust Aftertreatment Fuel Injector "A" Control Performance',
    short: 'Exhaust injector A control fault',
    severity: 'caution',
  },
  P20CD: {
    description: 'Exhaust Aftertreatment Fuel Injector "A" Control Circuit Low',
    short: 'Exhaust injector A control low',
    severity: 'caution',
  },
  P20CE: {
    description: 'Exhaust Aftertreatment Fuel Injector "A" Control Circuit High',
    short: 'Exhaust injector A control high',
    severity: 'caution',
  },
  P20CF: {
    description: 'Exhaust Aftertreatment Fuel Injector "A" Stuck Open',
    short: 'Exhaust injector A stuck open',
    severity: 'warning',
  },
  P20D0: {
    description: 'Exhaust Aftertreatment Fuel Injector "A" Stuck Closed',
    short: 'Exhaust injector A stuck closed',
    severity: 'caution',
  },
  P20D1: {
    description: 'Exhaust Aftertreatment Fuel Injector "B" Control Circuit/Open',
    short: 'Exhaust injector B control open',
    severity: 'caution',
  },
  P20D2: {
    description: 'Exhaust Aftertreatment Fuel Injector "B" Control Performance',
    short: 'Exhaust injector B control fault',
    severity: 'caution',
  },
  P20D3: {
    description: 'Exhaust Aftertreatment Fuel Injector "B" Control Circuit Low',
    short: 'Exhaust injector B control low',
    severity: 'caution',
  },
  P20D4: {
    description: 'Exhaust Aftertreatment Fuel Injector "B" Control Circuit High',
    short: 'Exhaust injector B control high',
    severity: 'caution',
  },
  P20D5: {
    description: 'Exhaust Aftertreatment Fuel Injector "B" Stuck Open',
    short: 'Exhaust injector B stuck open',
    severity: 'warning',
  },
  P20D6: {
    description: 'Exhaust Aftertreatment Fuel Injector "B" Stuck Closed',
    short: 'Exhaust injector B stuck closed',
    severity: 'caution',
  },
  P20D7: {
    description: 'Exhaust Aftertreatment Fuel Supply Control Circuit/Open',
    short: 'Exhaust fuel valve circuit open',
    severity: 'caution',
  },
  P20D8: {
    description: 'Exhaust Aftertreatment Fuel Supply Control Performance',
    short: 'Exhaust fuel valve fault',
    severity: 'caution',
  },
  P20D9: {
    description: 'Exhaust Aftertreatment Fuel Supply Control Circuit Low',
    short: 'Exhaust fuel valve low',
    severity: 'caution',
  },
  P20DA: {
    description: 'Exhaust Aftertreatment Fuel Supply Control Circuit High',
    short: 'Exhaust fuel valve high',
    severity: 'caution',
  },
  P20DB: {
    description: 'Exhaust Aftertreatment Fuel Supply Control Stuck Open',
    short: 'Exhaust fuel valve stuck open',
    severity: 'warning',
  },
  P20DC: {
    description: 'Exhaust Aftertreatment Fuel Supply Control Stuck Closed',
    short: 'Exhaust fuel valve stuck closed',
    severity: 'caution',
  },
  P20DD: {
    description: 'Exhaust Aftertreatment Fuel Pressure Sensor Circuit',
    short: 'Exhaust fuel sensor circuit',
    severity: 'caution',
  },
  P20DE: {
    description: 'Exhaust Aftertreatment Fuel Pressure Sensor Circuit Range/Performance',
    short: 'Exhaust fuel sensor out of range',
    severity: 'caution',
  },
  P20DF: {
    description: 'Exhaust Aftertreatment Fuel Pressure Sensor Circuit Low',
    short: 'Exhaust fuel sensor low',
    severity: 'caution',
  },
  P20E0: {
    description: 'Exhaust Aftertreatment Fuel Pressure Sensor Circuit High',
    short: 'Exhaust fuel sensor high',
    severity: 'caution',
  },
  P20E1: {
    description: 'Exhaust Aftertreatment Fuel Pressure Sensor Circuit Intermittent/Erratic',
    short: 'Exhaust fuel sensor erratic',
    severity: 'caution',
  },
  P20E2: {
    description: 'Exhaust Gas Temperature Sensor 1/2 Correlation (Bank 1)',
    short: 'Exhaust temp 1/2 mismatch (B1)',
    severity: 'caution',
  },
  P20E3: {
    description: 'Exhaust Gas Temperature Sensor 1/3 Correlation (Bank 1)',
    short: 'Exhaust temp 1/3 mismatch (B1)',
    severity: 'caution',
  },
  P20E4: {
    description: 'Exhaust Gas Temperature Sensor 2/3 Correlation (Bank 1)',
    short: 'Exhaust temp 2/3 mismatch (B1)',
    severity: 'caution',
  },
  P20E5: {
    description: 'Exhaust Gas Temperature Sensor 1/2 Correlation (Bank 2)',
    short: 'Exhaust temp 1/2 mismatch (B2)',
    severity: 'caution',
  },
  P20E6: {
    description: 'Reductant Injection Air Pressure Too Low',
    short: 'DEF air pressure too low',
    severity: 'caution',
  },
  P20E7: {
    description: 'Reductant Injection Air Pressure Too High',
    short: 'DEF air pressure too high',
    severity: 'caution',
  },
  P20E8: {
    description: 'Reductant Pressure Too Low',
    short: 'DEF pressure too low',
    severity: 'caution',
  },
  P20E9: {
    description: 'Reductant Pressure Too High',
    short: 'DEF pressure too high',
    severity: 'caution',
  },
  P20EA: {
    description: 'Reductant Control Module Power Relay De-Energized Performance - Too Early',
    short: 'DEF module relay off too early',
    severity: 'caution',
  },
  P20EB: {
    description: 'Reductant Control Module Power Relay De-Energized Performance - Too Late',
    short: 'DEF module relay off too late',
    severity: 'caution',
  },
  P20EC: {
    description: 'SCR NOx Catalyst - Over Temperature (Bank 1)',
    short: 'NOx catalyst overheating (B1)',
    severity: 'warning',
  },
  P20ED: {
    description: 'SCR NOx Pre-Catalyst - Over Temperature (Bank 1)',
    short: 'NOx pre-cat overheating (B1)',
    severity: 'warning',
  },
  P20EE: {
    description: 'SCR NOx Catalyst Efficiency Below Threshold (Bank 1)',
    short: 'NOx catalyst efficiency low (B1)',
    severity: 'caution',
  },
  P20EF: {
    description: 'SCR NOx Pre-Catalyst Efficiency Below Threshold (Bank 1)',
    short: 'NOx pre-cat efficiency low (B1)',
    severity: 'caution',
  },
  P20F0: {
    description: 'SCR NOx Catalyst - Over Temperature (Bank 2)',
    short: 'NOx catalyst overheating (B2)',
    severity: 'warning',
  },
  P20F1: {
    description: 'SCR NOx Pre-Catalyst - Over Temperature (Bank 2)',
    short: 'NOx pre-cat overheating (B2)',
    severity: 'warning',
  },
  P20F2: {
    description: 'SCR NOx Catalyst Efficiency Below Threshold (Bank 2)',
    short: 'NOx catalyst efficiency low (B2)',
    severity: 'caution',
  },
  P20F3: {
    description: 'SCR NOx Pre-Catalyst Efficiency Below Threshold (Bank 2)',
    short: 'NOx pre-cat efficiency low (B2)',
    severity: 'caution',
  },
  P20F4: {
    description: 'Reductant Consumption Too Low',
    short: 'DEF use too low',
    severity: 'caution',
  },
  P20F5: {
    description: 'Reductant Consumption Too High',
    short: 'DEF use too high',
    severity: 'caution',
  },
  P20F6: {
    description: 'Reductant Injection Valve Stuck Open (Bank 1 Unit 1)',
    short: 'DEF injector stuck open (B1)',
    severity: 'caution',
  },
  P20F7: {
    description: 'Reductant Injection Valve Stuck Open (Bank 2 Unit 1)',
    short: 'DEF injector stuck open (B2)',
    severity: 'caution',
  },
  P20F8: {
    description: 'Intake Manifold Runner Control Circuit Performance (Bank 1)',
    short: 'Intake runner circuit fault (B1)',
    severity: 'caution',
  },
  P20F9: {
    description: 'Intake Manifold Runner Control Circuit Performance (Bank 2)',
    short: 'Intake runner circuit fault (B2)',
    severity: 'caution',
  },
  P20FA: {
    description: 'Reductant Pump "B" Control Circuit/Open',
    short: 'DEF pump B circuit open',
    severity: 'caution',
  },
  P20FB: {
    description: 'Reductant Pump "B" Control Performance/Stuck Off',
    short: 'DEF pump B stuck off',
    severity: 'caution',
  },
  P20FC: {
    description: 'Reductant Pump "B" Control Circuit Low',
    short: 'DEF pump B low',
    severity: 'caution',
  },
  P20FD: {
    description: 'Reductant Pump "B" Control Circuit High',
    short: 'DEF pump B high',
    severity: 'caution',
  },
  P20FE: {
    description: 'Reductant Metering Unit Performance',
    short: 'DEF doser fault',
    severity: 'caution',
  },
  P20FF: {
    description: 'Reductant Control Module Performance',
    short: 'DEF control module fault',
    severity: 'caution',
  },

  // P21xx — throttle actuator and pedal sensors, fuel trim, injector supply, reductant (DEF)
  P2100: {
    description: 'Throttle Actuator "A" Control Motor Circuit/Open',
    short: 'Throttle motor circuit open',
    severity: 'warning',
  },
  P2101: {
    description: 'Throttle Actuator "A" Control Motor Circuit Range/Performance',
    short: 'Throttle motor out of range',
    severity: 'warning',
  },
  P2102: {
    description: 'Throttle Actuator "A" Control Motor Circuit Low',
    short: 'Throttle motor low',
    severity: 'warning',
  },
  P2103: {
    description: 'Throttle Actuator "A" Control Motor Circuit High',
    short: 'Throttle motor high',
    severity: 'warning',
  },
  P2104: {
    description: 'Throttle Actuator Control System - Forced Idle',
    short: 'Throttle fault: forced idle',
    severity: 'warning',
  },
  P2105: {
    description: 'Throttle Actuator Control System - Forced Engine Shutdown',
    short: 'Throttle fault: engine shut off',
    severity: 'critical',
  },
  P2106: {
    description: 'Throttle Actuator Control System - Forced Limited Power',
    short: 'Throttle fault: reduced power',
    severity: 'warning',
  },
  P2107: {
    description: 'Throttle Actuator "A" Control Module Processor',
    short: 'Throttle controller processor',
    severity: 'warning',
  },
  P2108: {
    description: 'Throttle Actuator "A" Control Module Performance',
    short: 'Throttle controller fault',
    severity: 'warning',
  },
  P2109: {
    description: 'Throttle/Pedal Position Sensor "A" Minimum Stop Performance',
    short: 'Throttle/pedal A min stop fault',
    severity: 'warning',
  },
  P210A: {
    description: 'Throttle Actuator "B" Control Motor Circuit/Open',
    short: 'Throttle B motor circuit open',
    severity: 'warning',
  },
  P210B: {
    description: 'Throttle Actuator "B" Control Motor Circuit Range/Performance',
    short: 'Throttle B motor out of range',
    severity: 'warning',
  },
  P210C: {
    description: 'Throttle Actuator "B" Control Motor Circuit Low',
    short: 'Throttle B motor low',
    severity: 'warning',
  },
  P210D: {
    description: 'Throttle Actuator "B" Control Motor Circuit High',
    short: 'Throttle B motor high',
    severity: 'warning',
  },
  P210E: {
    description: 'Throttle/Pedal Position Sensor/Switch "C"/"F" Voltage Correlation',
    short: 'Throttle/pedal C/F mismatch',
    severity: 'warning',
  },
  P210F: {
    description: 'Throttle Actuator "B" Control System - Forced Limited RPM',
    short: 'Throttle B fault: RPM limited',
    severity: 'warning',
  },
  P2110: {
    description: 'Throttle Actuator "A" Control System - Forced Limited RPM',
    short: 'Throttle fault: RPM limited',
    severity: 'warning',
  },
  P2111: {
    description: 'Throttle Actuator "A" Control System - Stuck Open',
    short: 'Throttle stuck open',
    severity: 'critical',
  },
  P2112: {
    description: 'Throttle Actuator "A" Control System - Stuck Closed',
    short: 'Throttle stuck closed',
    severity: 'warning',
  },
  P2113: {
    description: 'Throttle/Pedal Position Sensor "B" Minimum Stop Performance',
    short: 'Throttle/pedal B min stop fault',
    severity: 'warning',
  },
  P2114: {
    description: 'Throttle/Pedal Position Sensor "C" Minimum Stop Performance',
    short: 'Throttle/pedal C min stop fault',
    severity: 'warning',
  },
  P2115: {
    description: 'Throttle/Pedal Position Sensor "D" Minimum Stop Performance',
    short: 'Throttle/pedal D min stop fault',
    severity: 'warning',
  },
  P2116: {
    description: 'Throttle/Pedal Position Sensor "E" Minimum Stop Performance',
    short: 'Throttle/pedal E min stop fault',
    severity: 'warning',
  },
  P2117: {
    description: 'Throttle/Pedal Position Sensor "F" Minimum Stop Performance',
    short: 'Throttle/pedal F min stop fault',
    severity: 'warning',
  },
  P2118: {
    description: 'Throttle Actuator "A" Control Motor Current Range/Performance',
    short: 'Throttle motor current fault',
    severity: 'warning',
  },
  P2119: {
    description: 'Throttle Actuator "A" Control Throttle Body Range/Performance',
    short: 'Throttle body out of range',
    severity: 'warning',
  },
  P211A: {
    description: 'Throttle Actuator "B" Control System - Stuck Open',
    short: 'Throttle B stuck open',
    severity: 'critical',
  },
  P211B: {
    description: 'Throttle Actuator "B" Control System - Stuck Closed',
    short: 'Throttle B stuck closed',
    severity: 'warning',
  },
  P211C: {
    description: 'Throttle Actuator "B" Control Motor Current Range/Performance',
    short: 'Throttle B motor current fault',
    severity: 'warning',
  },
  P211D: {
    description: 'Throttle Actuator "B" Control Throttle Body Range/Performance',
    short: 'Throttle B body out of range',
    severity: 'warning',
  },
  P211E: {
    description: 'Throttle Actuator "B" Control Module Processor',
    short: 'Throttle B controller processor',
    severity: 'warning',
  },
  P211F: {
    description: 'Throttle Actuator "B" Control Module Performance',
    short: 'Throttle B controller fault',
    severity: 'warning',
  },
  P2120: {
    description: 'Throttle/Pedal Position Sensor/Switch "D" Circuit',
    short: 'Throttle/pedal sensor D circuit',
    severity: 'warning',
  },
  P2121: {
    description: 'Throttle/Pedal Position Sensor/Switch "D" Circuit Range/Performance',
    short: 'Throttle/pedal sensor D fault',
    severity: 'warning',
  },
  P2122: {
    description: 'Throttle/Pedal Position Sensor/Switch "D" Circuit Low',
    short: 'Throttle/pedal sensor D low',
    severity: 'warning',
  },
  P2123: {
    description: 'Throttle/Pedal Position Sensor/Switch "D" Circuit High',
    short: 'Throttle/pedal sensor D high',
    severity: 'warning',
  },
  P2124: {
    description: 'Throttle/Pedal Position Sensor/Switch "D" Circuit Intermittent',
    short: 'Throttle/pedal sensor D erratic',
    severity: 'warning',
  },
  P2125: {
    description: 'Throttle/Pedal Position Sensor/Switch "E" Circuit',
    short: 'Throttle/pedal sensor E circuit',
    severity: 'warning',
  },
  P2126: {
    description: 'Throttle/Pedal Position Sensor/Switch "E" Circuit Range/Performance',
    short: 'Throttle/pedal sensor E fault',
    severity: 'warning',
  },
  P2127: {
    description: 'Throttle/Pedal Position Sensor/Switch "E" Circuit Low',
    short: 'Throttle/pedal sensor E low',
    severity: 'warning',
  },
  P2128: {
    description: 'Throttle/Pedal Position Sensor/Switch "E" Circuit High',
    short: 'Throttle/pedal sensor E high',
    severity: 'warning',
  },
  P2129: {
    description: 'Throttle/Pedal Position Sensor/Switch "E" Circuit Intermittent',
    short: 'Throttle/pedal sensor E erratic',
    severity: 'warning',
  },
  P212A: {
    description: 'Throttle Position Sensor/Switch "G" Circuit',
    short: 'Throttle sensor G circuit',
    severity: 'warning',
  },
  P212B: {
    description: 'Throttle Position Sensor/Switch "G" Circuit Range/Performance',
    short: 'Throttle sensor G out of range',
    severity: 'warning',
  },
  P212C: {
    description: 'Throttle Position Sensor/Switch "G" Circuit Low',
    short: 'Throttle sensor G low',
    severity: 'warning',
  },
  P212D: {
    description: 'Throttle Position Sensor/Switch "G" Circuit High',
    short: 'Throttle sensor G high',
    severity: 'warning',
  },
  P212E: {
    description: 'Throttle Position Sensor/Switch "G" Circuit Intermittent',
    short: 'Throttle sensor G erratic',
    severity: 'warning',
  },
  P212F: {
    description: 'Throttle/Pedal Position Sensor/Switch "F"/"G" Voltage Correlation',
    short: 'Throttle/pedal F/G mismatch',
    severity: 'warning',
  },
  P2130: {
    description: 'Throttle/Pedal Position Sensor/Switch "F" Circuit',
    short: 'Throttle/pedal sensor F circuit',
    severity: 'warning',
  },
  P2131: {
    description: 'Throttle/Pedal Position Sensor/Switch "F" Circuit Range/Performance',
    short: 'Throttle/pedal sensor F fault',
    severity: 'warning',
  },
  P2132: {
    description: 'Throttle/Pedal Position Sensor/Switch "F" Circuit Low',
    short: 'Throttle/pedal sensor F low',
    severity: 'warning',
  },
  P2133: {
    description: 'Throttle/Pedal Position Sensor/Switch "F" Circuit High',
    short: 'Throttle/pedal sensor F high',
    severity: 'warning',
  },
  P2134: {
    description: 'Throttle/Pedal Position Sensor/Switch "F" Circuit Intermittent',
    short: 'Throttle/pedal sensor F erratic',
    severity: 'warning',
  },
  P2135: {
    description: 'Throttle/Pedal Position Sensor/Switch "A"/"B" Voltage Correlation',
    short: 'Throttle/pedal A/B mismatch',
    severity: 'warning',
  },
  P2136: {
    description: 'Throttle/Pedal Position Sensor/Switch "A"/"C" Voltage Correlation',
    short: 'Throttle/pedal A/C mismatch',
    severity: 'warning',
  },
  P2137: {
    description: 'Throttle/Pedal Position Sensor/Switch "B"/"C" Voltage Correlation',
    short: 'Throttle/pedal B/C mismatch',
    severity: 'warning',
  },
  P2138: {
    description: 'Throttle/Pedal Position Sensor/Switch "D"/"E" Voltage Correlation',
    short: 'Throttle/pedal D/E mismatch',
    severity: 'warning',
  },
  P2139: {
    description: 'Throttle/Pedal Position Sensor/Switch "D"/"F" Voltage Correlation',
    short: 'Throttle/pedal D/F mismatch',
    severity: 'warning',
  },
  P213A: {
    description: 'Exhaust Gas Recirculation Throttle Control Circuit "B"/Open',
    short: 'EGR throttle B circuit open',
    severity: 'caution',
  },
  P213B: {
    description: 'Exhaust Gas Recirculation Throttle Control Circuit "B" Range/Performance',
    short: 'EGR throttle B out of range',
    severity: 'caution',
  },
  P213C: {
    description: 'Exhaust Gas Recirculation Throttle Control Circuit "B" Low',
    short: 'EGR throttle B low',
    severity: 'caution',
  },
  P213D: {
    description: 'Exhaust Gas Recirculation Throttle Control Circuit "B" High',
    short: 'EGR throttle B high',
    severity: 'caution',
  },
  P213E: {
    description: 'Fuel Injection System Fault - Forced Engine Shutdown',
    short: 'Injection fault: engine shut off',
    severity: 'critical',
  },
  P213F: {
    description: 'Fuel Pump System Fault - Forced Engine Shutdown',
    short: 'Fuel pump fault: engine shut off',
    severity: 'critical',
  },
  P2140: {
    description: 'Throttle/Pedal Position Sensor/Switch "E"/"F" Voltage Correlation',
    short: 'Throttle/pedal E/F mismatch',
    severity: 'warning',
  },
  P2141: {
    description: 'Exhaust Gas Recirculation Throttle Control Circuit "A" Low',
    short: 'EGR throttle A low',
    severity: 'caution',
  },
  P2142: {
    description: 'Exhaust Gas Recirculation Throttle Control Circuit "A" High',
    short: 'EGR throttle A high',
    severity: 'caution',
  },
  P2143: {
    description: 'Exhaust Gas Recirculation Vent Control Circuit/Open',
    short: 'EGR vent valve circuit open',
    severity: 'caution',
  },
  P2144: {
    description: 'Exhaust Gas Recirculation Vent Control Circuit Low',
    short: 'EGR vent valve low',
    severity: 'caution',
  },
  P2145: {
    description: 'Exhaust Gas Recirculation Vent Control Circuit High',
    short: 'EGR vent valve high',
    severity: 'caution',
  },
  P2146: {
    description: 'Fuel Injector Group "A" Supply Voltage Circuit/Open',
    short: 'Injector group A supply circuit',
    severity: 'warning',
  },
  P2147: {
    description: 'Fuel Injector Group "A" Supply Voltage Circuit Low',
    short: 'Injector group A supply low',
    severity: 'warning',
  },
  P2148: {
    description: 'Fuel Injector Group "A" Supply Voltage Circuit High',
    short: 'Injector group A supply high',
    severity: 'warning',
  },
  P2149: {
    description: 'Fuel Injector Group "B" Supply Voltage Circuit/Open',
    short: 'Injector group B supply circuit',
    severity: 'warning',
  },
  P214A: {
    description: 'SCR NOx Catalyst Inlet Temperature Too High',
    short: 'NOx catalyst inlet too hot',
    severity: 'warning',
  },
  P214B: {
    description:
      'SCR NOx Catalyst Inlet Temperature Too High During Particulate Filter Regeneration',
    short: 'NOx catalyst inlet hot (regen)',
    severity: 'warning',
  },
  P214C: {
    description: 'SCR NOx Catalyst Outlet Temperature Too High',
    short: 'NOx catalyst outlet too hot',
    severity: 'warning',
  },
  P214D: {
    description:
      'SCR NOx Catalyst Outlet Temperature Too High During Particulate Filter Regeneration',
    short: 'NOx catalyst outlet hot (regen)',
    severity: 'warning',
  },
  P214E: {
    description: 'Reductant Pump "A" Current Too High',
    short: 'DEF pump A current too high',
    severity: 'caution',
  },
  P214F: {
    description: 'Reductant Heater "A" Current Too High',
    short: 'DEF heater A current high',
    severity: 'caution',
  },
  P2150: {
    description: 'Fuel Injector Group "B" Supply Voltage Circuit Low',
    short: 'Injector group B supply low',
    severity: 'warning',
  },
  P2151: {
    description: 'Fuel Injector Group "B" Supply Voltage Circuit High',
    short: 'Injector group B supply high',
    severity: 'warning',
  },
  P2152: {
    description: 'Fuel Injector Group "C" Supply Voltage Circuit/Open',
    short: 'Injector group C supply circuit',
    severity: 'warning',
  },
  P2153: {
    description: 'Fuel Injector Group "C" Supply Voltage Circuit Low',
    short: 'Injector group C supply low',
    severity: 'warning',
  },
  P2154: {
    description: 'Fuel Injector Group "C" Supply Voltage Circuit High',
    short: 'Injector group C supply high',
    severity: 'warning',
  },
  P2155: {
    description: 'Fuel Injector Group "D" Supply Voltage Circuit/Open',
    short: 'Injector group D supply circuit',
    severity: 'warning',
  },
  P2156: {
    description: 'Fuel Injector Group "D" Supply Voltage Circuit Low',
    short: 'Injector group D supply low',
    severity: 'warning',
  },
  P2157: {
    description: 'Fuel Injector Group "D" Supply Voltage Circuit High',
    short: 'Injector group D supply high',
    severity: 'warning',
  },
  P2158: {
    description: 'Vehicle Speed Sensor "B" Circuit',
    short: 'Vehicle speed sensor B circuit',
    severity: 'warning',
  },
  P2159: {
    description: 'Vehicle Speed Sensor "B" Circuit Range/Performance',
    short: 'Vehicle speed sensor B fault',
    severity: 'warning',
  },
  P215A: {
    description: 'Vehicle Speed - Wheel Speed Correlation',
    short: 'Vehicle/wheel speed mismatch',
    severity: 'warning',
  },
  P215B: {
    description: 'Vehicle Speed - Output Shaft Speed Correlation',
    short: 'Vehicle/output speed mismatch',
    severity: 'warning',
  },
  P215C: {
    description: 'Output Shaft Speed - Wheel Speed Correlation',
    short: 'Output/wheel speed mismatch',
    severity: 'warning',
  },
  P215D: {
    description: 'Reductant Pump "B" Stuck On',
    short: 'DEF pump B stuck on',
    severity: 'caution',
  },
  P215E: {
    description: 'Reductant Heater "D" Current Too Low',
    short: 'DEF heater D current low',
    severity: 'caution',
  },
  P215F: {
    description: 'Reductant Heater "D" Current Too High',
    short: 'DEF heater D current high',
    severity: 'caution',
  },
  P2160: {
    description: 'Vehicle Speed Sensor "B" Circuit Low',
    short: 'Vehicle speed sensor B low',
    severity: 'warning',
  },
  P2161: {
    description: 'Vehicle Speed Sensor "B" Circuit Intermittent/Erratic/High',
    short: 'Vehicle speed sensor B erratic',
    severity: 'warning',
  },
  P2162: {
    description: 'Vehicle Speed Sensor "A"/"B" Correlation',
    short: 'Speed sensors A/B mismatch',
    severity: 'warning',
  },
  P2163: {
    description: 'Throttle/Pedal Position Sensor "A" Maximum Stop Performance',
    short: 'Throttle/pedal A max stop fault',
    severity: 'warning',
  },
  P2164: {
    description: 'Throttle/Pedal Position Sensor "B" Maximum Stop Performance',
    short: 'Throttle/pedal B max stop fault',
    severity: 'warning',
  },
  P2165: {
    description: 'Throttle/Pedal Position Sensor "C" Maximum Stop Performance',
    short: 'Throttle/pedal C max stop fault',
    severity: 'warning',
  },
  P2166: {
    description: 'Throttle/Pedal Position Sensor "D" Maximum Stop Performance',
    short: 'Throttle/pedal D max stop fault',
    severity: 'warning',
  },
  P2167: {
    description: 'Throttle/Pedal Position Sensor "E" Maximum Stop Performance',
    short: 'Throttle/pedal E max stop fault',
    severity: 'warning',
  },
  P2168: {
    description: 'Throttle/Pedal Position Sensor "F" Maximum Stop Performance',
    short: 'Throttle/pedal F max stop fault',
    severity: 'warning',
  },
  P2169: {
    description: 'Exhaust Pressure Regulator Vent Solenoid Control Circuit/Open',
    short: 'Exhaust vent valve circuit open',
    severity: 'caution',
  },
  P216A: {
    description: 'Fuel Injector Group "E" Supply Voltage Circuit/Open',
    short: 'Injector group E supply circuit',
    severity: 'warning',
  },
  P216B: {
    description: 'Fuel Injector Group "E" Supply Voltage Circuit Low',
    short: 'Injector group E supply low',
    severity: 'warning',
  },
  P216C: {
    description: 'Fuel Injector Group "E" Supply Voltage Circuit High',
    short: 'Injector group E supply high',
    severity: 'warning',
  },
  P216D: {
    description: 'Fuel Injector Group "F" Supply Voltage Circuit/Open',
    short: 'Injector group F supply circuit',
    severity: 'warning',
  },
  P216E: {
    description: 'Fuel Injector Group "F" Supply Voltage Circuit Low',
    short: 'Injector group F supply low',
    severity: 'warning',
  },
  P216F: {
    description: 'Fuel Injector Group "F" Supply Voltage Circuit High',
    short: 'Injector group F supply high',
    severity: 'warning',
  },
  P2170: {
    description: 'Exhaust Pressure Regulator Vent Solenoid Control Circuit Low',
    short: 'Exhaust vent valve low',
    severity: 'caution',
  },
  P2171: {
    description: 'Exhaust Pressure Regulator Vent Solenoid Control Circuit High',
    short: 'Exhaust vent valve high',
    severity: 'caution',
  },
  P2172: {
    description: 'Throttle Actuator Control System - Sudden High Air Flow Detected',
    short: 'Sudden high airflow at throttle',
    severity: 'warning',
  },
  P2173: {
    description: 'Throttle Actuator Control System - High Air Flow Detected',
    short: 'Unexpected high airflow',
    severity: 'warning',
  },
  P2174: {
    description: 'Throttle Actuator Control System - Sudden Low Air Flow Detected',
    short: 'Sudden low airflow at throttle',
    severity: 'warning',
  },
  P2175: {
    description: 'Throttle Actuator Control System - Low Air Flow Detected',
    short: 'Unexpected low airflow',
    severity: 'warning',
  },
  P2176: {
    description: 'Throttle Actuator "A" Control System - Idle Position Not Learned',
    short: 'Throttle idle not learned',
    severity: 'caution',
  },
  P2177: {
    description: 'System Too Lean Off Idle (Bank 1)',
    short: 'Engine lean off idle (B1)',
    severity: 'caution',
  },
  P2178: {
    description: 'System Too Rich Off Idle (Bank 1)',
    short: 'Engine rich off idle (B1)',
    severity: 'caution',
  },
  P2179: {
    description: 'System Too Lean Off Idle (Bank 2)',
    short: 'Engine lean off idle (B2)',
    severity: 'caution',
  },
  P217A: {
    description: 'Fuel Injector Group "G" Supply Voltage Circuit/Open',
    short: 'Injector group G supply circuit',
    severity: 'warning',
  },
  P217B: {
    description: 'Fuel Injector Group "G" Supply Voltage Circuit Low',
    short: 'Injector group G supply low',
    severity: 'warning',
  },
  P217C: {
    description: 'Fuel Injector Group "G" Supply Voltage Circuit High',
    short: 'Injector group G supply high',
    severity: 'warning',
  },
  P217D: {
    description: 'Fuel Injector Group "H" Supply Voltage Circuit/Open',
    short: 'Injector group H supply circuit',
    severity: 'warning',
  },
  P217E: {
    description: 'Fuel Injector Group "H" Supply Voltage Circuit Low',
    short: 'Injector group H supply low',
    severity: 'warning',
  },
  P217F: {
    description: 'Fuel Injector Group "H" Supply Voltage Circuit High',
    short: 'Injector group H supply high',
    severity: 'warning',
  },
  P2180: {
    description: 'System Too Rich Off Idle (Bank 2)',
    short: 'Engine rich off idle (B2)',
    severity: 'caution',
  },
  P2181: {
    description: 'Cooling System Performance',
    short: 'Cooling system fault',
    severity: 'warning',
  },
  P2182: {
    description: 'Engine Coolant Temperature Sensor 2 Circuit',
    short: 'Coolant temp sensor 2 circuit',
    severity: 'warning',
  },
  P2183: {
    description: 'Engine Coolant Temperature Sensor 2 Circuit Range/Performance',
    short: 'Coolant temp sensor 2 fault',
    severity: 'warning',
  },
  P2184: {
    description: 'Engine Coolant Temperature Sensor 2 Circuit Low',
    short: 'Coolant temp sensor 2 low',
    severity: 'warning',
  },
  P2185: {
    description: 'Engine Coolant Temperature Sensor 2 Circuit High',
    short: 'Coolant temp sensor 2 high',
    severity: 'warning',
  },
  P2186: {
    description: 'Engine Coolant Temperature Sensor 2 Circuit Intermittent/Erratic',
    short: 'Coolant temp sensor 2 erratic',
    severity: 'warning',
  },
  P2187: {
    description: 'System Too Lean at Idle (Bank 1)',
    short: 'Engine lean at idle (B1)',
    severity: 'caution',
  },
  P2188: {
    description: 'System Too Rich at Idle (Bank 1)',
    short: 'Engine rich at idle (B1)',
    severity: 'caution',
  },
  P2189: {
    description: 'System Too Lean at Idle (Bank 2)',
    short: 'Engine lean at idle (B2)',
    severity: 'caution',
  },
  P218A: {
    description: 'Throttle Actuator "B" Control System - Idle Position Not Learned',
    short: 'Throttle B idle not learned',
    severity: 'caution',
  },
  P218B: {
    description: 'Throttle/Fuel Inhibit "B" Circuit',
    short: 'Throttle/fuel inhibit B circuit',
    severity: 'warning',
  },
  P218C: {
    description: 'Throttle/Fuel Inhibit "B" Circuit Range/Performance',
    short: 'Throttle/fuel inhibit B fault',
    severity: 'warning',
  },
  P218D: {
    description: 'Throttle/Fuel Inhibit "B" Circuit Low',
    short: 'Throttle/fuel inhibit B low',
    severity: 'warning',
  },
  P218E: {
    description: 'Throttle/Fuel Inhibit "B" Circuit High',
    short: 'Throttle/fuel inhibit B high',
    severity: 'warning',
  },
  P218F: {
    description: 'Reductant No Flow Detected',
    short: 'No DEF flow',
    severity: 'caution',
  },
  P2190: {
    description: 'System Too Rich at Idle (Bank 2)',
    short: 'Engine rich at idle (B2)',
    severity: 'caution',
  },
  P2191: {
    description: 'System Too Lean at Higher Load (Bank 1)',
    short: 'Engine lean under load (B1)',
    severity: 'caution',
  },
  P2192: {
    description: 'System Too Rich at Higher Load (Bank 1)',
    short: 'Engine rich under load (B1)',
    severity: 'caution',
  },
  P2193: {
    description: 'System Too Lean at Higher Load (Bank 2)',
    short: 'Engine lean under load (B2)',
    severity: 'caution',
  },
  P2194: {
    description: 'System Too Rich at Higher Load (Bank 2)',
    short: 'Engine rich under load (B2)',
    severity: 'caution',
  },
  P2195: {
    description: 'O2 Sensor Signal Biased/Stuck Lean (Bank 1 Sensor 1)',
    short: 'Upstream O2 stuck lean (B1)',
    severity: 'caution',
  },
  P2196: {
    description: 'O2 Sensor Signal Biased/Stuck Rich (Bank 1 Sensor 1)',
    short: 'Upstream O2 stuck rich (B1)',
    severity: 'caution',
  },
  P2197: {
    description: 'O2 Sensor Signal Biased/Stuck Lean (Bank 2 Sensor 1)',
    short: 'Upstream O2 stuck lean (B2)',
    severity: 'caution',
  },
  P2198: {
    description: 'O2 Sensor Signal Biased/Stuck Rich (Bank 2 Sensor 1)',
    short: 'Upstream O2 stuck rich (B2)',
    severity: 'caution',
  },
  P2199: {
    description: 'Intake Air Temperature Sensor 1/2 Correlation',
    short: 'Intake air temp 1/2 mismatch',
    severity: 'caution',
  },
  P219A: {
    description: 'Bank 1 Air-Fuel Ratio Imbalance',
    short: 'Air-fuel imbalance (B1)',
    severity: 'caution',
  },
  P219B: {
    description: 'Bank 2 Air-Fuel Ratio Imbalance',
    short: 'Air-fuel imbalance (B2)',
    severity: 'caution',
  },
  P219C: {
    description: 'Cylinder 1 Air-Fuel Ratio Imbalance',
    short: 'Cylinder 1 air-fuel imbalance',
    severity: 'caution',
  },
  P219D: {
    description: 'Cylinder 2 Air-Fuel Ratio Imbalance',
    short: 'Cylinder 2 air-fuel imbalance',
    severity: 'caution',
  },
  P219E: {
    description: 'Cylinder 3 Air-Fuel Ratio Imbalance',
    short: 'Cylinder 3 air-fuel imbalance',
    severity: 'caution',
  },
  P219F: {
    description: 'Cylinder 4 Air-Fuel Ratio Imbalance',
    short: 'Cylinder 4 air-fuel imbalance',
    severity: 'caution',
  },
  P21A0: {
    description: 'Cylinder 5 Air-Fuel Ratio Imbalance',
    short: 'Cylinder 5 air-fuel imbalance',
    severity: 'caution',
  },
  P21A1: {
    description: 'Cylinder 6 Air-Fuel Ratio Imbalance',
    short: 'Cylinder 6 air-fuel imbalance',
    severity: 'caution',
  },
  P21A2: {
    description: 'Cylinder 7 Air-Fuel Ratio Imbalance',
    short: 'Cylinder 7 air-fuel imbalance',
    severity: 'caution',
  },
  P21A3: {
    description: 'Cylinder 8 Air-Fuel Ratio Imbalance',
    short: 'Cylinder 8 air-fuel imbalance',
    severity: 'caution',
  },
  P21A4: {
    description: 'Cylinder 9 Air-Fuel Ratio Imbalance',
    short: 'Cylinder 9 air-fuel imbalance',
    severity: 'caution',
  },
  P21A5: {
    description: 'Cylinder 10 Air-Fuel Ratio Imbalance',
    short: 'Cylinder 10 air-fuel imbalance',
    severity: 'caution',
  },
  P21A6: {
    description: 'Cylinder 11 Air-Fuel Ratio Imbalance',
    short: 'Cylinder 11 air-fuel imbalance',
    severity: 'caution',
  },
  P21A7: {
    description: 'Cylinder 12 Air-Fuel Ratio Imbalance',
    short: 'Cylinder 12 air-fuel imbalance',
    severity: 'caution',
  },
  P21A8: {
    description: 'Reductant Level Sensor "B" Circuit',
    short: 'DEF level sensor B circuit',
    severity: 'caution',
  },
  P21A9: {
    description: 'Reductant Level Sensor "B" Circuit Range/Performance',
    short: 'DEF level sensor B out of range',
    severity: 'caution',
  },
  P21AA: {
    description: 'Reductant Level Sensor "B" Circuit Low',
    short: 'DEF level sensor B low',
    severity: 'caution',
  },
  P21AB: {
    description: 'Reductant Level Sensor "B" Circuit High',
    short: 'DEF level sensor B high',
    severity: 'caution',
  },
  P21AC: {
    description: 'Reductant Level Sensor "B" Circuit Intermittent/Erratic',
    short: 'DEF level sensor B erratic',
    severity: 'caution',
  },
  P21AD: {
    description: 'Reductant Level Sensor "C" Circuit',
    short: 'DEF level sensor C circuit',
    severity: 'caution',
  },
  P21AE: {
    description: 'Reductant Level Sensor "C" Circuit Range/Performance',
    short: 'DEF level sensor C out of range',
    severity: 'caution',
  },
  P21AF: {
    description: 'Reductant Level Sensor "C" Circuit Low',
    short: 'DEF level sensor C low',
    severity: 'caution',
  },
  P21B0: {
    description: 'Reductant Level Sensor "C" Circuit High',
    short: 'DEF level sensor C high',
    severity: 'caution',
  },
  P21B1: {
    description: 'Reductant Level Sensor "C" Circuit Intermittent/Erratic',
    short: 'DEF level sensor C erratic',
    severity: 'caution',
  },
  P21B2: {
    description: 'Excessive Time To Enter Closed Loop NOx Adsorber Control',
    short: 'NOx trap control slow to start',
    severity: 'caution',
  },
  P21B3: {
    description: 'Closed Loop NOx Adsorber Control At Limit - Too High',
    short: 'NOx trap control at limit (high)',
    severity: 'caution',
  },
  P21B4: {
    description: 'NOx Adsorber - Over Temperature (Bank 1)',
    short: 'NOx trap overheating (B1)',
    severity: 'warning',
  },
  P21B5: {
    description: 'NOx Adsorber - Over Temperature (Bank 2)',
    short: 'NOx trap overheating (B2)',
    severity: 'warning',
  },
  P21B6: {
    description: 'Cold Start Cylinder 1 Injection Timing',
    short: 'Cyl 1 cold-start timing fault',
    severity: 'caution',
  },
  P21B7: {
    description: 'Cold Start Cylinder 2 Injection Timing',
    short: 'Cyl 2 cold-start timing fault',
    severity: 'caution',
  },
  P21B8: {
    description: 'Cold Start Cylinder 3 Injection Timing',
    short: 'Cyl 3 cold-start timing fault',
    severity: 'caution',
  },
  P21B9: {
    description: 'Cold Start Cylinder 4 Injection Timing',
    short: 'Cyl 4 cold-start timing fault',
    severity: 'caution',
  },
  P21BA: {
    description: 'Cold Start Cylinder 5 Injection Timing',
    short: 'Cyl 5 cold-start timing fault',
    severity: 'caution',
  },
  P21BB: {
    description: 'Cold Start Cylinder 6 Injection Timing',
    short: 'Cyl 6 cold-start timing fault',
    severity: 'caution',
  },
  P21BC: {
    description: 'Cold Start Cylinder 7 Injection Timing',
    short: 'Cyl 7 cold-start timing fault',
    severity: 'caution',
  },
  P21BD: {
    description: 'Cold Start Cylinder 8 Injection Timing',
    short: 'Cyl 8 cold-start timing fault',
    severity: 'caution',
  },
  P21BE: {
    description: 'Cold Start Cylinder 9 Injection Timing',
    short: 'Cyl 9 cold-start timing fault',
    severity: 'caution',
  },
  P21BF: {
    description: 'Cold Start Cylinder 10 Injection Timing',
    short: 'Cyl 10 cold-start timing fault',
    severity: 'caution',
  },
  P21C0: {
    description: 'Cold Start Cylinder 11 Injection Timing',
    short: 'Cyl 11 cold-start timing fault',
    severity: 'caution',
  },
  P21C1: {
    description: 'Cold Start Cylinder 12 Injection Timing',
    short: 'Cyl 12 cold-start timing fault',
    severity: 'caution',
  },
  P21C2: {
    description: 'Reductant Heater Relay Control Circuit/Open',
    short: 'DEF heater relay circuit open',
    severity: 'caution',
  },
  P21C3: {
    description: 'Reductant Heater Relay Control Circuit Low',
    short: 'DEF heater relay low',
    severity: 'caution',
  },
  P21C4: {
    description: 'Reductant Heater Relay Control Circuit High',
    short: 'DEF heater relay high',
    severity: 'caution',
  },
  P21C5: {
    description: 'Reductant Level Sensor "A" Stuck',
    short: 'DEF level sensor A stuck',
    severity: 'caution',
  },
  P21C6: {
    description: 'Reductant Level Sensor "B" Stuck',
    short: 'DEF level sensor B stuck',
    severity: 'caution',
  },
  P21C7: {
    description: 'Reductant Control Module Power Relay/Relays Control Circuit/Open',
    short: 'DEF module power relay circuit',
    severity: 'caution',
  },
  P21C8: {
    description: 'Reductant Control Module Power Relay/Relays Control Circuit Low',
    short: 'DEF module power relay low',
    severity: 'caution',
  },
  P21C9: {
    description: 'Reductant Control Module Power Relay/Relays Control Circuit High',
    short: 'DEF module power relay high',
    severity: 'caution',
  },
  P21CA: {
    description: 'Reductant Control Module Supply Voltage Circuit',
    short: 'DEF module voltage circuit',
    severity: 'caution',
  },
  P21CB: {
    description: 'Reductant Control Module Supply Voltage Low',
    short: 'DEF module voltage low',
    severity: 'caution',
  },
  P21CC: {
    description: 'Reductant Control Module Supply Voltage High',
    short: 'DEF module voltage high',
    severity: 'caution',
  },
  P21CD: {
    description: 'Reductant Quality Module Supply Voltage Low',
    short: 'DEF quality module voltage low',
    severity: 'caution',
  },
  P21CE: {
    description: 'Reductant Quality Module Performance',
    short: 'DEF quality module fault',
    severity: 'caution',
  },
  P21CF: {
    description: 'Cylinder 1 Injector "B" Circuit/Open',
    short: 'Cylinder 1 injector B circuit',
    severity: 'warning',
  },
  P21D0: {
    description: 'Cylinder 2 Injector "B" Circuit/Open',
    short: 'Cylinder 2 injector B circuit',
    severity: 'warning',
  },
  P21D1: {
    description: 'Cylinder 3 Injector "B" Circuit/Open',
    short: 'Cylinder 3 injector B circuit',
    severity: 'warning',
  },
  P21D2: {
    description: 'Cylinder 4 Injector "B" Circuit/Open',
    short: 'Cylinder 4 injector B circuit',
    severity: 'warning',
  },
  P21D3: {
    description: 'Cylinder 5 Injector "B" Circuit/Open',
    short: 'Cylinder 5 injector B circuit',
    severity: 'warning',
  },
  P21D4: {
    description: 'Cylinder 6 Injector "B" Circuit/Open',
    short: 'Cylinder 6 injector B circuit',
    severity: 'warning',
  },
  P21D5: {
    description: 'Cylinder 7 Injector "B" Circuit/Open',
    short: 'Cylinder 7 injector B circuit',
    severity: 'warning',
  },
  P21D6: {
    description: 'Cylinder 8 Injector "B" Circuit/Open',
    short: 'Cylinder 8 injector B circuit',
    severity: 'warning',
  },
  P21D7: {
    description: 'Cylinder 9 Injector "B" Circuit/Open',
    short: 'Cylinder 9 injector B circuit',
    severity: 'warning',
  },
  P21D8: {
    description: 'Cylinder 10 Injector "B" Circuit/Open',
    short: 'Cylinder 10 injector B circuit',
    severity: 'warning',
  },
  P21D9: {
    description: 'Cylinder 11 Injector "B" Circuit/Open',
    short: 'Cylinder 11 injector B circuit',
    severity: 'warning',
  },
  P21DA: {
    description: 'Cylinder 12 Injector "B" Circuit/Open',
    short: 'Cylinder 12 injector B circuit',
    severity: 'warning',
  },
  P21DB: {
    description: 'Cylinder 1 Injector "B" Circuit Low',
    short: 'Cylinder 1 injector B low',
    severity: 'warning',
  },
  P21DC: {
    description: 'Cylinder 1 Injector "B" Circuit High',
    short: 'Cylinder 1 injector B high',
    severity: 'warning',
  },
  P21DD: {
    description: 'Reductant Heater "A" Current Too Low',
    short: 'DEF heater A current low',
    severity: 'caution',
  },
  P21DE: {
    description: 'Cylinder 2 Injector "B" Circuit Low',
    short: 'Cylinder 2 injector B low',
    severity: 'warning',
  },
  P21DF: {
    description: 'Cylinder 2 Injector "B" Circuit High',
    short: 'Cylinder 2 injector B high',
    severity: 'warning',
  },
  P21E0: {
    description: 'Cylinder 3 Injector "B" Circuit Low',
    short: 'Cylinder 3 injector B low',
    severity: 'warning',
  },
  P21E1: {
    description: 'Cylinder 3 Injector "B" Circuit High',
    short: 'Cylinder 3 injector B high',
    severity: 'warning',
  },
  P21E2: {
    description: 'Cylinder 4 Injector "B" Circuit Low',
    short: 'Cylinder 4 injector B low',
    severity: 'warning',
  },
  P21E3: {
    description: 'Cylinder 4 Injector "B" Circuit High',
    short: 'Cylinder 4 injector B high',
    severity: 'warning',
  },
  P21E4: {
    description: 'Cylinder 5 Injector "B" Circuit Low',
    short: 'Cylinder 5 injector B low',
    severity: 'warning',
  },
  P21E5: {
    description: 'Cylinder 5 Injector "B" Circuit High',
    short: 'Cylinder 5 injector B high',
    severity: 'warning',
  },
  P21E6: {
    description: 'Cylinder 6 Injector "B" Circuit Low',
    short: 'Cylinder 6 injector B low',
    severity: 'warning',
  },
  P21E7: {
    description: 'Cylinder 6 Injector "B" Circuit High',
    short: 'Cylinder 6 injector B high',
    severity: 'warning',
  },
  P21E8: {
    description: 'Cylinder 7 Injector "B" Circuit Low',
    short: 'Cylinder 7 injector B low',
    severity: 'warning',
  },
  P21E9: {
    description: 'Cylinder 7 Injector "B" Circuit High',
    short: 'Cylinder 7 injector B high',
    severity: 'warning',
  },
  P21EA: {
    description: 'Cylinder 8 Injector "B" Circuit Low',
    short: 'Cylinder 8 injector B low',
    severity: 'warning',
  },
  P21EB: {
    description: 'Cylinder 8 Injector "B" Circuit High',
    short: 'Cylinder 8 injector B high',
    severity: 'warning',
  },
  P21EC: {
    description: 'Cylinder 9 Injector "B" Circuit Low',
    short: 'Cylinder 9 injector B low',
    severity: 'warning',
  },
  P21ED: {
    description: 'Cylinder 9 Injector "B" Circuit High',
    short: 'Cylinder 9 injector B high',
    severity: 'warning',
  },
  P21EE: {
    description: 'Cylinder 10 Injector "B" Circuit Low',
    short: 'Cylinder 10 injector B low',
    severity: 'warning',
  },
  P21EF: {
    description: 'Cylinder 10 Injector "B" Circuit High',
    short: 'Cylinder 10 injector B high',
    severity: 'warning',
  },
  P21F0: {
    description: 'Cylinder 11 Injector "B" Circuit Low',
    short: 'Cylinder 11 injector B low',
    severity: 'warning',
  },
  P21F1: {
    description: 'Cylinder 11 Injector "B" Circuit High',
    short: 'Cylinder 11 injector B high',
    severity: 'warning',
  },
  P21F2: {
    description: 'Cylinder 12 Injector "B" Circuit Low',
    short: 'Cylinder 12 injector B low',
    severity: 'warning',
  },
  P21F3: {
    description: 'Cylinder 12 Injector "B" Circuit High',
    short: 'Cylinder 12 injector B high',
    severity: 'warning',
  },
  P21F4: {
    description: 'Fuel Control System "B" Too Lean Off Idle (Bank 1)',
    short: 'Fuel system B lean off idle (B1)',
    severity: 'caution',
  },
  P21F5: {
    description: 'Fuel Control System "B" Too Rich Off Idle (Bank 1)',
    short: 'Fuel system B rich off idle (B1)',
    severity: 'caution',
  },
  P21F6: {
    description: 'Fuel Control System "B" Too Lean Off Idle (Bank 2)',
    short: 'Fuel system B lean off idle (B2)',
    severity: 'caution',
  },
  P21F7: {
    description: 'Fuel Control System "B" Too Rich Off Idle (Bank 2)',
    short: 'Fuel system B rich off idle (B2)',
    severity: 'caution',
  },
  P21F8: {
    description: 'Fuel Control System "B" Too Lean at Idle (Bank 1)',
    short: 'Fuel system B lean at idle (B1)',
    severity: 'caution',
  },
  P21F9: {
    description: 'Fuel Control System "B" Too Rich at Idle (Bank 1)',
    short: 'Fuel system B rich at idle (B1)',
    severity: 'caution',
  },
  P21FA: {
    description: 'Fuel Control System "B" Too Lean at Idle (Bank 2)',
    short: 'Fuel system B lean at idle (B2)',
    severity: 'caution',
  },
  P21FB: {
    description: 'Fuel Control System "B" Too Rich at Idle (Bank 2)',
    short: 'Fuel system B rich at idle (B2)',
    severity: 'caution',
  },
  P21FC: {
    description: 'Fuel Control System "B" Too Lean at Higher Load (Bank 1)',
    short: 'Fuel system B lean at load (B1)',
    severity: 'caution',
  },
  P21FD: {
    description: 'Fuel Control System "B" Too Rich at Higher Load (Bank 1)',
    short: 'Fuel system B rich at load (B1)',
    severity: 'caution',
  },
  P21FE: {
    description: 'Fuel Control System "B" Too Lean at Higher Load (Bank 2)',
    short: 'Fuel system B lean at load (B2)',
    severity: 'caution',
  },
  P21FF: {
    description: 'Fuel Control System "B" Too Rich at Higher Load (Bank 2)',
    short: 'Fuel system B rich at load (B2)',
    severity: 'caution',
  },

  // P22xx — NOx sensors, barometric pressure, wide-band O2, turbo, water in fuel, injection
  P2200: {
    description: 'NOx Sensor Circuit (Bank 1 Sensor 1)',
    short: 'NOx sensor 1 circuit (B1)',
    severity: 'caution',
  },
  P2201: {
    description: 'NOx Sensor Circuit Range/Performance (Bank 1 Sensor 1)',
    short: 'NOx sensor 1 out of range (B1)',
    severity: 'caution',
  },
  P2202: {
    description: 'NOx Sensor Circuit Low (Bank 1 Sensor 1)',
    short: 'NOx sensor 1 low (B1)',
    severity: 'caution',
  },
  P2203: {
    description: 'NOx Sensor Circuit High (Bank 1 Sensor 1)',
    short: 'NOx sensor 1 high (B1)',
    severity: 'caution',
  },
  P2204: {
    description: 'NOx Sensor Circuit Intermittent (Bank 1 Sensor 1)',
    short: 'NOx sensor 1 erratic (B1)',
    severity: 'caution',
  },
  P2205: {
    description: 'NOx Sensor Heater Control Circuit/Open (Bank 1 Sensor 1)',
    short: 'NOx sensor 1 heater circuit (B1)',
    severity: 'caution',
  },
  P2206: {
    description: 'NOx Sensor Heater Control Circuit Low (Bank 1 Sensor 1)',
    short: 'NOx sensor 1 heater low (B1)',
    severity: 'caution',
  },
  P2207: {
    description: 'NOx Sensor Heater Control Circuit High (Bank 1 Sensor 1)',
    short: 'NOx sensor 1 heater high (B1)',
    severity: 'caution',
  },
  P2208: {
    description: 'NOx Sensor Heater Sense Circuit (Bank 1 Sensor 1)',
    short: 'NOx 1 heater sense circuit (B1)',
    severity: 'caution',
  },
  P2209: {
    description: 'NOx Sensor Heater Sense Circuit Range/Performance (Bank 1 Sensor 1)',
    short: 'NOx 1 heater sense fault (B1)',
    severity: 'caution',
  },
  P220A: {
    description: 'NOx Sensor Supply Voltage Circuit (Bank 1 Sensor 1)',
    short: 'NOx sensor 1 supply circuit (B1)',
    severity: 'caution',
  },
  P220B: {
    description: 'NOx Sensor Supply Voltage Circuit (Bank 1 Sensor 2)',
    short: 'NOx sensor 2 supply circuit (B1)',
    severity: 'caution',
  },
  P220C: {
    description: 'NOx Sensor Supply Voltage Circuit (Bank 2 Sensor 1)',
    short: 'NOx sensor 1 supply circuit (B2)',
    severity: 'caution',
  },
  P220D: {
    description: 'NOx Sensor Supply Voltage Circuit (Bank 2 Sensor 2)',
    short: 'NOx sensor 2 supply circuit (B2)',
    severity: 'caution',
  },
  P220E: {
    description: 'NOx Sensor Heater Control Circuit Range/Performance (Bank 1 Sensor 1)',
    short: 'NOx sensor 1 heater fault (B1)',
    severity: 'caution',
  },
  P220F: {
    description: 'NOx Sensor Heater Control Circuit Range/Performance (Bank 1 Sensor 2)',
    short: 'NOx sensor 2 heater fault (B1)',
    severity: 'caution',
  },
  P2210: {
    description: 'NOx Sensor Heater Sense Circuit Low (Bank 1 Sensor 1)',
    short: 'NOx 1 heater sense low (B1)',
    severity: 'caution',
  },
  P2211: {
    description: 'NOx Sensor Heater Sense Circuit High (Bank 1 Sensor 1)',
    short: 'NOx 1 heater sense high (B1)',
    severity: 'caution',
  },
  P2212: {
    description: 'NOx Sensor Heater Sense Circuit Intermittent (Bank 1 Sensor 1)',
    short: 'NOx 1 heater sense erratic (B1)',
    severity: 'caution',
  },
  P2213: {
    description: 'NOx Sensor Circuit (Bank 2)',
    short: 'NOx sensor circuit (B2)',
    severity: 'caution',
  },
  P2214: {
    description: 'NOx Sensor Circuit Range/Performance (Bank 2)',
    short: 'NOx sensor out of range (B2)',
    severity: 'caution',
  },
  P2215: {
    description: 'NOx Sensor Circuit Low (Bank 2)',
    short: 'NOx sensor low (B2)',
    severity: 'caution',
  },
  P2216: {
    description: 'NOx Sensor Circuit High (Bank 2)',
    short: 'NOx sensor high (B2)',
    severity: 'caution',
  },
  P2217: {
    description: 'NOx Sensor Circuit Intermittent (Bank 2)',
    short: 'NOx sensor erratic (B2)',
    severity: 'caution',
  },
  P2218: {
    description: 'NOx Sensor Heater Control Circuit/Open (Bank 2)',
    short: 'NOx sensor heater circuit (B2)',
    severity: 'caution',
  },
  P2219: {
    description: 'NOx Sensor Heater Control Circuit Low (Bank 2)',
    short: 'NOx sensor heater low (B2)',
    severity: 'caution',
  },
  P221A: {
    description: 'NOx Sensor 1/2 Correlation (Bank 1)',
    short: 'NOx sensors 1/2 mismatch (B1)',
    severity: 'caution',
  },
  P221B: {
    description: 'NOx Sensor 1/2 Correlation (Bank 2)',
    short: 'NOx sensors 1/2 mismatch (B2)',
    severity: 'caution',
  },
  P221C: {
    description: 'Reductant Heater "B" Current Too Low',
    short: 'DEF heater B current low',
    severity: 'caution',
  },
  P221D: {
    description: 'Reductant Heater "B" Current Too High',
    short: 'DEF heater B current high',
    severity: 'caution',
  },
  P221E: {
    description: 'Reductant Heater "C" Current Too Low',
    short: 'DEF heater C current low',
    severity: 'caution',
  },
  P221F: {
    description: 'Reductant Heater "C" Current Too High',
    short: 'DEF heater C current high',
    severity: 'caution',
  },
  P2220: {
    description: 'NOx Sensor Heater Control Circuit High (Bank 2)',
    short: 'NOx sensor heater high (B2)',
    severity: 'caution',
  },
  P2221: {
    description: 'NOx Sensor Heater Sense Circuit (Bank 2)',
    short: 'NOx heater sense circuit (B2)',
    severity: 'caution',
  },
  P2222: {
    description: 'NOx Sensor Heater Sense Circuit Range/Performance (Bank 2)',
    short: 'NOx heater sense fault (B2)',
    severity: 'caution',
  },
  P2223: {
    description: 'NOx Sensor Heater Sense Circuit Low (Bank 2)',
    short: 'NOx heater sense low (B2)',
    severity: 'caution',
  },
  P2224: {
    description: 'NOx Sensor Heater Sense Circuit High (Bank 2)',
    short: 'NOx heater sense high (B2)',
    severity: 'caution',
  },
  P2225: {
    description: 'NOx Sensor Heater Sense Circuit Intermittent (Bank 2)',
    short: 'NOx heater sense erratic (B2)',
    severity: 'caution',
  },
  P2226: {
    description: 'Barometric Pressure Sensor "A" Circuit',
    short: 'Barometric sensor A circuit',
    severity: 'caution',
  },
  P2227: {
    description: 'Barometric Pressure Sensor "A" Circuit Range/Performance',
    short: 'Barometric sensor A out of range',
    severity: 'caution',
  },
  P2228: {
    description: 'Barometric Pressure Sensor "A" Circuit Low',
    short: 'Barometric sensor A low',
    severity: 'caution',
  },
  P2229: {
    description: 'Barometric Pressure Sensor "A" Circuit High',
    short: 'Barometric sensor A high',
    severity: 'caution',
  },
  P222A: {
    description: 'Barometric Pressure Sensor "B" Circuit',
    short: 'Barometric sensor B circuit',
    severity: 'caution',
  },
  P222B: {
    description: 'Barometric Pressure Sensor "B" Circuit Range/Performance',
    short: 'Barometric sensor B out of range',
    severity: 'caution',
  },
  P222C: {
    description: 'Barometric Pressure Sensor "B" Circuit Low',
    short: 'Barometric sensor B low',
    severity: 'caution',
  },
  P222D: {
    description: 'Barometric Pressure Sensor "B" Circuit High',
    short: 'Barometric sensor B high',
    severity: 'caution',
  },
  P222E: {
    description: 'Barometric Pressure Sensor "B" Circuit Intermittent/Erratic',
    short: 'Barometric sensor B erratic',
    severity: 'caution',
  },
  P222F: {
    description: 'Barometric Pressure Sensor "A"/"B" Correlation',
    short: 'Baro sensors A/B mismatch',
    severity: 'caution',
  },
  P2230: {
    description: 'Barometric Pressure Sensor "A" Circuit Intermittent/Erratic',
    short: 'Barometric sensor A erratic',
    severity: 'caution',
  },
  P2231: {
    description: 'O2 Sensor Signal Circuit Shorted to Heater Circuit (Bank 1 Sensor 1)',
    short: 'Upstream O2 signal short (B1)',
    severity: 'caution',
  },
  P2232: {
    description: 'O2 Sensor Signal Circuit Shorted to Heater Circuit (Bank 1 Sensor 2)',
    short: 'Downstream O2 signal short (B1)',
    severity: 'caution',
  },
  P2233: {
    description: 'O2 Sensor Signal Circuit Shorted to Heater Circuit (Bank 1 Sensor 3)',
    short: 'O2 sensor 3 signal short (B1)',
    severity: 'caution',
  },
  P2234: {
    description: 'O2 Sensor Signal Circuit Shorted to Heater Circuit (Bank 2 Sensor 1)',
    short: 'Upstream O2 signal short (B2)',
    severity: 'caution',
  },
  P2235: {
    description: 'O2 Sensor Signal Circuit Shorted to Heater Circuit (Bank 2 Sensor 2)',
    short: 'Downstream O2 signal short (B2)',
    severity: 'caution',
  },
  P2236: {
    description: 'O2 Sensor Signal Circuit Shorted to Heater Circuit (Bank 2 Sensor 3)',
    short: 'O2 sensor 3 signal short (B2)',
    severity: 'caution',
  },
  P2237: {
    description: 'O2 Sensor Positive Current Control Circuit/Open (Bank 1 Sensor 1)',
    short: 'Upstream O2 +current open (B1)',
    severity: 'caution',
  },
  P2238: {
    description: 'O2 Sensor Positive Current Control Circuit Low (Bank 1 Sensor 1)',
    short: 'Upstream O2 +current low (B1)',
    severity: 'caution',
  },
  P2239: {
    description: 'O2 Sensor Positive Current Control Circuit High (Bank 1 Sensor 1)',
    short: 'Upstream O2 +current high (B1)',
    severity: 'caution',
  },
  P223A: {
    description: 'Reductant Heater "E" Control Circuit',
    short: 'DEF heater E circuit',
    severity: 'caution',
  },
  P223B: {
    description: 'Reductant Heater "F" Control Circuit',
    short: 'DEF heater F circuit',
    severity: 'caution',
  },
  P223C: {
    description: 'O2 Sensor Pumping Current Range/Performance (Bank 1)',
    short: 'O2 pump current fault (B1)',
    severity: 'caution',
  },
  P223D: {
    description: 'O2 Sensor Pumping Current Range/Performance (Bank 2)',
    short: 'O2 pump current fault (B2)',
    severity: 'caution',
  },
  P223E: {
    description: 'O2 Sensor Reference Resistance Out Of Range (Bank 1)',
    short: 'O2 resistance out of range (B1)',
    severity: 'caution',
  },
  P223F: {
    description: 'O2 Sensor Reference Resistance Out Of Range (Bank 2)',
    short: 'O2 resistance out of range (B2)',
    severity: 'caution',
  },
  P2240: {
    description: 'O2 Sensor Positive Current Control Circuit/Open (Bank 2 Sensor 1)',
    short: 'Upstream O2 +current open (B2)',
    severity: 'caution',
  },
  P2241: {
    description: 'O2 Sensor Positive Current Control Circuit Low (Bank 2 Sensor 1)',
    short: 'Upstream O2 +current low (B2)',
    severity: 'caution',
  },
  P2242: {
    description: 'O2 Sensor Positive Current Control Circuit High (Bank 2 Sensor 1)',
    short: 'Upstream O2 +current high (B2)',
    severity: 'caution',
  },
  P2243: {
    description: 'O2 Sensor Reference Voltage Circuit/Open (Bank 1 Sensor 1)',
    short: 'Upstream O2 ref. circuit (B1)',
    severity: 'caution',
  },
  P2244: {
    description: 'O2 Sensor Reference Voltage Performance (Bank 1 Sensor 1)',
    short: 'Upstream O2 ref. fault (B1)',
    severity: 'caution',
  },
  P2245: {
    description: 'O2 Sensor Reference Voltage Circuit Low (Bank 1 Sensor 1)',
    short: 'Upstream O2 ref. low (B1)',
    severity: 'caution',
  },
  P2246: {
    description: 'O2 Sensor Reference Voltage Circuit High (Bank 1 Sensor 1)',
    short: 'Upstream O2 ref. high (B1)',
    severity: 'caution',
  },
  P2247: {
    description: 'O2 Sensor Reference Voltage Circuit/Open (Bank 2 Sensor 1)',
    short: 'Upstream O2 ref. circuit (B2)',
    severity: 'caution',
  },
  P2248: {
    description: 'O2 Sensor Reference Voltage Performance (Bank 2 Sensor 1)',
    short: 'Upstream O2 ref. fault (B2)',
    severity: 'caution',
  },
  P2249: {
    description: 'O2 Sensor Reference Voltage Circuit Low (Bank 2 Sensor 1)',
    short: 'Upstream O2 ref. low (B2)',
    severity: 'caution',
  },
  P224A: {
    description: 'NOx Sensor Heater Resistance (Bank 1 Sensor 1)',
    short: 'NOx 1 heater resistance (B1)',
    severity: 'caution',
  },
  P224B: {
    description: 'NOx Sensor Heater Resistance (Bank 1 Sensor 2)',
    short: 'NOx 2 heater resistance (B1)',
    severity: 'caution',
  },
  P224C: {
    description: 'Alternative Fuel Tank Shutoff Valve "A" Control Circuit/Open',
    short: 'Alt-fuel tank valve A circuit',
    severity: 'warning',
  },
  P224D: {
    description: 'Alternative Fuel Tank Shutoff Valve "A" Control Circuit Range/Performance',
    short: 'Alt-fuel tank valve A fault',
    severity: 'warning',
  },
  P224E: {
    description: 'Alternative Fuel Tank Shutoff Valve "A" Control Circuit Low',
    short: 'Alt-fuel tank valve A low',
    severity: 'warning',
  },
  P224F: {
    description: 'Alternative Fuel Tank Shutoff Valve "A" Control Circuit High',
    short: 'Alt-fuel tank valve A high',
    severity: 'warning',
  },
  P2250: {
    description: 'O2 Sensor Reference Voltage Circuit High (Bank 2 Sensor 1)',
    short: 'Upstream O2 ref. high (B2)',
    severity: 'caution',
  },
  P2251: {
    description: 'O2 Sensor Negative Current Control Circuit/Open (Bank 1 Sensor 1)',
    short: 'Upstream O2 -current open (B1)',
    severity: 'caution',
  },
  P2252: {
    description: 'O2 Sensor Negative Current Control Circuit Low (Bank 1 Sensor 1)',
    short: 'Upstream O2 -current low (B1)',
    severity: 'caution',
  },
  P2253: {
    description: 'O2 Sensor Negative Current Control Circuit High (Bank 1 Sensor 1)',
    short: 'Upstream O2 -current high (B1)',
    severity: 'caution',
  },
  P2254: {
    description: 'O2 Sensor Negative Current Control Circuit/Open (Bank 2 Sensor 1)',
    short: 'Upstream O2 -current open (B2)',
    severity: 'caution',
  },
  P2255: {
    description: 'O2 Sensor Negative Current Control Circuit Low (Bank 2 Sensor 1)',
    short: 'Upstream O2 -current low (B2)',
    severity: 'caution',
  },
  P2256: {
    description: 'O2 Sensor Negative Current Control Circuit High (Bank 2 Sensor 1)',
    short: 'Upstream O2 -current high (B2)',
    severity: 'caution',
  },
  P2257: {
    description: 'Secondary Air Injection System Control "A" Circuit Low',
    short: 'Secondary air control A low',
    severity: 'caution',
  },
  P2258: {
    description: 'Secondary Air Injection System Control "A" Circuit High',
    short: 'Secondary air control A high',
    severity: 'caution',
  },
  P2259: {
    description: 'Secondary Air Injection System Control "B" Circuit Low',
    short: 'Secondary air control B low',
    severity: 'caution',
  },
  P225A: {
    description: 'NOx Sensor Calibration Memory (Bank 1 Sensor 1)',
    short: 'NOx sensor 1 memory fault (B1)',
    severity: 'caution',
  },
  P225B: {
    description: 'NOx Sensor Calibration Memory (Bank 1 Sensor 2)',
    short: 'NOx sensor 2 memory fault (B1)',
    severity: 'caution',
  },
  P225C: {
    description: 'NOx Sensor Performance - Signal Biased/Stuck High (Bank 1 Sensor 1)',
    short: 'NOx sensor 1 stuck high (B1)',
    severity: 'caution',
  },
  P225D: {
    description: 'NOx Sensor Performance - Signal Biased/Stuck Low (Bank 1 Sensor 1)',
    short: 'NOx sensor 1 stuck low (B1)',
    severity: 'caution',
  },
  P225E: {
    description: 'NOx Sensor Performance - Signal Biased/Stuck High (Bank 1 Sensor 2)',
    short: 'NOx sensor 2 stuck high (B1)',
    severity: 'caution',
  },
  P225F: {
    description: 'NOx Sensor Performance - Signal Biased/Stuck Low (Bank 1 Sensor 2)',
    short: 'NOx sensor 2 stuck low (B1)',
    severity: 'caution',
  },
  P2260: {
    description: 'Secondary Air Injection System Control "B" Circuit High',
    short: 'Secondary air control B high',
    severity: 'caution',
  },
  P2261: {
    description: 'Turbocharger/Supercharger Bypass Valve "A" - Mechanical',
    short: 'Turbo bypass valve A fault',
    severity: 'warning',
  },
  P2262: {
    description: 'Turbocharger/Supercharger Boost Pressure Not Detected - Mechanical',
    short: 'No turbo boost (mechanical)',
    severity: 'warning',
  },
  P2263: {
    description: 'Turbocharger/Supercharger Boost System Performance',
    short: 'Turbo boost system fault',
    severity: 'warning',
  },
  P2264: {
    description: 'Water in Fuel Sensor Circuit',
    short: 'Water-in-fuel sensor circuit',
    severity: 'caution',
  },
  P2265: {
    description: 'Water in Fuel Sensor Circuit Range/Performance',
    short: 'Water-in-fuel sensor fault',
    severity: 'caution',
  },
  P2266: {
    description: 'Water in Fuel Sensor Circuit Low',
    short: 'Water-in-fuel sensor low',
    severity: 'caution',
  },
  P2267: {
    description: 'Water in Fuel Sensor Circuit High',
    short: 'Water-in-fuel sensor high',
    severity: 'caution',
  },
  P2268: {
    description: 'Water in Fuel Sensor Circuit Intermittent',
    short: 'Water-in-fuel sensor erratic',
    severity: 'caution',
  },
  P2269: {
    description: 'Water in Fuel Condition',
    short: 'Water in fuel',
    severity: 'warning',
  },
  P226A: {
    description: 'Water in Fuel Lamp Control Circuit',
    short: 'Water-in-fuel lamp circuit',
    severity: 'info',
  },
  P226B: {
    description: 'Turbocharger/Supercharger Boost Pressure Too High - Mechanical',
    short: 'Turbo boost too high',
    severity: 'warning',
  },
  P226C: {
    description: 'Turbocharger Boost Control "A" Slow Response',
    short: 'Turbo boost control A slow',
    severity: 'warning',
  },
  P226D: {
    description: 'Particulate Filter Deteriorated/Missing Substrate (Bank 1)',
    short: 'Exhaust filter damaged (B1)',
    severity: 'caution',
  },
  P226E: {
    description: 'Particulate Filter Deteriorated/Missing Substrate (Bank 2)',
    short: 'Exhaust filter damaged (B2)',
    severity: 'caution',
  },
  P226F: {
    description: 'Turbocharger Boost Control "B" Slow Response',
    short: 'Turbo boost control B slow',
    severity: 'warning',
  },
  P2270: {
    description: 'O2 Sensor Signal Biased/Stuck Lean (Bank 1 Sensor 2)',
    short: 'Downstream O2 stuck lean (B1)',
    severity: 'caution',
  },
  P2271: {
    description: 'O2 Sensor Signal Biased/Stuck Rich (Bank 1 Sensor 2)',
    short: 'Downstream O2 stuck rich (B1)',
    severity: 'caution',
  },
  P2272: {
    description: 'O2 Sensor Signal Biased/Stuck Lean (Bank 2 Sensor 2)',
    short: 'Downstream O2 stuck lean (B2)',
    severity: 'caution',
  },
  P2273: {
    description: 'O2 Sensor Signal Biased/Stuck Rich (Bank 2 Sensor 2)',
    short: 'Downstream O2 stuck rich (B2)',
    severity: 'caution',
  },
  P2274: {
    description: 'O2 Sensor Signal Biased/Stuck Lean (Bank 1 Sensor 3)',
    short: 'O2 sensor 3 stuck lean (B1)',
    severity: 'caution',
  },
  P2275: {
    description: 'O2 Sensor Signal Biased/Stuck Rich (Bank 1 Sensor 3)',
    short: 'O2 sensor 3 stuck rich (B1)',
    severity: 'caution',
  },
  P2276: {
    description: 'O2 Sensor Signal Biased/Stuck Lean (Bank 2 Sensor 3)',
    short: 'O2 sensor 3 stuck lean (B2)',
    severity: 'caution',
  },
  P2277: {
    description: 'O2 Sensor Signal Biased/Stuck Rich (Bank 2 Sensor 3)',
    short: 'O2 sensor 3 stuck rich (B2)',
    severity: 'caution',
  },
  P2278: {
    description: 'O2 Sensor Signals Swapped (Bank 1 Sensor 3 / Bank 2 Sensor 3)',
    short: 'O2 sensor 3 swapped B1/B2',
    severity: 'caution',
  },
  P2279: {
    description: 'Intake Air System Leak',
    short: 'Intake air leak',
    severity: 'caution',
  },
  P227A: {
    description: 'Barometric Pressure Sensor "C" Circuit',
    short: 'Barometric sensor C circuit',
    severity: 'caution',
  },
  P227B: {
    description: 'Barometric Pressure Sensor "C" Circuit Range/Performance',
    short: 'Barometric sensor C out of range',
    severity: 'caution',
  },
  P227C: {
    description: 'Barometric Pressure Sensor "C" Circuit Low',
    short: 'Barometric sensor C low',
    severity: 'caution',
  },
  P227D: {
    description: 'Barometric Pressure Sensor "C" Circuit High',
    short: 'Barometric sensor C high',
    severity: 'caution',
  },
  P227E: {
    description: 'Barometric Pressure Sensor "C" Circuit Intermittent/Erratic',
    short: 'Barometric sensor C erratic',
    severity: 'caution',
  },
  P227F: {
    description: 'Air Flow Restriction/Air Leak Between Air Filter and MAF (Bank 2)',
    short: 'Air filter leak/blockage (B2)',
    severity: 'caution',
  },
  P2280: {
    description: 'Air Flow Restriction/Air Leak Between Air Filter and MAF (Bank 1)',
    short: 'Air filter leak/blockage (B1)',
    severity: 'caution',
  },
  P2281: {
    description: 'Air Leak Between MAF and Throttle Body',
    short: 'Air leak before throttle',
    severity: 'caution',
  },
  P2282: {
    description: 'Air Leak Between Throttle Body and Intake Valves',
    short: 'Air leak after throttle',
    severity: 'caution',
  },
  P2283: {
    description: 'Injector Control Pressure Sensor Circuit',
    short: 'Inj. pressure sensor circuit',
    severity: 'warning',
  },
  P2284: {
    description: 'Injector Control Pressure Sensor Circuit Range/Performance',
    short: 'Inj. pressure sensor fault',
    severity: 'warning',
  },
  P2285: {
    description: 'Injector Control Pressure Sensor Circuit Low',
    short: 'Inj. pressure sensor low',
    severity: 'warning',
  },
  P2286: {
    description: 'Injector Control Pressure Sensor Circuit High',
    short: 'Inj. pressure sensor high',
    severity: 'warning',
  },
  P2287: {
    description: 'Injector Control Pressure Sensor Circuit Intermittent',
    short: 'Inj. pressure sensor erratic',
    severity: 'warning',
  },
  P2288: {
    description: 'Injector Control Pressure Too High',
    short: 'Injection pressure too high',
    severity: 'warning',
  },
  P2289: {
    description: 'Injector Control Pressure Too High - Engine Off',
    short: 'Inj. pressure high, engine off',
    severity: 'warning',
  },
  P228A: {
    description: 'Fuel Pressure Regulator 1 - Forced Engine Shutdown',
    short: 'Fuel reg. 1: engine shut off',
    severity: 'critical',
  },
  P228B: {
    description: 'Fuel Pressure Regulator 2 - Forced Engine Shutdown',
    short: 'Fuel reg. 2: engine shut off',
    severity: 'critical',
  },
  P228C: {
    description: 'Fuel Pressure Regulator 1 Exceeded Control Limits - Pressure Too Low',
    short: 'Fuel pressure too low (reg 1)',
    severity: 'warning',
  },
  P228D: {
    description: 'Fuel Pressure Regulator 1 Exceeded Control Limits - Pressure Too High',
    short: 'Fuel pressure too high (reg 1)',
    severity: 'warning',
  },
  P228E: {
    description: 'Fuel Pressure Regulator 1 Exceeded Learning Limits - Too Low',
    short: 'Fuel regulator 1 learn too low',
    severity: 'warning',
  },
  P228F: {
    description: 'Fuel Pressure Regulator 1 Exceeded Learning Limits - Too High',
    short: 'Fuel regulator 1 learn too high',
    severity: 'warning',
  },
  P2290: {
    description: 'Injector Control Pressure Too Low',
    short: 'Injection pressure too low',
    severity: 'warning',
  },
  P2291: {
    description: 'Injector Control Pressure Too Low - Engine Cranking',
    short: 'Low injection pressure cranking',
    severity: 'warning',
  },
  P2292: {
    description: 'Injector Control Pressure Erratic',
    short: 'Injection pressure erratic',
    severity: 'warning',
  },
  P2293: {
    description: 'Fuel Pressure Regulator 2 Performance',
    short: 'Fuel pressure regulator 2 fault',
    severity: 'warning',
  },
  P2294: {
    description: 'Fuel Pressure Regulator 2 Control Circuit/Open',
    short: 'Fuel pressure reg 2 circuit open',
    severity: 'warning',
  },
  P2295: {
    description: 'Fuel Pressure Regulator 2 Control Circuit Low',
    short: 'Fuel pressure reg 2 circuit low',
    severity: 'warning',
  },
  P2296: {
    description: 'Fuel Pressure Regulator 2 Control Circuit High',
    short: 'Fuel pressure reg 2 circuit high',
    severity: 'warning',
  },
  P2297: {
    description: 'O2 Sensor Out of Range During Deceleration (Bank 1 Sensor 1)',
    short: 'Upstream O2 wrong on decel (B1)',
    severity: 'caution',
  },
  P2298: {
    description: 'O2 Sensor Out of Range During Deceleration (Bank 2 Sensor 1)',
    short: 'Upstream O2 wrong on decel (B2)',
    severity: 'caution',
  },
  P2299: {
    description: 'Brake Pedal Position/Accelerator Pedal Position Incompatible',
    short: 'Brake and gas pedal conflict',
    severity: 'warning',
  },
  P229A: {
    description: 'Fuel Pressure Regulator 2 Exceeded Control Limits - Pressure Too Low',
    short: 'Fuel pressure too low (reg 2)',
    severity: 'warning',
  },
  P229B: {
    description: 'Fuel Pressure Regulator 2 Exceeded Control Limits - Pressure Too High',
    short: 'Fuel pressure too high (reg 2)',
    severity: 'warning',
  },
  P229C: {
    description: 'Fuel Pressure Regulator 2 Exceeded Learning Limits - Too Low',
    short: 'Fuel regulator 2 learn too low',
    severity: 'warning',
  },
  P229D: {
    description: 'Fuel Pressure Regulator 2 Exceeded Learning Limits - Too High',
    short: 'Fuel regulator 2 learn too high',
    severity: 'warning',
  },
  P229E: {
    description: 'NOx Sensor Circuit (Bank 1 Sensor 2)',
    short: 'NOx sensor 2 circuit (B1)',
    severity: 'caution',
  },
  P229F: {
    description: 'NOx Sensor Circuit Range/Performance (Bank 1 Sensor 2)',
    short: 'NOx sensor 2 out of range (B1)',
    severity: 'caution',
  },
  P22A0: {
    description: 'NOx Sensor Circuit Low (Bank 1 Sensor 2)',
    short: 'NOx sensor 2 low (B1)',
    severity: 'caution',
  },
  P22A1: {
    description: 'NOx Sensor Circuit High (Bank 1 Sensor 2)',
    short: 'NOx sensor 2 high (B1)',
    severity: 'caution',
  },
  P22A2: {
    description: 'NOx Sensor Circuit Intermittent (Bank 1 Sensor 2)',
    short: 'NOx sensor 2 erratic (B1)',
    severity: 'caution',
  },
  P22A3: {
    description: 'NOx Sensor Heater Control Circuit/Open (Bank 1 Sensor 2)',
    short: 'NOx sensor 2 heater circuit (B1)',
    severity: 'caution',
  },
  P22A4: {
    description: 'NOx Sensor Heater Control Circuit Low (Bank 1 Sensor 2)',
    short: 'NOx sensor 2 heater low (B1)',
    severity: 'caution',
  },
  P22A5: {
    description: 'NOx Sensor Heater Control Circuit High (Bank 1 Sensor 2)',
    short: 'NOx sensor 2 heater high (B1)',
    severity: 'caution',
  },
  P22A6: {
    description: 'NOx Sensor Heater Sense Circuit (Bank 1 Sensor 2)',
    short: 'NOx 2 heater sense circuit (B1)',
    severity: 'caution',
  },
  P22A7: {
    description: 'NOx Sensor Heater Sense Circuit Range/Performance (Bank 1 Sensor 2)',
    short: 'NOx 2 heater sense fault (B1)',
    severity: 'caution',
  },
  P22A8: {
    description: 'NOx Sensor Heater Sense Circuit Low (Bank 1 Sensor 2)',
    short: 'NOx 2 heater sense low (B1)',
    severity: 'caution',
  },
  P22A9: {
    description: 'NOx Sensor Heater Sense Circuit High (Bank 1 Sensor 2)',
    short: 'NOx 2 heater sense high (B1)',
    severity: 'caution',
  },
  P22AA: {
    description: 'NOx Sensor Heater Sense Circuit Intermittent (Bank 1 Sensor 2)',
    short: 'NOx 2 heater sense erratic (B1)',
    severity: 'caution',
  },
  P22AB: {
    description: 'O2 Sensor Positive Current Control Circuit/Open (Bank 1 Sensor 2)',
    short: 'Downstream O2 +current open (B1)',
    severity: 'caution',
  },
  P22AC: {
    description: 'O2 Sensor Positive Current Control Circuit Low (Bank 1 Sensor 2)',
    short: 'Downstream O2 +current low (B1)',
    severity: 'caution',
  },
  P22AD: {
    description: 'O2 Sensor Positive Current Control Circuit High (Bank 1 Sensor 2)',
    short: 'Downstream O2 +current high (B1)',
    severity: 'caution',
  },
  P22AE: {
    description: 'O2 Sensor Reference Voltage Circuit/Open (Bank 1 Sensor 2)',
    short: 'Downstream O2 ref. circuit (B1)',
    severity: 'caution',
  },
  P22AF: {
    description: 'O2 Sensor Reference Voltage Performance (Bank 1 Sensor 2)',
    short: 'Downstream O2 ref. fault (B1)',
    severity: 'caution',
  },
  P22B0: {
    description: 'O2 Sensor Reference Voltage Circuit Low (Bank 1 Sensor 2)',
    short: 'Downstream O2 ref. low (B1)',
    severity: 'caution',
  },
  P22B1: {
    description: 'O2 Sensor Reference Voltage Circuit High (Bank 1 Sensor 2)',
    short: 'Downstream O2 ref. high (B1)',
    severity: 'caution',
  },
  P22B2: {
    description: 'O2 Sensor Negative Current Control Circuit/Open (Bank 1 Sensor 2)',
    short: 'Downstream O2 -current open (B1)',
    severity: 'caution',
  },
  P22B3: {
    description: 'O2 Sensor Negative Current Control Circuit Low (Bank 1 Sensor 2)',
    short: 'Downstream O2 -current low (B1)',
    severity: 'caution',
  },
  P22B4: {
    description: 'O2 Sensor Negative Current Control Circuit High (Bank 1 Sensor 2)',
    short: 'Downstream O2 -current high (B1)',
    severity: 'caution',
  },
  P22B5: {
    description: 'O2 Sensor Pumping Current Trim Circuit/Open (Bank 1 Sensor 2)',
    short: 'Downstream O2 trim circuit (B1)',
    severity: 'caution',
  },
  P22B6: {
    description: 'O2 Sensor Pumping Current Trim Circuit Low (Bank 1 Sensor 2)',
    short: 'Downstream O2 trim low (B1)',
    severity: 'caution',
  },
  P22B7: {
    description: 'O2 Sensor Pumping Current Trim Circuit High (Bank 1 Sensor 2)',
    short: 'Downstream O2 trim high (B1)',
    severity: 'caution',
  },
  P22B8: {
    description: 'O2 Sensor Positive Current Control Circuit/Open (Bank 2 Sensor 2)',
    short: 'Downstream O2 +current open (B2)',
    severity: 'caution',
  },
  P22B9: {
    description: 'O2 Sensor Positive Current Control Circuit Low (Bank 2 Sensor 2)',
    short: 'Downstream O2 +current low (B2)',
    severity: 'caution',
  },
  P22BA: {
    description: 'O2 Sensor Positive Current Control Circuit High (Bank 2 Sensor 2)',
    short: 'Downstream O2 +current high (B2)',
    severity: 'caution',
  },
  P22BB: {
    description: 'O2 Sensor Reference Voltage Circuit/Open (Bank 2 Sensor 2)',
    short: 'Downstream O2 ref. circuit (B2)',
    severity: 'caution',
  },
  P22BC: {
    description: 'O2 Sensor Reference Voltage Performance (Bank 2 Sensor 2)',
    short: 'Downstream O2 ref. fault (B2)',
    severity: 'caution',
  },
  P22BD: {
    description: 'O2 Sensor Reference Voltage Circuit Low (Bank 2 Sensor 2)',
    short: 'Downstream O2 ref. low (B2)',
    severity: 'caution',
  },
  P22BE: {
    description: 'O2 Sensor Reference Voltage Circuit High (Bank 2 Sensor 2)',
    short: 'Downstream O2 ref. high (B2)',
    severity: 'caution',
  },
  P22BF: {
    description: 'O2 Sensor Negative Current Control Circuit/Open (Bank 2 Sensor 2)',
    short: 'Downstream O2 -current open (B2)',
    severity: 'caution',
  },
  P22C0: {
    description: 'O2 Sensor Negative Current Control Circuit Low (Bank 2 Sensor 2)',
    short: 'Downstream O2 -current low (B2)',
    severity: 'caution',
  },
  P22C1: {
    description: 'O2 Sensor Negative Current Control Circuit High (Bank 2 Sensor 2)',
    short: 'Downstream O2 -current high (B2)',
    severity: 'caution',
  },
  P22C2: {
    description: 'O2 Sensor Pumping Current Trim Circuit/Open (Bank 2 Sensor 2)',
    short: 'Downstream O2 trim circuit (B2)',
    severity: 'caution',
  },
  P22C3: {
    description: 'O2 Sensor Pumping Current Trim Circuit Low (Bank 2 Sensor 2)',
    short: 'Downstream O2 trim low (B2)',
    severity: 'caution',
  },
  P22C4: {
    description: 'O2 Sensor Pumping Current Trim Circuit High (Bank 2 Sensor 2)',
    short: 'Downstream O2 trim high (B2)',
    severity: 'caution',
  },
  P22C5: {
    description: 'Turbocharger Compressor Outlet Valve Control Circuit/Open',
    short: 'Turbo outlet valve circuit open',
    severity: 'warning',
  },
  P22C6: {
    description: 'Turbocharger Compressor Outlet Valve Control Circuit Low',
    short: 'Turbo outlet valve low',
    severity: 'warning',
  },
  P22C7: {
    description: 'Turbocharger Compressor Outlet Valve Control Circuit High',
    short: 'Turbo outlet valve high',
    severity: 'warning',
  },
  P22C8: {
    description: 'Turbocharger Compressor Outlet Valve Stuck Open',
    short: 'Turbo outlet valve stuck open',
    severity: 'warning',
  },
  P22C9: {
    description: 'Turbocharger Compressor Outlet Valve Stuck Closed',
    short: 'Turbo outlet valve stuck closed',
    severity: 'warning',
  },
  P22CA: {
    description: 'Turbocharger Compressor Outlet Switching Valve Control Circuit/Open',
    short: 'Turbo switch valve circuit open',
    severity: 'warning',
  },
  P22CB: {
    description: 'Turbocharger Compressor Outlet Switching Valve Control Circuit Low',
    short: 'Turbo switch valve low',
    severity: 'warning',
  },
  P22CC: {
    description: 'Turbocharger Compressor Outlet Switching Valve Control Circuit High',
    short: 'Turbo switch valve high',
    severity: 'warning',
  },
  P22CD: {
    description: 'Turbocharger Compressor Outlet Switching Valve Stuck Open',
    short: 'Turbo switch valve stuck open',
    severity: 'warning',
  },
  P22CE: {
    description: 'Turbocharger Compressor Outlet Switching Valve Stuck Closed',
    short: 'Turbo switch valve stuck closed',
    severity: 'warning',
  },
  P22CF: {
    description: 'Turbocharger Turbine Inlet Valve Control Circuit/Open',
    short: 'Turbo inlet valve circuit open',
    severity: 'warning',
  },
  P22D0: {
    description: 'Turbocharger Turbine Inlet Valve Control Circuit Low',
    short: 'Turbo inlet valve low',
    severity: 'warning',
  },
  P22D1: {
    description: 'Turbocharger Turbine Inlet Valve Control Circuit High',
    short: 'Turbo inlet valve high',
    severity: 'warning',
  },
  P22D2: {
    description: 'Turbocharger Turbine Inlet Valve Stuck Open',
    short: 'Turbo inlet valve stuck open',
    severity: 'warning',
  },
  P22D3: {
    description: 'Turbocharger Turbine Inlet Valve Stuck Closed',
    short: 'Turbo inlet valve stuck closed',
    severity: 'warning',
  },
  P22D4: {
    description: 'Turbocharger Turbine Inlet Valve Position Sensor Circuit',
    short: 'Turbo inlet valve sensor circuit',
    severity: 'warning',
  },
  P22D5: {
    description: 'Turbocharger Turbine Inlet Valve Position Sensor Circuit Range/Performance',
    short: 'Turbo inlet valve sensor fault',
    severity: 'warning',
  },
  P22D6: {
    description: 'Turbocharger Turbine Inlet Valve Position Sensor Circuit Low',
    short: 'Turbo inlet valve sensor low',
    severity: 'warning',
  },
  P22D7: {
    description: 'Turbocharger Turbine Inlet Valve Position Sensor Circuit High',
    short: 'Turbo inlet valve sensor high',
    severity: 'warning',
  },
  P22D8: {
    description: 'Turbocharger Turbine Inlet Valve Position Sensor Circuit Intermittent/Erratic',
    short: 'Turbo inlet valve sensor erratic',
    severity: 'warning',
  },
  P22D9: {
    description: 'Cylinder 1 Alternative Fuel Injector Control Circuit/Open',
    short: 'Cyl 1 alt-fuel injector circuit',
    severity: 'warning',
  },
  P22DA: {
    description: 'Cylinder 1 Alternative Fuel Injector Control Circuit Low',
    short: 'Cyl 1 alt-fuel injector low',
    severity: 'warning',
  },
  P22DB: {
    description: 'Cylinder 1 Alternative Fuel Injector Control Circuit High',
    short: 'Cyl 1 alt-fuel injector high',
    severity: 'warning',
  },
  P22DC: {
    description: 'Cylinder 1 Alternative Fuel Injector Control Circuit Range/Performance',
    short: 'Cyl 1 alt-fuel injector fault',
    severity: 'warning',
  },
  P22DD: {
    description: 'Cylinder 2 Alternative Fuel Injector Control Circuit/Open',
    short: 'Cyl 2 alt-fuel injector circuit',
    severity: 'warning',
  },
  P22DE: {
    description: 'Cylinder 2 Alternative Fuel Injector Control Circuit Low',
    short: 'Cyl 2 alt-fuel injector low',
    severity: 'warning',
  },
  P22DF: {
    description: 'Cylinder 2 Alternative Fuel Injector Control Circuit High',
    short: 'Cyl 2 alt-fuel injector high',
    severity: 'warning',
  },
  P22E0: {
    description: 'Cylinder 2 Alternative Fuel Injector Control Circuit Range/Performance',
    short: 'Cyl 2 alt-fuel injector fault',
    severity: 'warning',
  },
  P22E1: {
    description: 'Cylinder 3 Alternative Fuel Injector Control Circuit/Open',
    short: 'Cyl 3 alt-fuel injector circuit',
    severity: 'warning',
  },
  P22E2: {
    description: 'Cylinder 3 Alternative Fuel Injector Control Circuit Low',
    short: 'Cyl 3 alt-fuel injector low',
    severity: 'warning',
  },
  P22E3: {
    description: 'Cylinder 3 Alternative Fuel Injector Control Circuit High',
    short: 'Cyl 3 alt-fuel injector high',
    severity: 'warning',
  },
  P22E4: {
    description: 'Cylinder 3 Alternative Fuel Injector Control Circuit Range/Performance',
    short: 'Cyl 3 alt-fuel injector fault',
    severity: 'warning',
  },
  P22E5: {
    description: 'Cylinder 4 Alternative Fuel Injector Control Circuit/Open',
    short: 'Cyl 4 alt-fuel injector circuit',
    severity: 'warning',
  },
  P22E6: {
    description: 'Cylinder 4 Alternative Fuel Injector Control Circuit Low',
    short: 'Cyl 4 alt-fuel injector low',
    severity: 'warning',
  },
  P22E7: {
    description: 'Cylinder 4 Alternative Fuel Injector Control Circuit High',
    short: 'Cyl 4 alt-fuel injector high',
    severity: 'warning',
  },
  P22E8: {
    description: 'Cylinder 4 Alternative Fuel Injector Control Circuit Range/Performance',
    short: 'Cyl 4 alt-fuel injector fault',
    severity: 'warning',
  },
  P22E9: {
    description: 'Cylinder 5 Alternative Fuel Injector Control Circuit/Open',
    short: 'Cyl 5 alt-fuel injector circuit',
    severity: 'warning',
  },
  P22EA: {
    description: 'Cylinder 5 Alternative Fuel Injector Control Circuit Low',
    short: 'Cyl 5 alt-fuel injector low',
    severity: 'warning',
  },
  P22EB: {
    description: 'Cylinder 5 Alternative Fuel Injector Control Circuit High',
    short: 'Cyl 5 alt-fuel injector high',
    severity: 'warning',
  },
  P22EC: {
    description: 'Cylinder 5 Alternative Fuel Injector Control Circuit Range/Performance',
    short: 'Cyl 5 alt-fuel injector fault',
    severity: 'warning',
  },
  P22ED: {
    description: 'Cylinder 6 Alternative Fuel Injector Control Circuit/Open',
    short: 'Cyl 6 alt-fuel injector circuit',
    severity: 'warning',
  },
  P22EE: {
    description: 'Cylinder 6 Alternative Fuel Injector Control Circuit Low',
    short: 'Cyl 6 alt-fuel injector low',
    severity: 'warning',
  },
  P22EF: {
    description: 'Cylinder 6 Alternative Fuel Injector Control Circuit High',
    short: 'Cyl 6 alt-fuel injector high',
    severity: 'warning',
  },
  P22F0: {
    description: 'Cylinder 6 Alternative Fuel Injector Control Circuit Range/Performance',
    short: 'Cyl 6 alt-fuel injector fault',
    severity: 'warning',
  },
  P22F1: {
    description: 'Cylinder 7 Alternative Fuel Injector Control Circuit/Open',
    short: 'Cyl 7 alt-fuel injector circuit',
    severity: 'warning',
  },
  P22F2: {
    description: 'Cylinder 7 Alternative Fuel Injector Control Circuit Low',
    short: 'Cyl 7 alt-fuel injector low',
    severity: 'warning',
  },
  P22F3: {
    description: 'Cylinder 7 Alternative Fuel Injector Control Circuit High',
    short: 'Cyl 7 alt-fuel injector high',
    severity: 'warning',
  },
  P22F4: {
    description: 'Cylinder 7 Alternative Fuel Injector Control Circuit Range/Performance',
    short: 'Cyl 7 alt-fuel injector fault',
    severity: 'warning',
  },
  P22F5: {
    description: 'Cylinder 8 Alternative Fuel Injector Control Circuit/Open',
    short: 'Cyl 8 alt-fuel injector circuit',
    severity: 'warning',
  },
  P22F6: {
    description: 'Cylinder 8 Alternative Fuel Injector Control Circuit Low',
    short: 'Cyl 8 alt-fuel injector low',
    severity: 'warning',
  },
  P22F7: {
    description: 'Cylinder 8 Alternative Fuel Injector Control Circuit High',
    short: 'Cyl 8 alt-fuel injector high',
    severity: 'warning',
  },
  P22F8: {
    description: 'Cylinder 8 Alternative Fuel Injector Control Circuit Range/Performance',
    short: 'Cyl 8 alt-fuel injector fault',
    severity: 'warning',
  },
  P22F9: {
    description: 'NOx Sensor Performance - Slow Response Low to High (Bank 1 Sensor 1)',
    short: 'NOx sensor 1 slow rising (B1)',
    severity: 'caution',
  },
  P22FA: {
    description: 'NOx Sensor Performance - Slow Response High to Low (Bank 1 Sensor 1)',
    short: 'NOx sensor 1 slow falling (B1)',
    severity: 'caution',
  },
  P22FB: {
    description: 'NOx Sensor Performance - Sensing Element (Bank 1 Sensor 1)',
    short: 'NOx sensor 1 element fault (B1)',
    severity: 'caution',
  },
  P22FC: {
    description: 'NOx Sensor Performance - Slow Response Low to High (Bank 1 Sensor 2)',
    short: 'NOx sensor 2 slow rising (B1)',
    severity: 'caution',
  },
  P22FD: {
    description: 'NOx Sensor Performance - Slow Response High to Low (Bank 1 Sensor 2)',
    short: 'NOx sensor 2 slow falling (B1)',
    severity: 'caution',
  },
  P22FE: {
    description: 'NOx Sensor Performance - Sensing Element (Bank 1 Sensor 2)',
    short: 'NOx sensor 2 element fault (B1)',
    severity: 'caution',
  },
  P22FF: {
    description: 'SCR NOx Catalyst Inlet Temperature Too Low',
    short: 'NOx catalyst inlet too cold',
    severity: 'caution',
  },

  // P23xx — ignition coils, knock, cylinder pressure, injector balance
  P2300: {
    description: 'Ignition Coil "A" Primary Control Circuit Low',
    short: 'Ignition coil A low',
    severity: 'warning',
  },
  P2301: {
    description: 'Ignition Coil "A" Primary Control Circuit High',
    short: 'Ignition coil A high',
    severity: 'warning',
  },
  P2302: {
    description: 'Ignition Coil "A" Secondary Circuit',
    short: 'Ignition coil A secondary fault',
    severity: 'warning',
  },
  P2303: {
    description: 'Ignition Coil "B" Primary Control Circuit Low',
    short: 'Ignition coil B low',
    severity: 'warning',
  },
  P2304: {
    description: 'Ignition Coil "B" Primary Control Circuit High',
    short: 'Ignition coil B high',
    severity: 'warning',
  },
  P2305: {
    description: 'Ignition Coil "B" Secondary Circuit',
    short: 'Ignition coil B secondary fault',
    severity: 'warning',
  },
  P2306: {
    description: 'Ignition Coil "C" Primary Control Circuit Low',
    short: 'Ignition coil C low',
    severity: 'warning',
  },
  P2307: {
    description: 'Ignition Coil "C" Primary Control Circuit High',
    short: 'Ignition coil C high',
    severity: 'warning',
  },
  P2308: {
    description: 'Ignition Coil "C" Secondary Circuit',
    short: 'Ignition coil C secondary fault',
    severity: 'warning',
  },
  P2309: {
    description: 'Ignition Coil "D" Primary Control Circuit Low',
    short: 'Ignition coil D low',
    severity: 'warning',
  },
  P230A: {
    description: 'Cylinder 1 Air-Fuel Ratio Imbalance - Adjustment At Limit During Balance',
    short: 'Cylinder 1 fuel balance limit',
    severity: 'caution',
  },
  P230B: {
    description: 'Cylinder 2 Air-Fuel Ratio Imbalance - Adjustment At Limit During Balance',
    short: 'Cylinder 2 fuel balance limit',
    severity: 'caution',
  },
  P230C: {
    description: 'Cylinder 3 Air-Fuel Ratio Imbalance - Adjustment At Limit During Balance',
    short: 'Cylinder 3 fuel balance limit',
    severity: 'caution',
  },
  P230D: {
    description: 'Cylinder 4 Air-Fuel Ratio Imbalance - Adjustment At Limit During Balance',
    short: 'Cylinder 4 fuel balance limit',
    severity: 'caution',
  },
  P230E: {
    description: 'Cylinder 5 Air-Fuel Ratio Imbalance - Adjustment At Limit During Balance',
    short: 'Cylinder 5 fuel balance limit',
    severity: 'caution',
  },
  P230F: {
    description: 'Cylinder 6 Air-Fuel Ratio Imbalance - Adjustment At Limit During Balance',
    short: 'Cylinder 6 fuel balance limit',
    severity: 'caution',
  },
  P2310: {
    description: 'Ignition Coil "D" Primary Control Circuit High',
    short: 'Ignition coil D high',
    severity: 'warning',
  },
  P2311: {
    description: 'Ignition Coil "D" Secondary Circuit',
    short: 'Ignition coil D secondary fault',
    severity: 'warning',
  },
  P2312: {
    description: 'Ignition Coil "E" Primary Control Circuit Low',
    short: 'Ignition coil E low',
    severity: 'warning',
  },
  P2313: {
    description: 'Ignition Coil "E" Primary Control Circuit High',
    short: 'Ignition coil E high',
    severity: 'warning',
  },
  P2314: {
    description: 'Ignition Coil "E" Secondary Circuit',
    short: 'Ignition coil E secondary fault',
    severity: 'warning',
  },
  P2315: {
    description: 'Ignition Coil "F" Primary Control Circuit Low',
    short: 'Ignition coil F low',
    severity: 'warning',
  },
  P2316: {
    description: 'Ignition Coil "F" Primary Control Circuit High',
    short: 'Ignition coil F high',
    severity: 'warning',
  },
  P2317: {
    description: 'Ignition Coil "F" Secondary Circuit',
    short: 'Ignition coil F secondary fault',
    severity: 'warning',
  },
  P2318: {
    description: 'Ignition Coil "G" Primary Control Circuit Low',
    short: 'Ignition coil G low',
    severity: 'warning',
  },
  P2319: {
    description: 'Ignition Coil "G" Primary Control Circuit High',
    short: 'Ignition coil G high',
    severity: 'warning',
  },
  P231A: {
    description: 'Cylinder 7 Air-Fuel Ratio Imbalance - Adjustment At Limit During Balance',
    short: 'Cylinder 7 fuel balance limit',
    severity: 'caution',
  },
  P231B: {
    description: 'Cylinder 8 Air-Fuel Ratio Imbalance - Adjustment At Limit During Balance',
    short: 'Cylinder 8 fuel balance limit',
    severity: 'caution',
  },
  P231C: {
    description: 'Cylinder 9 Air-Fuel Ratio Imbalance - Adjustment At Limit During Balance',
    short: 'Cylinder 9 fuel balance limit',
    severity: 'caution',
  },
  P231D: {
    description: 'Cylinder 10 Air-Fuel Ratio Imbalance - Adjustment At Limit During Balance',
    short: 'Cylinder 10 fuel balance limit',
    severity: 'caution',
  },
  P231E: {
    description: 'Cylinder 11 Air-Fuel Ratio Imbalance - Adjustment At Limit During Balance',
    short: 'Cylinder 11 fuel balance limit',
    severity: 'caution',
  },
  P231F: {
    description: 'Cylinder 12 Air-Fuel Ratio Imbalance - Adjustment At Limit During Balance',
    short: 'Cylinder 12 fuel balance limit',
    severity: 'caution',
  },
  P2320: {
    description: 'Ignition Coil "G" Secondary Circuit',
    short: 'Ignition coil G secondary fault',
    severity: 'warning',
  },
  P2321: {
    description: 'Ignition Coil "H" Primary Control Circuit Low',
    short: 'Ignition coil H low',
    severity: 'warning',
  },
  P2322: {
    description: 'Ignition Coil "H" Primary Control Circuit High',
    short: 'Ignition coil H high',
    severity: 'warning',
  },
  P2323: {
    description: 'Ignition Coil "H" Secondary Circuit',
    short: 'Ignition coil H secondary fault',
    severity: 'warning',
  },
  P2324: {
    description: 'Ignition Coil "I" Primary Control Circuit Low',
    short: 'Ignition coil I low',
    severity: 'warning',
  },
  P2325: {
    description: 'Ignition Coil "I" Primary Control Circuit High',
    short: 'Ignition coil I high',
    severity: 'warning',
  },
  P2326: {
    description: 'Ignition Coil "I" Secondary Circuit',
    short: 'Ignition coil I secondary fault',
    severity: 'warning',
  },
  P2327: {
    description: 'Ignition Coil "J" Primary Control Circuit Low',
    short: 'Ignition coil J low',
    severity: 'warning',
  },
  P2328: {
    description: 'Ignition Coil "J" Primary Control Circuit High',
    short: 'Ignition coil J high',
    severity: 'warning',
  },
  P2329: {
    description: 'Ignition Coil "J" Secondary Circuit',
    short: 'Ignition coil J secondary fault',
    severity: 'warning',
  },
  P232A: {
    description: 'TCM Request - Forced Engine Shutdown',
    short: 'Transmission forced engine off',
    severity: 'critical',
  },
  P2330: {
    description: 'Ignition Coil "K" Primary Control Circuit Low',
    short: 'Ignition coil K low',
    severity: 'warning',
  },
  P2331: {
    description: 'Ignition Coil "K" Primary Control Circuit High',
    short: 'Ignition coil K high',
    severity: 'warning',
  },
  P2332: {
    description: 'Ignition Coil "K" Secondary Circuit',
    short: 'Ignition coil K secondary fault',
    severity: 'warning',
  },
  P2333: {
    description: 'Ignition Coil "L" Primary Control Circuit Low',
    short: 'Ignition coil L low',
    severity: 'warning',
  },
  P2334: {
    description: 'Ignition Coil "L" Primary Control Circuit High',
    short: 'Ignition coil L high',
    severity: 'warning',
  },
  P2335: {
    description: 'Ignition Coil "L" Secondary Circuit',
    short: 'Ignition coil L secondary fault',
    severity: 'warning',
  },
  P2336: {
    description: 'Cylinder 1 Above Knock/Combustion Vibration Sensor Threshold',
    short: 'Cylinder 1 knocking',
    severity: 'warning',
  },
  P2337: {
    description: 'Cylinder 2 Above Knock/Combustion Vibration Sensor Threshold',
    short: 'Cylinder 2 knocking',
    severity: 'warning',
  },
  P2338: {
    description: 'Cylinder 3 Above Knock/Combustion Vibration Sensor Threshold',
    short: 'Cylinder 3 knocking',
    severity: 'warning',
  },
  P2339: {
    description: 'Cylinder 4 Above Knock/Combustion Vibration Sensor Threshold',
    short: 'Cylinder 4 knocking',
    severity: 'warning',
  },
  P2340: {
    description: 'Cylinder 5 Above Knock/Combustion Vibration Sensor Threshold',
    short: 'Cylinder 5 knocking',
    severity: 'warning',
  },
  P2341: {
    description: 'Cylinder 6 Above Knock/Combustion Vibration Sensor Threshold',
    short: 'Cylinder 6 knocking',
    severity: 'warning',
  },
  P2342: {
    description: 'Cylinder 7 Above Knock/Combustion Vibration Sensor Threshold',
    short: 'Cylinder 7 knocking',
    severity: 'warning',
  },
  P2343: {
    description: 'Cylinder 8 Above Knock/Combustion Vibration Sensor Threshold',
    short: 'Cylinder 8 knocking',
    severity: 'warning',
  },
  P2344: {
    description: 'Cylinder 9 Above Knock/Combustion Vibration Sensor Threshold',
    short: 'Cylinder 9 knocking',
    severity: 'warning',
  },
  P2345: {
    description: 'Cylinder 10 Above Knock/Combustion Vibration Sensor Threshold',
    short: 'Cylinder 10 knocking',
    severity: 'warning',
  },
  P2346: {
    description: 'Cylinder 11 Above Knock/Combustion Vibration Sensor Threshold',
    short: 'Cylinder 11 knocking',
    severity: 'warning',
  },
  P2347: {
    description: 'Cylinder 12 Above Knock/Combustion Vibration Sensor Threshold',
    short: 'Cylinder 12 knocking',
    severity: 'warning',
  },
  P2348: {
    description: 'Cylinder 9 Pressure Sensor Circuit',
    short: 'Cyl 9 pressure sensor circuit',
    severity: 'caution',
  },
  P2349: {
    description: 'Cylinder 9 Pressure Sensor Circuit Range/Performance',
    short: 'Cyl 9 pressure sensor fault',
    severity: 'caution',
  },
  P234A: {
    description: 'Cylinder 9 Pressure Sensor Circuit Low',
    short: 'Cyl 9 pressure sensor low',
    severity: 'caution',
  },
  P234B: {
    description: 'Cylinder 9 Pressure Sensor Circuit High',
    short: 'Cyl 9 pressure sensor high',
    severity: 'caution',
  },
  P234C: {
    description: 'Cylinder 9 Pressure Sensor Circuit Intermittent/Erratic',
    short: 'Cyl 9 pressure sensor erratic',
    severity: 'caution',
  },
  P234D: {
    description: 'Cylinder 9 Pressure Too Low',
    short: 'Cylinder 9 pressure too low',
    severity: 'warning',
  },
  P234E: {
    description: 'Cylinder 9 Pressure Too High',
    short: 'Cylinder 9 pressure too high',
    severity: 'warning',
  },
  P234F: {
    description: 'Cylinder 9 Pressure Variation Low',
    short: 'Cyl 9 pressure variation low',
    severity: 'warning',
  },
  P2350: {
    description: 'Cylinder 9 Pressure Variation High',
    short: 'Cyl 9 pressure variation high',
    severity: 'warning',
  },
  P2351: {
    description: 'Cylinder 9 Combustion Performance',
    short: 'Cylinder 9 combustion fault',
    severity: 'warning',
  },
  P2352: {
    description: 'Cylinder 10 Pressure Sensor Circuit',
    short: 'Cyl 10 pressure sensor circuit',
    severity: 'caution',
  },
  P2353: {
    description: 'Cylinder 10 Pressure Sensor Circuit Range/Performance',
    short: 'Cyl 10 pressure sensor fault',
    severity: 'caution',
  },
  P2354: {
    description: 'Cylinder 10 Pressure Sensor Circuit Low',
    short: 'Cyl 10 pressure sensor low',
    severity: 'caution',
  },
  P2355: {
    description: 'Cylinder 10 Pressure Sensor Circuit High',
    short: 'Cyl 10 pressure sensor high',
    severity: 'caution',
  },
  P2356: {
    description: 'Cylinder 10 Pressure Sensor Circuit Intermittent/Erratic',
    short: 'Cyl 10 pressure sensor erratic',
    severity: 'caution',
  },
  P2357: {
    description: 'Cylinder 10 Pressure Too Low',
    short: 'Cylinder 10 pressure too low',
    severity: 'warning',
  },
  P2358: {
    description: 'Cylinder 10 Pressure Too High',
    short: 'Cylinder 10 pressure too high',
    severity: 'warning',
  },
  P2359: {
    description: 'Cylinder 10 Pressure Variation Low',
    short: 'Cyl 10 pressure variation low',
    severity: 'warning',
  },
  P235A: {
    description: 'Cylinder 10 Pressure Variation High',
    short: 'Cyl 10 pressure variation high',
    severity: 'warning',
  },
  P235B: {
    description: 'Cylinder 10 Combustion Performance',
    short: 'Cylinder 10 combustion fault',
    severity: 'warning',
  },
  P235C: {
    description: 'Cylinder 11 Pressure Sensor Circuit',
    short: 'Cyl 11 pressure sensor circuit',
    severity: 'caution',
  },
  P235D: {
    description: 'Cylinder 11 Pressure Sensor Circuit Range/Performance',
    short: 'Cyl 11 pressure sensor fault',
    severity: 'caution',
  },
  P235E: {
    description: 'Cylinder 11 Pressure Sensor Circuit Low',
    short: 'Cyl 11 pressure sensor low',
    severity: 'caution',
  },
  P235F: {
    description: 'Cylinder 11 Pressure Sensor Circuit High',
    short: 'Cyl 11 pressure sensor high',
    severity: 'caution',
  },
  P2360: {
    description: 'Cylinder 11 Pressure Sensor Circuit Intermittent/Erratic',
    short: 'Cyl 11 pressure sensor erratic',
    severity: 'caution',
  },
  P2361: {
    description: 'Cylinder 11 Pressure Too Low',
    short: 'Cylinder 11 pressure too low',
    severity: 'warning',
  },
  P2362: {
    description: 'Cylinder 11 Pressure Too High',
    short: 'Cylinder 11 pressure too high',
    severity: 'warning',
  },
  P2363: {
    description: 'Cylinder 11 Pressure Variation Low',
    short: 'Cyl 11 pressure variation low',
    severity: 'warning',
  },
  P2364: {
    description: 'Cylinder 11 Pressure Variation High',
    short: 'Cyl 11 pressure variation high',
    severity: 'warning',
  },
  P2365: {
    description: 'Cylinder 11 Combustion Performance',
    short: 'Cylinder 11 combustion fault',
    severity: 'warning',
  },
  P2366: {
    description: 'Cylinder 12 Pressure Sensor Circuit',
    short: 'Cyl 12 pressure sensor circuit',
    severity: 'caution',
  },
  P2367: {
    description: 'Cylinder 12 Pressure Sensor Circuit Range/Performance',
    short: 'Cyl 12 pressure sensor fault',
    severity: 'caution',
  },
  P2368: {
    description: 'Cylinder 12 Pressure Sensor Circuit Low',
    short: 'Cyl 12 pressure sensor low',
    severity: 'caution',
  },
  P2369: {
    description: 'Cylinder 12 Pressure Sensor Circuit High',
    short: 'Cyl 12 pressure sensor high',
    severity: 'caution',
  },
  P236A: {
    description: 'Cylinder 12 Pressure Sensor Circuit Intermittent/Erratic',
    short: 'Cyl 12 pressure sensor erratic',
    severity: 'caution',
  },
  P236B: {
    description: 'Cylinder 12 Pressure Too Low',
    short: 'Cylinder 12 pressure too low',
    severity: 'warning',
  },
  P236C: {
    description: 'Cylinder 12 Pressure Too High',
    short: 'Cylinder 12 pressure too high',
    severity: 'warning',
  },
  P236D: {
    description: 'Cylinder 12 Pressure Variation Low',
    short: 'Cyl 12 pressure variation low',
    severity: 'warning',
  },
  P236E: {
    description: 'Cylinder 12 Pressure Variation High',
    short: 'Cyl 12 pressure variation high',
    severity: 'warning',
  },
  P236F: {
    description: 'Cylinder 12 Combustion Performance',
    short: 'Cylinder 12 combustion fault',
    severity: 'warning',
  },
  P23F2: {
    description: 'Cylinder 1 Injector "B" Air-Fuel Ratio Imbalance',
    short: 'Cyl 1 injector B imbalance',
    severity: 'caution',
  },
  P23F3: {
    description: 'Cylinder 2 Injector "B" Air-Fuel Ratio Imbalance',
    short: 'Cyl 2 injector B imbalance',
    severity: 'caution',
  },
  P23F4: {
    description: 'Cylinder 3 Injector "B" Air-Fuel Ratio Imbalance',
    short: 'Cyl 3 injector B imbalance',
    severity: 'caution',
  },
  P23F5: {
    description: 'Cylinder 4 Injector "B" Air-Fuel Ratio Imbalance',
    short: 'Cyl 4 injector B imbalance',
    severity: 'caution',
  },
  P23F6: {
    description: 'Cylinder 5 Injector "B" Air-Fuel Ratio Imbalance',
    short: 'Cyl 5 injector B imbalance',
    severity: 'caution',
  },
  P23F7: {
    description: 'Cylinder 6 Injector "B" Air-Fuel Ratio Imbalance',
    short: 'Cyl 6 injector B imbalance',
    severity: 'caution',
  },
  P23F8: {
    description: 'Cylinder 7 Injector "B" Air-Fuel Ratio Imbalance',
    short: 'Cyl 7 injector B imbalance',
    severity: 'caution',
  },
  P23F9: {
    description: 'Cylinder 8 Injector "B" Air-Fuel Ratio Imbalance',
    short: 'Cyl 8 injector B imbalance',
    severity: 'caution',
  },
  P23FA: {
    description: 'Cylinder 9 Injector "B" Air-Fuel Ratio Imbalance',
    short: 'Cyl 9 injector B imbalance',
    severity: 'caution',
  },
  P23FB: {
    description: 'Cylinder 10 Injector "B" Air-Fuel Ratio Imbalance',
    short: 'Cyl 10 injector B imbalance',
    severity: 'caution',
  },
  P23FC: {
    description: 'Cylinder 11 Injector "B" Air-Fuel Ratio Imbalance',
    short: 'Cyl 11 injector B imbalance',
    severity: 'caution',
  },
  P23FD: {
    description: 'Cylinder 12 Injector "B" Air-Fuel Ratio Imbalance',
    short: 'Cyl 12 injector B imbalance',
    severity: 'caution',
  },
  P23FE: {
    description: 'Bank 1 System "B" Air-Fuel Ratio Imbalance',
    short: 'Fuel system B imbalance (B1)',
    severity: 'caution',
  },
  P23FF: {
    description: 'Bank 2 System "B" Air-Fuel Ratio Imbalance',
    short: 'Fuel system B imbalance (B2)',
    severity: 'caution',
  },

  // P24xx — EVAP leak detection, EGR cooler, secondary air, particulate filter, exhaust temp
  P2400: {
    description: 'Evaporative Emission System Leak Detection Pump Control Circuit/Open',
    short: 'EVAP leak pump circuit open',
    severity: 'caution',
  },
  P2401: {
    description: 'Evaporative Emission System Leak Detection Pump Control Circuit Low',
    short: 'EVAP leak pump low',
    severity: 'caution',
  },
  P2402: {
    description: 'Evaporative Emission System Leak Detection Pump Control Circuit High',
    short: 'EVAP leak pump high',
    severity: 'caution',
  },
  P2403: {
    description: 'Evaporative Emission System Leak Detection Pump Sense Circuit/Open',
    short: 'EVAP leak pump sense circuit',
    severity: 'caution',
  },
  P2404: {
    description: 'Evaporative Emission System Leak Detection Pump Sense Circuit Range/Performance',
    short: 'EVAP leak pump sense fault',
    severity: 'caution',
  },
  P2405: {
    description: 'Evaporative Emission System Leak Detection Pump Sense Circuit Low',
    short: 'EVAP leak pump sense low',
    severity: 'caution',
  },
  P2406: {
    description: 'Evaporative Emission System Leak Detection Pump Sense Circuit High',
    short: 'EVAP leak pump sense high',
    severity: 'caution',
  },
  P2407: {
    description:
      'Evaporative Emission System Leak Detection Pump Sense Circuit Intermittent/Erratic',
    short: 'EVAP leak pump sense erratic',
    severity: 'caution',
  },
  P2408: {
    description: 'Fuel Cap Sensor/Switch Circuit',
    short: 'Fuel cap sensor circuit',
    severity: 'info',
  },
  P2409: {
    description: 'Fuel Cap Sensor/Switch Circuit Range/Performance',
    short: 'Fuel cap sensor out of range',
    severity: 'info',
  },
  P240A: {
    description: 'Evaporative Emission System Leak Detection Pump Heater Control Circuit/Open',
    short: 'EVAP leak pump heater circuit',
    severity: 'caution',
  },
  P240B: {
    description: 'Evaporative Emission System Leak Detection Pump Heater Control Circuit Low',
    short: 'EVAP leak pump heater low',
    severity: 'caution',
  },
  P240C: {
    description: 'Evaporative Emission System Leak Detection Pump Heater Control Circuit High',
    short: 'EVAP leak pump heater high',
    severity: 'caution',
  },
  P240D: {
    description: 'Alternative Fuel Low Pressure System Leak',
    short: 'Alt-fuel leak (low pressure)',
    severity: 'critical',
  },
  P240E: {
    description: 'Alternative Fuel High Pressure System Leak',
    short: 'Alt-fuel leak (high pressure)',
    severity: 'critical',
  },
  P240F: {
    description: 'Exhaust Gas Recirculation Slow Response',
    short: 'EGR slow response',
    severity: 'caution',
  },
  P2410: {
    description: 'Fuel Cap Sensor/Switch Circuit Low',
    short: 'Fuel cap sensor low',
    severity: 'info',
  },
  P2411: {
    description: 'Fuel Cap Sensor/Switch Circuit High',
    short: 'Fuel cap sensor high',
    severity: 'info',
  },
  P2412: {
    description: 'Fuel Cap Sensor/Switch Circuit Intermittent/Erratic',
    short: 'Fuel cap sensor erratic',
    severity: 'info',
  },
  P2413: {
    description: 'Exhaust Gas Recirculation System Performance',
    short: 'EGR system fault',
    severity: 'caution',
  },
  P2414: {
    description: 'O2 Sensor Exhaust Sample Error (Bank 1 Sensor 1)',
    short: 'Upstream O2 sample error (B1)',
    severity: 'caution',
  },
  P2415: {
    description: 'O2 Sensor Exhaust Sample Error (Bank 2 Sensor 1)',
    short: 'Upstream O2 sample error (B2)',
    severity: 'caution',
  },
  P2416: {
    description: 'O2 Sensor Signals Swapped (Bank 1 Sensor 2 / Bank 1 Sensor 3)',
    short: 'O2 sensors 2/3 swapped (B1)',
    severity: 'caution',
  },
  P2417: {
    description: 'O2 Sensor Signals Swapped (Bank 2 Sensor 2 / Bank 2 Sensor 3)',
    short: 'O2 sensors 2/3 swapped (B2)',
    severity: 'caution',
  },
  P2418: {
    description: 'Evaporative Emission System Switching Valve Control Circuit/Open',
    short: 'EVAP switch valve circuit open',
    severity: 'caution',
  },
  P2419: {
    description: 'Evaporative Emission System Switching Valve Control Circuit Low',
    short: 'EVAP switch valve low',
    severity: 'caution',
  },
  P241A: {
    description: 'O2 Sensor Signals Swapped (Bank 1 Sensor 1 / Bank 1 Sensor 2)',
    short: 'Up/downstream O2 swapped (B1)',
    severity: 'caution',
  },
  P241B: {
    description: 'O2 Sensor Signals Swapped (Bank 2 Sensor 1 / Bank 2 Sensor 2)',
    short: 'Up/downstream O2 swapped (B2)',
    severity: 'caution',
  },
  P241C: {
    description: 'Throttle Actuator Control System - Ice Blockage (Bank 2)',
    short: 'Throttle blocked by ice (B2)',
    severity: 'warning',
  },
  P241E: {
    description: 'Reductant Heater Coolant Control Valve Stuck Closed',
    short: 'DEF coolant valve stuck closed',
    severity: 'caution',
  },
  P241F: {
    description: 'Exhaust Gas Recirculation Cooler "B" Efficiency Below Threshold',
    short: 'EGR cooler B efficiency low',
    severity: 'caution',
  },
  P2420: {
    description: 'Evaporative Emission System Switching Valve Control Circuit High',
    short: 'EVAP switch valve high',
    severity: 'caution',
  },
  P2421: {
    description: 'Evaporative Emission System Vent Valve Stuck Open',
    short: 'EVAP vent valve stuck open',
    severity: 'caution',
  },
  P2422: {
    description: 'Evaporative Emission System Vent Valve Stuck Closed',
    short: 'EVAP vent valve stuck closed',
    severity: 'caution',
  },
  P2423: {
    description: 'HC Adsorption Catalyst Efficiency Below Threshold (Bank 1)',
    short: 'HC trap efficiency low (B1)',
    severity: 'caution',
  },
  P2424: {
    description: 'HC Adsorption Catalyst Efficiency Below Threshold (Bank 2)',
    short: 'HC trap efficiency low (B2)',
    severity: 'caution',
  },
  P2425: {
    description: 'Exhaust Gas Recirculation Cooling Valve Control Circuit/Open',
    short: 'EGR cooler valve circuit open',
    severity: 'caution',
  },
  P2426: {
    description: 'Exhaust Gas Recirculation Cooling Valve Control Circuit Low',
    short: 'EGR cooler valve low',
    severity: 'caution',
  },
  P2427: {
    description: 'Exhaust Gas Recirculation Cooling Valve Control Circuit High',
    short: 'EGR cooler valve high',
    severity: 'caution',
  },
  P2428: {
    description: 'Exhaust Gas Temperature Too High (Bank 1)',
    short: 'Exhaust too hot (B1)',
    severity: 'warning',
  },
  P2429: {
    description: 'Exhaust Gas Temperature Too High (Bank 2)',
    short: 'Exhaust too hot (B2)',
    severity: 'warning',
  },
  P242A: {
    description: 'Exhaust Gas Temperature Sensor Circuit (Bank 1 Sensor 3)',
    short: 'Exhaust temp 3 circuit (B1)',
    severity: 'caution',
  },
  P242B: {
    description: 'Exhaust Gas Temperature Sensor Circuit Range/Performance (Bank 1 Sensor 3)',
    short: 'Exhaust temp sensor 3 fault (B1)',
    severity: 'caution',
  },
  P242C: {
    description: 'Exhaust Gas Temperature Sensor Circuit Low (Bank 1 Sensor 3)',
    short: 'Exhaust temp sensor 3 low (B1)',
    severity: 'caution',
  },
  P242D: {
    description: 'Exhaust Gas Temperature Sensor Circuit High (Bank 1 Sensor 3)',
    short: 'Exhaust temp sensor 3 high (B1)',
    severity: 'caution',
  },
  P242E: {
    description: 'Exhaust Gas Temperature Sensor Circuit Intermittent/Erratic (Bank 1 Sensor 3)',
    short: 'Exhaust temp 3 erratic (B1)',
    severity: 'caution',
  },
  P242F: {
    description: 'Particulate Filter Restriction - Ash Accumulation (Bank 1)',
    short: 'Exhaust filter ash buildup (B1)',
    severity: 'warning',
  },
  P2430: {
    description: 'Secondary Air Injection System Air Flow/Pressure Sensor Circuit (Bank 1)',
    short: 'Sec. air sensor circuit (B1)',
    severity: 'caution',
  },
  P2431: {
    description:
      'Secondary Air Injection System Air Flow/Pressure Sensor Circuit Range/Performance (Bank 1)',
    short: 'Sec. air sensor fault (B1)',
    severity: 'caution',
  },
  P2432: {
    description: 'Secondary Air Injection System Air Flow/Pressure Sensor Circuit Low (Bank 1)',
    short: 'Sec. air sensor low (B1)',
    severity: 'caution',
  },
  P2433: {
    description: 'Secondary Air Injection System Air Flow/Pressure Sensor Circuit High (Bank 1)',
    short: 'Sec. air sensor high (B1)',
    severity: 'caution',
  },
  P2434: {
    description:
      'Secondary Air Injection System Air Flow/Pressure Sensor Circuit Intermittent/Erratic (Bank 1)',
    short: 'Sec. air sensor erratic (B1)',
    severity: 'caution',
  },
  P2435: {
    description: 'Secondary Air Injection System Air Flow/Pressure Sensor Circuit (Bank 2)',
    short: 'Sec. air sensor circuit (B2)',
    severity: 'caution',
  },
  P2436: {
    description:
      'Secondary Air Injection System Air Flow/Pressure Sensor Circuit Range/Performance (Bank 2)',
    short: 'Sec. air sensor fault (B2)',
    severity: 'caution',
  },
  P2437: {
    description: 'Secondary Air Injection System Air Flow/Pressure Sensor Circuit Low (Bank 2)',
    short: 'Sec. air sensor low (B2)',
    severity: 'caution',
  },
  P2438: {
    description: 'Secondary Air Injection System Air Flow/Pressure Sensor Circuit High (Bank 2)',
    short: 'Sec. air sensor high (B2)',
    severity: 'caution',
  },
  P2439: {
    description:
      'Secondary Air Injection System Air Flow/Pressure Sensor Circuit Intermittent/Erratic (Bank 2)',
    short: 'Sec. air sensor erratic (B2)',
    severity: 'caution',
  },
  P243A: {
    description: 'Particulate Filter Restriction - Ash Accumulation (Bank 2)',
    short: 'Exhaust filter ash buildup (B2)',
    severity: 'warning',
  },
  P243B: {
    description: 'Particulate Filter Restriction - Forced Limited Power (Bank 2)',
    short: 'Clogged filter: power cut (B2)',
    severity: 'warning',
  },
  P243C: {
    description: 'Particulate Filter Regeneration Frequency (Bank 2)',
    short: 'Exhaust filter cleans often (B2)',
    severity: 'caution',
  },
  P243D: {
    description: 'Particulate Filter Regeneration Duration (Bank 2)',
    short: 'Exhaust filter clean slow (B2)',
    severity: 'caution',
  },
  P243E: {
    description: 'Particulate Filter Regeneration Incomplete (Bank 2)',
    short: 'Exhaust filter clean failed (B2)',
    severity: 'caution',
  },
  P243F: {
    description: 'Particulate Filter Restriction - Soot Accumulation Too High (Bank 2)',
    short: 'Exhaust filter clogged (B2)',
    severity: 'warning',
  },
  P2440: {
    description: 'Secondary Air Injection System Switching Valve Stuck Open (Bank 1)',
    short: 'Sec. air valve stuck open (B1)',
    severity: 'caution',
  },
  P2441: {
    description: 'Secondary Air Injection System Switching Valve Stuck Closed (Bank 1)',
    short: 'Sec. air valve stuck closed (B1)',
    severity: 'caution',
  },
  P2442: {
    description: 'Secondary Air Injection System Switching Valve Stuck Open (Bank 2)',
    short: 'Sec. air valve stuck open (B2)',
    severity: 'caution',
  },
  P2443: {
    description: 'Secondary Air Injection System Switching Valve Stuck Closed (Bank 2)',
    short: 'Sec. air valve stuck closed (B2)',
    severity: 'caution',
  },
  P2444: {
    description: 'Secondary Air Injection System Pump Stuck On (Bank 1)',
    short: 'Sec. air pump stuck on (B1)',
    severity: 'caution',
  },
  P2445: {
    description: 'Secondary Air Injection System Pump Stuck Off (Bank 1)',
    short: 'Sec. air pump stuck off (B1)',
    severity: 'caution',
  },
  P2446: {
    description: 'Secondary Air Injection System Pump Stuck On (Bank 2)',
    short: 'Sec. air pump stuck on (B2)',
    severity: 'caution',
  },
  P2447: {
    description: 'Secondary Air Injection System Pump Stuck Off (Bank 2)',
    short: 'Sec. air pump stuck off (B2)',
    severity: 'caution',
  },
  P2448: {
    description: 'Secondary Air Injection System High Air Flow (Bank 1)',
    short: 'Secondary air flow too high (B1)',
    severity: 'caution',
  },
  P2449: {
    description: 'Secondary Air Injection System High Air Flow (Bank 2)',
    short: 'Secondary air flow too high (B2)',
    severity: 'caution',
  },
  P244A: {
    description: 'Particulate Filter Differential Pressure Too Low (Bank 1)',
    short: 'Exhaust filter pressure low (B1)',
    severity: 'caution',
  },
  P244B: {
    description: 'Particulate Filter Differential Pressure Too High (Bank 1)',
    short: 'Exhaust filter restricted (B1)',
    severity: 'warning',
  },
  P244C: {
    description: 'Exhaust Temperature Too Low For Particulate Filter Regeneration (Bank 1)',
    short: 'Too cold to clean filter (B1)',
    severity: 'caution',
  },
  P244D: {
    description: 'Exhaust Temperature Too High For Particulate Filter Regeneration (Bank 1)',
    short: 'Too hot to clean filter (B1)',
    severity: 'caution',
  },
  P244E: {
    description: 'Exhaust Temperature Too Low For Particulate Filter Regeneration (Bank 2)',
    short: 'Too cold to clean filter (B2)',
    severity: 'caution',
  },
  P244F: {
    description: 'Exhaust Temperature Too High For Particulate Filter Regeneration (Bank 2)',
    short: 'Too hot to clean filter (B2)',
    severity: 'caution',
  },
  P2450: {
    description: 'Evaporative Emission System Switching Valve Performance/Stuck Open',
    short: 'EVAP switch valve stuck open',
    severity: 'caution',
  },
  P2451: {
    description: 'Evaporative Emission System Switching Valve Stuck Closed',
    short: 'EVAP switch valve stuck closed',
    severity: 'caution',
  },
  P2452: {
    description: 'Particulate Filter Pressure Sensor "A" Circuit',
    short: 'Exhaust filter sensor A circuit',
    severity: 'caution',
  },
  P2453: {
    description: 'Particulate Filter Pressure Sensor "A" Circuit Range/Performance',
    short: 'Exhaust filter sensor A fault',
    severity: 'caution',
  },
  P2454: {
    description: 'Particulate Filter Pressure Sensor "A" Circuit Low',
    short: 'Exhaust filter sensor A low',
    severity: 'caution',
  },
  P2455: {
    description: 'Particulate Filter Pressure Sensor "A" Circuit High',
    short: 'Exhaust filter sensor A high',
    severity: 'caution',
  },
  P2456: {
    description: 'Particulate Filter Pressure Sensor "A" Circuit Intermittent/Erratic',
    short: 'Exhaust filter sensor A erratic',
    severity: 'caution',
  },
  P2457: {
    description: 'Exhaust Gas Recirculation Cooler "A" Efficiency Below Threshold',
    short: 'EGR cooler A efficiency low',
    severity: 'caution',
  },
  P2458: {
    description: 'Particulate Filter Regeneration Duration (Bank 1)',
    short: 'Exhaust filter clean slow (B1)',
    severity: 'caution',
  },
  P2459: {
    description: 'Particulate Filter Regeneration Frequency (Bank 1)',
    short: 'Exhaust filter cleans often (B1)',
    severity: 'caution',
  },
  P245A: {
    description: 'Exhaust Gas Recirculation Cooler Bypass Control Circuit/Open (Bank 1)',
    short: 'EGR cooler bypass circuit (B1)',
    severity: 'caution',
  },
  P245B: {
    description:
      'Exhaust Gas Recirculation Cooler Bypass Control Circuit Range/Performance (Bank 1)',
    short: 'EGR cooler bypass fault (B1)',
    severity: 'caution',
  },
  P245C: {
    description: 'Exhaust Gas Recirculation Cooler Bypass Control Circuit Low (Bank 1)',
    short: 'EGR cooler bypass low (B1)',
    severity: 'caution',
  },
  P245D: {
    description: 'Exhaust Gas Recirculation Cooler Bypass Control Circuit High (Bank 1)',
    short: 'EGR cooler bypass high (B1)',
    severity: 'caution',
  },
  P245E: {
    description: 'Particulate Filter Pressure Sensor "B" Circuit',
    short: 'Exhaust filter sensor B circuit',
    severity: 'caution',
  },
  P245F: {
    description: 'Particulate Filter Pressure Sensor "B" Circuit Range/Performance',
    short: 'Exhaust filter sensor B fault',
    severity: 'caution',
  },
  P2460: {
    description: 'Particulate Filter Pressure Sensor "B" Circuit Low',
    short: 'Exhaust filter sensor B low',
    severity: 'caution',
  },
  P2461: {
    description: 'Particulate Filter Pressure Sensor "B" Circuit High',
    short: 'Exhaust filter sensor B high',
    severity: 'caution',
  },
  P2462: {
    description: 'Particulate Filter Pressure Sensor "B" Circuit Intermittent/Erratic',
    short: 'Exhaust filter sensor B erratic',
    severity: 'caution',
  },
  P2463: {
    description: 'Particulate Filter Restriction - Soot Accumulation (Bank 1)',
    short: 'Exhaust filter soot buildup (B1)',
    severity: 'warning',
  },
  P2464: {
    description: 'Particulate Filter Differential Pressure Too Low (Bank 2)',
    short: 'Exhaust filter pressure low (B2)',
    severity: 'caution',
  },
  P2465: {
    description: 'Particulate Filter Differential Pressure Too High (Bank 2)',
    short: 'Exhaust filter restricted (B2)',
    severity: 'warning',
  },
  P2466: {
    description: 'Exhaust Gas Temperature Sensor Circuit (Bank 2 Sensor 3)',
    short: 'Exhaust temp 3 circuit (B2)',
    severity: 'caution',
  },
  P2467: {
    description: 'Exhaust Gas Temperature Sensor Circuit Range/Performance (Bank 2 Sensor 3)',
    short: 'Exhaust temp sensor 3 fault (B2)',
    severity: 'caution',
  },
  P2468: {
    description: 'Exhaust Gas Temperature Sensor Circuit Low (Bank 2 Sensor 3)',
    short: 'Exhaust temp sensor 3 low (B2)',
    severity: 'caution',
  },
  P2469: {
    description: 'Exhaust Gas Temperature Sensor Circuit High (Bank 2 Sensor 3)',
    short: 'Exhaust temp sensor 3 high (B2)',
    severity: 'caution',
  },
  P246A: {
    description: 'Exhaust Gas Temperature Sensor Circuit Intermittent/Erratic (Bank 2 Sensor 3)',
    short: 'Exhaust temp 3 erratic (B2)',
    severity: 'caution',
  },
  P246B: {
    description: 'Vehicle Conditions Incorrect for Particulate Filter Regeneration',
    short: 'Filter cleaning not possible',
    severity: 'caution',
  },
  P246C: {
    description: 'Particulate Filter Restriction - Forced Limited Power (Bank 1)',
    short: 'Clogged filter: power cut (B1)',
    severity: 'warning',
  },
  P246D: {
    description: 'Particulate Filter Pressure Sensor "A"/"B" Correlation',
    short: 'Filter sensors A/B mismatch',
    severity: 'caution',
  },
  P246E: {
    description: 'Exhaust Gas Temperature Sensor Circuit (Bank 1 Sensor 4)',
    short: 'Exhaust temp 4 circuit (B1)',
    severity: 'caution',
  },
  P246F: {
    description: 'Exhaust Gas Temperature Sensor Circuit Range/Performance (Bank 1 Sensor 4)',
    short: 'Exhaust temp sensor 4 fault (B1)',
    severity: 'caution',
  },
  P2470: {
    description: 'Exhaust Gas Temperature Sensor Circuit Low (Bank 1 Sensor 4)',
    short: 'Exhaust temp sensor 4 low (B1)',
    severity: 'caution',
  },
  P2471: {
    description: 'Exhaust Gas Temperature Sensor Circuit High (Bank 1 Sensor 4)',
    short: 'Exhaust temp sensor 4 high (B1)',
    severity: 'caution',
  },
  P2472: {
    description: 'Exhaust Gas Temperature Sensor Circuit Intermittent/Erratic (Bank 1 Sensor 4)',
    short: 'Exhaust temp 4 erratic (B1)',
    severity: 'caution',
  },
  P2473: {
    description: 'Exhaust Gas Temperature Sensor Circuit (Bank 2 Sensor 4)',
    short: 'Exhaust temp 4 circuit (B2)',
    severity: 'caution',
  },
  P2474: {
    description: 'Exhaust Gas Temperature Sensor Circuit Range/Performance (Bank 2 Sensor 4)',
    short: 'Exhaust temp sensor 4 fault (B2)',
    severity: 'caution',
  },
  P2475: {
    description: 'Exhaust Gas Temperature Sensor Circuit Low (Bank 2 Sensor 4)',
    short: 'Exhaust temp sensor 4 low (B2)',
    severity: 'caution',
  },
  P2476: {
    description: 'Exhaust Gas Temperature Sensor Circuit High (Bank 2 Sensor 4)',
    short: 'Exhaust temp sensor 4 high (B2)',
    severity: 'caution',
  },
  P2477: {
    description: 'Exhaust Gas Temperature Sensor Circuit Intermittent/Erratic (Bank 2 Sensor 4)',
    short: 'Exhaust temp 4 erratic (B2)',
    severity: 'caution',
  },
  P2478: {
    description: 'Exhaust Gas Temperature Out of Range (Bank 1 Sensor 1)',
    short: 'Exhaust temp 1 abnormal (B1)',
    severity: 'caution',
  },
  P2479: {
    description: 'Exhaust Gas Temperature Out of Range (Bank 1 Sensor 2)',
    short: 'Exhaust temp 2 abnormal (B1)',
    severity: 'caution',
  },
  P247A: {
    description: 'Exhaust Gas Temperature Out of Range (Bank 1 Sensor 3)',
    short: 'Exhaust temp 3 abnormal (B1)',
    severity: 'caution',
  },
  P247B: {
    description: 'Exhaust Gas Temperature Out of Range (Bank 1 Sensor 4)',
    short: 'Exhaust temp 4 abnormal (B1)',
    severity: 'caution',
  },
  P247C: {
    description: 'Exhaust Gas Temperature Out of Range (Bank 2 Sensor 1)',
    short: 'Exhaust temp 1 abnormal (B2)',
    severity: 'caution',
  },
  P247D: {
    description: 'Exhaust Gas Temperature Out of Range (Bank 2 Sensor 2)',
    short: 'Exhaust temp 2 abnormal (B2)',
    severity: 'caution',
  },
  P247E: {
    description: 'Exhaust Gas Temperature Out of Range (Bank 2 Sensor 3)',
    short: 'Exhaust temp 3 abnormal (B2)',
    severity: 'caution',
  },
  P247F: {
    description: 'Exhaust Gas Temperature Out of Range (Bank 2 Sensor 4)',
    short: 'Exhaust temp 4 abnormal (B2)',
    severity: 'caution',
  },
  P2480: {
    description: 'Exhaust Gas Temperature Sensor Circuit/Open (Bank 1 Sensor 5)',
    short: 'Exhaust temp 5 circuit open (B1)',
    severity: 'caution',
  },
  P2481: {
    description: 'Exhaust Gas Temperature Sensor Circuit Low (Bank 1 Sensor 5)',
    short: 'Exhaust temp sensor 5 low (B1)',
    severity: 'caution',
  },
  P2482: {
    description: 'Exhaust Gas Temperature Sensor Circuit High (Bank 1 Sensor 5)',
    short: 'Exhaust temp sensor 5 high (B1)',
    severity: 'caution',
  },
  P2483: {
    description: 'Exhaust Gas Temperature Sensor Circuit Range/Performance (Bank 1 Sensor 5)',
    short: 'Exhaust temp sensor 5 fault (B1)',
    severity: 'caution',
  },
  P2484: {
    description: 'Exhaust Gas Temperature Sensor Circuit Intermittent/Erratic (Bank 1 Sensor 5)',
    short: 'Exhaust temp 5 erratic (B1)',
    severity: 'caution',
  },
  P2485: {
    description: 'Exhaust Gas Temperature Sensor Circuit/Open (Bank 2 Sensor 5)',
    short: 'Exhaust temp 5 circuit open (B2)',
    severity: 'caution',
  },
  P2486: {
    description: 'Exhaust Gas Temperature Sensor Circuit Low (Bank 2 Sensor 5)',
    short: 'Exhaust temp sensor 5 low (B2)',
    severity: 'caution',
  },
  P2487: {
    description: 'Exhaust Gas Temperature Sensor Circuit High (Bank 2 Sensor 5)',
    short: 'Exhaust temp sensor 5 high (B2)',
    severity: 'caution',
  },
  P2488: {
    description: 'Exhaust Gas Temperature Sensor Circuit Range/Performance (Bank 2 Sensor 5)',
    short: 'Exhaust temp sensor 5 fault (B2)',
    severity: 'caution',
  },
  P2489: {
    description: 'Exhaust Gas Temperature Sensor Circuit Intermittent/Erratic (Bank 2 Sensor 5)',
    short: 'Exhaust temp 5 erratic (B2)',
    severity: 'caution',
  },
  P248A: {
    description: 'Reductant Heater "A" Sense Circuit Low',
    short: 'DEF heater A sense low',
    severity: 'caution',
  },
  P248B: {
    description: 'Reductant Heater "A" Sense Circuit High',
    short: 'DEF heater A sense high',
    severity: 'caution',
  },
  P248C: {
    description: 'Reductant Heater "B" Sense Circuit Low',
    short: 'DEF heater B sense low',
    severity: 'caution',
  },
  P248D: {
    description: 'Reductant Heater "B" Sense Circuit High',
    short: 'DEF heater B sense high',
    severity: 'caution',
  },
  P248E: {
    description: 'Exhaust Gas Recirculation Cooler Bypass Control Circuit/Open (Bank 2)',
    short: 'EGR cooler bypass circuit (B2)',
    severity: 'caution',
  },
  P248F: {
    description:
      'Exhaust Gas Recirculation Cooler Bypass Control Circuit Range/Performance (Bank 2)',
    short: 'EGR cooler bypass fault (B2)',
    severity: 'caution',
  },
  P2490: {
    description: 'Exhaust Gas Recirculation Cooler Bypass Control Circuit Low (Bank 2)',
    short: 'EGR cooler bypass low (B2)',
    severity: 'caution',
  },
  P2491: {
    description: 'Exhaust Gas Recirculation Cooler Bypass Control Circuit High (Bank 2)',
    short: 'EGR cooler bypass high (B2)',
    severity: 'caution',
  },
  P2492: {
    description: 'Exhaust Gas Recirculation Cooler Bypass Position Sensor Circuit (Bank 1)',
    short: 'EGR bypass sensor circuit (B1)',
    severity: 'caution',
  },
  P2493: {
    description:
      'Exhaust Gas Recirculation Cooler Bypass Position Sensor Range/Performance (Bank 1)',
    short: 'EGR bypass sensor fault (B1)',
    severity: 'caution',
  },
  P2494: {
    description: 'Exhaust Gas Recirculation Cooler Bypass Position Sensor Circuit Low (Bank 1)',
    short: 'EGR bypass sensor low (B1)',
    severity: 'caution',
  },
  P2495: {
    description: 'Exhaust Gas Recirculation Cooler Bypass Position Sensor Circuit High (Bank 1)',
    short: 'EGR bypass sensor high (B1)',
    severity: 'caution',
  },
  P2496: {
    description:
      'Exhaust Gas Recirculation Cooler Bypass Position Sensor Circuit Intermittent/Erratic (Bank 1)',
    short: 'EGR bypass sensor erratic (B1)',
    severity: 'caution',
  },
  P2497: {
    description: 'Exhaust Gas Recirculation Cooler Bypass Position Sensor Circuit (Bank 2)',
    short: 'EGR bypass sensor circuit (B2)',
    severity: 'caution',
  },
  P2498: {
    description:
      'Exhaust Gas Recirculation Cooler Bypass Position Sensor Range/Performance (Bank 2)',
    short: 'EGR bypass sensor fault (B2)',
    severity: 'caution',
  },
  P2499: {
    description: 'Exhaust Gas Recirculation Cooler Bypass Position Sensor Circuit Low (Bank 2)',
    short: 'EGR bypass sensor low (B2)',
    severity: 'caution',
  },
  P249A: {
    description: 'Exhaust Gas Recirculation Cooler Bypass Position Sensor Circuit High (Bank 2)',
    short: 'EGR bypass sensor high (B2)',
    severity: 'caution',
  },
  P249B: {
    description:
      'Exhaust Gas Recirculation Cooler Bypass Position Sensor Circuit Intermittent/Erratic (Bank 2)',
    short: 'EGR bypass sensor erratic (B2)',
    severity: 'caution',
  },
  P249C: {
    description: 'Excessive Time To Enter Closed Loop Reductant Injection Control',
    short: 'DEF dosing slow to start',
    severity: 'caution',
  },
  P249D: {
    description: 'Closed Loop Reductant Injection Control At Limit - Flow Too Low',
    short: 'DEF dosing at limit (low)',
    severity: 'caution',
  },
  P249E: {
    description: 'Closed Loop Reductant Injection Control At Limit - Flow Too High',
    short: 'DEF dosing at limit (high)',
    severity: 'caution',
  },
  P249F: {
    description: 'Excessive Time To Enter Closed Loop Particulate Filter Regeneration Control',
    short: 'Filter cleaning slow to start',
    severity: 'caution',
  },
  P24A0: {
    description:
      'Closed Loop Particulate Filter Regeneration Control At Limit - Temperature Too Low',
    short: 'Filter clean temp too low',
    severity: 'caution',
  },
  P24A1: {
    description:
      'Closed Loop Particulate Filter Regeneration Control At Limit - Temperature Too High',
    short: 'Filter clean temp too high',
    severity: 'caution',
  },
  P24A2: {
    description: 'Particulate Filter Regeneration Incomplete (Bank 1)',
    short: 'Exhaust filter clean failed (B1)',
    severity: 'caution',
  },
  P24A3: {
    description: 'Particulate Filter Restriction - Soot Accumulation (Bank 2)',
    short: 'Exhaust filter soot buildup (B2)',
    severity: 'warning',
  },
  P24A4: {
    description: 'Particulate Filter Restriction - Soot Accumulation Too High (Bank 1)',
    short: 'Exhaust filter clogged (B1)',
    severity: 'warning',
  },
  P24A5: {
    description: 'Exhaust Gas Recirculation Cooler Bypass Control Stuck (Bank 1)',
    short: 'EGR cooler bypass stuck (B1)',
    severity: 'caution',
  },
  P24A6: {
    description: 'Exhaust Gas Recirculation Cooler Bypass Control Stuck (Bank 2)',
    short: 'EGR cooler bypass stuck (B2)',
    severity: 'caution',
  },
  P24A7: {
    description: 'Exhaust Gas Recirculation Cooler Coolant Pump Control Circuit/Open',
    short: 'EGR cooler pump circuit open',
    severity: 'caution',
  },
  P24A8: {
    description: 'Exhaust Gas Recirculation Cooler Coolant Pump Performance/Stuck Off',
    short: 'EGR cooler pump stuck off',
    severity: 'caution',
  },
  P24A9: {
    description: 'Exhaust Gas Recirculation Cooler Coolant Pump Control Circuit Low',
    short: 'EGR cooler pump low',
    severity: 'caution',
  },
  P24AA: {
    description: 'Exhaust Gas Recirculation Cooler Coolant Pump Control Circuit High',
    short: 'EGR cooler pump high',
    severity: 'caution',
  },
  P24AB: {
    description: 'Exhaust Gas Recirculation Cooler Coolant Pump Stuck On',
    short: 'EGR cooler pump stuck on',
    severity: 'caution',
  },
  P24AC: {
    description: 'Exhaust Gas Recirculation Cooler Coolant Pump Feedback Circuit Low',
    short: 'EGR cooler pump feedback low',
    severity: 'caution',
  },
  P24AD: {
    description: 'Exhaust Gas Recirculation Cooler Coolant Pump Feedback Circuit High',
    short: 'EGR cooler pump feedback high',
    severity: 'caution',
  },
  P24AE: {
    description: 'Particulate Matter Sensor Circuit',
    short: 'Soot sensor circuit',
    severity: 'caution',
  },
  P24AF: {
    description: 'Particulate Matter Sensor Circuit Range/Performance',
    short: 'Soot sensor out of range',
    severity: 'caution',
  },
  P24B0: {
    description: 'Particulate Matter Sensor Circuit Low',
    short: 'Soot sensor low',
    severity: 'caution',
  },
  P24B1: {
    description: 'Particulate Matter Sensor Circuit High',
    short: 'Soot sensor high',
    severity: 'caution',
  },
  P24B2: {
    description: 'Particulate Matter Sensor Circuit Intermittent',
    short: 'Soot sensor erratic',
    severity: 'caution',
  },
  P24B3: {
    description: 'Particulate Matter Sensor Heater Control Circuit/Open',
    short: 'Soot sensor heater circuit open',
    severity: 'caution',
  },
  P24B4: {
    description: 'Particulate Matter Sensor Heater Control Circuit Range/Performance',
    short: 'Soot sensor heater out of range',
    severity: 'caution',
  },
  P24B5: {
    description: 'Particulate Matter Sensor Heater Control Circuit Low',
    short: 'Soot sensor heater low',
    severity: 'caution',
  },
  P24B6: {
    description: 'Particulate Matter Sensor Heater Control Circuit High',
    short: 'Soot sensor heater high',
    severity: 'caution',
  },
  P24B7: {
    description: 'Particulate Matter Sensor Heater Resistance',
    short: 'Soot sensor heater resistance',
    severity: 'caution',
  },
  P24B8: {
    description: 'Evaporative Emission System Leak Detection Pump Pressure Sensor Circuit',
    short: 'EVAP pump sensor circuit',
    severity: 'caution',
  },
  P24B9: {
    description:
      'Evaporative Emission System Leak Detection Pump Pressure Sensor Circuit Range/Performance',
    short: 'EVAP pump sensor out of range',
    severity: 'caution',
  },
  P24BA: {
    description: 'Evaporative Emission System Leak Detection Pump Pressure Sensor Circuit Low',
    short: 'EVAP pump sensor low',
    severity: 'caution',
  },
  P24BB: {
    description: 'Evaporative Emission System Leak Detection Pump Pressure Sensor Circuit High',
    short: 'EVAP pump sensor high',
    severity: 'caution',
  },
  P24BC: {
    description:
      'Evaporative Emission System Leak Detection Pump Pressure Sensor Circuit Intermittent',
    short: 'EVAP pump sensor erratic',
    severity: 'caution',
  },
  P24BD: {
    description:
      'Evaporative Emission System Leak Detection Pump Vacuum Switching Valve Control Circuit/Open',
    short: 'EVAP pump switch valve circuit',
    severity: 'caution',
  },
  P24BE: {
    description:
      'Evaporative Emission System Leak Detection Pump Vacuum Switching Valve Control Circuit Low',
    short: 'EVAP pump switch valve low',
    severity: 'caution',
  },
  P24BF: {
    description:
      'Evaporative Emission System Leak Detection Pump Vacuum Switching Valve Control Circuit High',
    short: 'EVAP pump switch valve high',
    severity: 'caution',
  },
  P24C0: {
    description: 'Evaporative Emission System Leak Detection Pump Vacuum Switching Valve Stuck On',
    short: 'EVAP pump switch valve stuck on',
    severity: 'caution',
  },
  P24C1: {
    description:
      'Evaporative Emission System Leak Detection Pump Vacuum Switching Valve Performance/Stuck Off',
    short: 'EVAP pump switch valve stuck off',
    severity: 'caution',
  },
  P24C2: {
    description:
      'Exhaust Gas Temperature Measurement System - Multiple Sensor Correlation (Bank 1)',
    short: 'Exhaust temps disagree (B1)',
    severity: 'caution',
  },
  P24C3: {
    description:
      'Exhaust Gas Temperature Measurement System - Multiple Sensor Correlation (Bank 2)',
    short: 'Exhaust temps disagree (B2)',
    severity: 'caution',
  },
  P24C4: {
    description:
      'Exhaust Gas Recirculation Cooler Bypass Position Sensor Exceeded Learning Limit (Bank 1)',
    short: 'EGR bypass learn limit (B1)',
    severity: 'caution',
  },
  P24C5: {
    description:
      'Exhaust Gas Recirculation Cooler Bypass Position Sensor Exceeded Learning Limit (Bank 2)',
    short: 'EGR bypass learn limit (B2)',
    severity: 'caution',
  },
  P24C6: {
    description: 'Particulate Matter Sensor Temperature Circuit',
    short: 'Soot sensor temp circuit',
    severity: 'caution',
  },
  P24C7: {
    description: 'Particulate Matter Sensor Temperature Circuit Range/Performance',
    short: 'Soot sensor temp out of range',
    severity: 'caution',
  },
  P24C8: {
    description: 'Particulate Matter Sensor Temperature Circuit Low',
    short: 'Soot sensor temp low',
    severity: 'caution',
  },
  P24C9: {
    description: 'Particulate Matter Sensor Temperature Circuit High',
    short: 'Soot sensor temp high',
    severity: 'caution',
  },
  P24CA: {
    description: 'Particulate Matter Sensor Temperature Circuit Intermittent',
    short: 'Soot sensor temp erratic',
    severity: 'caution',
  },
  P24CB: {
    description: 'Reductant Tank Cap Switch Circuit',
    short: 'DEF cap switch circuit',
    severity: 'caution',
  },
  P24CC: {
    description: 'Reductant Tank Cap Switch Circuit Range/Performance',
    short: 'DEF cap switch out of range',
    severity: 'caution',
  },
  P24CD: {
    description: 'Reductant Tank Cap Switch Circuit Low',
    short: 'DEF cap switch low',
    severity: 'caution',
  },
  P24CE: {
    description: 'Reductant Tank Cap Switch Circuit High',
    short: 'DEF cap switch high',
    severity: 'caution',
  },
  P24CF: {
    description: 'Reductant Tank Cap Switch Circuit Intermittent/Erratic',
    short: 'DEF cap switch erratic',
    severity: 'caution',
  },
  P24D0: {
    description: 'Particulate Matter Sensor Supply Voltage Circuit Low',
    short: 'Soot sensor supply low',
    severity: 'caution',
  },
  P24D1: {
    description: 'Particulate Matter Sensor Regeneration Incomplete',
    short: 'Soot sensor clean incomplete',
    severity: 'caution',
  },
  P24D2: {
    description: 'Reductant Heater "A" Sense Circuit',
    short: 'DEF heater A sense circuit',
    severity: 'caution',
  },
  P24D3: {
    description: 'Reductant Heater "B" Sense Circuit',
    short: 'DEF heater B sense circuit',
    severity: 'caution',
  },
  P24D4: {
    description: 'Exhaust Gas Recirculation Cooler Coolant Pump Feedback Circuit',
    short: 'EGR cooler pump feedback circuit',
    severity: 'caution',
  },
  P24D5: {
    description: 'Evaporative Emission System Pressure Sensor/Switch "B" Circuit',
    short: 'EVAP pressure sensor B circuit',
    severity: 'caution',
  },
  P24D6: {
    description: 'Evaporative Emission System Pressure Sensor/Switch "B" Circuit Range/Performance',
    short: 'EVAP pressure sensor B fault',
    severity: 'caution',
  },
  P24D7: {
    description: 'Evaporative Emission System Pressure Sensor/Switch "B" Circuit Low',
    short: 'EVAP pressure sensor B low',
    severity: 'caution',
  },
  P24D8: {
    description: 'Evaporative Emission System Pressure Sensor/Switch "B" Circuit High',
    short: 'EVAP pressure sensor B high',
    severity: 'caution',
  },
  P24D9: {
    description: 'Evaporative Emission System Pressure Sensor/Switch "B" Circuit Intermittent',
    short: 'EVAP pressure sensor B erratic',
    severity: 'caution',
  },
  P24DA: {
    description: 'Particulate Matter Sensor Exhaust Sample Error (Bank 1)',
    short: 'Soot sensor sample error (B1)',
    severity: 'caution',
  },
  P24DB: {
    description: 'Reductant Purge Control Valve "B" Circuit/Open',
    short: 'DEF purge valve B circuit open',
    severity: 'caution',
  },
  P24DC: {
    description: 'Reductant Purge Control Valve "B" Performance',
    short: 'DEF purge valve B fault',
    severity: 'caution',
  },
  P24DD: {
    description: 'Reductant Purge Control Valve "B" Circuit Low',
    short: 'DEF purge valve B low',
    severity: 'caution',
  },
  P24DE: {
    description: 'Reductant Purge Control Valve "B" Circuit High',
    short: 'DEF purge valve B high',
    severity: 'caution',
  },
  P24DF: {
    description: 'Reductant Purge Control Valve "B" Stuck Open',
    short: 'DEF purge valve B stuck open',
    severity: 'caution',
  },
  P24E0: {
    description: 'Reductant Purge Control Valve "B" Stuck Closed',
    short: 'DEF purge valve B stuck closed',
    severity: 'caution',
  },
  P24E1: {
    description: 'NH3 Sensor Circuit',
    short: 'Ammonia sensor circuit',
    severity: 'caution',
  },
  P24E2: {
    description: 'NH3 Sensor Circuit Range/Performance',
    short: 'Ammonia sensor out of range',
    severity: 'caution',
  },
  P24E3: {
    description: 'NH3 Sensor Circuit Low',
    short: 'Ammonia sensor low',
    severity: 'caution',
  },
  P24E4: {
    description: 'NH3 Sensor Circuit High',
    short: 'Ammonia sensor high',
    severity: 'caution',
  },
  P24E5: {
    description: 'NH3 Sensor Circuit Intermittent/Erratic',
    short: 'Ammonia sensor erratic',
    severity: 'caution',
  },
  P24E6: {
    description: 'NH3 Sensor Heater Circuit/Open',
    short: 'Ammonia sensor heater circuit',
    severity: 'caution',
  },
  P24E7: {
    description: 'NH3 Sensor Heater Circuit Low',
    short: 'Ammonia sensor heater low',
    severity: 'caution',
  },
  P24E8: {
    description: 'NH3 Sensor Heater Circuit High',
    short: 'Ammonia sensor heater high',
    severity: 'caution',
  },
  P24E9: {
    description: 'NH3 Sensor Heater Circuit Performance',
    short: 'Ammonia sensor heater fault',
    severity: 'caution',
  },
  P24EA: {
    description: 'NH3 Sensor Supply Voltage Circuit',
    short: 'Ammonia sensor supply circuit',
    severity: 'caution',
  },
  P24EB: {
    description: 'NH3 Sensor Supply Voltage Circuit Low',
    short: 'Ammonia sensor supply low',
    severity: 'caution',
  },
  P24EC: {
    description: 'NH3 Sensor Supply Voltage Circuit High',
    short: 'Ammonia sensor supply high',
    severity: 'caution',
  },
  P24ED: {
    description: 'NH3 Sensor Calibration Memory',
    short: 'Ammonia sensor memory fault',
    severity: 'caution',
  },
  P24EE: {
    description: 'NH3 Sensor Processor Performance',
    short: 'Ammonia sensor processor fault',
    severity: 'caution',
  },
  P24EF: {
    description: 'Control Module Wake-up Circuit/Open',
    short: 'Module wake-up circuit open',
    severity: 'caution',
  },
  P24F0: {
    description: 'Control Module Wake-up Circuit Low',
    short: 'Module wake-up circuit low',
    severity: 'caution',
  },
  P24F1: {
    description: 'Control Module Wake-up Circuit High',
    short: 'Module wake-up circuit high',
    severity: 'caution',
  },
  P24F2: {
    description: 'Exhaust Gas Recirculation Temperature/Charge Air Cooler Temperature Correlation',
    short: 'EGR/intercooler temp mismatch',
    severity: 'caution',
  },
  P24F3: {
    description: 'Reductant Tank Temperature/Fuel Temperature Correlation',
    short: 'DEF/fuel temperature mismatch',
    severity: 'caution',
  },
  P24FD: {
    description: 'Particulate Filter Incorrect',
    short: 'Wrong exhaust filter fitted',
    severity: 'caution',
  },
  P24FE: {
    description: 'SCR Catalyst Incorrect',
    short: 'Wrong NOx catalyst fitted',
    severity: 'caution',
  },
  P24FF: {
    description: 'Reductant Temperature Too High',
    short: 'DEF temperature too high',
    severity: 'caution',
  },

  // P25xx — auxiliary inputs: charging, oil level/quality, ignition switch, PTO, turbo sensors
  P2500: {
    description: 'Generator Lamp/L-Terminal Circuit Low',
    short: 'Alternator lamp circuit low',
    severity: 'warning',
  },
  P2501: {
    description: 'Generator Lamp/L-Terminal Circuit High',
    short: 'Alternator lamp circuit high',
    severity: 'warning',
  },
  P2502: {
    description: 'Charging System Voltage',
    short: 'Charging system fault',
    severity: 'warning',
  },
  P2503: {
    description: 'Charging System Voltage Low',
    short: 'Charging voltage low',
    severity: 'warning',
  },
  P2504: {
    description: 'Charging System Voltage High',
    short: 'Charging voltage high',
    severity: 'warning',
  },
  P2505: {
    description: 'ECM/PCM Power Input Signal',
    short: 'Engine computer power input',
    severity: 'warning',
  },
  P2506: {
    description: 'ECM/PCM Power Input Signal Range/Performance',
    short: 'Engine computer power fault',
    severity: 'warning',
  },
  P2507: {
    description: 'ECM/PCM Power Input Signal Low',
    short: 'Engine computer power low',
    severity: 'warning',
  },
  P2508: {
    description: 'ECM/PCM Power Input Signal High',
    short: 'Engine computer power high',
    severity: 'warning',
  },
  P2509: {
    description: 'ECM/PCM Power Input Signal Intermittent',
    short: 'Engine computer power erratic',
    severity: 'warning',
  },
  P250A: {
    description: 'Engine Oil Level Sensor Circuit',
    short: 'Oil level sensor circuit',
    severity: 'caution',
  },
  P250B: {
    description: 'Engine Oil Level Sensor Circuit Range/Performance',
    short: 'Oil level sensor out of range',
    severity: 'caution',
  },
  P250C: {
    description: 'Engine Oil Level Sensor Circuit Low',
    short: 'Oil level sensor low',
    severity: 'caution',
  },
  P250D: {
    description: 'Engine Oil Level Sensor Circuit High',
    short: 'Oil level sensor high',
    severity: 'caution',
  },
  P250E: {
    description: 'Engine Oil Level Sensor Circuit Intermittent/Erratic',
    short: 'Oil level sensor erratic',
    severity: 'caution',
  },
  P250F: {
    description: 'Engine Oil Level Too Low',
    short: 'Engine oil level too low',
    severity: 'critical',
  },
  P2510: {
    description: 'ECM/PCM Power Relay Sense Circuit Range/Performance',
    short: 'Computer relay sense fault',
    severity: 'warning',
  },
  P2511: {
    description: 'ECM/PCM Power Relay Sense Circuit Intermittent',
    short: 'Computer relay sense erratic',
    severity: 'warning',
  },
  P2512: {
    description: 'Event Data Recorder Request Circuit/Open',
    short: 'Crash recorder signal circuit',
    severity: 'info',
  },
  P2513: {
    description: 'Event Data Recorder Request Circuit Low',
    short: 'Crash recorder signal low',
    severity: 'info',
  },
  P2514: {
    description: 'Event Data Recorder Request Circuit High',
    short: 'Crash recorder signal high',
    severity: 'info',
  },
  P2515: {
    description: 'A/C Refrigerant Pressure Sensor "B" Circuit',
    short: 'A/C pressure sensor B circuit',
    severity: 'info',
  },
  P2516: {
    description: 'A/C Refrigerant Pressure Sensor "B" Circuit Range/Performance',
    short: 'A/C pressure sensor B fault',
    severity: 'info',
  },
  P2517: {
    description: 'A/C Refrigerant Pressure Sensor "B" Circuit Low',
    short: 'A/C pressure sensor B low',
    severity: 'info',
  },
  P2518: {
    description: 'A/C Refrigerant Pressure Sensor "B" Circuit High',
    short: 'A/C pressure sensor B high',
    severity: 'info',
  },
  P2519: {
    description: 'A/C Request "A" Circuit',
    short: 'A/C request A circuit',
    severity: 'info',
  },
  P251A: {
    description: 'PTO Enable Switch Circuit/Open',
    short: 'PTO enable switch circuit open',
    severity: 'info',
  },
  P251B: {
    description: 'PTO Enable Switch Circuit Low',
    short: 'PTO enable switch low',
    severity: 'info',
  },
  P251C: {
    description: 'PTO Enable Switch Circuit High',
    short: 'PTO enable switch high',
    severity: 'info',
  },
  P251D: {
    description: 'PTO Engine Shutdown Circuit/Open',
    short: 'PTO engine shutdown circuit open',
    severity: 'info',
  },
  P251E: {
    description: 'PTO Engine Shutdown Circuit Low',
    short: 'PTO engine shutdown low',
    severity: 'info',
  },
  P251F: {
    description: 'PTO Engine Shutdown Circuit High',
    short: 'PTO engine shutdown high',
    severity: 'info',
  },
  P2520: {
    description: 'A/C Request "A" Circuit Low',
    short: 'A/C request A low',
    severity: 'info',
  },
  P2521: {
    description: 'A/C Request "A" Circuit High',
    short: 'A/C request A high',
    severity: 'info',
  },
  P2522: {
    description: 'A/C Request "B" Circuit',
    short: 'A/C request B circuit',
    severity: 'info',
  },
  P2523: {
    description: 'A/C Request "B" Circuit Low',
    short: 'A/C request B low',
    severity: 'info',
  },
  P2524: {
    description: 'A/C Request "B" Circuit High',
    short: 'A/C request B high',
    severity: 'info',
  },
  P2525: {
    description: 'Vacuum Reservoir Pressure Sensor Circuit',
    short: 'Brake vacuum sensor circuit',
    severity: 'warning',
  },
  P2526: {
    description: 'Vacuum Reservoir Pressure Sensor Circuit Range/Performance',
    short: 'Brake vacuum sensor out of range',
    severity: 'warning',
  },
  P2527: {
    description: 'Vacuum Reservoir Pressure Sensor Circuit Low',
    short: 'Brake vacuum sensor low',
    severity: 'warning',
  },
  P2528: {
    description: 'Vacuum Reservoir Pressure Sensor Circuit High',
    short: 'Brake vacuum sensor high',
    severity: 'warning',
  },
  P2529: {
    description: 'Vacuum Reservoir Pressure Sensor Circuit Intermittent',
    short: 'Brake vacuum sensor erratic',
    severity: 'warning',
  },
  P252A: {
    description: 'Engine Oil Quality Sensor Circuit',
    short: 'Oil quality sensor circuit',
    severity: 'caution',
  },
  P252B: {
    description: 'Engine Oil Quality Sensor Circuit Range/Performance',
    short: 'Oil quality sensor out of range',
    severity: 'caution',
  },
  P252C: {
    description: 'Engine Oil Quality Sensor Circuit Low',
    short: 'Oil quality sensor low',
    severity: 'caution',
  },
  P252D: {
    description: 'Engine Oil Quality Sensor Circuit High',
    short: 'Oil quality sensor high',
    severity: 'caution',
  },
  P252E: {
    description: 'Engine Oil Quality Sensor Circuit Intermittent/Erratic',
    short: 'Oil quality sensor erratic',
    severity: 'caution',
  },
  P252F: {
    description: 'Engine Oil Level Too High',
    short: 'Engine oil level too high',
    severity: 'warning',
  },
  P2530: {
    description: 'Ignition Switch Run Position Circuit',
    short: 'Ignition switch run circuit',
    severity: 'warning',
  },
  P2531: {
    description: 'Ignition Switch Run Position Circuit Low',
    short: 'Ignition switch run low',
    severity: 'warning',
  },
  P2532: {
    description: 'Ignition Switch Run Position Circuit High',
    short: 'Ignition switch run high',
    severity: 'warning',
  },
  P2533: {
    description: 'Ignition Switch Run/Start Position Circuit',
    short: 'Ign. switch run/start circuit',
    severity: 'warning',
  },
  P2534: {
    description: 'Ignition Switch Run/Start Position Circuit Low',
    short: 'Ignition switch run/start low',
    severity: 'warning',
  },
  P2535: {
    description: 'Ignition Switch Run/Start Position Circuit High',
    short: 'Ignition switch run/start high',
    severity: 'warning',
  },
  P2536: {
    description: 'Ignition Switch Accessory Position Circuit',
    short: 'Ign. switch accessory circuit',
    severity: 'caution',
  },
  P2537: {
    description: 'Ignition Switch Accessory Position Circuit Low',
    short: 'Ignition switch accessory low',
    severity: 'caution',
  },
  P2538: {
    description: 'Ignition Switch Accessory Position Circuit High',
    short: 'Ignition switch accessory high',
    severity: 'caution',
  },
  P2539: {
    description: 'Low Pressure Fuel System Sensor Circuit',
    short: 'Fuel feed sensor circuit',
    severity: 'warning',
  },
  P253A: {
    description: 'PTO Sense Circuit/Open',
    short: 'PTO sense circuit open',
    severity: 'info',
  },
  P253B: {
    description: 'PTO Sense Circuit Range/Performance',
    short: 'PTO sense out of range',
    severity: 'info',
  },
  P253C: {
    description: 'PTO Sense Circuit Low',
    short: 'PTO sense low',
    severity: 'info',
  },
  P253D: {
    description: 'PTO Sense Circuit High',
    short: 'PTO sense high',
    severity: 'info',
  },
  P253E: {
    description: 'PTO Sense Circuit Intermittent/Erratic',
    short: 'PTO sense erratic',
    severity: 'info',
  },
  P253F: {
    description: 'Engine Oil Deteriorated',
    short: 'Engine oil worn out',
    severity: 'caution',
  },
  P2540: {
    description: 'Low Pressure Fuel System Sensor Circuit Range/Performance',
    short: 'Fuel feed sensor out of range',
    severity: 'warning',
  },
  P2541: {
    description: 'Low Pressure Fuel System Sensor Circuit Low',
    short: 'Fuel feed sensor low',
    severity: 'warning',
  },
  P2542: {
    description: 'Low Pressure Fuel System Sensor Circuit High',
    short: 'Fuel feed sensor high',
    severity: 'warning',
  },
  P2543: {
    description: 'Low Pressure Fuel System Sensor Circuit Intermittent',
    short: 'Fuel feed sensor erratic',
    severity: 'warning',
  },
  P2544: {
    description: 'Torque Management Request Input Signal "A"',
    short: 'Torque request signal A circuit',
    severity: 'warning',
  },
  P2545: {
    description: 'Torque Management Request Input Signal "A" Range/Performance',
    short: 'Torque request signal A fault',
    severity: 'warning',
  },
  P2546: {
    description: 'Torque Management Request Input Signal "A" Low',
    short: 'Torque request signal A low',
    severity: 'warning',
  },
  P2547: {
    description: 'Torque Management Request Input Signal "A" High',
    short: 'Torque request signal A high',
    severity: 'warning',
  },
  P2548: {
    description: 'Torque Management Request Input Signal "B"',
    short: 'Torque request signal B circuit',
    severity: 'warning',
  },
  P2549: {
    description: 'Torque Management Request Input Signal "B" Range/Performance',
    short: 'Torque request signal B fault',
    severity: 'warning',
  },
  P254A: {
    description: 'PTO Speed Selector Sensor/Switch 1 Circuit/Open',
    short: 'PTO speed selector 1 circuit',
    severity: 'info',
  },
  P254B: {
    description: 'PTO Speed Selector Sensor/Switch 1 Range/Performance',
    short: 'PTO speed selector 1 fault',
    severity: 'info',
  },
  P254C: {
    description: 'PTO Speed Selector Sensor/Switch 1 Circuit Low',
    short: 'PTO speed selector 1 low',
    severity: 'info',
  },
  P254D: {
    description: 'PTO Speed Selector Sensor/Switch 1 Circuit High',
    short: 'PTO speed selector 1 high',
    severity: 'info',
  },
  P254E: {
    description: 'PTO Speed Selector Sensor/Switch 1 Circuit Intermittent/Erratic',
    short: 'PTO speed selector 1 erratic',
    severity: 'info',
  },
  P254F: {
    description: 'Engine Hood Switch Circuit',
    short: 'Hood switch circuit',
    severity: 'info',
  },
  P2550: {
    description: 'Torque Management Request Input Signal "B" Low',
    short: 'Torque request signal B low',
    severity: 'warning',
  },
  P2551: {
    description: 'Torque Management Request Input Signal "B" High',
    short: 'Torque request signal B high',
    severity: 'warning',
  },
  P2552: {
    description: 'Throttle/Fuel Inhibit "A" Circuit',
    short: 'Throttle/fuel inhibit A circuit',
    severity: 'warning',
  },
  P2553: {
    description: 'Throttle/Fuel Inhibit "A" Circuit Range/Performance',
    short: 'Throttle/fuel inhibit A fault',
    severity: 'warning',
  },
  P2554: {
    description: 'Throttle/Fuel Inhibit "A" Circuit Low',
    short: 'Throttle/fuel inhibit A low',
    severity: 'warning',
  },
  P2555: {
    description: 'Throttle/Fuel Inhibit "A" Circuit High',
    short: 'Throttle/fuel inhibit A high',
    severity: 'warning',
  },
  P2556: {
    description: 'Engine Coolant Level Sensor/Switch Circuit',
    short: 'Coolant level sensor circuit',
    severity: 'caution',
  },
  P2557: {
    description: 'Engine Coolant Level Sensor/Switch Circuit Range/Performance',
    short: 'Coolant level sensor fault',
    severity: 'caution',
  },
  P2558: {
    description: 'Engine Coolant Level Sensor/Switch Circuit Low',
    short: 'Coolant level sensor low',
    severity: 'caution',
  },
  P2559: {
    description: 'Engine Coolant Level Sensor/Switch Circuit High',
    short: 'Coolant level sensor high',
    severity: 'caution',
  },
  P255A: {
    description: 'PTO Speed Selector Sensor/Switch 2 Circuit/Open',
    short: 'PTO speed selector 2 circuit',
    severity: 'info',
  },
  P255B: {
    description: 'PTO Speed Selector Sensor/Switch 2 Range/Performance',
    short: 'PTO speed selector 2 fault',
    severity: 'info',
  },
  P255C: {
    description: 'PTO Speed Selector Sensor/Switch 2 Circuit Low',
    short: 'PTO speed selector 2 low',
    severity: 'info',
  },
  P255D: {
    description: 'PTO Speed Selector Sensor/Switch 2 Circuit High',
    short: 'PTO speed selector 2 high',
    severity: 'info',
  },
  P255E: {
    description: 'PTO Speed Selector Sensor/Switch 2 Circuit Intermittent/Erratic',
    short: 'PTO speed selector 2 erratic',
    severity: 'info',
  },
  P255F: {
    description: 'A/C Request "A" Circuit Range/Performance',
    short: 'A/C request A out of range',
    severity: 'info',
  },
  P2560: {
    description: 'Engine Coolant Level Low',
    short: 'Coolant level low',
    severity: 'warning',
  },
  P2561: {
    description: 'A/C Control Module Requested MIL Illumination',
    short: 'A/C module fault reported',
    severity: 'caution',
  },
  P2562: {
    description: 'Turbocharger Boost Control Position Sensor "A" Circuit',
    short: 'Turbo position sensor A circuit',
    severity: 'warning',
  },
  P2563: {
    description: 'Turbocharger Boost Control Position Sensor "A" Circuit Range/Performance',
    short: 'Turbo position sensor A fault',
    severity: 'warning',
  },
  P2564: {
    description: 'Turbocharger Boost Control Position Sensor "A" Circuit Low',
    short: 'Turbo position sensor A low',
    severity: 'warning',
  },
  P2565: {
    description: 'Turbocharger Boost Control Position Sensor "A" Circuit High',
    short: 'Turbo position sensor A high',
    severity: 'warning',
  },
  P2566: {
    description: 'Turbocharger Boost Control Position Sensor "A" Circuit Intermittent',
    short: 'Turbo position sensor A erratic',
    severity: 'warning',
  },
  P2567: {
    description: 'Direct Ozone Reduction Catalyst Temperature Sensor Circuit',
    short: 'Ozone cat temp sensor circuit',
    severity: 'caution',
  },
  P2568: {
    description: 'Direct Ozone Reduction Catalyst Temperature Sensor Circuit Range/Performance',
    short: 'Ozone cat temp sensor fault',
    severity: 'caution',
  },
  P2569: {
    description: 'Direct Ozone Reduction Catalyst Temperature Sensor Circuit Low',
    short: 'Ozone cat temp sensor low',
    severity: 'caution',
  },
  P256A: {
    description: 'Engine Idle Speed Selector Sensor/Switch Circuit/Open',
    short: 'Idle speed selector circuit open',
    severity: 'info',
  },
  P256B: {
    description: 'Engine Idle Speed Selector Sensor/Switch Range/Performance',
    short: 'Idle speed selector out of range',
    severity: 'info',
  },
  P256C: {
    description: 'Engine Idle Speed Selector Sensor/Switch Circuit Low',
    short: 'Idle speed selector low',
    severity: 'info',
  },
  P256D: {
    description: 'Engine Idle Speed Selector Sensor/Switch Circuit High',
    short: 'Idle speed selector high',
    severity: 'info',
  },
  P256E: {
    description: 'Engine Idle Speed Selector Sensor/Switch Circuit Intermittent/Erratic',
    short: 'Idle speed selector erratic',
    severity: 'info',
  },
  P256F: {
    description: 'A/C Request "B" Circuit Range/Performance',
    short: 'A/C request B out of range',
    severity: 'info',
  },
  P2570: {
    description: 'Direct Ozone Reduction Catalyst Temperature Sensor Circuit High',
    short: 'Ozone cat temp sensor high',
    severity: 'caution',
  },
  P2571: {
    description: 'Direct Ozone Reduction Catalyst Temperature Sensor Circuit Intermittent/Erratic',
    short: 'Ozone cat temp sensor erratic',
    severity: 'caution',
  },
  P2572: {
    description: 'Direct Ozone Reduction Catalyst Deterioration Sensor Circuit',
    short: 'Ozone catalyst sensor circuit',
    severity: 'caution',
  },
  P2573: {
    description: 'Direct Ozone Reduction Catalyst Deterioration Sensor Circuit Range/Performance',
    short: 'Ozone catalyst sensor fault',
    severity: 'caution',
  },
  P2574: {
    description: 'Direct Ozone Reduction Catalyst Deterioration Sensor Circuit Low',
    short: 'Ozone catalyst sensor low',
    severity: 'caution',
  },
  P2575: {
    description: 'Direct Ozone Reduction Catalyst Deterioration Sensor Circuit High',
    short: 'Ozone catalyst sensor high',
    severity: 'caution',
  },
  P2576: {
    description:
      'Direct Ozone Reduction Catalyst Deterioration Sensor Circuit Intermittent/Erratic',
    short: 'Ozone catalyst sensor erratic',
    severity: 'caution',
  },
  P2577: {
    description: 'Direct Ozone Reduction Catalyst Efficiency Below Threshold',
    short: 'Ozone catalyst efficiency low',
    severity: 'caution',
  },
  P2578: {
    description: 'Turbocharger/Supercharger Speed Sensor "A" Circuit',
    short: 'Turbo speed sensor A circuit',
    severity: 'warning',
  },
  P2579: {
    description: 'Turbocharger/Supercharger Speed Sensor "A" Circuit Range/Performance',
    short: 'Turbo speed sensor A fault',
    severity: 'warning',
  },
  P257A: {
    description: 'Vacuum Reservoir Control Circuit/Open',
    short: 'Brake vac. control circuit open',
    severity: 'warning',
  },
  P257B: {
    description: 'Vacuum Reservoir Control Circuit Low',
    short: 'Brake vac. control circuit low',
    severity: 'warning',
  },
  P257C: {
    description: 'Vacuum Reservoir Control Circuit High',
    short: 'Brake vac. control circuit high',
    severity: 'warning',
  },
  P257D: {
    description: 'Engine Hood Switch Circuit Range/Performance',
    short: 'Hood switch out of range',
    severity: 'info',
  },
  P257E: {
    description: 'Engine Hood Switch Circuit Low',
    short: 'Hood switch low',
    severity: 'info',
  },
  P257F: {
    description: 'Engine Hood Switch Circuit High',
    short: 'Hood switch high',
    severity: 'info',
  },
  P2580: {
    description: 'Turbocharger/Supercharger Speed Sensor "A" Circuit Low',
    short: 'Turbo speed sensor A low',
    severity: 'warning',
  },
  P2581: {
    description: 'Turbocharger/Supercharger Speed Sensor "A" Circuit High',
    short: 'Turbo speed sensor A high',
    severity: 'warning',
  },
  P2582: {
    description: 'Turbocharger/Supercharger Speed Sensor "A" Circuit Intermittent',
    short: 'Turbo speed sensor A erratic',
    severity: 'warning',
  },
  P2583: {
    description: 'Cruise Control Front Distance Range Sensor Single Sensor or Center',
    short: 'Cruise radar fault (center)',
    severity: 'caution',
  },
  P2584: {
    description: 'Fuel Additive Control Module Requested MIL Illumination',
    short: 'Fuel additive fault reported',
    severity: 'caution',
  },
  P2585: {
    description: 'Fuel Additive Control Module Warning Lamp Request',
    short: 'Fuel additive warning',
    severity: 'caution',
  },
  P2586: {
    description: 'Turbocharger Boost Control Position Sensor "B" Circuit',
    short: 'Turbo position sensor B circuit',
    severity: 'warning',
  },
  P2587: {
    description: 'Turbocharger Boost Control Position Sensor "B" Circuit Range/Performance',
    short: 'Turbo position sensor B fault',
    severity: 'warning',
  },
  P2588: {
    description: 'Turbocharger Boost Control Position Sensor "B" Circuit Low',
    short: 'Turbo position sensor B low',
    severity: 'warning',
  },
  P2589: {
    description: 'Turbocharger Boost Control Position Sensor "B" Circuit High',
    short: 'Turbo position sensor B high',
    severity: 'warning',
  },
  P258A: {
    description: 'Vacuum Pump Control Circuit/Open',
    short: 'Brake vacuum pump circuit open',
    severity: 'warning',
  },
  P258B: {
    description: 'Vacuum Pump Control Range/Performance',
    short: 'Brake vacuum pump out of range',
    severity: 'warning',
  },
  P258C: {
    description: 'Vacuum Pump Control Circuit Low',
    short: 'Brake vacuum pump circuit low',
    severity: 'warning',
  },
  P258D: {
    description: 'Vacuum Pump Control Circuit High',
    short: 'Brake vacuum pump circuit high',
    severity: 'warning',
  },
  P258E: {
    description: 'PTO Enable Switch Performance',
    short: 'PTO enable switch fault',
    severity: 'info',
  },
  P258F: {
    description: 'Torque Management Request Output Signal',
    short: 'Torque request output fault',
    severity: 'warning',
  },
  P2590: {
    description: 'Turbocharger Boost Control Position Sensor "B" Circuit Intermittent/Erratic',
    short: 'Turbo position sensor B erratic',
    severity: 'warning',
  },
  P2591: {
    description: 'Cruise Control Front Distance Range Sensor Left',
    short: 'Cruise radar fault (left)',
    severity: 'caution',
  },
  P2592: {
    description: 'Cruise Control Front Distance Range Sensor Right',
    short: 'Cruise radar fault (right)',
    severity: 'caution',
  },
  P2593: {
    description: 'Turbocharger Speed Sensor "B" Circuit',
    short: 'Turbo speed sensor B circuit',
    severity: 'warning',
  },
  P2594: {
    description: 'Turbocharger Speed Sensor "B" Circuit Range/Performance',
    short: 'Turbo speed sensor B fault',
    severity: 'warning',
  },
  P2595: {
    description: 'Turbocharger Speed Sensor "B" Circuit Low',
    short: 'Turbo speed sensor B low',
    severity: 'warning',
  },
  P2596: {
    description: 'Turbocharger Speed Sensor "B" Circuit High',
    short: 'Turbo speed sensor B high',
    severity: 'warning',
  },
  P2597: {
    description: 'Turbocharger Speed Sensor "B" Circuit Intermittent',
    short: 'Turbo speed sensor B erratic',
    severity: 'warning',
  },
  P2598: {
    description: 'Turbocharger Boost Control Position Sensor "A" Performance - Stuck Low',
    short: 'Turbo sensor A stuck low',
    severity: 'warning',
  },
  P2599: {
    description: 'Turbocharger Boost Control Position Sensor "A" Performance - Stuck High',
    short: 'Turbo sensor A stuck high',
    severity: 'warning',
  },
  P259A: {
    description: 'Turbocharger Boost Control Position Sensor "B" Performance - Stuck Low',
    short: 'Turbo sensor B stuck low',
    severity: 'warning',
  },
  P259B: {
    description: 'Turbocharger Boost Control Position Sensor "B" Performance - Stuck High',
    short: 'Turbo sensor B stuck high',
    severity: 'warning',
  },
  P259C: {
    description: 'Excessive Time To Enter Closed Loop Turbocharger "A" Boost Control',
    short: 'Turbo control A slow to start',
    severity: 'warning',
  },
  P259D: {
    description: 'Excessive Time To Enter Closed Loop Turbocharger "B" Boost Control',
    short: 'Turbo control B slow to start',
    severity: 'warning',
  },
  P259E: {
    description: 'Turbocharger "A" Boost Control Position At Low Limit',
    short: 'Turbo control A at low limit',
    severity: 'warning',
  },
  P259F: {
    description: 'Turbocharger "A" Boost Control Position At High Limit',
    short: 'Turbo control A at high limit',
    severity: 'warning',
  },
  P25A0: {
    description: 'Turbocharger "B" Boost Control Position At Low Limit',
    short: 'Turbo control B at low limit',
    severity: 'warning',
  },
  P25A1: {
    description: 'Turbocharger "B" Boost Control Position At High Limit',
    short: 'Turbo control B at high limit',
    severity: 'warning',
  },
  P25A2: {
    description: 'Brake System Control Module Requested MIL Illumination',
    short: 'Brake module fault reported',
    severity: 'warning',
  },
  P25A3: {
    description: 'Engine Hood Open',
    short: 'Hood open',
    severity: 'info',
  },
  P25A4: {
    description: 'Fuel Mode Select Switch Circuit',
    short: 'Fuel mode switch circuit',
    severity: 'info',
  },
  P25A5: {
    description: 'Fuel Mode Select Switch Performance',
    short: 'Fuel mode switch fault',
    severity: 'info',
  },
  P25A6: {
    description: 'Fuel Mode Select Switch Circuit Low',
    short: 'Fuel mode switch low',
    severity: 'info',
  },
  P25A7: {
    description: 'Fuel Mode Select Switch Circuit High',
    short: 'Fuel mode switch high',
    severity: 'info',
  },
  P25A8: {
    description: 'Fuel Mode Select Switch Circuit Intermittent/Erratic',
    short: 'Fuel mode switch erratic',
    severity: 'info',
  },
  P25A9: {
    description: 'Piston Cooling Oil Control Circuit/Open',
    short: 'Piston cooling oil circuit open',
    severity: 'warning',
  },
  P25AA: {
    description: 'Piston Cooling Oil Control Circuit Low',
    short: 'Piston cooling control low',
    severity: 'warning',
  },
  P25AB: {
    description: 'Piston Cooling Oil Control Circuit High',
    short: 'Piston cooling control high',
    severity: 'warning',
  },
  P25AC: {
    description: 'Piston Cooling Oil Control Circuit Performance/Stuck Off',
    short: 'Piston cooling oil stuck off',
    severity: 'warning',
  },
  P25AD: {
    description: 'Piston Cooling Oil Control Circuit Stuck On',
    short: 'Piston cooling oil stuck on',
    severity: 'warning',
  },
  P25AE: {
    description: 'Piston Cooling Oil Pressure Too Low',
    short: 'Piston cooling oil pressure low',
    severity: 'warning',
  },
  P25AF: {
    description: 'Coolant Temperature Control Module Requested MIL Illumination',
    short: 'Coolant control fault reported',
    severity: 'caution',
  },
  P25B0: {
    description: 'Fuel Level Sensor "A" Stuck',
    short: 'Fuel level sensor A stuck',
    severity: 'caution',
  },
  P25B1: {
    description: 'Fuel Level Sensor "B" Stuck',
    short: 'Fuel level sensor B stuck',
    severity: 'caution',
  },
  P25B2: {
    description: 'Fuel Level Sensor "A" or "B" Stuck',
    short: 'Fuel level sensor A/B stuck',
    severity: 'caution',
  },
  P25B3: {
    description: 'Turbocharger/Supercharger Wastegate "A" Stuck Open',
    short: 'Turbo wastegate A stuck open',
    severity: 'warning',
  },
  P25B4: {
    description: 'Turbocharger/Supercharger Wastegate "A" Stuck Closed',
    short: 'Turbo wastegate A stuck closed',
    severity: 'warning',
  },
  P25B5: {
    description: 'Turbocharger/Supercharger Wastegate "B" Stuck Open',
    short: 'Turbo wastegate B stuck open',
    severity: 'warning',
  },
  P25B6: {
    description: 'Turbocharger/Supercharger Wastegate "B" Stuck Closed',
    short: 'Turbo wastegate B stuck closed',
    severity: 'warning',
  },
  P25B7: {
    description: 'Auxiliary Ignition Switch Run/Start Position Circuit',
    short: 'Aux ignition switch circuit',
    severity: 'caution',
  },
  P25B8: {
    description: 'Auxiliary Ignition Switch Run/Start Position Circuit Low',
    short: 'Aux ignition switch low',
    severity: 'caution',
  },
  P25B9: {
    description: 'Auxiliary Ignition Switch Run/Start Position Circuit High',
    short: 'Aux ignition switch high',
    severity: 'caution',
  },
  P25BA: {
    description: 'Regeneration Control Switch Circuit/Open',
    short: 'Filter clean switch circuit open',
    severity: 'caution',
  },
  P25BB: {
    description: 'Regeneration Control Switch Circuit Low',
    short: 'Filter clean switch low',
    severity: 'caution',
  },
  P25BC: {
    description: 'Regeneration Control Switch Circuit High',
    short: 'Filter clean switch high',
    severity: 'caution',
  },
  P25BD: {
    description: 'Unmetered Fuel - Forced Engine Shutdown',
    short: 'Unmetered fuel: engine shut off',
    severity: 'critical',
  },
  P25BE: {
    description: 'Alternative Fuel Disable Control Circuit/Open',
    short: 'Alt-fuel disable circuit open',
    severity: 'caution',
  },
  P25BF: {
    description: 'Alternative Fuel Disable Control Circuit High',
    short: 'Alt-fuel disable high',
    severity: 'caution',
  },
  P25C0: {
    description: 'Alternative Fuel Disable Control Circuit Low',
    short: 'Alt-fuel disable low',
    severity: 'caution',
  },
  P25C1: {
    description: 'Alternative Fuel Disable Signal Circuit',
    short: 'Alt-fuel disable signal circuit',
    severity: 'caution',
  },
  P25C2: {
    description: 'Alternative Fuel Disable Signal Circuit High',
    short: 'Alt-fuel disable signal high',
    severity: 'caution',
  },
  P25C3: {
    description: 'Alternative Fuel Disable Signal Circuit Low',
    short: 'Alt-fuel disable signal low',
    severity: 'caution',
  },
  P25C4: {
    description: 'Brake Booster Temperature Sensor Circuit',
    short: 'Booster temp sensor circuit',
    severity: 'warning',
  },
  P25C5: {
    description: 'Brake Booster Temperature Sensor Circuit Range/Performance',
    short: 'Booster temp sensor out of range',
    severity: 'warning',
  },
  P25C6: {
    description: 'Brake Booster Temperature Sensor Circuit Low',
    short: 'Booster temp sensor low',
    severity: 'warning',
  },
  P25C7: {
    description: 'Brake Booster Temperature Sensor Circuit High',
    short: 'Booster temp sensor high',
    severity: 'warning',
  },
  P25C8: {
    description: 'Brake Booster Temperature Sensor Circuit Intermittent/Erratic',
    short: 'Booster temp sensor erratic',
    severity: 'warning',
  },

  // P26xx — computer and auxiliary outputs: coolant pumps/valves, sensor supplies, rocker arms
  P2600: {
    description: 'Coolant Pump "A" Control Circuit/Open',
    short: 'Coolant pump A circuit open',
    severity: 'warning',
  },
  P2601: {
    description: 'Coolant Pump "A" Control Circuit Performance/Stuck Off',
    short: 'Coolant pump A stuck off',
    severity: 'warning',
  },
  P2602: {
    description: 'Coolant Pump "A" Control Circuit Low',
    short: 'Coolant pump A low',
    severity: 'warning',
  },
  P2603: {
    description: 'Coolant Pump "A" Control Circuit High',
    short: 'Coolant pump A high',
    severity: 'warning',
  },
  P2604: {
    description: 'Intake Air Heater "A" Circuit Range/Performance',
    short: 'Intake air heater A out of range',
    severity: 'caution',
  },
  P2605: {
    description: 'Intake Air Heater "B" Circuit/Open',
    short: 'Intake air heater B circuit open',
    severity: 'caution',
  },
  P2606: {
    description: 'Intake Air Heater "B" Circuit Range/Performance',
    short: 'Intake air heater B out of range',
    severity: 'caution',
  },
  P2607: {
    description: 'Intake Air Heater "B" Circuit Low',
    short: 'Intake air heater B low',
    severity: 'caution',
  },
  P2608: {
    description: 'Intake Air Heater "B" Circuit High',
    short: 'Intake air heater B high',
    severity: 'caution',
  },
  P2609: {
    description: 'Intake Air Heater System Performance',
    short: 'Intake air heater fault',
    severity: 'caution',
  },
  P260A: {
    description: 'PTO Control Circuit/Open',
    short: 'PTO control circuit open',
    severity: 'info',
  },
  P260B: {
    description: 'PTO Control Circuit Low',
    short: 'PTO control low',
    severity: 'info',
  },
  P260C: {
    description: 'PTO Control Circuit High',
    short: 'PTO control high',
    severity: 'info',
  },
  P260D: {
    description: 'PTO Engaged Lamp Control Circuit',
    short: 'PTO lamp circuit',
    severity: 'info',
  },
  P260E: {
    description: 'Particulate Filter Regeneration Lamp Control Circuit',
    short: 'Filter cleaning lamp circuit',
    severity: 'info',
  },
  P260F: {
    description: 'Evaporative Emission System Monitoring Processor Performance',
    short: 'EVAP monitor processor fault',
    severity: 'caution',
  },
  P2610: {
    description: 'ECM/PCM Engine Off Timer Performance',
    short: 'Engine-off timer fault',
    severity: 'caution',
  },
  P2611: {
    description: 'A/C Refrigerant Distribution Valve Control Circuit/Open',
    short: 'A/C distribution valve circuit',
    severity: 'info',
  },
  P2612: {
    description: 'A/C Refrigerant Distribution Valve Control Circuit Low',
    short: 'A/C distribution valve low',
    severity: 'info',
  },
  P2613: {
    description: 'A/C Refrigerant Distribution Valve Control Circuit High',
    short: 'A/C distribution valve high',
    severity: 'info',
  },
  P2614: {
    description: 'Camshaft Position Signal Output Circuit/Open',
    short: 'Cam signal output circuit open',
    severity: 'warning',
  },
  P2615: {
    description: 'Camshaft Position Signal Output Circuit Low',
    short: 'Cam signal output low',
    severity: 'warning',
  },
  P2616: {
    description: 'Camshaft Position Signal Output Circuit High',
    short: 'Cam signal output high',
    severity: 'warning',
  },
  P2617: {
    description: 'Crankshaft Position Signal Output Circuit/Open',
    short: 'Crank signal output circuit open',
    severity: 'warning',
  },
  P2618: {
    description: 'Crankshaft Position Signal Output Circuit Low',
    short: 'Crank signal output low',
    severity: 'warning',
  },
  P2619: {
    description: 'Crankshaft Position Signal Output Circuit High',
    short: 'Crank signal output high',
    severity: 'warning',
  },
  P261A: {
    description: 'Coolant Pump "B" Control Circuit/Open',
    short: 'Coolant pump B circuit open',
    severity: 'warning',
  },
  P261B: {
    description: 'Coolant Pump "B" Control Circuit Performance/Stuck Off',
    short: 'Coolant pump B stuck off',
    severity: 'warning',
  },
  P261C: {
    description: 'Coolant Pump "B" Control Circuit Low',
    short: 'Coolant pump B low',
    severity: 'warning',
  },
  P261D: {
    description: 'Coolant Pump "B" Control Circuit High',
    short: 'Coolant pump B high',
    severity: 'warning',
  },
  P261E: {
    description: 'Coolant Pump "B" Control Circuit Stuck On',
    short: 'Coolant pump B stuck on',
    severity: 'warning',
  },
  P261F: {
    description: 'Coolant Pump "A" Control Circuit Stuck On',
    short: 'Coolant pump A stuck on',
    severity: 'warning',
  },
  P2620: {
    description: 'Throttle Position Output Circuit/Open',
    short: 'Throttle signal output circuit',
    severity: 'warning',
  },
  P2621: {
    description: 'Throttle Position Output Circuit Low',
    short: 'Throttle signal output low',
    severity: 'warning',
  },
  P2622: {
    description: 'Throttle Position Output Circuit High',
    short: 'Throttle signal output high',
    severity: 'warning',
  },
  P2623: {
    description: 'Injector Control Pressure Regulator Circuit/Open',
    short: 'Injection pressure reg. circuit',
    severity: 'warning',
  },
  P2624: {
    description: 'Injector Control Pressure Regulator Circuit Low',
    short: 'Inj. pressure reg. circuit low',
    severity: 'warning',
  },
  P2625: {
    description: 'Injector Control Pressure Regulator Circuit High',
    short: 'Inj. pressure reg. circuit high',
    severity: 'warning',
  },
  P2626: {
    description: 'O2 Sensor Pumping Current Trim Circuit/Open (Bank 1 Sensor 1)',
    short: 'Upstream O2 trim circuit (B1)',
    severity: 'caution',
  },
  P2627: {
    description: 'O2 Sensor Pumping Current Trim Circuit Low (Bank 1 Sensor 1)',
    short: 'Upstream O2 trim low (B1)',
    severity: 'caution',
  },
  P2628: {
    description: 'O2 Sensor Pumping Current Trim Circuit High (Bank 1 Sensor 1)',
    short: 'Upstream O2 trim high (B1)',
    severity: 'caution',
  },
  P2629: {
    description: 'O2 Sensor Pumping Current Trim Circuit/Open (Bank 2 Sensor 1)',
    short: 'Upstream O2 trim circuit (B2)',
    severity: 'caution',
  },
  P262A: {
    description: 'Fuel Injector - Pilot Injection Not Learned',
    short: 'Pilot injection not learned',
    severity: 'caution',
  },
  P262B: {
    description: 'Control Module Power Off Timer Performance',
    short: 'Module power-off timer fault',
    severity: 'caution',
  },
  P262C: {
    description: 'Sensor Reference Voltage "G" Circuit/Open',
    short: 'Sensor supply G circuit open',
    severity: 'warning',
  },
  P262D: {
    description: 'Sensor Reference Voltage "G" Circuit Low',
    short: 'Sensor supply G low',
    severity: 'warning',
  },
  P262E: {
    description: 'Sensor Reference Voltage "G" Circuit High',
    short: 'Sensor supply G high',
    severity: 'warning',
  },
  P262F: {
    description: 'Sensor Reference Voltage "G" Circuit Range/Performance',
    short: 'Sensor supply G out of range',
    severity: 'warning',
  },
  P2630: {
    description: 'O2 Sensor Pumping Current Trim Circuit Low (Bank 2 Sensor 1)',
    short: 'Upstream O2 trim low (B2)',
    severity: 'caution',
  },
  P2631: {
    description: 'O2 Sensor Pumping Current Trim Circuit High (Bank 2 Sensor 1)',
    short: 'Upstream O2 trim high (B2)',
    severity: 'caution',
  },
  P2632: {
    description: 'Fuel Pump "B" Control Circuit/Open',
    short: 'Fuel pump B circuit open',
    severity: 'warning',
  },
  P2633: {
    description: 'Fuel Pump "B" Control Circuit Low',
    short: 'Fuel pump B low',
    severity: 'warning',
  },
  P2634: {
    description: 'Fuel Pump "B" Control Circuit High',
    short: 'Fuel pump B high',
    severity: 'warning',
  },
  P2635: {
    description: 'Fuel Pump "A" Low Flow/Performance',
    short: 'Fuel pump A low flow',
    severity: 'warning',
  },
  P2636: {
    description: 'Fuel Pump "B" Low Flow/Performance',
    short: 'Fuel pump B low flow',
    severity: 'warning',
  },
  P2637: {
    description: 'Torque Management Feedback Signal "A"',
    short: 'Torque feedback signal A circuit',
    severity: 'warning',
  },
  P2638: {
    description: 'Torque Management Feedback Signal "A" Range/Performance',
    short: 'Torque feedback signal A fault',
    severity: 'warning',
  },
  P2639: {
    description: 'Torque Management Feedback Signal "A" Low',
    short: 'Torque feedback signal A low',
    severity: 'warning',
  },
  P263A: {
    description: 'MIL Control Circuit Low',
    short: 'Check engine light circuit low',
    severity: 'caution',
  },
  P263B: {
    description: 'MIL Control Circuit High',
    short: 'Check engine light circuit high',
    severity: 'caution',
  },
  P263C: {
    description: 'Glow Plug Control Driver Performance',
    short: 'Glow plug driver fault',
    severity: 'caution',
  },
  P263D: {
    description: 'Reductant Heater Driver Performance',
    short: 'DEF heater driver fault',
    severity: 'caution',
  },
  P263E: {
    description: 'Glow Plug Control Module 1 Over Temperature',
    short: 'Glow plug module 1 overheating',
    severity: 'caution',
  },
  P263F: {
    description: 'Glow Plug Control Module 2 Over Temperature',
    short: 'Glow plug module 2 overheating',
    severity: 'caution',
  },
  P2640: {
    description: 'Torque Management Feedback Signal "A" High',
    short: 'Torque feedback signal A high',
    severity: 'warning',
  },
  P2641: {
    description: 'Torque Management Feedback Signal "B"',
    short: 'Torque feedback signal B circuit',
    severity: 'warning',
  },
  P2642: {
    description: 'Torque Management Feedback Signal "B" Range/Performance',
    short: 'Torque feedback signal B fault',
    severity: 'warning',
  },
  P2643: {
    description: 'Torque Management Feedback Signal "B" Low',
    short: 'Torque feedback signal B low',
    severity: 'warning',
  },
  P2644: {
    description: 'Torque Management Feedback Signal "B" High',
    short: 'Torque feedback signal B high',
    severity: 'warning',
  },
  P2645: {
    description: '"A" Rocker Arm Actuator Control Circuit/Open (Bank 1)',
    short: 'Rocker arm A circuit open (B1)',
    severity: 'warning',
  },
  P2646: {
    description: '"A" Rocker Arm Actuator System Performance/Stuck Off (Bank 1)',
    short: 'Rocker arm A stuck off (B1)',
    severity: 'warning',
  },
  P2647: {
    description: '"A" Rocker Arm Actuator System Stuck On (Bank 1)',
    short: 'Rocker arm A stuck on (B1)',
    severity: 'warning',
  },
  P2648: {
    description: '"A" Rocker Arm Actuator Control Circuit Low (Bank 1)',
    short: 'Rocker arm A low (B1)',
    severity: 'warning',
  },
  P2649: {
    description: '"A" Rocker Arm Actuator Control Circuit High (Bank 1)',
    short: 'Rocker arm A high (B1)',
    severity: 'warning',
  },
  P264A: {
    description: '"A" Rocker Arm Actuator Position Sensor Circuit (Bank 1)',
    short: 'Rocker arm sensor A circuit (B1)',
    severity: 'warning',
  },
  P264B: {
    description: '"A" Rocker Arm Actuator Position Sensor Circuit Range/Performance (Bank 1)',
    short: 'Rocker arm sensor A fault (B1)',
    severity: 'warning',
  },
  P264C: {
    description: '"A" Rocker Arm Actuator Position Sensor Circuit Low (Bank 1)',
    short: 'Rocker arm sensor A low (B1)',
    severity: 'warning',
  },
  P264D: {
    description: '"A" Rocker Arm Actuator Position Sensor Circuit High (Bank 1)',
    short: 'Rocker arm sensor A high (B1)',
    severity: 'warning',
  },
  P264E: {
    description: '"A" Rocker Arm Actuator Position Sensor Circuit Intermittent/Erratic (Bank 1)',
    short: 'Rocker arm sensor A erratic (B1)',
    severity: 'warning',
  },
  P264F: {
    description: 'Engine Serial Number Not Programmed or Incompatible',
    short: 'Engine serial not programmed',
    severity: 'caution',
  },
  P2650: {
    description: '"B" Rocker Arm Actuator Control Circuit/Open (Bank 1)',
    short: 'Rocker arm B circuit open (B1)',
    severity: 'warning',
  },
  P2651: {
    description: '"B" Rocker Arm Actuator System Performance/Stuck Off (Bank 1)',
    short: 'Rocker arm B stuck off (B1)',
    severity: 'warning',
  },
  P2652: {
    description: '"B" Rocker Arm Actuator System Stuck On (Bank 1)',
    short: 'Rocker arm B stuck on (B1)',
    severity: 'warning',
  },
  P2653: {
    description: '"B" Rocker Arm Actuator Control Circuit Low (Bank 1)',
    short: 'Rocker arm B low (B1)',
    severity: 'warning',
  },
  P2654: {
    description: '"B" Rocker Arm Actuator Control Circuit High (Bank 1)',
    short: 'Rocker arm B high (B1)',
    severity: 'warning',
  },
  P2655: {
    description: '"A" Rocker Arm Actuator Control Circuit/Open (Bank 2)',
    short: 'Rocker arm A circuit open (B2)',
    severity: 'warning',
  },
  P2656: {
    description: '"A" Rocker Arm Actuator System Performance/Stuck Off (Bank 2)',
    short: 'Rocker arm A stuck off (B2)',
    severity: 'warning',
  },
  P2657: {
    description: '"A" Rocker Arm Actuator System Stuck On (Bank 2)',
    short: 'Rocker arm A stuck on (B2)',
    severity: 'warning',
  },
  P2658: {
    description: '"A" Rocker Arm Actuator Control Circuit Low (Bank 2)',
    short: 'Rocker arm A low (B2)',
    severity: 'warning',
  },
  P2659: {
    description: '"A" Rocker Arm Actuator Control Circuit High (Bank 2)',
    short: 'Rocker arm A high (B2)',
    severity: 'warning',
  },
  P265A: {
    description: '"B" Rocker Arm Actuator Position Sensor Circuit (Bank 1)',
    short: 'Rocker arm sensor B circuit (B1)',
    severity: 'warning',
  },
  P265B: {
    description: '"B" Rocker Arm Actuator Position Sensor Circuit Range/Performance (Bank 1)',
    short: 'Rocker arm sensor B fault (B1)',
    severity: 'warning',
  },
  P265C: {
    description: '"B" Rocker Arm Actuator Position Sensor Circuit Low (Bank 1)',
    short: 'Rocker arm sensor B low (B1)',
    severity: 'warning',
  },
  P265D: {
    description: '"B" Rocker Arm Actuator Position Sensor Circuit High (Bank 1)',
    short: 'Rocker arm sensor B high (B1)',
    severity: 'warning',
  },
  P265E: {
    description: '"B" Rocker Arm Actuator Position Sensor Circuit Intermittent/Erratic (Bank 1)',
    short: 'Rocker arm sensor B erratic (B1)',
    severity: 'warning',
  },
  P265F: {
    description: 'Variable A/C Compressor Control Circuit Range/Performance',
    short: 'A/C compressor control fault',
    severity: 'info',
  },
  P2660: {
    description: '"B" Rocker Arm Actuator Control Circuit/Open (Bank 2)',
    short: 'Rocker arm B circuit open (B2)',
    severity: 'warning',
  },
  P2661: {
    description: '"B" Rocker Arm Actuator System Performance/Stuck Off (Bank 2)',
    short: 'Rocker arm B stuck off (B2)',
    severity: 'warning',
  },
  P2662: {
    description: '"B" Rocker Arm Actuator System Stuck On (Bank 2)',
    short: 'Rocker arm B stuck on (B2)',
    severity: 'warning',
  },
  P2663: {
    description: '"B" Rocker Arm Actuator Control Circuit Low (Bank 2)',
    short: 'Rocker arm B low (B2)',
    severity: 'warning',
  },
  P2664: {
    description: '"B" Rocker Arm Actuator Control Circuit High (Bank 2)',
    short: 'Rocker arm B high (B2)',
    severity: 'warning',
  },
  P2665: {
    description: 'Fuel Shutoff Valve "B" Control Circuit/Open',
    short: 'Fuel shutoff valve B circuit',
    severity: 'warning',
  },
  P2666: {
    description: 'Fuel Shutoff Valve "B" Control Circuit Low',
    short: 'Fuel shutoff valve B low',
    severity: 'warning',
  },
  P2667: {
    description: 'Fuel Shutoff Valve "B" Control Circuit High',
    short: 'Fuel shutoff valve B high',
    severity: 'warning',
  },
  P2668: {
    description: 'Fuel Mode Indicator Lamp Control Circuit',
    short: 'Fuel mode lamp circuit',
    severity: 'info',
  },
  P2669: {
    description: 'Actuator Supply Voltage "B" Circuit/Open',
    short: 'Actuator supply B circuit open',
    severity: 'warning',
  },
  P266A: {
    description: '"A" Rocker Arm Actuator Position Sensor Circuit (Bank 2)',
    short: 'Rocker arm sensor A circuit (B2)',
    severity: 'warning',
  },
  P266B: {
    description: '"A" Rocker Arm Actuator Position Sensor Circuit Range/Performance (Bank 2)',
    short: 'Rocker arm sensor A fault (B2)',
    severity: 'warning',
  },
  P266C: {
    description: '"A" Rocker Arm Actuator Position Sensor Circuit Low (Bank 2)',
    short: 'Rocker arm sensor A low (B2)',
    severity: 'warning',
  },
  P266D: {
    description: '"A" Rocker Arm Actuator Position Sensor Circuit High (Bank 2)',
    short: 'Rocker arm sensor A high (B2)',
    severity: 'warning',
  },
  P266E: {
    description: '"A" Rocker Arm Actuator Position Sensor Circuit Intermittent/Erratic (Bank 2)',
    short: 'Rocker arm sensor A erratic (B2)',
    severity: 'warning',
  },
  P266F: {
    description:
      'A/C Refrigerant Distribution Valve Control Circuit Driver Current/Temperature Too High',
    short: 'A/C valve driver overheating',
    severity: 'info',
  },
  P2670: {
    description: 'Actuator Supply Voltage "B" Circuit Low',
    short: 'Actuator supply B low',
    severity: 'warning',
  },
  P2671: {
    description: 'Actuator Supply Voltage "B" Circuit High',
    short: 'Actuator supply B high',
    severity: 'warning',
  },
  P2672: {
    description: 'Injection Pump Timing Offset',
    short: 'Injection pump timing offset',
    severity: 'warning',
  },
  P2673: {
    description: 'Injection Pump Timing Calibration Not Learned',
    short: 'Pump timing not calibrated',
    severity: 'warning',
  },
  P2674: {
    description: 'Injection Pump Fuel Calibration Not Learned',
    short: 'Pump fuel not calibrated',
    severity: 'warning',
  },
  P2675: {
    description: 'Air Cleaner Inlet Control Circuit/Open',
    short: 'Air intake flap circuit open',
    severity: 'caution',
  },
  P2676: {
    description: 'Air Cleaner Inlet Control Circuit Low',
    short: 'Air intake flap low',
    severity: 'caution',
  },
  P2677: {
    description: 'Air Cleaner Inlet Control Circuit High',
    short: 'Air intake flap high',
    severity: 'caution',
  },
  P2678: {
    description: 'Coolant Degassing Valve Control Circuit/Open',
    short: 'Coolant degas valve circuit open',
    severity: 'caution',
  },
  P2679: {
    description: 'Coolant Degassing Valve Control Circuit Low',
    short: 'Coolant degas valve low',
    severity: 'caution',
  },
  P267A: {
    description: '"B" Rocker Arm Actuator Position Sensor Circuit (Bank 2)',
    short: 'Rocker arm sensor B circuit (B2)',
    severity: 'warning',
  },
  P267B: {
    description: '"B" Rocker Arm Actuator Position Sensor Circuit Range/Performance (Bank 2)',
    short: 'Rocker arm sensor B fault (B2)',
    severity: 'warning',
  },
  P267C: {
    description: '"B" Rocker Arm Actuator Position Sensor Circuit Low (Bank 2)',
    short: 'Rocker arm sensor B low (B2)',
    severity: 'warning',
  },
  P267D: {
    description: '"B" Rocker Arm Actuator Position Sensor Circuit High (Bank 2)',
    short: 'Rocker arm sensor B high (B2)',
    severity: 'warning',
  },
  P267E: {
    description: '"B" Rocker Arm Actuator Position Sensor Circuit Intermittent/Erratic (Bank 2)',
    short: 'Rocker arm sensor B erratic (B2)',
    severity: 'warning',
  },
  P267F: {
    description: 'Control Module Internal Temperature Sensor "A" Circuit Intermittent/Erratic',
    short: 'Module temp sensor A erratic',
    severity: 'caution',
  },
  P2680: {
    description: 'Coolant Degassing Valve Control Circuit High',
    short: 'Coolant degas valve high',
    severity: 'caution',
  },
  P2681: {
    description: 'Engine Coolant Bypass Valve "A" Control Circuit/Open',
    short: 'Coolant valve A circuit open',
    severity: 'warning',
  },
  P2682: {
    description: 'Engine Coolant Bypass Valve "A" Control Circuit Low',
    short: 'Coolant valve A low',
    severity: 'warning',
  },
  P2683: {
    description: 'Engine Coolant Bypass Valve "A" Control Circuit High',
    short: 'Coolant valve A high',
    severity: 'warning',
  },
  P2684: {
    description: 'Actuator Supply Voltage "C" Circuit/Open',
    short: 'Actuator supply C circuit open',
    severity: 'warning',
  },
  P2685: {
    description: 'Actuator Supply Voltage "C" Circuit Low',
    short: 'Actuator supply C low',
    severity: 'warning',
  },
  P2686: {
    description: 'Actuator Supply Voltage "C" Circuit High',
    short: 'Actuator supply C high',
    severity: 'warning',
  },
  P2687: {
    description: 'Fuel Supply Heater Control Circuit/Open',
    short: 'Fuel heater circuit open',
    severity: 'caution',
  },
  P2688: {
    description: 'Fuel Supply Heater Control Circuit Low',
    short: 'Fuel heater low',
    severity: 'caution',
  },
  P2689: {
    description: 'Fuel Supply Heater Control Circuit High',
    short: 'Fuel heater high',
    severity: 'caution',
  },
  P268A: {
    description: 'Fuel Injector Calibration Not Learned/Programmed',
    short: 'Injector codes not programmed',
    severity: 'warning',
  },
  P268B: {
    description: 'High Pressure Fuel Pump Calibration Not Learned/Programmed',
    short: 'Fuel pump not calibrated',
    severity: 'warning',
  },
  P268C: {
    description: 'Cylinder 1 Injector Data Incompatible',
    short: 'Cyl 1 injector data wrong',
    severity: 'warning',
  },
  P268D: {
    description: 'Cylinder 2 Injector Data Incompatible',
    short: 'Cyl 2 injector data wrong',
    severity: 'warning',
  },
  P268E: {
    description: 'Cylinder 3 Injector Data Incompatible',
    short: 'Cyl 3 injector data wrong',
    severity: 'warning',
  },
  P268F: {
    description: 'Cylinder 4 Injector Data Incompatible',
    short: 'Cyl 4 injector data wrong',
    severity: 'warning',
  },
  P2690: {
    description: 'Cylinder 5 Injector Data Incompatible',
    short: 'Cyl 5 injector data wrong',
    severity: 'warning',
  },
  P2691: {
    description: 'Cylinder 6 Injector Data Incompatible',
    short: 'Cyl 6 injector data wrong',
    severity: 'warning',
  },
  P2692: {
    description: 'Cylinder 7 Injector Data Incompatible',
    short: 'Cyl 7 injector data wrong',
    severity: 'warning',
  },
  P2693: {
    description: 'Cylinder 8 Injector Data Incompatible',
    short: 'Cyl 8 injector data wrong',
    severity: 'warning',
  },
  P2694: {
    description: 'Cylinder 9 Injector Data Incompatible',
    short: 'Cyl 9 injector data wrong',
    severity: 'warning',
  },
  P2695: {
    description: 'Cylinder 10 Injector Data Incompatible',
    short: 'Cyl 10 injector data wrong',
    severity: 'warning',
  },
  P2696: {
    description: 'Injector Data Incompatible',
    short: 'Injector data incompatible',
    severity: 'warning',
  },
  P2697: {
    description: 'Exhaust Aftertreatment Fuel Injector "A" Circuit/Open',
    short: 'Exhaust injector A circuit open',
    severity: 'caution',
  },
  P2698: {
    description: 'Exhaust Aftertreatment Fuel Injector "A" Performance',
    short: 'Exhaust injector A fault',
    severity: 'caution',
  },
  P2699: {
    description: 'Exhaust Aftertreatment Fuel Injector "A" Circuit Low',
    short: 'Exhaust injector A circuit low',
    severity: 'caution',
  },
  P269A: {
    description: 'Exhaust Aftertreatment Fuel Injector "A" Circuit High',
    short: 'Exhaust injector A circuit high',
    severity: 'caution',
  },
  P269B: {
    description: 'Exhaust Aftertreatment Glow Plug Control Circuit/Open',
    short: 'Exhaust glow plug control open',
    severity: 'caution',
  },
  P269C: {
    description: 'Exhaust Aftertreatment Glow Plug Control Performance',
    short: 'Exhaust glow plug control fault',
    severity: 'caution',
  },
  P269D: {
    description: 'Exhaust Aftertreatment Glow Plug Control Circuit Low',
    short: 'Exhaust glow plug control low',
    severity: 'caution',
  },
  P269E: {
    description: 'Exhaust Aftertreatment Glow Plug Control Circuit High',
    short: 'Exhaust glow plug control high',
    severity: 'caution',
  },
  P269F: {
    description: 'Exhaust Aftertreatment Glow Plug Circuit/Open',
    short: 'Exhaust glow plug circuit open',
    severity: 'caution',
  },
  P26A0: {
    description: 'Exhaust Aftertreatment Glow Plug Performance',
    short: 'Exhaust glow plug fault',
    severity: 'caution',
  },
  P26A1: {
    description: 'Exhaust Aftertreatment Glow Plug Circuit Low',
    short: 'Exhaust glow plug circuit low',
    severity: 'caution',
  },
  P26A2: {
    description: 'Exhaust Aftertreatment Glow Plug Circuit High',
    short: 'Exhaust glow plug circuit high',
    severity: 'caution',
  },
  P26A3: {
    description: 'Engine Coolant Bypass Valve "A" Range/Performance',
    short: 'Coolant valve A out of range',
    severity: 'warning',
  },
  P26A4: {
    description: 'Engine Coolant Bypass Valve "A" Position Sensor Circuit',
    short: 'Coolant valve A sensor circuit',
    severity: 'warning',
  },
  P26A5: {
    description: 'Engine Coolant Bypass Valve "A" Position Sensor Circuit Range/Performance',
    short: 'Coolant valve A sensor fault',
    severity: 'warning',
  },
  P26A6: {
    description: 'Engine Coolant Bypass Valve "A" Position Sensor Circuit Low',
    short: 'Coolant valve A sensor low',
    severity: 'warning',
  },
  P26A7: {
    description: 'Engine Coolant Bypass Valve "A" Position Sensor Circuit High',
    short: 'Coolant valve A sensor high',
    severity: 'warning',
  },
  P26A8: {
    description: 'Engine Coolant Bypass Valve "A" Position Sensor Circuit Intermittent/Erratic',
    short: 'Coolant valve A sensor erratic',
    severity: 'warning',
  },
  P26A9: {
    description: 'Engine Coolant Bypass Valve "A" Position Sensor Stop/Minimum Stop Performance',
    short: 'Coolant valve A min stop fault',
    severity: 'warning',
  },
  P26AA: {
    description: 'Engine Coolant Bypass Valve "A" Position Sensor Maximum Stop Performance',
    short: 'Coolant valve A max stop fault',
    severity: 'warning',
  },
  P26AB: {
    description: 'Engine Coolant Bypass Valve "A" Stuck/Open',
    short: 'Coolant valve A stuck open',
    severity: 'warning',
  },
  P26AC: {
    description: 'Engine Coolant Bypass Valve "B" Control Circuit/Open',
    short: 'Coolant valve B circuit open',
    severity: 'warning',
  },
  P26AD: {
    description: 'Engine Coolant Bypass Valve "B" Control Circuit Low',
    short: 'Coolant valve B low',
    severity: 'warning',
  },
  P26AE: {
    description: 'Engine Coolant Bypass Valve "B" Control Circuit High',
    short: 'Coolant valve B high',
    severity: 'warning',
  },
  P26AF: {
    description: 'Engine Coolant Bypass Valve "B" Stuck/Open',
    short: 'Coolant valve B stuck open',
    severity: 'warning',
  },
  P26B0: {
    description: 'Engine Coolant Bypass Valve "B" Range/Performance',
    short: 'Coolant valve B out of range',
    severity: 'warning',
  },
  P26B1: {
    description: 'Engine Coolant Bypass Valve "A" Stuck Closed',
    short: 'Coolant valve A stuck closed',
    severity: 'warning',
  },
  P26B2: {
    description: 'Engine Coolant Bypass Valve "B" Stuck Closed',
    short: 'Coolant valve B stuck closed',
    severity: 'warning',
  },
  P26B3: {
    description: 'Fuel Shutoff Valve "A" Control Circuit Performance/Stuck Off',
    short: 'Fuel shutoff valve A stuck off',
    severity: 'warning',
  },
  P26B4: {
    description: 'Fuel Shutoff Valve "A" Control Circuit Stuck On',
    short: 'Fuel shutoff valve A stuck on',
    severity: 'warning',
  },
  P26B5: {
    description: 'Fuel Shutoff Valve "B" Control Circuit Performance/Stuck Off',
    short: 'Fuel shutoff valve B stuck off',
    severity: 'warning',
  },
  P26B6: {
    description: 'Fuel Shutoff Valve "B" Control Circuit Stuck On',
    short: 'Fuel shutoff valve B stuck on',
    severity: 'warning',
  },
  P26B7: {
    description: 'Engine Coolant Bypass Valve "C" Control Circuit/Open',
    short: 'Coolant valve C circuit open',
    severity: 'warning',
  },
  P26B8: {
    description: 'Engine Coolant Bypass Valve "C" Control Circuit Low',
    short: 'Coolant valve C low',
    severity: 'warning',
  },
  P26B9: {
    description: 'Engine Coolant Bypass Valve "C" Control Circuit High',
    short: 'Coolant valve C high',
    severity: 'warning',
  },
  P26BA: {
    description: 'Engine Coolant Bypass Valve "C" Stuck/Open',
    short: 'Coolant valve C stuck open',
    severity: 'warning',
  },
  P26BB: {
    description: 'Engine Coolant Bypass Valve "C" Range/Performance',
    short: 'Coolant valve C out of range',
    severity: 'warning',
  },
  P26BC: {
    description: 'Engine Coolant Bypass Valve "C" Stuck Closed',
    short: 'Coolant valve C stuck closed',
    severity: 'warning',
  },
  P26BD: {
    description: 'Engine Coolant Bypass Valve "D" Control Circuit/Open',
    short: 'Coolant valve D circuit open',
    severity: 'warning',
  },
  P26BE: {
    description: 'Engine Coolant Bypass Valve "D" Control Circuit Low',
    short: 'Coolant valve D low',
    severity: 'warning',
  },
  P26BF: {
    description: 'Engine Coolant Bypass Valve "D" Control Circuit High',
    short: 'Coolant valve D high',
    severity: 'warning',
  },
  P26C0: {
    description: 'Engine Coolant Bypass Valve "D" Stuck/Open',
    short: 'Coolant valve D stuck open',
    severity: 'warning',
  },
  P26C1: {
    description: 'Engine Coolant Bypass Valve "D" Range/Performance',
    short: 'Coolant valve D out of range',
    severity: 'warning',
  },
  P26C2: {
    description: 'Engine Coolant Bypass Valve "D" Stuck Closed',
    short: 'Coolant valve D stuck closed',
    severity: 'warning',
  },
  P26C3: {
    description: 'Internal Control Module Transmission Range Sensor Performance',
    short: 'Gear position input fault',
    severity: 'warning',
  },
  P26C4: {
    description: 'Internal Control Module Clutch Pedal Performance',
    short: 'Clutch pedal input fault',
    severity: 'warning',
  },
  P26C5: {
    description: 'Exhaust Flow Control Valve "A" Control Circuit/Open',
    short: 'Exhaust flap valve A circuit',
    severity: 'caution',
  },
  P26C6: {
    description: 'Exhaust Flow Control Valve "A" Control Circuit Low',
    short: 'Exhaust flap valve A low',
    severity: 'caution',
  },
  P26C7: {
    description: 'Exhaust Flow Control Valve "A" Control Circuit High',
    short: 'Exhaust flap valve A high',
    severity: 'caution',
  },
  P26C8: {
    description: 'Chassis Control Module 1 Requested MIL Illumination',
    short: 'Chassis module 1 fault reported',
    severity: 'caution',
  },
  P26C9: {
    description: 'Chassis Control Module 2 Requested MIL Illumination',
    short: 'Chassis module 2 fault reported',
    severity: 'caution',
  },
  P26CA: {
    description: 'Engine Coolant Pump Control Circuit/Open',
    short: 'Coolant pump circuit open',
    severity: 'warning',
  },
  P26CB: {
    description: 'Engine Coolant Pump Performance/Stuck Off',
    short: 'Coolant pump stuck off',
    severity: 'warning',
  },
  P26CC: {
    description: 'Engine Coolant Pump Control Circuit Low',
    short: 'Coolant pump low',
    severity: 'warning',
  },
  P26CD: {
    description: 'Engine Coolant Pump Control Circuit High',
    short: 'Coolant pump high',
    severity: 'warning',
  },
  P26CE: {
    description: 'Engine Coolant Pump Overspeed',
    short: 'Coolant pump overspeed',
    severity: 'warning',
  },
  P26CF: {
    description: 'Engine Coolant Pump Control Module System Voltage',
    short: 'Coolant pump module voltage',
    severity: 'warning',
  },
  P26D0: {
    description: 'Engine Coolant Pump Control Module System Voltage Low',
    short: 'Coolant pump module voltage low',
    severity: 'warning',
  },
  P26D1: {
    description: 'Engine Coolant Pump Control Module System Voltage High',
    short: 'Coolant pump module voltage high',
    severity: 'warning',
  },
  P26D2: {
    description: 'Engine Coolant Pump Control Module Over Temperature',
    short: 'Coolant pump module overheating',
    severity: 'warning',
  },
  P26D3: {
    description: 'Engine Coolant Pump Supply Voltage Circuit',
    short: 'Coolant pump supply circuit',
    severity: 'warning',
  },
  P26D4: {
    description: 'Engine Coolant Pump Supply Voltage Circuit Low',
    short: 'Coolant pump supply low',
    severity: 'warning',
  },
  P26D5: {
    description: 'Engine Coolant Pump Supply Voltage Circuit High',
    short: 'Coolant pump supply high',
    severity: 'warning',
  },
  P26D6: {
    description: 'Engine Coolant Pump Clutch Control Circuit/Open',
    short: 'Coolant pump clutch circuit open',
    severity: 'warning',
  },
  P26D7: {
    description: 'Engine Coolant Pump Clutch Performance/Stuck Off',
    short: 'Coolant pump clutch stuck off',
    severity: 'warning',
  },
  P26D8: {
    description: 'Engine Coolant Pump Clutch Stuck On',
    short: 'Coolant pump clutch stuck on',
    severity: 'warning',
  },
  P26D9: {
    description: 'Engine Coolant Pump Clutch Control Circuit Low',
    short: 'Coolant pump clutch low',
    severity: 'warning',
  },
  P26DA: {
    description: 'Engine Coolant Pump Clutch Control Circuit High',
    short: 'Coolant pump clutch high',
    severity: 'warning',
  },
  P26DB: {
    description: 'Engine Sound Control "A" Circuit/Open',
    short: 'Engine sound A circuit open',
    severity: 'info',
  },
  P26DC: {
    description: 'Engine Sound Control "A" Circuit Low',
    short: 'Engine sound A circuit low',
    severity: 'info',
  },
  P26DD: {
    description: 'Engine Sound Control "A" Circuit High',
    short: 'Engine sound A circuit high',
    severity: 'info',
  },
  P26DE: {
    description: 'Engine Sound Control "A" Circuit Performance',
    short: 'Engine sound A circuit fault',
    severity: 'info',
  },
  P26DF: {
    description: 'Sensor Power Supply "D" Circuit/Open',
    short: 'Sensor power supply D circuit',
    severity: 'warning',
  },
  P26E0: {
    description: 'Sensor Power Supply "D" Circuit Low',
    short: 'Sensor power supply D low',
    severity: 'warning',
  },
  P26E1: {
    description: 'Sensor Power Supply "D" Circuit High',
    short: 'Sensor power supply D high',
    severity: 'warning',
  },
  P26E2: {
    description: 'Fuel Mode Indicator Lamp Control Circuit Low',
    short: 'Fuel mode lamp low',
    severity: 'info',
  },
  P26E3: {
    description: 'Fuel Mode Indicator Lamp Control Circuit High',
    short: 'Fuel mode lamp high',
    severity: 'info',
  },
  P26E4: {
    description: 'Starter Relay "B" Circuit',
    short: 'Starter relay B circuit',
    severity: 'warning',
  },
  P26E5: {
    description: 'Starter Relay "B" Circuit Low',
    short: 'Starter relay B low',
    severity: 'warning',
  },
  P26E6: {
    description: 'Starter Relay "B" Circuit High',
    short: 'Starter relay B high',
    severity: 'warning',
  },
  P26E7: {
    description: 'Actuator Supply Voltage "D" Circuit/Open',
    short: 'Actuator supply D circuit open',
    severity: 'warning',
  },
  P26E8: {
    description: 'Actuator Supply Voltage "D" Circuit Low',
    short: 'Actuator supply D low',
    severity: 'warning',
  },
  P26E9: {
    description: 'Actuator Supply Voltage "D" Circuit High',
    short: 'Actuator supply D high',
    severity: 'warning',
  },
  P26EB: {
    description: 'Alternative Fuel Control Module System Voltage',
    short: 'Alt-fuel module voltage fault',
    severity: 'warning',
  },
  P26EC: {
    description: 'Engine Sound Control "B" Circuit/Open',
    short: 'Engine sound B circuit open',
    severity: 'info',
  },
  P26ED: {
    description: 'Engine Sound Control "B" Circuit Low',
    short: 'Engine sound B circuit low',
    severity: 'info',
  },
  P26EE: {
    description: 'Engine Sound Control "B" Circuit High',
    short: 'Engine sound B circuit high',
    severity: 'info',
  },
  P26EF: {
    description: 'Engine Sound Control "B" Circuit Performance',
    short: 'Engine sound B circuit fault',
    severity: 'info',
  },
  P26F0: {
    description: 'Starter Relay "A" Stuck On',
    short: 'Starter relay A stuck on',
    severity: 'warning',
  },
  P26F1: {
    description: 'Starter Relay "A" Stuck Off',
    short: 'Starter relay A stuck off',
    severity: 'warning',
  },
  P26F2: {
    description: 'Starter Relay "B" Stuck On',
    short: 'Starter relay B stuck on',
    severity: 'warning',
  },
  P26F3: {
    description: 'Starter Relay "B" Stuck Off',
    short: 'Starter relay B stuck off',
    severity: 'warning',
  },
  P26FF: {
    description: 'Auto Configuration Throttle Input Not Present (Bank 2)',
    short: 'Throttle input not detected (B2)',
    severity: 'warning',
  },

  // P27xx — transmission
  P2700: {
    description: 'Transmission Friction Element "A" Apply Time Range/Performance',
    short: 'Trans clutch A apply time fault',
    severity: 'warning',
  },
  P2701: {
    description: 'Transmission Friction Element "B" Apply Time Range/Performance',
    short: 'Trans clutch B apply time fault',
    severity: 'warning',
  },
  P2702: {
    description: 'Transmission Friction Element "C" Apply Time Range/Performance',
    short: 'Trans clutch C apply time fault',
    severity: 'warning',
  },
  P2703: {
    description: 'Transmission Friction Element "D" Apply Time Range/Performance',
    short: 'Trans clutch D apply time fault',
    severity: 'warning',
  },
  P2704: {
    description: 'Transmission Friction Element "E" Apply Time Range/Performance',
    short: 'Trans clutch E apply time fault',
    severity: 'warning',
  },
  P2705: {
    description: 'Transmission Friction Element "F" Apply Time Range/Performance',
    short: 'Trans clutch F apply time fault',
    severity: 'warning',
  },
  P2706: {
    description: 'Shift Solenoid "F"',
    short: 'Shift solenoid F fault',
    severity: 'warning',
  },
  P2707: {
    description: 'Shift Solenoid "F" Performance/Stuck Off',
    short: 'Shift solenoid F stuck off',
    severity: 'warning',
  },
  P2708: {
    description: 'Shift Solenoid "F" Stuck On',
    short: 'Shift solenoid F stuck on',
    severity: 'warning',
  },
  P2709: {
    description: 'Shift Solenoid "F" Electrical',
    short: 'Shift solenoid F electrical',
    severity: 'warning',
  },
  P270A: {
    description: 'Transmission Friction Element "A" Temperature Too High',
    short: 'Trans clutch A overheating',
    severity: 'critical',
  },
  P270B: {
    description: 'Transmission Friction Element "B" Temperature Too High',
    short: 'Trans clutch B overheating',
    severity: 'critical',
  },
  P270C: {
    description: 'Transmission Friction Element "C" Temperature Too High',
    short: 'Trans clutch C overheating',
    severity: 'critical',
  },
  P270D: {
    description: 'Transmission Friction Element "D" Temperature Too High',
    short: 'Trans clutch D overheating',
    severity: 'critical',
  },
  P270E: {
    description: 'Transmission Friction Element "E" Temperature Too High',
    short: 'Trans clutch E overheating',
    severity: 'critical',
  },
  P270F: {
    description: 'Transmission Friction Element "F" Temperature Too High',
    short: 'Trans clutch F overheating',
    severity: 'critical',
  },
  P2710: {
    description: 'Shift Solenoid "F" Intermittent',
    short: 'Shift solenoid F erratic',
    severity: 'warning',
  },
  P2711: {
    description: 'Unexpected Mechanical Gear Disengagement',
    short: 'Gear disengaged unexpectedly',
    severity: 'warning',
  },
  P2712: {
    description: 'Hydraulic Power Unit Leakage',
    short: 'Trans hydraulic unit leak',
    severity: 'warning',
  },
  P2713: {
    description: 'Pressure Control Solenoid "D"',
    short: 'Pressure solenoid D fault',
    severity: 'warning',
  },
  P2714: {
    description: 'Pressure Control Solenoid "D" Performance/Stuck Off',
    short: 'Pressure solenoid D stuck off',
    severity: 'warning',
  },
  P2715: {
    description: 'Pressure Control Solenoid "D" Stuck On',
    short: 'Pressure solenoid D stuck on',
    severity: 'warning',
  },
  P2716: {
    description: 'Pressure Control Solenoid "D" Electrical',
    short: 'Pressure solenoid D electrical',
    severity: 'warning',
  },
  P2717: {
    description: 'Pressure Control Solenoid "D" Intermittent',
    short: 'Pressure solenoid D erratic',
    severity: 'warning',
  },
  P2718: {
    description: 'Pressure Control Solenoid "D" Control Circuit/Open',
    short: 'Pressure solenoid D circuit open',
    severity: 'warning',
  },
  P2719: {
    description: 'Pressure Control Solenoid "D" Control Circuit Range/Performance',
    short: 'Pressure solenoid D out of range',
    severity: 'warning',
  },
  P271A: {
    description: 'Park Pawl Position Sensor "A" Circuit Low',
    short: 'Park lock sensor A low',
    severity: 'warning',
  },
  P271B: {
    description: 'Park Pawl Position Sensor "A" Circuit High',
    short: 'Park lock sensor A high',
    severity: 'warning',
  },
  P271C: {
    description: 'Park Pawl Position Sensor "B" Circuit Low',
    short: 'Park lock sensor B low',
    severity: 'warning',
  },
  P271D: {
    description: 'Park Pawl Position Sensor "B" Circuit High',
    short: 'Park lock sensor B high',
    severity: 'warning',
  },
  P2720: {
    description: 'Pressure Control Solenoid "D" Control Circuit Low',
    short: 'Pressure solenoid D low',
    severity: 'warning',
  },
  P2721: {
    description: 'Pressure Control Solenoid "D" Control Circuit High',
    short: 'Pressure solenoid D high',
    severity: 'warning',
  },
  P2722: {
    description: 'Pressure Control Solenoid "E"',
    short: 'Pressure solenoid E fault',
    severity: 'warning',
  },
  P2723: {
    description: 'Pressure Control Solenoid "E" Performance/Stuck Off',
    short: 'Pressure solenoid E stuck off',
    severity: 'warning',
  },
  P2724: {
    description: 'Pressure Control Solenoid "E" Stuck On',
    short: 'Pressure solenoid E stuck on',
    severity: 'warning',
  },
  P2725: {
    description: 'Pressure Control Solenoid "E" Electrical',
    short: 'Pressure solenoid E electrical',
    severity: 'warning',
  },
  P2726: {
    description: 'Pressure Control Solenoid "E" Intermittent',
    short: 'Pressure solenoid E erratic',
    severity: 'warning',
  },
  P2727: {
    description: 'Pressure Control Solenoid "E" Control Circuit/Open',
    short: 'Pressure solenoid E circuit open',
    severity: 'warning',
  },
  P2728: {
    description: 'Pressure Control Solenoid "E" Control Circuit Range/Performance',
    short: 'Pressure solenoid E out of range',
    severity: 'warning',
  },
  P2729: {
    description: 'Pressure Control Solenoid "E" Control Circuit Low',
    short: 'Pressure solenoid E low',
    severity: 'warning',
  },
  P272A: {
    description: 'Transmission Range Select Motor Control Circuit',
    short: 'Gear select motor circuit',
    severity: 'warning',
  },
  P272B: {
    description: 'Transmission Range Select Motor Control Circuit Current Too High',
    short: 'Gear select motor current high',
    severity: 'warning',
  },
  P272C: {
    description: 'Park Pawl Motor Control Circuit',
    short: 'Park lock motor circuit',
    severity: 'warning',
  },
  P272D: {
    description: 'Park Pawl Motor Control Circuit Current Too High',
    short: 'Park lock motor current high',
    severity: 'warning',
  },
  P2730: {
    description: 'Pressure Control Solenoid "E" Control Circuit High',
    short: 'Pressure solenoid E high',
    severity: 'warning',
  },
  P2731: {
    description: 'Pressure Control Solenoid "F"',
    short: 'Pressure solenoid F fault',
    severity: 'warning',
  },
  P2732: {
    description: 'Pressure Control Solenoid "F" Performance/Stuck Off',
    short: 'Pressure solenoid F stuck off',
    severity: 'warning',
  },
  P2733: {
    description: 'Pressure Control Solenoid "F" Stuck On',
    short: 'Pressure solenoid F stuck on',
    severity: 'warning',
  },
  P2734: {
    description: 'Pressure Control Solenoid "F" Electrical',
    short: 'Pressure solenoid F electrical',
    severity: 'warning',
  },
  P2735: {
    description: 'Pressure Control Solenoid "F" Intermittent',
    short: 'Pressure solenoid F erratic',
    severity: 'warning',
  },
  P2736: {
    description: 'Pressure Control Solenoid "F" Control Circuit/Open',
    short: 'Pressure solenoid F circuit open',
    severity: 'warning',
  },
  P2737: {
    description: 'Pressure Control Solenoid "F" Control Circuit Range/Performance',
    short: 'Pressure solenoid F out of range',
    severity: 'warning',
  },
  P2738: {
    description: 'Pressure Control Solenoid "F" Control Circuit Low',
    short: 'Pressure solenoid F low',
    severity: 'warning',
  },
  P2739: {
    description: 'Pressure Control Solenoid "F" Control Circuit High',
    short: 'Pressure solenoid F high',
    severity: 'warning',
  },
  P273A: {
    description: 'Transmission Friction Element "G" Apply Time Range/Performance',
    short: 'Trans clutch G apply time fault',
    severity: 'warning',
  },
  P273B: {
    description: 'Transmission Friction Element "H" Apply Time Range/Performance',
    short: 'Trans clutch H apply time fault',
    severity: 'warning',
  },
  P273F: {
    description: 'Transmission Fluid Temperature Sensor "B" Over Temperature Condition',
    short: 'Transmission overheating',
    severity: 'critical',
  },
  P2740: {
    description: 'Transmission Fluid Temperature Sensor "B" Circuit',
    short: 'Trans temp sensor B circuit',
    severity: 'warning',
  },
  P2741: {
    description: 'Transmission Fluid Temperature Sensor "B" Circuit Range/Performance',
    short: 'Trans temp sensor B out of range',
    severity: 'warning',
  },
  P2742: {
    description: 'Transmission Fluid Temperature Sensor "B" Circuit Low',
    short: 'Trans temp sensor B low',
    severity: 'warning',
  },
  P2743: {
    description: 'Transmission Fluid Temperature Sensor "B" Circuit High',
    short: 'Trans temp sensor B high',
    severity: 'warning',
  },
  P2744: {
    description: 'Transmission Fluid Temperature Sensor "B" Circuit Intermittent',
    short: 'Trans temp sensor B erratic',
    severity: 'warning',
  },
  P2745: {
    description: 'Intermediate Shaft Speed Sensor "B" Circuit',
    short: 'Trans shaft sensor B circuit',
    severity: 'warning',
  },
  P2746: {
    description: 'Intermediate Shaft Speed Sensor "B" Circuit Range/Performance',
    short: 'Trans shaft sensor B fault',
    severity: 'warning',
  },
  P2747: {
    description: 'Intermediate Shaft Speed Sensor "B" Circuit No Signal',
    short: 'Trans shaft sensor B no signal',
    severity: 'warning',
  },
  P2748: {
    description: 'Intermediate Shaft Speed Sensor "B" Circuit Intermittent',
    short: 'Trans shaft sensor B erratic',
    severity: 'warning',
  },
  P2749: {
    description: 'Intermediate Shaft Speed Sensor "C" Circuit',
    short: 'Trans shaft sensor C circuit',
    severity: 'warning',
  },
  P274A: {
    description: 'Transmission Fluid Temperature Sensor "C" Circuit',
    short: 'Trans temp sensor C circuit',
    severity: 'warning',
  },
  P274B: {
    description: 'Transmission Fluid Temperature Sensor "C" Circuit Range/Performance',
    short: 'Trans temp sensor C out of range',
    severity: 'warning',
  },
  P274C: {
    description: 'Transmission Fluid Temperature Sensor "C" Circuit Low',
    short: 'Trans temp sensor C low',
    severity: 'warning',
  },
  P274D: {
    description: 'Transmission Fluid Temperature Sensor "C" Circuit High',
    short: 'Trans temp sensor C high',
    severity: 'warning',
  },
  P274E: {
    description: 'Transmission Fluid Temperature Sensor "C" Circuit Intermittent',
    short: 'Trans temp sensor C erratic',
    severity: 'warning',
  },
  P274F: {
    description: 'Transmission Fluid Temperature Sensor "C" Over Temperature Condition',
    short: 'Transmission overheating',
    severity: 'critical',
  },
  P2750: {
    description: 'Intermediate Shaft Speed Sensor "C" Circuit Range/Performance',
    short: 'Trans shaft sensor C fault',
    severity: 'warning',
  },
  P2751: {
    description: 'Intermediate Shaft Speed Sensor "C" Circuit No Signal',
    short: 'Trans shaft sensor C no signal',
    severity: 'warning',
  },
  P2752: {
    description: 'Intermediate Shaft Speed Sensor "C" Circuit Intermittent',
    short: 'Trans shaft sensor C erratic',
    severity: 'warning',
  },
  P2753: {
    description: 'Transmission Fluid Cooler Control Circuit/Open',
    short: 'Transmission cooler circuit open',
    severity: 'warning',
  },
  P2754: {
    description: 'Transmission Fluid Cooler Control Circuit Low',
    short: 'Transmission cooler low',
    severity: 'warning',
  },
  P2755: {
    description: 'Transmission Fluid Cooler Control Circuit High',
    short: 'Transmission cooler high',
    severity: 'warning',
  },
  P2756: {
    description: 'Torque Converter Clutch Pressure Control Solenoid',
    short: 'Converter solenoid fault',
    severity: 'warning',
  },
  P2757: {
    description:
      'Torque Converter Clutch Pressure Control Solenoid Control Circuit Performance/Stuck Off',
    short: 'Converter solenoid stuck off',
    severity: 'warning',
  },
  P2758: {
    description: 'Torque Converter Clutch Pressure Control Solenoid Control Circuit Stuck On',
    short: 'Converter solenoid stuck on',
    severity: 'warning',
  },
  P2759: {
    description: 'Torque Converter Clutch Pressure Control Solenoid Control Circuit Electrical',
    short: 'Converter solenoid electrical',
    severity: 'warning',
  },
  P275A: {
    description: 'Transmission Fluid Temperature Sensor "D" Circuit',
    short: 'Trans temp sensor D circuit',
    severity: 'warning',
  },
  P275B: {
    description: 'Transmission Fluid Temperature Sensor "D" Circuit Range/Performance',
    short: 'Trans temp sensor D out of range',
    severity: 'warning',
  },
  P275C: {
    description: 'Transmission Fluid Temperature Sensor "D" Circuit Low',
    short: 'Trans temp sensor D low',
    severity: 'warning',
  },
  P275D: {
    description: 'Transmission Fluid Temperature Sensor "D" Circuit High',
    short: 'Trans temp sensor D high',
    severity: 'warning',
  },
  P275E: {
    description: 'Transmission Fluid Temperature Sensor "D" Circuit Intermittent',
    short: 'Trans temp sensor D erratic',
    severity: 'warning',
  },
  P275F: {
    description: 'Transmission Fluid Temperature Sensor "D" Over Temperature Condition',
    short: 'Transmission overheating',
    severity: 'critical',
  },
  P2760: {
    description: 'Torque Converter Clutch Pressure Control Solenoid Control Circuit Intermittent',
    short: 'Converter solenoid erratic',
    severity: 'warning',
  },
  P2761: {
    description: 'Torque Converter Clutch Pressure Control Solenoid Control Circuit/Open',
    short: 'Converter solenoid circuit open',
    severity: 'warning',
  },
  P2762: {
    description:
      'Torque Converter Clutch Pressure Control Solenoid Control Circuit Range/Performance',
    short: 'Converter solenoid out of range',
    severity: 'warning',
  },
  P2763: {
    description: 'Torque Converter Clutch Pressure Control Solenoid Control Circuit High',
    short: 'Converter solenoid high',
    severity: 'warning',
  },
  P2764: {
    description: 'Torque Converter Clutch Pressure Control Solenoid Control Circuit Low',
    short: 'Converter solenoid low',
    severity: 'warning',
  },
  P2765: {
    description: 'Input/Turbine Shaft Speed Sensor "B" Circuit',
    short: 'Input speed sensor B circuit',
    severity: 'warning',
  },
  P2766: {
    description: 'Input/Turbine Shaft Speed Sensor "B" Circuit Range/Performance',
    short: 'Input speed sensor B fault',
    severity: 'warning',
  },
  P2767: {
    description: 'Input/Turbine Shaft Speed Sensor "B" Circuit No Signal',
    short: 'Input speed sensor B no signal',
    severity: 'warning',
  },
  P2768: {
    description: 'Input/Turbine Shaft Speed Sensor "B" Circuit Intermittent',
    short: 'Input speed sensor B erratic',
    severity: 'warning',
  },
  P2769: {
    description: 'Torque Converter Clutch Circuit Low',
    short: 'Converter clutch circuit low',
    severity: 'warning',
  },
  P276A: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "B" Motor Supply Voltage Circuit/Open',
    short: 'Aux trans pump B supply circuit',
    severity: 'warning',
  },
  P276B: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "B" Motor Supply Voltage Circuit Low',
    short: 'Aux trans pump B supply low',
    severity: 'warning',
  },
  P276C: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "B" Motor Supply Voltage Circuit High',
    short: 'Aux trans pump B supply high',
    severity: 'warning',
  },
  P276D: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "B" Motor Current',
    short: 'Aux trans pump B current fault',
    severity: 'warning',
  },
  P276E: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "B" Motor Current Low',
    short: 'Aux trans pump B current low',
    severity: 'warning',
  },
  P276F: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "B" Motor Current High',
    short: 'Aux trans pump B current high',
    severity: 'warning',
  },
  P2770: {
    description: 'Torque Converter Clutch Circuit High',
    short: 'Converter clutch circuit high',
    severity: 'warning',
  },
  P2771: {
    description: 'Four Wheel Drive (4WD) Low Switch Circuit',
    short: '4WD low switch circuit',
    severity: 'caution',
  },
  P2772: {
    description: 'Four Wheel Drive (4WD) Low Switch Circuit Range/Performance',
    short: '4WD low switch out of range',
    severity: 'caution',
  },
  P2773: {
    description: 'Four Wheel Drive (4WD) Low Switch Circuit Low',
    short: '4WD low switch low',
    severity: 'caution',
  },
  P2774: {
    description: 'Four Wheel Drive (4WD) Low Switch Circuit High',
    short: '4WD low switch high',
    severity: 'caution',
  },
  P2775: {
    description: 'Upshift Switch Circuit Range/Performance',
    short: 'Upshift switch out of range',
    severity: 'caution',
  },
  P2776: {
    description: 'Upshift Switch Circuit Low',
    short: 'Upshift switch low',
    severity: 'caution',
  },
  P2777: {
    description: 'Upshift Switch Circuit High',
    short: 'Upshift switch high',
    severity: 'caution',
  },
  P2778: {
    description: 'Upshift Switch Circuit Intermittent/Erratic',
    short: 'Upshift switch erratic',
    severity: 'caution',
  },
  P2779: {
    description: 'Downshift Switch Circuit Range/Performance',
    short: 'Downshift switch out of range',
    severity: 'caution',
  },
  P277A: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "B" Hydraulic Leakage',
    short: 'Aux trans pump B leak',
    severity: 'warning',
  },
  P277B: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "B" Driver Circuit Performance',
    short: 'Aux trans pump B driver fault',
    severity: 'warning',
  },
  P277C: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "B" Motor Stalled',
    short: 'Aux trans pump B stalled',
    severity: 'warning',
  },
  P277D: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "B" Motor Over Temperature',
    short: 'Aux trans pump B overheating',
    severity: 'warning',
  },
  P2780: {
    description: 'Downshift Switch Circuit Low',
    short: 'Downshift switch low',
    severity: 'caution',
  },
  P2781: {
    description: 'Downshift Switch Circuit High',
    short: 'Downshift switch high',
    severity: 'caution',
  },
  P2782: {
    description: 'Downshift Switch Circuit Intermittent/Erratic',
    short: 'Downshift switch erratic',
    severity: 'caution',
  },
  P2783: {
    description: 'Torque Converter Temperature Too High',
    short: 'Torque converter overheating',
    severity: 'critical',
  },
  P2784: {
    description: 'Input/Turbine Speed Sensor "A"/"B" Correlation',
    short: 'Input speed A/B mismatch',
    severity: 'warning',
  },
  P2785: {
    description: 'Clutch Actuator Temperature Too High',
    short: 'Clutch actuator overheating',
    severity: 'warning',
  },
  P2786: {
    description: 'Gear Shift Actuator Temperature Too High',
    short: 'Shift actuator overheating',
    severity: 'warning',
  },
  P2787: {
    description: 'Clutch Temperature Too High',
    short: 'Clutch overheating',
    severity: 'critical',
  },
  P2788: {
    description: 'Auto Shift Manual Adaptive Learning at Limit',
    short: 'Auto-manual learning at limit',
    severity: 'caution',
  },
  P2789: {
    description: 'Clutch "A" Adaptive Learning at Limit',
    short: 'Clutch A learning at limit',
    severity: 'caution',
  },
  P278A: {
    description: 'Kick Down Switch Circuit',
    short: 'Kickdown switch circuit',
    severity: 'caution',
  },
  P278B: {
    description: 'Kick Down Switch Circuit Range/Performance',
    short: 'Kickdown switch out of range',
    severity: 'caution',
  },
  P278C: {
    description: 'Kick Down Switch Circuit Low',
    short: 'Kickdown switch low',
    severity: 'caution',
  },
  P278D: {
    description: 'Kick Down Switch Circuit High',
    short: 'Kickdown switch high',
    severity: 'caution',
  },
  P278E: {
    description: 'Kick Down Switch Circuit Intermittent/Erratic',
    short: 'Kickdown switch erratic',
    severity: 'caution',
  },
  P278F: {
    description: 'Clutch "B" Adaptive Learning at Limit',
    short: 'Clutch B learning at limit',
    severity: 'caution',
  },
  P2790: {
    description: 'Gate Select Direction Circuit',
    short: 'Gate select circuit',
    severity: 'warning',
  },
  P2791: {
    description: 'Gate Select Direction Circuit Low',
    short: 'Gate select circuit low',
    severity: 'warning',
  },
  P2792: {
    description: 'Gate Select Direction Circuit High',
    short: 'Gate select circuit high',
    severity: 'warning',
  },
  P2793: {
    description: 'Gear Shift Direction Circuit',
    short: 'Shift direction circuit',
    severity: 'warning',
  },
  P2794: {
    description: 'Gear Shift Direction Circuit Low',
    short: 'Shift direction circuit low',
    severity: 'warning',
  },
  P2795: {
    description: 'Gear Shift Direction Circuit High',
    short: 'Shift direction circuit high',
    severity: 'warning',
  },
  P2796: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "A" Control Circuit/Open',
    short: 'Aux trans pump A circuit open',
    severity: 'warning',
  },
  P2797: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "A" Performance/Stuck Off',
    short: 'Aux trans pump A stuck off',
    severity: 'warning',
  },
  P2798: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "A" Control Circuit Low',
    short: 'Aux trans pump A low',
    severity: 'warning',
  },
  P2799: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "A" Control Circuit High',
    short: 'Aux trans pump A high',
    severity: 'warning',
  },
  P279A: {
    description: 'Transfer Case Gear High Incorrect Ratio',
    short: '4WD high range ratio wrong',
    severity: 'warning',
  },
  P279B: {
    description: 'Transfer Case Gear Low Incorrect Ratio',
    short: '4WD low range ratio wrong',
    severity: 'warning',
  },
  P279C: {
    description: 'Transfer Case Gear Neutral Incorrect Ratio',
    short: '4WD neutral range ratio wrong',
    severity: 'warning',
  },
  P279D: {
    description: 'Four Wheel Drive (4WD) Range Signal Circuit',
    short: '4WD range signal circuit',
    severity: 'caution',
  },
  P279E: {
    description: 'Four Wheel Drive (4WD) Range Signal Circuit Range/Performance',
    short: '4WD range signal out of range',
    severity: 'caution',
  },
  P279F: {
    description: 'Four Wheel Drive (4WD) Range Signal Circuit Low',
    short: '4WD range signal low',
    severity: 'caution',
  },
  P27A0: {
    description: 'Four Wheel Drive (4WD) Range Signal Circuit High',
    short: '4WD range signal high',
    severity: 'caution',
  },
  P27A1: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "A" Stuck On',
    short: 'Aux trans pump A stuck on',
    severity: 'warning',
  },
  P27A2: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "B" Control Circuit/Open',
    short: 'Aux trans pump B circuit open',
    severity: 'warning',
  },
  P27A3: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "B" Performance/Stuck Off',
    short: 'Aux trans pump B stuck off',
    severity: 'warning',
  },
  P27A4: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "B" Control Circuit Low',
    short: 'Aux trans pump B low',
    severity: 'warning',
  },
  P27A5: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "B" Control Circuit High',
    short: 'Aux trans pump B high',
    severity: 'warning',
  },
  P27A6: {
    description: 'Electric/Auxiliary Transmission Fluid Pump "B" Stuck On',
    short: 'Aux trans pump B stuck on',
    severity: 'warning',
  },
  P27A7: {
    description: 'Pressure Control Solenoid "A" Data Incompatible',
    short: 'Trans solenoid A data wrong',
    severity: 'warning',
  },
  P27A8: {
    description: 'Pressure Control Solenoid "B" Data Incompatible',
    short: 'Trans solenoid B data wrong',
    severity: 'warning',
  },
  P27A9: {
    description: 'Pressure Control Solenoid "C" Data Incompatible',
    short: 'Trans solenoid C data wrong',
    severity: 'warning',
  },
  P27AA: {
    description: 'Pressure Control Solenoid "D" Data Incompatible',
    short: 'Trans solenoid D data wrong',
    severity: 'warning',
  },
  P27AB: {
    description: 'Pressure Control Solenoid "E" Data Incompatible',
    short: 'Trans solenoid E data wrong',
    severity: 'warning',
  },
  P27AC: {
    description: 'Pressure Control Solenoid "F" Data Incompatible',
    short: 'Trans solenoid F data wrong',
    severity: 'warning',
  },
  P27AD: {
    description: 'Pressure Control Solenoid "G" Data Incompatible',
    short: 'Trans solenoid G data wrong',
    severity: 'warning',
  },
  P27AE: {
    description: 'Pressure Control Solenoid "H" Data Incompatible',
    short: 'Trans solenoid H data wrong',
    severity: 'warning',
  },
  P27AF: {
    description: 'Pressure Control Solenoid "J" Data Incompatible',
    short: 'Trans solenoid J data wrong',
    severity: 'warning',
  },
  P27B0: {
    description: 'Pressure Control Solenoid "K" Data Incompatible',
    short: 'Trans solenoid K data wrong',
    severity: 'warning',
  },

  // P28xx — transmission: range sensors, pressure control solenoids, shift forks, clutches
  P2800: {
    description: 'Transmission Range Sensor "B" Circuit (PRNDL Input)',
    short: 'Gear position sensor B circuit',
    severity: 'warning',
  },
  P2801: {
    description: 'Transmission Range Sensor "B" Circuit Range/Performance',
    short: 'Gear position sensor B fault',
    severity: 'warning',
  },
  P2802: {
    description: 'Transmission Range Sensor "B" Circuit Low',
    short: 'Gear position sensor B low',
    severity: 'warning',
  },
  P2803: {
    description: 'Transmission Range Sensor "B" Circuit High',
    short: 'Gear position sensor B high',
    severity: 'warning',
  },
  P2804: {
    description: 'Transmission Range Sensor "B" Circuit Intermittent',
    short: 'Gear position sensor B erratic',
    severity: 'warning',
  },
  P2805: {
    description: 'Transmission Range Sensor "A"/"B" Correlation',
    short: 'Gear sensors A/B mismatch',
    severity: 'warning',
  },
  P2806: {
    description: 'Transmission Range Sensor Alignment',
    short: 'Gear position sensor alignment',
    severity: 'warning',
  },
  P2807: {
    description: 'Pressure Control Solenoid "G"',
    short: 'Pressure solenoid G fault',
    severity: 'warning',
  },
  P2808: {
    description: 'Pressure Control Solenoid "G" Performance/Stuck Off',
    short: 'Pressure solenoid G stuck off',
    severity: 'warning',
  },
  P2809: {
    description: 'Pressure Control Solenoid "G" Stuck On',
    short: 'Pressure solenoid G stuck on',
    severity: 'warning',
  },
  P280A: {
    description: 'Transmission Range Sensor "A" Circuit Not Learned',
    short: 'Gear sensor A not learned',
    severity: 'warning',
  },
  P280B: {
    description: 'Transmission Range Sensor "B" Circuit Not Learned',
    short: 'Gear sensor B not learned',
    severity: 'warning',
  },
  P2810: {
    description: 'Pressure Control Solenoid "G" Electrical',
    short: 'Pressure solenoid G electrical',
    severity: 'warning',
  },
  P2811: {
    description: 'Pressure Control Solenoid "G" Intermittent',
    short: 'Pressure solenoid G erratic',
    severity: 'warning',
  },
  P2812: {
    description: 'Pressure Control Solenoid "G" Control Circuit/Open',
    short: 'Pressure solenoid G circuit open',
    severity: 'warning',
  },
  P2813: {
    description: 'Pressure Control Solenoid "G" Control Circuit Range/Performance',
    short: 'Pressure solenoid G out of range',
    severity: 'warning',
  },
  P2814: {
    description: 'Pressure Control Solenoid "G" Control Circuit Low',
    short: 'Pressure solenoid G low',
    severity: 'warning',
  },
  P2815: {
    description: 'Pressure Control Solenoid "G" Control Circuit High',
    short: 'Pressure solenoid G high',
    severity: 'warning',
  },
  P2816: {
    description: 'Pressure Control Solenoid "H"',
    short: 'Pressure solenoid H fault',
    severity: 'warning',
  },
  P2817: {
    description: 'Pressure Control Solenoid "H" Performance/Stuck Off',
    short: 'Pressure solenoid H stuck off',
    severity: 'warning',
  },
  P2818: {
    description: 'Pressure Control Solenoid "H" Stuck On',
    short: 'Pressure solenoid H stuck on',
    severity: 'warning',
  },
  P2819: {
    description: 'Pressure Control Solenoid "H" Electrical',
    short: 'Pressure solenoid H electrical',
    severity: 'warning',
  },
  P281A: {
    description: 'Pressure Control Solenoid "H" Intermittent',
    short: 'Pressure solenoid H erratic',
    severity: 'warning',
  },
  P281B: {
    description: 'Pressure Control Solenoid "H" Control Circuit/Open',
    short: 'Pressure solenoid H circuit open',
    severity: 'warning',
  },
  P281C: {
    description: 'Pressure Control Solenoid "H" Control Circuit Range/Performance',
    short: 'Pressure solenoid H out of range',
    severity: 'warning',
  },
  P281D: {
    description: 'Pressure Control Solenoid "H" Control Circuit Low',
    short: 'Pressure solenoid H low',
    severity: 'warning',
  },
  P281E: {
    description: 'Pressure Control Solenoid "H" Control Circuit High',
    short: 'Pressure solenoid H high',
    severity: 'warning',
  },
  P281F: {
    description: 'Pressure Control Solenoid "J"',
    short: 'Pressure solenoid J fault',
    severity: 'warning',
  },
  P2820: {
    description: 'Pressure Control Solenoid "J" Performance/Stuck Off',
    short: 'Pressure solenoid J stuck off',
    severity: 'warning',
  },
  P2821: {
    description: 'Pressure Control Solenoid "J" Stuck On',
    short: 'Pressure solenoid J stuck on',
    severity: 'warning',
  },
  P2822: {
    description: 'Pressure Control Solenoid "J" Electrical',
    short: 'Pressure solenoid J electrical',
    severity: 'warning',
  },
  P2823: {
    description: 'Pressure Control Solenoid "J" Intermittent',
    short: 'Pressure solenoid J erratic',
    severity: 'warning',
  },
  P2824: {
    description: 'Pressure Control Solenoid "J" Control Circuit/Open',
    short: 'Pressure solenoid J circuit open',
    severity: 'warning',
  },
  P2825: {
    description: 'Pressure Control Solenoid "J" Control Circuit Range/Performance',
    short: 'Pressure solenoid J out of range',
    severity: 'warning',
  },
  P2826: {
    description: 'Pressure Control Solenoid "J" Control Circuit Low',
    short: 'Pressure solenoid J low',
    severity: 'warning',
  },
  P2827: {
    description: 'Pressure Control Solenoid "J" Control Circuit High',
    short: 'Pressure solenoid J high',
    severity: 'warning',
  },
  P2828: {
    description: 'Pressure Control Solenoid "K"',
    short: 'Pressure solenoid K fault',
    severity: 'warning',
  },
  P2829: {
    description: 'Pressure Control Solenoid "K" Performance/Stuck Off',
    short: 'Pressure solenoid K stuck off',
    severity: 'warning',
  },
  P282A: {
    description: 'Pressure Control Solenoid "K" Stuck On',
    short: 'Pressure solenoid K stuck on',
    severity: 'warning',
  },
  P282B: {
    description: 'Pressure Control Solenoid "K" Electrical',
    short: 'Pressure solenoid K electrical',
    severity: 'warning',
  },
  P282C: {
    description: 'Pressure Control Solenoid "K" Intermittent',
    short: 'Pressure solenoid K erratic',
    severity: 'warning',
  },
  P282D: {
    description: 'Pressure Control Solenoid "K" Control Circuit/Open',
    short: 'Pressure solenoid K circuit open',
    severity: 'warning',
  },
  P282E: {
    description: 'Pressure Control Solenoid "K" Control Circuit Range/Performance',
    short: 'Pressure solenoid K out of range',
    severity: 'warning',
  },
  P282F: {
    description: 'Pressure Control Solenoid "K" Control Circuit Low',
    short: 'Pressure solenoid K low',
    severity: 'warning',
  },
  P2830: {
    description: 'Pressure Control Solenoid "K" Control Circuit High',
    short: 'Pressure solenoid K high',
    severity: 'warning',
  },
  P2831: {
    description: 'Shift Fork "A" Position Circuit',
    short: 'Shift fork A sensor circuit',
    severity: 'warning',
  },
  P2832: {
    description: 'Shift Fork "A" Position Circuit Range/Performance',
    short: 'Shift fork A sensor out of range',
    severity: 'warning',
  },
  P2833: {
    description: 'Shift Fork "A" Position Circuit Low',
    short: 'Shift fork A sensor low',
    severity: 'warning',
  },
  P2834: {
    description: 'Shift Fork "A" Position Circuit High',
    short: 'Shift fork A sensor high',
    severity: 'warning',
  },
  P2835: {
    description: 'Shift Fork "A" Position Circuit Intermittent',
    short: 'Shift fork A sensor erratic',
    severity: 'warning',
  },
  P2836: {
    description: 'Shift Fork "B" Position Circuit',
    short: 'Shift fork B sensor circuit',
    severity: 'warning',
  },
  P2837: {
    description: 'Shift Fork "B" Position Circuit Range/Performance',
    short: 'Shift fork B sensor out of range',
    severity: 'warning',
  },
  P2838: {
    description: 'Shift Fork "B" Position Circuit Low',
    short: 'Shift fork B sensor low',
    severity: 'warning',
  },
  P2839: {
    description: 'Shift Fork "B" Position Circuit High',
    short: 'Shift fork B sensor high',
    severity: 'warning',
  },
  P283A: {
    description: 'Shift Fork "B" Position Circuit Intermittent',
    short: 'Shift fork B sensor erratic',
    severity: 'warning',
  },
  P283B: {
    description: 'Shift Fork "C" Position Circuit',
    short: 'Shift fork C sensor circuit',
    severity: 'warning',
  },
  P283C: {
    description: 'Shift Fork "C" Position Circuit Range/Performance',
    short: 'Shift fork C sensor out of range',
    severity: 'warning',
  },
  P283D: {
    description: 'Shift Fork "C" Position Circuit Low',
    short: 'Shift fork C sensor low',
    severity: 'warning',
  },
  P283E: {
    description: 'Shift Fork "C" Position Circuit High',
    short: 'Shift fork C sensor high',
    severity: 'warning',
  },
  P283F: {
    description: 'Shift Fork "C" Position Circuit Intermittent',
    short: 'Shift fork C sensor erratic',
    severity: 'warning',
  },
  P2840: {
    description: 'Shift Fork "D" Position Circuit',
    short: 'Shift fork D sensor circuit',
    severity: 'warning',
  },
  P2841: {
    description: 'Shift Fork "D" Position Circuit Range/Performance',
    short: 'Shift fork D sensor out of range',
    severity: 'warning',
  },
  P2842: {
    description: 'Shift Fork "D" Position Circuit Low',
    short: 'Shift fork D sensor low',
    severity: 'warning',
  },
  P2843: {
    description: 'Shift Fork "D" Position Circuit High',
    short: 'Shift fork D sensor high',
    severity: 'warning',
  },
  P2844: {
    description: 'Shift Fork "D" Position Circuit Intermittent',
    short: 'Shift fork D sensor erratic',
    severity: 'warning',
  },
  P2845: {
    description: 'Shift Fork "A" Position Sensor Incorrect Neutral Position Indicated',
    short: 'Shift fork A neutral wrong',
    severity: 'warning',
  },
  P2846: {
    description: 'Shift Fork "B" Position Sensor Incorrect Neutral Position Indicated',
    short: 'Shift fork B neutral wrong',
    severity: 'warning',
  },
  P2847: {
    description: 'Shift Fork "C" Position Sensor Incorrect Neutral Position Indicated',
    short: 'Shift fork C neutral wrong',
    severity: 'warning',
  },
  P2848: {
    description: 'Shift Fork "D" Position Sensor Incorrect Neutral Position Indicated',
    short: 'Shift fork D neutral wrong',
    severity: 'warning',
  },
  P2849: {
    description: 'Shift Fork "A" Stuck',
    short: 'Shift fork A stuck',
    severity: 'warning',
  },
  P284A: {
    description: 'Shift Fork "B" Stuck',
    short: 'Shift fork B stuck',
    severity: 'warning',
  },
  P284B: {
    description: 'Shift Fork "C" Stuck',
    short: 'Shift fork C stuck',
    severity: 'warning',
  },
  P284C: {
    description: 'Shift Fork "D" Stuck',
    short: 'Shift fork D stuck',
    severity: 'warning',
  },
  P284D: {
    description: 'Shift Fork "A" Unrequested Movement',
    short: 'Shift fork A moved on its own',
    severity: 'warning',
  },
  P284E: {
    description: 'Shift Fork "B" Unrequested Movement',
    short: 'Shift fork B moved on its own',
    severity: 'warning',
  },
  P284F: {
    description: 'Shift Fork "C" Unrequested Movement',
    short: 'Shift fork C moved on its own',
    severity: 'warning',
  },
  P2850: {
    description: 'Shift Fork "D" Unrequested Movement',
    short: 'Shift fork D moved on its own',
    severity: 'warning',
  },
  P2851: {
    description: 'Shift Fork Position Sensor "A"/"B" Correlation',
    short: 'Shift fork A/B mismatch',
    severity: 'warning',
  },
  P2852: {
    description: 'Shift Fork Position Sensor "C"/"D" Correlation',
    short: 'Shift fork C/D mismatch',
    severity: 'warning',
  },
  P2853: {
    description: 'Clutch "A" Pressure Discharge Performance',
    short: 'Clutch A pressure release fault',
    severity: 'warning',
  },
  P2854: {
    description: 'Clutch "B" Pressure Discharge Performance',
    short: 'Clutch B pressure release fault',
    severity: 'warning',
  },
  P2855: {
    description: 'Clutch "A" Pressure Charge Performance',
    short: 'Clutch A pressure build fault',
    severity: 'warning',
  },
  P2856: {
    description: 'Clutch "B" Pressure Charge Performance',
    short: 'Clutch B pressure build fault',
    severity: 'warning',
  },
  P2857: {
    description: 'Clutch "A" Pressure Engagement Performance/Too Low',
    short: 'Clutch A engage pressure low',
    severity: 'warning',
  },
  P2858: {
    description: 'Clutch "B" Pressure Engagement Performance/Too Low',
    short: 'Clutch B engage pressure low',
    severity: 'warning',
  },
  P2859: {
    description: 'Clutch "A" Pressure Disengagement Performance/Too Low',
    short: 'Clutch A release pressure low',
    severity: 'warning',
  },
  P285A: {
    description: 'Clutch "B" Pressure Disengagement Performance/Too Low',
    short: 'Clutch B release pressure low',
    severity: 'warning',
  },
  P285B: {
    description: 'Shift Fork "A" Actuator Circuit/Open',
    short: 'Shift fork A actuator circuit',
    severity: 'warning',
  },
  P285C: {
    description: 'Shift Fork "A" Actuator Circuit Performance',
    short: 'Shift fork A actuator fault',
    severity: 'warning',
  },
  P285D: {
    description: 'Shift Fork "A" Actuator Circuit Low',
    short: 'Shift fork A actuator low',
    severity: 'warning',
  },
  P285E: {
    description: 'Shift Fork "A" Actuator Circuit High',
    short: 'Shift fork A actuator high',
    severity: 'warning',
  },
  P285F: {
    description: 'Shift Fork "B" Actuator Circuit/Open',
    short: 'Shift fork B actuator circuit',
    severity: 'warning',
  },
  P2860: {
    description: 'Shift Fork "B" Actuator Circuit Performance',
    short: 'Shift fork B actuator fault',
    severity: 'warning',
  },
  P2861: {
    description: 'Shift Fork "B" Actuator Circuit Low',
    short: 'Shift fork B actuator low',
    severity: 'warning',
  },
  P2862: {
    description: 'Shift Fork "B" Actuator Circuit High',
    short: 'Shift fork B actuator high',
    severity: 'warning',
  },
  P2863: {
    description: 'Shift Fork "E" Position Circuit',
    short: 'Shift fork E sensor circuit',
    severity: 'warning',
  },
  P2864: {
    description: 'Shift Fork "E" Position Circuit Range/Performance',
    short: 'Shift fork E sensor out of range',
    severity: 'warning',
  },
  P2865: {
    description: 'Shift Fork "E" Position Circuit Low',
    short: 'Shift fork E sensor low',
    severity: 'warning',
  },
  P2866: {
    description: 'Shift Fork "E" Position Circuit High',
    short: 'Shift fork E sensor high',
    severity: 'warning',
  },
  P2867: {
    description: 'Shift Fork "E" Position Circuit Intermittent',
    short: 'Shift fork E sensor erratic',
    severity: 'warning',
  },
  P2868: {
    description: 'Shift Fork "E" Position Sensor Incorrect Neutral Position Indicated',
    short: 'Shift fork E neutral wrong',
    severity: 'warning',
  },
  P2869: {
    description: 'Shift Fork "E" Stuck',
    short: 'Shift fork E stuck',
    severity: 'warning',
  },
  P286A: {
    description: 'Shift Fork "E" Unrequested Movement',
    short: 'Shift fork E moved on its own',
    severity: 'warning',
  },
  P286B: {
    description: 'Clutch "A" Pressure Engagement Too High',
    short: 'Clutch A engage pressure high',
    severity: 'warning',
  },
  P286C: {
    description: 'Clutch "A" Pressure Disengagement Too High',
    short: 'Clutch A release pressure high',
    severity: 'warning',
  },
  P286D: {
    description: 'Clutch "A" Engagement Time Performance/Too Slow',
    short: 'Clutch A engages too slowly',
    severity: 'warning',
  },
  P286E: {
    description: 'Clutch "A" Engagement Time Too Fast',
    short: 'Clutch A engages too fast',
    severity: 'warning',
  },
  P286F: {
    description: 'Clutch "A" Disengagement Time Performance/Too Slow',
    short: 'Clutch A releases too slowly',
    severity: 'warning',
  },
  P2870: {
    description: 'Clutch "A" Disengagement Time Too Fast',
    short: 'Clutch A releases too fast',
    severity: 'warning',
  },
  P2871: {
    description: 'Clutch "A" Performance/Stuck Disengaged',
    short: 'Clutch A stuck disengaged',
    severity: 'warning',
  },
  P2872: {
    description: 'Clutch "A" Stuck Engaged',
    short: 'Clutch A stuck engaged',
    severity: 'warning',
  },
  P2873: {
    description: 'Clutch "B" Pressure Engagement Too High',
    short: 'Clutch B engage pressure high',
    severity: 'warning',
  },
  P2874: {
    description: 'Clutch "B" Pressure Disengagement Too High',
    short: 'Clutch B release pressure high',
    severity: 'warning',
  },
  P2875: {
    description: 'Clutch "B" Engagement Time Performance/Too Slow',
    short: 'Clutch B engages too slowly',
    severity: 'warning',
  },
  P2876: {
    description: 'Clutch "B" Engagement Time Too Fast',
    short: 'Clutch B engages too fast',
    severity: 'warning',
  },
  P2877: {
    description: 'Clutch "B" Disengagement Time Performance/Too Slow',
    short: 'Clutch B releases too slowly',
    severity: 'warning',
  },
  P2878: {
    description: 'Clutch "B" Disengagement Time Too Fast',
    short: 'Clutch B releases too fast',
    severity: 'warning',
  },
  P2879: {
    description: 'Clutch "B" Performance/Stuck Disengaged',
    short: 'Clutch B stuck disengaged',
    severity: 'warning',
  },
  P287A: {
    description: 'Clutch "B" Stuck Engaged',
    short: 'Clutch B stuck engaged',
    severity: 'warning',
  },
  P287B: {
    description: 'Shift Fork Calibration Not Learned',
    short: 'Shift forks not calibrated',
    severity: 'warning',
  },
  P287C: {
    description: 'Transmission Adaptive Values Not Learned',
    short: 'Trans adaptation not learned',
    severity: 'caution',
  },
  P287D: {
    description: 'Electric/Auxiliary Transmission Fluid Pump Motor Torque Out Of Range',
    short: 'Aux trans pump torque wrong',
    severity: 'warning',
  },
  P287E: {
    description: 'Engine Disconnect Clutch Solenoid Circuit/Open',
    short: 'Engine clutch actuator circuit',
    severity: 'warning',
  },
  P287F: {
    description: 'Engine Disconnect Clutch Solenoid Circuit Range/Performance',
    short: 'Engine clutch actuator fault',
    severity: 'warning',
  },
  P2880: {
    description: 'Engine Disconnect Clutch Solenoid Circuit Low',
    short: 'Engine clutch actuator low',
    severity: 'warning',
  },
  P2881: {
    description: 'Engine Disconnect Clutch Solenoid Circuit High',
    short: 'Engine clutch actuator high',
    severity: 'warning',
  },
  P2882: {
    description: 'Engine Disconnect Clutch Excessive Slippage',
    short: 'Engine clutch slipping',
    severity: 'warning',
  },
  P2883: {
    description: 'Engine Disconnect Clutch Temperature Too High',
    short: 'Engine clutch overheating',
    severity: 'critical',
  },
  P2884: {
    description: 'Engine Disconnect Clutch Stuck Open',
    short: 'Engine clutch stuck open',
    severity: 'warning',
  },
  P2885: {
    description: 'Engine Disconnect Clutch Engagement Fault',
    short: 'Engine clutch engage fault',
    severity: 'warning',
  },
  P2886: {
    description: 'Engine Disconnect Clutch Stuck Closed',
    short: 'Engine clutch stuck closed',
    severity: 'warning',
  },

  // P2Axx — O2 sensors, manifold pressure sensor "B", injection pump, alternative fuel
  P2A00: {
    description: 'O2 Sensor Circuit Range/Performance (Bank 1 Sensor 1)',
    short: 'Upstream O2 sensor fault (B1)',
    severity: 'caution',
  },
  P2A01: {
    description: 'O2 Sensor Circuit Range/Performance (Bank 1 Sensor 2)',
    short: 'Downstream O2 sensor fault (B1)',
    severity: 'caution',
  },
  P2A02: {
    description: 'O2 Sensor Circuit Range/Performance (Bank 1 Sensor 3)',
    short: 'O2 sensor 3 fault (B1)',
    severity: 'caution',
  },
  P2A03: {
    description: 'O2 Sensor Circuit Range/Performance (Bank 2 Sensor 1)',
    short: 'Upstream O2 sensor fault (B2)',
    severity: 'caution',
  },
  P2A04: {
    description: 'O2 Sensor Circuit Range/Performance (Bank 2 Sensor 2)',
    short: 'Downstream O2 sensor fault (B2)',
    severity: 'caution',
  },
  P2A05: {
    description: 'O2 Sensor Circuit Range/Performance (Bank 2 Sensor 3)',
    short: 'O2 sensor 3 fault (B2)',
    severity: 'caution',
  },
  P2A06: {
    description: 'O2 Sensor Negative Voltage (Bank 1 Sensor 1)',
    short: 'Upstream O2 below 0 V (B1)',
    severity: 'caution',
  },
  P2A07: {
    description: 'O2 Sensor Negative Voltage (Bank 1 Sensor 2)',
    short: 'Downstream O2 below 0 V (B1)',
    severity: 'caution',
  },
  P2A08: {
    description: 'O2 Sensor Negative Voltage (Bank 1 Sensor 3)',
    short: 'O2 sensor 3 below 0 V (B1)',
    severity: 'caution',
  },
  P2A09: {
    description: 'O2 Sensor Negative Voltage (Bank 2 Sensor 1)',
    short: 'Upstream O2 below 0 V (B2)',
    severity: 'caution',
  },
  P2A0A: {
    description: 'Manifold Absolute Pressure Sensor "B" Circuit',
    short: 'Intake pressure sensor B circuit',
    severity: 'caution',
  },
  P2A0B: {
    description: 'Manifold Absolute Pressure Sensor "B" Circuit Range/Performance',
    short: 'Intake pressure sensor B fault',
    severity: 'caution',
  },
  P2A0C: {
    description: 'Manifold Absolute Pressure Sensor "B" Circuit Low',
    short: 'Intake pressure sensor B low',
    severity: 'caution',
  },
  P2A0D: {
    description: 'Manifold Absolute Pressure Sensor "B" Circuit High',
    short: 'Intake pressure sensor B high',
    severity: 'caution',
  },
  P2A0E: {
    description: 'Manifold Absolute Pressure Sensor "B" Circuit Intermittent/Erratic',
    short: 'Intake pressure sensor B erratic',
    severity: 'caution',
  },
  P2A10: {
    description: 'O2 Sensor Negative Voltage (Bank 2 Sensor 2)',
    short: 'Downstream O2 below 0 V (B2)',
    severity: 'caution',
  },
  P2A11: {
    description: 'O2 Sensor Negative Voltage (Bank 2 Sensor 3)',
    short: 'O2 sensor 3 below 0 V (B2)',
    severity: 'caution',
  },
  P2A12: {
    description: 'Injection Pump Fuel Metering Control "C" (Cam/Rotor/Injector)',
    short: 'Injection pump control C circuit',
    severity: 'warning',
  },
  P2A13: {
    description: 'Injection Pump Fuel Metering Control "C" Range/Performance (Cam/Rotor/Injector)',
    short: 'Injection pump control C fault',
    severity: 'warning',
  },
  P2A14: {
    description: 'Injection Pump Fuel Metering Control "C" Low (Cam/Rotor/Injector)',
    short: 'Injection pump control C low',
    severity: 'warning',
  },
  P2A15: {
    description: 'Injection Pump Fuel Metering Control "C" High (Cam/Rotor/Injector)',
    short: 'Injection pump control C high',
    severity: 'warning',
  },
  P2A16: {
    description: 'Injection Pump Fuel Metering Control "D" (Cam/Rotor/Injector)',
    short: 'Injection pump control D circuit',
    severity: 'warning',
  },
  P2A17: {
    description: 'Injection Pump Fuel Metering Control "D" Range/Performance (Cam/Rotor/Injector)',
    short: 'Injection pump control D fault',
    severity: 'warning',
  },
  P2A18: {
    description: 'Injection Pump Fuel Metering Control "D" Low (Cam/Rotor/Injector)',
    short: 'Injection pump control D low',
    severity: 'warning',
  },
  P2A19: {
    description: 'Injection Pump Fuel Metering Control "D" High (Cam/Rotor/Injector)',
    short: 'Injection pump control D high',
    severity: 'warning',
  },
  P2A1A: {
    description: 'Injection Pump Fuel Metering Control "E" (Cam/Rotor/Injector)',
    short: 'Injection pump control E circuit',
    severity: 'warning',
  },
  P2A1B: {
    description: 'Injection Pump Fuel Metering Control "E" Range/Performance (Cam/Rotor/Injector)',
    short: 'Injection pump control E fault',
    severity: 'warning',
  },
  P2A1C: {
    description: 'Injection Pump Fuel Metering Control "E" Low (Cam/Rotor/Injector)',
    short: 'Injection pump control E low',
    severity: 'warning',
  },
  P2A1D: {
    description: 'Injection Pump Fuel Metering Control "E" High (Cam/Rotor/Injector)',
    short: 'Injection pump control E high',
    severity: 'warning',
  },
  P2A1E: {
    description: 'Injection Pump Fuel Metering Control "F" (Cam/Rotor/Injector)',
    short: 'Injection pump control F circuit',
    severity: 'warning',
  },
  P2A1F: {
    description: 'Injection Pump Fuel Metering Control "F" Range/Performance (Cam/Rotor/Injector)',
    short: 'Injection pump control F fault',
    severity: 'warning',
  },
  P2A20: {
    description: 'Injection Pump Fuel Metering Control "F" Low (Cam/Rotor/Injector)',
    short: 'Injection pump control F low',
    severity: 'warning',
  },
  P2A21: {
    description: 'Injection Pump Fuel Metering Control "F" High (Cam/Rotor/Injector)',
    short: 'Injection pump control F high',
    severity: 'warning',
  },
  P2A22: {
    description: 'Alternative Fuel Tank Shutoff Valve "B" Control Circuit/Open',
    short: 'Alt-fuel tank valve B circuit',
    severity: 'warning',
  },
  P2A23: {
    description: 'Alternative Fuel Tank Shutoff Valve "B" Control Circuit Range/Performance',
    short: 'Alt-fuel tank valve B fault',
    severity: 'warning',
  },
  P2A24: {
    description: 'Alternative Fuel Tank Shutoff Valve "B" Control Circuit Low',
    short: 'Alt-fuel tank valve B low',
    severity: 'warning',
  },
  P2A25: {
    description: 'Alternative Fuel Tank Shutoff Valve "B" Control Circuit High',
    short: 'Alt-fuel tank valve B high',
    severity: 'warning',
  },
  P2A26: {
    description: 'Alternative Fuel Tank Shutoff Valve "C" Control Circuit/Open',
    short: 'Alt-fuel tank valve C circuit',
    severity: 'warning',
  },
  P2A27: {
    description: 'Alternative Fuel Tank Shutoff Valve "C" Control Circuit Range/Performance',
    short: 'Alt-fuel tank valve C fault',
    severity: 'warning',
  },
  P2A28: {
    description: 'Alternative Fuel Tank Shutoff Valve "C" Control Circuit Low',
    short: 'Alt-fuel tank valve C low',
    severity: 'warning',
  },
  P2A29: {
    description: 'Alternative Fuel Tank Shutoff Valve "C" Control Circuit High',
    short: 'Alt-fuel tank valve C high',
    severity: 'warning',
  },
  P2A2A: {
    description: 'Alternative Fuel Tank Shutoff Valve "D" Control Circuit/Open',
    short: 'Alt-fuel tank valve D circuit',
    severity: 'warning',
  },
  P2A2B: {
    description: 'Alternative Fuel Tank Shutoff Valve "D" Control Circuit Range/Performance',
    short: 'Alt-fuel tank valve D fault',
    severity: 'warning',
  },
  P2A2C: {
    description: 'Alternative Fuel Tank Shutoff Valve "D" Control Circuit Low',
    short: 'Alt-fuel tank valve D low',
    severity: 'warning',
  },
  P2A2D: {
    description: 'Alternative Fuel Tank Shutoff Valve "D" Control Circuit High',
    short: 'Alt-fuel tank valve D high',
    severity: 'warning',
  },
  P2A2E: {
    description: 'Alternative Fuel Tank Shutoff Valve "E" Control Circuit/Open',
    short: 'Alt-fuel tank valve E circuit',
    severity: 'warning',
  },
  P2A2F: {
    description: 'Alternative Fuel Tank Shutoff Valve "E" Control Circuit Range/Performance',
    short: 'Alt-fuel tank valve E fault',
    severity: 'warning',
  },
  P2A30: {
    description: 'Alternative Fuel Tank Shutoff Valve "E" Control Circuit Low',
    short: 'Alt-fuel tank valve E low',
    severity: 'warning',
  },
  P2A31: {
    description: 'Alternative Fuel Tank Shutoff Valve "E" Control Circuit High',
    short: 'Alt-fuel tank valve E high',
    severity: 'warning',
  },
  P2A32: {
    description: 'AFCM Power Relay Control Circuit/Open',
    short: 'Alt-fuel module relay circuit',
    severity: 'warning',
  },
  P2A33: {
    description: 'AFCM Power Relay Control Circuit Low',
    short: 'Alt-fuel module relay low',
    severity: 'warning',
  },
  P2A34: {
    description: 'AFCM Power Relay Control Circuit High',
    short: 'Alt-fuel module relay high',
    severity: 'warning',
  },
  P2A35: {
    description: 'AFCM Power Relay Sense Circuit',
    short: 'Alt-fuel module relay sense',
    severity: 'warning',
  },
  P2A36: {
    description: 'AFCM Power Relay Sense Circuit Low',
    short: 'Alt-fuel module relay sense low',
    severity: 'warning',
  },
  P2A37: {
    description: 'AFCM Power Relay Sense Circuit High',
    short: 'Alt-fuel module relay sense high',
    severity: 'warning',
  },

  // P2Bxx — NOx exceedence and driver inducement
  P2BA7: {
    description: 'NOx Exceedence - Empty Reagent Tank',
    short: 'NOx high: DEF tank empty',
    severity: 'warning',
  },
  P2BA8: {
    description: 'NOx Exceedence - Interruption of Reagent Dosing Activity',
    short: 'NOx high: DEF dosing stopped',
    severity: 'warning',
  },
  P2BA9: {
    description: 'NOx Exceedence - Insufficient Reagent Quality',
    short: 'NOx high: poor DEF quality',
    severity: 'warning',
  },
  P2BAA: {
    description: 'NOx Exceedence - Low Reagent Consumption',
    short: 'NOx high: DEF use too low',
    severity: 'warning',
  },
  P2BAB: {
    description: 'NOx Exceedence - Incorrect Exhaust Gas Recirculation Flow',
    short: 'NOx high: wrong EGR flow',
    severity: 'warning',
  },
  P2BAC: {
    description: 'NOx Exceedence - Deactivation of Exhaust Gas Recirculation',
    short: 'NOx high: EGR disabled',
    severity: 'warning',
  },
  P2BAD: {
    description: 'NOx Exceedence - Root Cause Unknown',
    short: 'NOx too high, cause unknown',
    severity: 'warning',
  },
  P2BAE: {
    description: 'NOx Exceedence - NOx Control Monitoring System',
    short: 'NOx high: monitor fault',
    severity: 'warning',
  },
  P2BAF: {
    description: 'NOx System Driver Inducement Active',
    short: 'Emissions power limit active',
    severity: 'warning',
  },

  // P34xx — cylinder deactivation
  P3400: {
    description: 'Cylinder Deactivation System (Bank 1)',
    short: 'Cylinder deactivation fault (B1)',
    severity: 'caution',
  },
  P3401: {
    description: 'Cylinder 1 Deactivation/Intake Valve Control Circuit/Open',
    short: 'Cyl 1 deactivation circuit open',
    severity: 'caution',
  },
  P3402: {
    description: 'Cylinder 1 Deactivation/Intake Valve Control Circuit Performance',
    short: 'Cyl 1 deactivation fault',
    severity: 'caution',
  },
  P3403: {
    description: 'Cylinder 1 Deactivation/Intake Valve Control Circuit Low',
    short: 'Cyl 1 deactivation low',
    severity: 'caution',
  },
  P3404: {
    description: 'Cylinder 1 Deactivation/Intake Valve Control Circuit High',
    short: 'Cyl 1 deactivation high',
    severity: 'caution',
  },
  P3405: {
    description: 'Cylinder 1 Exhaust Valve Control Circuit/Open',
    short: 'Cyl 1 exhaust valve circuit',
    severity: 'caution',
  },
  P3406: {
    description: 'Cylinder 1 Exhaust Valve Control Circuit Performance',
    short: 'Cyl 1 exhaust valve fault',
    severity: 'caution',
  },
  P3407: {
    description: 'Cylinder 1 Exhaust Valve Control Circuit Low',
    short: 'Cyl 1 exhaust valve low',
    severity: 'caution',
  },
  P3408: {
    description: 'Cylinder 1 Exhaust Valve Control Circuit High',
    short: 'Cyl 1 exhaust valve high',
    severity: 'caution',
  },
  P3409: {
    description: 'Cylinder 2 Deactivation/Intake Valve Control Circuit/Open',
    short: 'Cyl 2 deactivation circuit open',
    severity: 'caution',
  },
  P340A: {
    description: 'Deactivation/Intake Valve Control Circuit (Bank 1)',
    short: 'Intake valve deactivation (B1)',
    severity: 'caution',
  },
  P340B: {
    description: 'Deactivation/Intake Valve Control Circuit (Bank 2)',
    short: 'Intake valve deactivation (B2)',
    severity: 'caution',
  },
  P340C: {
    description: 'Deactivation/Exhaust Valve Control Circuit (Bank 1)',
    short: 'Exhaust valve deactivation (B1)',
    severity: 'caution',
  },
  P340D: {
    description: 'Deactivation/Exhaust Valve Control Circuit (Bank 2)',
    short: 'Exhaust valve deactivation (B2)',
    severity: 'caution',
  },
  P3410: {
    description: 'Cylinder 2 Deactivation/Intake Valve Control Circuit Performance',
    short: 'Cyl 2 deactivation fault',
    severity: 'caution',
  },
  P3411: {
    description: 'Cylinder 2 Deactivation/Intake Valve Control Circuit Low',
    short: 'Cyl 2 deactivation low',
    severity: 'caution',
  },
  P3412: {
    description: 'Cylinder 2 Deactivation/Intake Valve Control Circuit High',
    short: 'Cyl 2 deactivation high',
    severity: 'caution',
  },
  P3413: {
    description: 'Cylinder 2 Exhaust Valve Control Circuit/Open',
    short: 'Cyl 2 exhaust valve circuit',
    severity: 'caution',
  },
  P3414: {
    description: 'Cylinder 2 Exhaust Valve Control Circuit Performance',
    short: 'Cyl 2 exhaust valve fault',
    severity: 'caution',
  },
  P3415: {
    description: 'Cylinder 2 Exhaust Valve Control Circuit Low',
    short: 'Cyl 2 exhaust valve low',
    severity: 'caution',
  },
  P3416: {
    description: 'Cylinder 2 Exhaust Valve Control Circuit High',
    short: 'Cyl 2 exhaust valve high',
    severity: 'caution',
  },
  P3417: {
    description: 'Cylinder 3 Deactivation/Intake Valve Control Circuit/Open',
    short: 'Cyl 3 deactivation circuit open',
    severity: 'caution',
  },
  P3418: {
    description: 'Cylinder 3 Deactivation/Intake Valve Control Circuit Performance',
    short: 'Cyl 3 deactivation fault',
    severity: 'caution',
  },
  P3419: {
    description: 'Cylinder 3 Deactivation/Intake Valve Control Circuit Low',
    short: 'Cyl 3 deactivation low',
    severity: 'caution',
  },
  P341A: {
    description: 'Deactivation/Intake Valve Control Circuit Performance (Bank 1)',
    short: 'Intake valve deact. fault (B1)',
    severity: 'caution',
  },
  P341B: {
    description: 'Deactivation/Intake Valve Control Circuit Performance (Bank 2)',
    short: 'Intake valve deact. fault (B2)',
    severity: 'caution',
  },
  P341C: {
    description: 'Deactivation/Exhaust Valve Control Circuit Performance (Bank 1)',
    short: 'Exhaust valve deact. fault (B1)',
    severity: 'caution',
  },
  P341D: {
    description: 'Deactivation/Exhaust Valve Control Circuit Performance (Bank 2)',
    short: 'Exhaust valve deact. fault (B2)',
    severity: 'caution',
  },
  P3420: {
    description: 'Cylinder 3 Deactivation/Intake Valve Control Circuit High',
    short: 'Cyl 3 deactivation high',
    severity: 'caution',
  },
  P3421: {
    description: 'Cylinder 3 Exhaust Valve Control Circuit/Open',
    short: 'Cyl 3 exhaust valve circuit',
    severity: 'caution',
  },
  P3422: {
    description: 'Cylinder 3 Exhaust Valve Control Circuit Performance',
    short: 'Cyl 3 exhaust valve fault',
    severity: 'caution',
  },
  P3423: {
    description: 'Cylinder 3 Exhaust Valve Control Circuit Low',
    short: 'Cyl 3 exhaust valve low',
    severity: 'caution',
  },
  P3424: {
    description: 'Cylinder 3 Exhaust Valve Control Circuit High',
    short: 'Cyl 3 exhaust valve high',
    severity: 'caution',
  },
  P3425: {
    description: 'Cylinder 4 Deactivation/Intake Valve Control Circuit/Open',
    short: 'Cyl 4 deactivation circuit open',
    severity: 'caution',
  },
  P3426: {
    description: 'Cylinder 4 Deactivation/Intake Valve Control Circuit Performance',
    short: 'Cyl 4 deactivation fault',
    severity: 'caution',
  },
  P3427: {
    description: 'Cylinder 4 Deactivation/Intake Valve Control Circuit Low',
    short: 'Cyl 4 deactivation low',
    severity: 'caution',
  },
  P3428: {
    description: 'Cylinder 4 Deactivation/Intake Valve Control Circuit High',
    short: 'Cyl 4 deactivation high',
    severity: 'caution',
  },
  P3429: {
    description: 'Cylinder 4 Exhaust Valve Control Circuit/Open',
    short: 'Cyl 4 exhaust valve circuit',
    severity: 'caution',
  },
  P3430: {
    description: 'Cylinder 4 Exhaust Valve Control Circuit Performance',
    short: 'Cyl 4 exhaust valve fault',
    severity: 'caution',
  },
  P3431: {
    description: 'Cylinder 4 Exhaust Valve Control Circuit Low',
    short: 'Cyl 4 exhaust valve low',
    severity: 'caution',
  },
  P3432: {
    description: 'Cylinder 4 Exhaust Valve Control Circuit High',
    short: 'Cyl 4 exhaust valve high',
    severity: 'caution',
  },
  P3433: {
    description: 'Cylinder 5 Deactivation/Intake Valve Control Circuit/Open',
    short: 'Cyl 5 deactivation circuit open',
    severity: 'caution',
  },
  P3434: {
    description: 'Cylinder 5 Deactivation/Intake Valve Control Circuit Performance',
    short: 'Cyl 5 deactivation fault',
    severity: 'caution',
  },
  P3435: {
    description: 'Cylinder 5 Deactivation/Intake Valve Control Circuit Low',
    short: 'Cyl 5 deactivation low',
    severity: 'caution',
  },
  P3436: {
    description: 'Cylinder 5 Deactivation/Intake Valve Control Circuit High',
    short: 'Cyl 5 deactivation high',
    severity: 'caution',
  },
  P3437: {
    description: 'Cylinder 5 Exhaust Valve Control Circuit/Open',
    short: 'Cyl 5 exhaust valve circuit',
    severity: 'caution',
  },
  P3438: {
    description: 'Cylinder 5 Exhaust Valve Control Circuit Performance',
    short: 'Cyl 5 exhaust valve fault',
    severity: 'caution',
  },
  P3439: {
    description: 'Cylinder 5 Exhaust Valve Control Circuit Low',
    short: 'Cyl 5 exhaust valve low',
    severity: 'caution',
  },
  P3440: {
    description: 'Cylinder 5 Exhaust Valve Control Circuit High',
    short: 'Cyl 5 exhaust valve high',
    severity: 'caution',
  },
  P3441: {
    description: 'Cylinder 6 Deactivation/Intake Valve Control Circuit/Open',
    short: 'Cyl 6 deactivation circuit open',
    severity: 'caution',
  },
  P3442: {
    description: 'Cylinder 6 Deactivation/Intake Valve Control Circuit Performance',
    short: 'Cyl 6 deactivation fault',
    severity: 'caution',
  },
  P3443: {
    description: 'Cylinder 6 Deactivation/Intake Valve Control Circuit Low',
    short: 'Cyl 6 deactivation low',
    severity: 'caution',
  },
  P3444: {
    description: 'Cylinder 6 Deactivation/Intake Valve Control Circuit High',
    short: 'Cyl 6 deactivation high',
    severity: 'caution',
  },
  P3445: {
    description: 'Cylinder 6 Exhaust Valve Control Circuit/Open',
    short: 'Cyl 6 exhaust valve circuit',
    severity: 'caution',
  },
  P3446: {
    description: 'Cylinder 6 Exhaust Valve Control Circuit Performance',
    short: 'Cyl 6 exhaust valve fault',
    severity: 'caution',
  },
  P3447: {
    description: 'Cylinder 6 Exhaust Valve Control Circuit Low',
    short: 'Cyl 6 exhaust valve low',
    severity: 'caution',
  },
  P3448: {
    description: 'Cylinder 6 Exhaust Valve Control Circuit High',
    short: 'Cyl 6 exhaust valve high',
    severity: 'caution',
  },
  P3449: {
    description: 'Cylinder 7 Deactivation/Intake Valve Control Circuit/Open',
    short: 'Cyl 7 deactivation circuit open',
    severity: 'caution',
  },
  P3450: {
    description: 'Cylinder 7 Deactivation/Intake Valve Control Circuit Performance',
    short: 'Cyl 7 deactivation fault',
    severity: 'caution',
  },
  P3451: {
    description: 'Cylinder 7 Deactivation/Intake Valve Control Circuit Low',
    short: 'Cyl 7 deactivation low',
    severity: 'caution',
  },
  P3452: {
    description: 'Cylinder 7 Deactivation/Intake Valve Control Circuit High',
    short: 'Cyl 7 deactivation high',
    severity: 'caution',
  },
  P3453: {
    description: 'Cylinder 7 Exhaust Valve Control Circuit/Open',
    short: 'Cyl 7 exhaust valve circuit',
    severity: 'caution',
  },
  P3454: {
    description: 'Cylinder 7 Exhaust Valve Control Circuit Performance',
    short: 'Cyl 7 exhaust valve fault',
    severity: 'caution',
  },
  P3455: {
    description: 'Cylinder 7 Exhaust Valve Control Circuit Low',
    short: 'Cyl 7 exhaust valve low',
    severity: 'caution',
  },
  P3456: {
    description: 'Cylinder 7 Exhaust Valve Control Circuit High',
    short: 'Cyl 7 exhaust valve high',
    severity: 'caution',
  },
  P3457: {
    description: 'Cylinder 8 Deactivation/Intake Valve Control Circuit/Open',
    short: 'Cyl 8 deactivation circuit open',
    severity: 'caution',
  },
  P3458: {
    description: 'Cylinder 8 Deactivation/Intake Valve Control Circuit Performance',
    short: 'Cyl 8 deactivation fault',
    severity: 'caution',
  },
  P3459: {
    description: 'Cylinder 8 Deactivation/Intake Valve Control Circuit Low',
    short: 'Cyl 8 deactivation low',
    severity: 'caution',
  },
  P3460: {
    description: 'Cylinder 8 Deactivation/Intake Valve Control Circuit High',
    short: 'Cyl 8 deactivation high',
    severity: 'caution',
  },
  P3461: {
    description: 'Cylinder 8 Exhaust Valve Control Circuit/Open',
    short: 'Cyl 8 exhaust valve circuit',
    severity: 'caution',
  },
  P3462: {
    description: 'Cylinder 8 Exhaust Valve Control Circuit Performance',
    short: 'Cyl 8 exhaust valve fault',
    severity: 'caution',
  },
  P3463: {
    description: 'Cylinder 8 Exhaust Valve Control Circuit Low',
    short: 'Cyl 8 exhaust valve low',
    severity: 'caution',
  },
  P3464: {
    description: 'Cylinder 8 Exhaust Valve Control Circuit High',
    short: 'Cyl 8 exhaust valve high',
    severity: 'caution',
  },
  P3465: {
    description: 'Cylinder 9 Deactivation/Intake Valve Control Circuit/Open',
    short: 'Cyl 9 deactivation circuit open',
    severity: 'caution',
  },
  P3466: {
    description: 'Cylinder 9 Deactivation/Intake Valve Control Circuit Performance',
    short: 'Cyl 9 deactivation fault',
    severity: 'caution',
  },
  P3467: {
    description: 'Cylinder 9 Deactivation/Intake Valve Control Circuit Low',
    short: 'Cyl 9 deactivation low',
    severity: 'caution',
  },
  P3468: {
    description: 'Cylinder 9 Deactivation/Intake Valve Control Circuit High',
    short: 'Cyl 9 deactivation high',
    severity: 'caution',
  },
  P3469: {
    description: 'Cylinder 9 Exhaust Valve Control Circuit/Open',
    short: 'Cyl 9 exhaust valve circuit',
    severity: 'caution',
  },
  P3470: {
    description: 'Cylinder 9 Exhaust Valve Control Circuit Performance',
    short: 'Cyl 9 exhaust valve fault',
    severity: 'caution',
  },
  P3471: {
    description: 'Cylinder 9 Exhaust Valve Control Circuit Low',
    short: 'Cyl 9 exhaust valve low',
    severity: 'caution',
  },
  P3472: {
    description: 'Cylinder 9 Exhaust Valve Control Circuit High',
    short: 'Cyl 9 exhaust valve high',
    severity: 'caution',
  },
  P3473: {
    description: 'Cylinder 10 Deactivation/Intake Valve Control Circuit/Open',
    short: 'Cyl 10 deactivation circuit open',
    severity: 'caution',
  },
  P3474: {
    description: 'Cylinder 10 Deactivation/Intake Valve Control Circuit Performance',
    short: 'Cyl 10 deactivation fault',
    severity: 'caution',
  },
  P3475: {
    description: 'Cylinder 10 Deactivation/Intake Valve Control Circuit Low',
    short: 'Cyl 10 deactivation low',
    severity: 'caution',
  },
  P3476: {
    description: 'Cylinder 10 Deactivation/Intake Valve Control Circuit High',
    short: 'Cyl 10 deactivation high',
    severity: 'caution',
  },
  P3477: {
    description: 'Cylinder 10 Exhaust Valve Control Circuit/Open',
    short: 'Cyl 10 exhaust valve circuit',
    severity: 'caution',
  },
  P3478: {
    description: 'Cylinder 10 Exhaust Valve Control Circuit Performance',
    short: 'Cyl 10 exhaust valve fault',
    severity: 'caution',
  },
  P3479: {
    description: 'Cylinder 10 Exhaust Valve Control Circuit Low',
    short: 'Cyl 10 exhaust valve low',
    severity: 'caution',
  },
  P3480: {
    description: 'Cylinder 10 Exhaust Valve Control Circuit High',
    short: 'Cyl 10 exhaust valve high',
    severity: 'caution',
  },
  P3481: {
    description: 'Cylinder 11 Deactivation/Intake Valve Control Circuit/Open',
    short: 'Cyl 11 deactivation circuit open',
    severity: 'caution',
  },
  P3482: {
    description: 'Cylinder 11 Deactivation/Intake Valve Control Circuit Performance',
    short: 'Cyl 11 deactivation fault',
    severity: 'caution',
  },
  P3483: {
    description: 'Cylinder 11 Deactivation/Intake Valve Control Circuit Low',
    short: 'Cyl 11 deactivation low',
    severity: 'caution',
  },
  P3484: {
    description: 'Cylinder 11 Deactivation/Intake Valve Control Circuit High',
    short: 'Cyl 11 deactivation high',
    severity: 'caution',
  },
  P3485: {
    description: 'Cylinder 11 Exhaust Valve Control Circuit/Open',
    short: 'Cyl 11 exhaust valve circuit',
    severity: 'caution',
  },
  P3486: {
    description: 'Cylinder 11 Exhaust Valve Control Circuit Performance',
    short: 'Cyl 11 exhaust valve fault',
    severity: 'caution',
  },
  P3487: {
    description: 'Cylinder 11 Exhaust Valve Control Circuit Low',
    short: 'Cyl 11 exhaust valve low',
    severity: 'caution',
  },
  P3488: {
    description: 'Cylinder 11 Exhaust Valve Control Circuit High',
    short: 'Cyl 11 exhaust valve high',
    severity: 'caution',
  },
  P3489: {
    description: 'Cylinder 12 Deactivation/Intake Valve Control Circuit/Open',
    short: 'Cyl 12 deactivation circuit open',
    severity: 'caution',
  },
  P3490: {
    description: 'Cylinder 12 Deactivation/Intake Valve Control Circuit Performance',
    short: 'Cyl 12 deactivation fault',
    severity: 'caution',
  },
  P3491: {
    description: 'Cylinder 12 Deactivation/Intake Valve Control Circuit Low',
    short: 'Cyl 12 deactivation low',
    severity: 'caution',
  },
  P3492: {
    description: 'Cylinder 12 Deactivation/Intake Valve Control Circuit High',
    short: 'Cyl 12 deactivation high',
    severity: 'caution',
  },
  P3493: {
    description: 'Cylinder 12 Exhaust Valve Control Circuit/Open',
    short: 'Cyl 12 exhaust valve circuit',
    severity: 'caution',
  },
  P3494: {
    description: 'Cylinder 12 Exhaust Valve Control Circuit Performance',
    short: 'Cyl 12 exhaust valve fault',
    severity: 'caution',
  },
  P3495: {
    description: 'Cylinder 12 Exhaust Valve Control Circuit Low',
    short: 'Cyl 12 exhaust valve low',
    severity: 'caution',
  },
  P3496: {
    description: 'Cylinder 12 Exhaust Valve Control Circuit High',
    short: 'Cyl 12 exhaust valve high',
    severity: 'caution',
  },
  P3497: {
    description: 'Cylinder Deactivation System (Bank 2)',
    short: 'Cylinder deactivation fault (B2)',
    severity: 'caution',
  },
  P3498: {
    description: 'Cylinder 1 Deactivation Performance',
    short: 'Cylinder 1 deactivation fault',
    severity: 'caution',
  },
  P3499: {
    description: 'Cylinder 2 Deactivation Performance',
    short: 'Cylinder 2 deactivation fault',
    severity: 'caution',
  },
  P349A: {
    description: 'Cylinder 3 Deactivation Performance',
    short: 'Cylinder 3 deactivation fault',
    severity: 'caution',
  },
  P349B: {
    description: 'Cylinder 4 Deactivation Performance',
    short: 'Cylinder 4 deactivation fault',
    severity: 'caution',
  },
  P349C: {
    description: 'Cylinder 5 Deactivation Performance',
    short: 'Cylinder 5 deactivation fault',
    severity: 'caution',
  },
  P349D: {
    description: 'Cylinder 6 Deactivation Performance',
    short: 'Cylinder 6 deactivation fault',
    severity: 'caution',
  },
  P349E: {
    description: 'Cylinder 7 Deactivation Performance',
    short: 'Cylinder 7 deactivation fault',
    severity: 'caution',
  },
  P349F: {
    description: 'Cylinder 8 Deactivation Performance',
    short: 'Cylinder 8 deactivation fault',
    severity: 'caution',
  },
  P34A0: {
    description: 'Cylinder 9 Deactivation Performance',
    short: 'Cylinder 9 deactivation fault',
    severity: 'caution',
  },
  P34A1: {
    description: 'Cylinder 10 Deactivation Performance',
    short: 'Cylinder 10 deactivation fault',
    severity: 'caution',
  },
  P34A2: {
    description: 'Cylinder 11 Deactivation Performance',
    short: 'Cylinder 11 deactivation fault',
    severity: 'caution',
  },
  P34A3: {
    description: 'Cylinder 12 Deactivation Performance',
    short: 'Cylinder 12 deactivation fault',
    severity: 'caution',
  },
};
