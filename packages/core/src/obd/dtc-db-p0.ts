import type { DtcDbEntry } from './dtc-database.ts';

/**
 * Generic powertrain codes P0000–P0FFF (SAE J2012).
 *
 * Coverage: every defined code P0001–P0999, the hybrid/EV block P0A00–P0AFF, and a curated set of
 * hex-lettered codes from later J2012 revisions that late-model cars commonly report (camshaft
 * slow response P000A–P000D, fuel volume regulator learning / relief valve P000E–P000F, charge air
 * cooler temperature P007A–P007E, radiator coolant temperature P00B1–P00B6, turbo inlet pressure
 * P012A–P012E, O2 response rate P013A–P015D, fuel pump module P025A–P025D, cold-start monitors
 * P050A–P050E, control-module self-tests P060A–P062F, oil pressure control P06DA–P06DE, ...).
 * P0364 is left out on purpose: it was reserved for years and its later generic meaning could not
 * be verified. Codes that are not listed (the remaining hex-lettered additions and P0B00–P0FFF)
 * still decode through the J2012 range fallback in `dtc-ranges.ts`, so an omission degrades
 * gracefully.
 *
 * `description` uses the current J2012 generic wording and typography: letter designators in quotes
 * ("A" is the intake, left, front or first of several), qualifiers in parentheses. Bank 1 is the
 * bank containing cylinder 1; sensor 1 is the sensor closest to the engine. Wording was
 * cross-checked against python-OBD's code table and the MIT-licensed Wal33D/dtc-database generic
 * set, and every code those two sources disagree on (or that only one of them lists) was checked
 * against published OEM service information and code references. A few codes keep their
 * long-established wording where a later revision only rephrased them (e.g. P0421 "Warm Up
 * Catalyst", P0494 "Fan Speed Low"). P0325–P0334 use the later knock sensor "A"/"B" designators;
 * older tables and many service manuals call the same sensors "Knock Sensor 1 (Bank 1 or Single
 * Sensor)" and "Knock Sensor 2 (Bank 2)".
 *
 * `short` is the glanceable HUD label (at most 32 characters, plain English, no code prefix):
 *   - "(B1)" / "(B2)" name the engine bank; labels without one apply to the whole engine or bank 1
 *     on single-bank engines.
 *   - "Upstream O2" is sensor 1 (before the catalytic converter), "Downstream O2" is sensor 2.
 *   - "low" / "high" on a sensor, switch or circuit describe the electrical signal, not the
 *     measured quantity (a coolant sensor "low" usually reads as very hot). Where the quantity
 *     itself would be alarming (coolant, oil and transmission temperature, oil pressure, fuel
 *     level) the label says "signal low" / "signal high" so it cannot be read as the condition.
 *   - J2012 "Circuit/Open" means a circuit fault *or* an open circuit, so its label says
 *     "circuit" and only a plain "Circuit Open" code is labelled "open".
 *   - Labels name the component the code names and no more: "Contribution/Balance" is a cylinder
 *     power balance fault, not necessarily an injector.
 *
 * `severity` follows the rubric in `dtc-ranges.ts`. Only conditions where continuing to drive
 * risks immediate damage or safety are critical (engine/transmission/oil over-temperature, low oil
 * pressure, a large fuel leak, hybrid battery over-temperature and high-voltage isolation faults).
 */
export const P0_CODES: Readonly<Record<string, DtcDbEntry>> = {
  // P00xx — fuel and air metering, variable valve timing, turbo/supercharger, O2 heaters
  P0001: {
    description: 'Fuel Volume Regulator "A" Control Circuit/Open',
    short: 'Fuel volume regulator circuit',
    severity: 'warning',
  },
  P0002: {
    description: 'Fuel Volume Regulator "A" Control Circuit Performance',
    short: 'Fuel volume regulator fault',
    severity: 'warning',
  },
  P0003: {
    description: 'Fuel Volume Regulator "A" Control Circuit Low',
    short: 'Fuel volume regulator low',
    severity: 'warning',
  },
  P0004: {
    description: 'Fuel Volume Regulator "A" Control Circuit High',
    short: 'Fuel volume regulator high',
    severity: 'warning',
  },
  P0005: {
    description: 'Fuel Shutoff Valve "A" Control Circuit/Open',
    short: 'Fuel shutoff valve circuit',
    severity: 'warning',
  },
  P0006: {
    description: 'Fuel Shutoff Valve "A" Control Circuit Low',
    short: 'Fuel shutoff valve low',
    severity: 'warning',
  },
  P0007: {
    description: 'Fuel Shutoff Valve "A" Control Circuit High',
    short: 'Fuel shutoff valve high',
    severity: 'warning',
  },
  P0008: {
    description: 'Engine Position System Performance (Bank 1)',
    short: 'Engine timing out of spec (B1)',
    severity: 'warning',
  },
  P0009: {
    description: 'Engine Position System Performance (Bank 2)',
    short: 'Engine timing out of spec (B2)',
    severity: 'warning',
  },
  P000A: {
    description: '"A" Camshaft Position Slow Response (Bank 1)',
    short: 'Cam timing A slow (B1)',
    severity: 'warning',
  },
  P000B: {
    description: '"B" Camshaft Position Slow Response (Bank 1)',
    short: 'Cam timing B slow (B1)',
    severity: 'warning',
  },
  P000C: {
    description: '"A" Camshaft Position Slow Response (Bank 2)',
    short: 'Cam timing A slow (B2)',
    severity: 'warning',
  },
  P000D: {
    description: '"B" Camshaft Position Slow Response (Bank 2)',
    short: 'Cam timing B slow (B2)',
    severity: 'warning',
  },
  P000E: {
    description: 'Fuel Volume Regulator Control Exceeded Learning Limit',
    short: 'Fuel volume regulator at limit',
    severity: 'warning',
  },
  P000F: {
    description: 'Fuel System Over Pressure Relief Valve Activated',
    short: 'Fuel pressure relief valve open',
    severity: 'warning',
  },
  P0010: {
    description: '"A" Camshaft Position Actuator Circuit/Open (Bank 1)',
    short: 'Cam timing A circuit (B1)',
    severity: 'warning',
  },
  P0011: {
    description: '"A" Camshaft Position - Timing Over-Advanced or System Performance (Bank 1)',
    short: 'Cam timing A over-advanced (B1)',
    severity: 'warning',
  },
  P0012: {
    description: '"A" Camshaft Position - Timing Over-Retarded (Bank 1)',
    short: 'Cam timing A over-retarded (B1)',
    severity: 'warning',
  },
  P0013: {
    description: '"B" Camshaft Position Actuator Circuit/Open (Bank 1)',
    short: 'Cam timing B circuit (B1)',
    severity: 'warning',
  },
  P0014: {
    description: '"B" Camshaft Position - Timing Over-Advanced or System Performance (Bank 1)',
    short: 'Cam timing B over-advanced (B1)',
    severity: 'warning',
  },
  P0015: {
    description: '"B" Camshaft Position - Timing Over-Retarded (Bank 1)',
    short: 'Cam timing B over-retarded (B1)',
    severity: 'warning',
  },
  P0016: {
    description: 'Crankshaft Position - Camshaft Position Correlation (Bank 1 Sensor A)',
    short: 'Crank/cam A timing mismatch (B1)',
    severity: 'warning',
  },
  P0017: {
    description: 'Crankshaft Position - Camshaft Position Correlation (Bank 1 Sensor B)',
    short: 'Crank/cam B timing mismatch (B1)',
    severity: 'warning',
  },
  P0018: {
    description: 'Crankshaft Position - Camshaft Position Correlation (Bank 2 Sensor A)',
    short: 'Crank/cam A timing mismatch (B2)',
    severity: 'warning',
  },
  P0019: {
    description: 'Crankshaft Position - Camshaft Position Correlation (Bank 2 Sensor B)',
    short: 'Crank/cam B timing mismatch (B2)',
    severity: 'warning',
  },
  P0020: {
    description: '"A" Camshaft Position Actuator Circuit/Open (Bank 2)',
    short: 'Cam timing A circuit (B2)',
    severity: 'warning',
  },
  P0021: {
    description: '"A" Camshaft Position - Timing Over-Advanced or System Performance (Bank 2)',
    short: 'Cam timing A over-advanced (B2)',
    severity: 'warning',
  },
  P0022: {
    description: '"A" Camshaft Position - Timing Over-Retarded (Bank 2)',
    short: 'Cam timing A over-retarded (B2)',
    severity: 'warning',
  },
  P0023: {
    description: '"B" Camshaft Position Actuator Circuit/Open (Bank 2)',
    short: 'Cam timing B circuit (B2)',
    severity: 'warning',
  },
  P0024: {
    description: '"B" Camshaft Position - Timing Over-Advanced or System Performance (Bank 2)',
    short: 'Cam timing B over-advanced (B2)',
    severity: 'warning',
  },
  P0025: {
    description: '"B" Camshaft Position - Timing Over-Retarded (Bank 2)',
    short: 'Cam timing B over-retarded (B2)',
    severity: 'warning',
  },
  P0026: {
    description: 'Intake Valve Control Solenoid Circuit Range/Performance (Bank 1)',
    short: 'Intake cam solenoid fault (B1)',
    severity: 'warning',
  },
  P0027: {
    description: 'Exhaust Valve Control Solenoid Circuit Range/Performance (Bank 1)',
    short: 'Exhaust cam solenoid fault (B1)',
    severity: 'warning',
  },
  P0028: {
    description: 'Intake Valve Control Solenoid Circuit Range/Performance (Bank 2)',
    short: 'Intake cam solenoid fault (B2)',
    severity: 'warning',
  },
  P0029: {
    description: 'Exhaust Valve Control Solenoid Circuit Range/Performance (Bank 2)',
    short: 'Exhaust cam solenoid fault (B2)',
    severity: 'warning',
  },
  P0030: {
    description: 'HO2S Heater Control Circuit (Bank 1 Sensor 1)',
    short: 'Upstream O2 heater circuit (B1)',
    severity: 'caution',
  },
  P0031: {
    description: 'HO2S Heater Control Circuit Low (Bank 1 Sensor 1)',
    short: 'Upstream O2 heater low (B1)',
    severity: 'caution',
  },
  P0032: {
    description: 'HO2S Heater Control Circuit High (Bank 1 Sensor 1)',
    short: 'Upstream O2 heater high (B1)',
    severity: 'caution',
  },
  P0033: {
    description: 'Turbocharger/Supercharger Bypass Valve "A" Control Circuit',
    short: 'Turbo bypass valve circuit',
    severity: 'warning',
  },
  P0034: {
    description: 'Turbocharger/Supercharger Bypass Valve "A" Control Circuit Low',
    short: 'Turbo bypass valve low',
    severity: 'warning',
  },
  P0035: {
    description: 'Turbocharger/Supercharger Bypass Valve "A" Control Circuit High',
    short: 'Turbo bypass valve high',
    severity: 'warning',
  },
  P0036: {
    description: 'HO2S Heater Control Circuit (Bank 1 Sensor 2)',
    short: 'Downstream O2 sensor heater (B1)',
    severity: 'caution',
  },
  P0037: {
    description: 'HO2S Heater Control Circuit Low (Bank 1 Sensor 2)',
    short: 'Downstream O2 heater low (B1)',
    severity: 'caution',
  },
  P0038: {
    description: 'HO2S Heater Control Circuit High (Bank 1 Sensor 2)',
    short: 'Downstream O2 heater high (B1)',
    severity: 'caution',
  },
  P0039: {
    description: 'Turbocharger/Supercharger Bypass Valve "A" Control Circuit Range/Performance',
    short: 'Turbo bypass valve out of range',
    severity: 'warning',
  },
  P0040: {
    description: 'O2 Sensor Signals Swapped (Bank 1 Sensor 1 / Bank 2 Sensor 1)',
    short: 'Upstream O2 signals swapped',
    severity: 'caution',
  },
  P0041: {
    description: 'O2 Sensor Signals Swapped (Bank 1 Sensor 2 / Bank 2 Sensor 2)',
    short: 'Downstream O2 signals swapped',
    severity: 'caution',
  },
  P0042: {
    description: 'HO2S Heater Control Circuit (Bank 1 Sensor 3)',
    short: 'O2 sensor 3 heater circuit (B1)',
    severity: 'caution',
  },
  P0043: {
    description: 'HO2S Heater Control Circuit Low (Bank 1 Sensor 3)',
    short: 'O2 sensor 3 heater low (B1)',
    severity: 'caution',
  },
  P0044: {
    description: 'HO2S Heater Control Circuit High (Bank 1 Sensor 3)',
    short: 'O2 sensor 3 heater high (B1)',
    severity: 'caution',
  },
  P0045: {
    description: 'Turbocharger/Supercharger Boost Control "A" Circuit/Open',
    short: 'Turbo boost control circuit',
    severity: 'warning',
  },
  P0046: {
    description: 'Turbocharger/Supercharger Boost Control "A" Circuit Range/Performance',
    short: 'Turbo boost control out of range',
    severity: 'warning',
  },
  P0047: {
    description: 'Turbocharger/Supercharger Boost Control "A" Circuit Low',
    short: 'Turbo boost control low',
    severity: 'warning',
  },
  P0048: {
    description: 'Turbocharger/Supercharger Boost Control "A" Circuit High',
    short: 'Turbo boost control high',
    severity: 'warning',
  },
  P0049: {
    description: 'Turbocharger/Supercharger "A" Turbine Overspeed',
    short: 'Turbo overspeed',
    severity: 'warning',
  },
  P0050: {
    description: 'HO2S Heater Control Circuit (Bank 2 Sensor 1)',
    short: 'Upstream O2 heater circuit (B2)',
    severity: 'caution',
  },
  P0051: {
    description: 'HO2S Heater Control Circuit Low (Bank 2 Sensor 1)',
    short: 'Upstream O2 heater low (B2)',
    severity: 'caution',
  },
  P0052: {
    description: 'HO2S Heater Control Circuit High (Bank 2 Sensor 1)',
    short: 'Upstream O2 heater high (B2)',
    severity: 'caution',
  },
  P0053: {
    description: 'HO2S Heater Resistance (Bank 1 Sensor 1)',
    short: 'Upstream O2 heater faulty (B1)',
    severity: 'caution',
  },
  P0054: {
    description: 'HO2S Heater Resistance (Bank 1 Sensor 2)',
    short: 'Downstream O2 heater faulty (B1)',
    severity: 'caution',
  },
  P0055: {
    description: 'HO2S Heater Resistance (Bank 1 Sensor 3)',
    short: 'O2 sensor 3 heater faulty (B1)',
    severity: 'caution',
  },
  P0056: {
    description: 'HO2S Heater Control Circuit (Bank 2 Sensor 2)',
    short: 'Downstream O2 sensor heater (B2)',
    severity: 'caution',
  },
  P0057: {
    description: 'HO2S Heater Control Circuit Low (Bank 2 Sensor 2)',
    short: 'Downstream O2 heater low (B2)',
    severity: 'caution',
  },
  P0058: {
    description: 'HO2S Heater Control Circuit High (Bank 2 Sensor 2)',
    short: 'Downstream O2 heater high (B2)',
    severity: 'caution',
  },
  P0059: {
    description: 'HO2S Heater Resistance (Bank 2 Sensor 1)',
    short: 'Upstream O2 heater faulty (B2)',
    severity: 'caution',
  },
  P0060: {
    description: 'HO2S Heater Resistance (Bank 2 Sensor 2)',
    short: 'Downstream O2 heater faulty (B2)',
    severity: 'caution',
  },
  P0061: {
    description: 'HO2S Heater Resistance (Bank 2 Sensor 3)',
    short: 'O2 sensor 3 heater faulty (B2)',
    severity: 'caution',
  },
  P0062: {
    description: 'HO2S Heater Control Circuit (Bank 2 Sensor 3)',
    short: 'O2 sensor 3 heater circuit (B2)',
    severity: 'caution',
  },
  P0063: {
    description: 'HO2S Heater Control Circuit Low (Bank 2 Sensor 3)',
    short: 'O2 sensor 3 heater low (B2)',
    severity: 'caution',
  },
  P0064: {
    description: 'HO2S Heater Control Circuit High (Bank 2 Sensor 3)',
    short: 'O2 sensor 3 heater high (B2)',
    severity: 'caution',
  },
  P0065: {
    description: 'Air Assisted Injector Control Range/Performance',
    short: 'Air-assist injector out of range',
    severity: 'caution',
  },
  P0066: {
    description: 'Air Assisted Injector Control Circuit Low',
    short: 'Air-assist injector low',
    severity: 'caution',
  },
  P0067: {
    description: 'Air Assisted Injector Control Circuit High',
    short: 'Air-assist injector high',
    severity: 'caution',
  },
  P0068: {
    description: 'MAP/MAF - Throttle Position Correlation',
    short: 'Airflow/throttle mismatch',
    severity: 'warning',
  },
  P0069: {
    description: 'Manifold Absolute Pressure - Barometric Pressure Correlation',
    short: 'Manifold/baro pressure mismatch',
    severity: 'caution',
  },
  P006A: {
    description: 'MAP - Mass or Volume Air Flow Correlation (Bank 1)',
    short: 'MAP/airflow mismatch (B1)',
    severity: 'caution',
  },
  P0070: {
    description: 'Ambient Air Temperature Sensor Circuit "A"',
    short: 'Outside temp sensor circuit',
    severity: 'info',
  },
  P0071: {
    description: 'Ambient Air Temperature Sensor Circuit "A" Range/Performance',
    short: 'Outside temp sensor out of range',
    severity: 'info',
  },
  P0072: {
    description: 'Ambient Air Temperature Sensor Circuit "A" Low',
    short: 'Outside temp sensor low',
    severity: 'info',
  },
  P0073: {
    description: 'Ambient Air Temperature Sensor Circuit "A" High',
    short: 'Outside temp sensor high',
    severity: 'info',
  },
  P0074: {
    description: 'Ambient Air Temperature Sensor Circuit "A" Intermittent/Erratic',
    short: 'Outside temp sensor erratic',
    severity: 'info',
  },
  P0075: {
    description: 'Intake Valve Control Solenoid Circuit (Bank 1)',
    short: 'Intake cam solenoid circuit (B1)',
    severity: 'warning',
  },
  P0076: {
    description: 'Intake Valve Control Solenoid Circuit Low (Bank 1)',
    short: 'Intake cam solenoid low (B1)',
    severity: 'warning',
  },
  P0077: {
    description: 'Intake Valve Control Solenoid Circuit High (Bank 1)',
    short: 'Intake cam solenoid high (B1)',
    severity: 'warning',
  },
  P0078: {
    description: 'Exhaust Valve Control Solenoid Circuit (Bank 1)',
    short: 'Exhaust cam solenoid (B1)',
    severity: 'warning',
  },
  P0079: {
    description: 'Exhaust Valve Control Solenoid Circuit Low (Bank 1)',
    short: 'Exhaust cam solenoid low (B1)',
    severity: 'warning',
  },
  P007A: {
    description: 'Charge Air Cooler Temperature Sensor Circuit (Bank 1)',
    short: 'Intercooler temp sensor circuit',
    severity: 'caution',
  },
  P007B: {
    description: 'Charge Air Cooler Temperature Sensor Circuit Range/Performance (Bank 1)',
    short: 'Intercooler temp sensor fault',
    severity: 'caution',
  },
  P007C: {
    description: 'Charge Air Cooler Temperature Sensor Circuit Low (Bank 1)',
    short: 'Intercooler temp sensor low',
    severity: 'caution',
  },
  P007D: {
    description: 'Charge Air Cooler Temperature Sensor Circuit High (Bank 1)',
    short: 'Intercooler temp sensor high',
    severity: 'caution',
  },
  P007E: {
    description: 'Charge Air Cooler Temperature Sensor Circuit Intermittent/Erratic (Bank 1)',
    short: 'Intercooler temp sensor erratic',
    severity: 'caution',
  },
  P0080: {
    description: 'Exhaust Valve Control Solenoid Circuit High (Bank 1)',
    short: 'Exhaust cam solenoid high (B1)',
    severity: 'warning',
  },
  P0081: {
    description: 'Intake Valve Control Solenoid Circuit (Bank 2)',
    short: 'Intake cam solenoid circuit (B2)',
    severity: 'warning',
  },
  P0082: {
    description: 'Intake Valve Control Solenoid Circuit Low (Bank 2)',
    short: 'Intake cam solenoid low (B2)',
    severity: 'warning',
  },
  P0083: {
    description: 'Intake Valve Control Solenoid Circuit High (Bank 2)',
    short: 'Intake cam solenoid high (B2)',
    severity: 'warning',
  },
  P0084: {
    description: 'Exhaust Valve Control Solenoid Circuit (Bank 2)',
    short: 'Exhaust cam solenoid (B2)',
    severity: 'warning',
  },
  P0085: {
    description: 'Exhaust Valve Control Solenoid Circuit Low (Bank 2)',
    short: 'Exhaust cam solenoid low (B2)',
    severity: 'warning',
  },
  P0086: {
    description: 'Exhaust Valve Control Solenoid Circuit High (Bank 2)',
    short: 'Exhaust cam solenoid high (B2)',
    severity: 'warning',
  },
  P0087: {
    description: 'Fuel Rail/System Pressure - Too Low (Bank 1)',
    short: 'Fuel pressure too low (B1)',
    severity: 'warning',
  },
  P0088: {
    description: 'Fuel Rail/System Pressure - Too High (Bank 1)',
    short: 'Fuel pressure too high (B1)',
    severity: 'warning',
  },
  P0089: {
    description: 'Fuel Pressure Regulator "A" Performance',
    short: 'Fuel pressure regulator fault',
    severity: 'warning',
  },
  P008A: {
    description: 'Low Pressure Fuel System Pressure - Too Low',
    short: 'Low-side fuel pressure too low',
    severity: 'warning',
  },
  P008B: {
    description: 'Low Pressure Fuel System Pressure - Too High',
    short: 'Low-side fuel pressure too high',
    severity: 'warning',
  },
  P0090: {
    description: 'Fuel Pressure Regulator "A" Control Circuit/Open',
    short: 'Fuel pressure regulator circuit',
    severity: 'warning',
  },
  P0091: {
    description: 'Fuel Pressure Regulator "A" Control Circuit Low',
    short: 'Fuel pressure regulator low',
    severity: 'warning',
  },
  P0092: {
    description: 'Fuel Pressure Regulator "A" Control Circuit High',
    short: 'Fuel pressure regulator high',
    severity: 'warning',
  },
  P0093: {
    description: 'Fuel System Leak Detected - Large Leak',
    short: 'Large fuel leak detected',
    severity: 'critical',
  },
  P0094: {
    description: 'Fuel System Leak Detected - Small Leak',
    short: 'Small fuel leak detected',
    severity: 'warning',
  },
  P0095: {
    description: 'Intake Air Temperature Sensor 2 Circuit (Bank 1)',
    short: 'Intake temp sensor 2 (B1)',
    severity: 'caution',
  },
  P0096: {
    description: 'Intake Air Temperature Sensor 2 Circuit Range/Performance (Bank 1)',
    short: 'Intake temp 2 out of range (B1)',
    severity: 'caution',
  },
  P0097: {
    description: 'Intake Air Temperature Sensor 2 Circuit Low (Bank 1)',
    short: 'Intake temp sensor 2 low (B1)',
    severity: 'caution',
  },
  P0098: {
    description: 'Intake Air Temperature Sensor 2 Circuit High (Bank 1)',
    short: 'Intake temp sensor 2 high (B1)',
    severity: 'caution',
  },
  P0099: {
    description: 'Intake Air Temperature Sensor 2 Circuit Intermittent/Erratic (Bank 1)',
    short: 'Intake temp 2 erratic (B1)',
    severity: 'caution',
  },
  P00B1: {
    description: 'Radiator Coolant Temperature Sensor Circuit',
    short: 'Radiator temp sensor circuit',
    severity: 'warning',
  },
  P00B2: {
    description: 'Radiator Coolant Temperature Sensor Circuit Range/Performance',
    short: 'Radiator temp sensor fault',
    severity: 'warning',
  },
  P00B3: {
    description: 'Radiator Coolant Temperature Sensor Circuit Low',
    short: 'Radiator temp sensor signal low',
    severity: 'warning',
  },
  P00B4: {
    description: 'Radiator Coolant Temperature Sensor Circuit High',
    short: 'Radiator temp sensor signal high',
    severity: 'warning',
  },
  P00B5: {
    description: 'Radiator Coolant Temperature Sensor Circuit Intermittent/Erratic',
    short: 'Radiator temp sensor erratic',
    severity: 'warning',
  },
  P00B6: {
    description: 'Radiator Coolant Temperature/Engine Coolant Temperature Correlation',
    short: 'Radiator/engine temp mismatch',
    severity: 'warning',
  },
  P00B7: {
    description: 'Engine Coolant Flow Low/Performance',
    short: 'Engine coolant flow low',
    severity: 'warning',
  },

  // P01xx — fuel and air metering: airflow/temperature sensors, O2 sensors, fuel trim
  P0100: {
    description: 'Mass or Volume Air Flow Sensor "A" Circuit',
    short: 'Mass airflow sensor circuit',
    severity: 'caution',
  },
  P0101: {
    description: 'Mass or Volume Air Flow Sensor "A" Circuit Range/Performance',
    short: 'Mass airflow sensor out of range',
    severity: 'caution',
  },
  P0102: {
    description: 'Mass or Volume Air Flow Sensor "A" Circuit Low',
    short: 'Mass airflow sensor low',
    severity: 'caution',
  },
  P0103: {
    description: 'Mass or Volume Air Flow Sensor "A" Circuit High',
    short: 'Mass airflow sensor high',
    severity: 'caution',
  },
  P0104: {
    description: 'Mass or Volume Air Flow Sensor "A" Circuit Intermittent',
    short: 'Mass airflow sensor intermittent',
    severity: 'caution',
  },
  P0105: {
    description: 'Manifold Absolute Pressure/Barometric Pressure Sensor Circuit',
    short: 'Manifold pressure sensor circuit',
    severity: 'caution',
  },
  P0106: {
    description: 'Manifold Absolute Pressure/Barometric Pressure Sensor Circuit Range/Performance',
    short: 'Manifold pressure sensor fault',
    severity: 'caution',
  },
  P0107: {
    description: 'Manifold Absolute Pressure/Barometric Pressure Sensor Circuit Low',
    short: 'Manifold pressure sensor low',
    severity: 'caution',
  },
  P0108: {
    description: 'Manifold Absolute Pressure/Barometric Pressure Sensor Circuit High',
    short: 'Manifold pressure sensor high',
    severity: 'caution',
  },
  P0109: {
    description: 'Manifold Absolute Pressure/Barometric Pressure Sensor Circuit Intermittent',
    short: 'Manifold pressure sensor erratic',
    severity: 'caution',
  },
  P010A: {
    description: 'Mass or Volume Air Flow Sensor "B" Circuit',
    short: 'Mass airflow sensor B circuit',
    severity: 'caution',
  },
  P010B: {
    description: 'Mass or Volume Air Flow Sensor "B" Circuit Range/Performance',
    short: 'Airflow sensor B out of range',
    severity: 'caution',
  },
  P010C: {
    description: 'Mass or Volume Air Flow Sensor "B" Circuit Low',
    short: 'Mass airflow sensor B low',
    severity: 'caution',
  },
  P010D: {
    description: 'Mass or Volume Air Flow Sensor "B" Circuit High',
    short: 'Mass airflow sensor B high',
    severity: 'caution',
  },
  P010E: {
    description: 'Mass or Volume Air Flow Sensor "B" Circuit Intermittent/Erratic',
    short: 'Mass airflow sensor B erratic',
    severity: 'caution',
  },
  P010F: {
    description: 'Mass or Volume Air Flow Sensor "A"/"B" Correlation',
    short: 'Airflow sensor A/B mismatch',
    severity: 'caution',
  },
  P0110: {
    description: 'Intake Air Temperature Sensor 1 Circuit (Bank 1)',
    short: 'Intake temp sensor circuit (B1)',
    severity: 'caution',
  },
  P0111: {
    description: 'Intake Air Temperature Sensor 1 Circuit Range/Performance (Bank 1)',
    short: 'Intake temp sensor fault (B1)',
    severity: 'caution',
  },
  P0112: {
    description: 'Intake Air Temperature Sensor 1 Circuit Low (Bank 1)',
    short: 'Intake temp sensor low (B1)',
    severity: 'caution',
  },
  P0113: {
    description: 'Intake Air Temperature Sensor 1 Circuit High (Bank 1)',
    short: 'Intake temp sensor high (B1)',
    severity: 'caution',
  },
  P0114: {
    description: 'Intake Air Temperature Sensor 1 Circuit Intermittent (Bank 1)',
    short: 'Intake temp sensor erratic (B1)',
    severity: 'caution',
  },
  P0115: {
    description: 'Engine Coolant Temperature Sensor 1 Circuit',
    short: 'Coolant temp sensor circuit',
    severity: 'warning',
  },
  P0116: {
    description: 'Engine Coolant Temperature Sensor 1 Circuit Range/Performance',
    short: 'Coolant temp sensor out of range',
    severity: 'warning',
  },
  P0117: {
    description: 'Engine Coolant Temperature Sensor 1 Circuit Low',
    short: 'Coolant temp sensor signal low',
    severity: 'warning',
  },
  P0118: {
    description: 'Engine Coolant Temperature Sensor 1 Circuit High',
    short: 'Coolant temp sensor signal high',
    severity: 'warning',
  },
  P0119: {
    description: 'Engine Coolant Temperature Sensor 1 Circuit Intermittent/Erratic',
    short: 'Coolant temp sensor erratic',
    severity: 'warning',
  },
  P0120: {
    description: 'Throttle/Pedal Position Sensor/Switch "A" Circuit',
    short: 'Throttle/pedal sensor A circuit',
    severity: 'warning',
  },
  P0121: {
    description: 'Throttle/Pedal Position Sensor/Switch "A" Circuit Range/Performance',
    short: 'Throttle/pedal sensor A fault',
    severity: 'warning',
  },
  P0122: {
    description: 'Throttle/Pedal Position Sensor/Switch "A" Circuit Low',
    short: 'Throttle/pedal sensor A low',
    severity: 'warning',
  },
  P0123: {
    description: 'Throttle/Pedal Position Sensor/Switch "A" Circuit High',
    short: 'Throttle/pedal sensor A high',
    severity: 'warning',
  },
  P0124: {
    description: 'Throttle/Pedal Position Sensor/Switch "A" Circuit Intermittent',
    short: 'Throttle/pedal sensor A erratic',
    severity: 'warning',
  },
  P0125: {
    description: 'Insufficient Coolant Temperature for Closed Loop Fuel Control',
    short: 'Engine slow to warm up',
    severity: 'caution',
  },
  P0126: {
    description: 'Insufficient Coolant Temperature for Stable Operation',
    short: 'Engine not warm enough',
    severity: 'caution',
  },
  P0127: {
    description: 'Intake Air Temperature Too High',
    short: 'Intake air too hot',
    severity: 'caution',
  },
  P0128: {
    description: 'Coolant Thermostat (Coolant Temperature Below Thermostat Regulating Temperature)',
    short: 'Engine runs cold (thermostat)',
    severity: 'caution',
  },
  P0129: {
    description: 'Barometric Pressure Too Low',
    short: 'Barometric reading too low',
    severity: 'caution',
  },
  P012A: {
    description: 'Turbocharger/Supercharger Inlet Pressure Sensor Circuit',
    short: 'Turbo inlet pressure sensor',
    severity: 'warning',
  },
  P012B: {
    description: 'Turbocharger/Supercharger Inlet Pressure Sensor Circuit Range/Performance',
    short: 'Turbo inlet sensor out of range',
    severity: 'warning',
  },
  P012C: {
    description: 'Turbocharger/Supercharger Inlet Pressure Sensor Circuit Low',
    short: 'Turbo inlet pressure sensor low',
    severity: 'warning',
  },
  P012D: {
    description: 'Turbocharger/Supercharger Inlet Pressure Sensor Circuit High',
    short: 'Turbo inlet pressure sensor high',
    severity: 'warning',
  },
  P012E: {
    description: 'Turbocharger/Supercharger Inlet Pressure Sensor Circuit Intermittent/Erratic',
    short: 'Turbo inlet sensor erratic',
    severity: 'warning',
  },
  P0130: {
    description: 'O2 Sensor Circuit (Bank 1 Sensor 1)',
    short: 'Upstream O2 sensor circuit (B1)',
    severity: 'caution',
  },
  P0131: {
    description: 'O2 Sensor Circuit Low Voltage (Bank 1 Sensor 1)',
    short: 'Upstream O2 sensor low (B1)',
    severity: 'caution',
  },
  P0132: {
    description: 'O2 Sensor Circuit High Voltage (Bank 1 Sensor 1)',
    short: 'Upstream O2 sensor high (B1)',
    severity: 'caution',
  },
  P0133: {
    description: 'O2 Sensor Circuit Slow Response (Bank 1 Sensor 1)',
    short: 'Upstream O2 sensor slow (B1)',
    severity: 'caution',
  },
  P0134: {
    description: 'O2 Sensor Circuit No Activity Detected (Bank 1 Sensor 1)',
    short: 'Upstream O2 no activity (B1)',
    severity: 'caution',
  },
  P0135: {
    description: 'O2 Sensor Heater Circuit (Bank 1 Sensor 1)',
    short: 'Upstream O2 heater circuit (B1)',
    severity: 'caution',
  },
  P0136: {
    description: 'O2 Sensor Circuit (Bank 1 Sensor 2)',
    short: 'Downstream O2 circuit (B1)',
    severity: 'caution',
  },
  P0137: {
    description: 'O2 Sensor Circuit Low Voltage (Bank 1 Sensor 2)',
    short: 'Downstream O2 sensor low (B1)',
    severity: 'caution',
  },
  P0138: {
    description: 'O2 Sensor Circuit High Voltage (Bank 1 Sensor 2)',
    short: 'Downstream O2 sensor high (B1)',
    severity: 'caution',
  },
  P0139: {
    description: 'O2 Sensor Circuit Slow Response (Bank 1 Sensor 2)',
    short: 'Downstream O2 sensor slow (B1)',
    severity: 'caution',
  },
  P013A: {
    description: 'O2 Sensor Slow Response - Rich to Lean (Bank 1 Sensor 2)',
    short: 'Downstream O2 slow to lean (B1)',
    severity: 'caution',
  },
  P013B: {
    description: 'O2 Sensor Slow Response - Lean to Rich (Bank 1 Sensor 2)',
    short: 'Downstream O2 slow to rich (B1)',
    severity: 'caution',
  },
  P013C: {
    description: 'O2 Sensor Slow Response - Rich to Lean (Bank 2 Sensor 2)',
    short: 'Downstream O2 slow to lean (B2)',
    severity: 'caution',
  },
  P013D: {
    description: 'O2 Sensor Slow Response - Lean to Rich (Bank 2 Sensor 2)',
    short: 'Downstream O2 slow to rich (B2)',
    severity: 'caution',
  },
  P013E: {
    description: 'O2 Sensor Delayed Response - Rich to Lean (Bank 1 Sensor 2)',
    short: 'Downstream O2 late to lean (B1)',
    severity: 'caution',
  },
  P013F: {
    description: 'O2 Sensor Delayed Response - Lean to Rich (Bank 1 Sensor 2)',
    short: 'Downstream O2 late to rich (B1)',
    severity: 'caution',
  },
  P0140: {
    description: 'O2 Sensor Circuit No Activity Detected (Bank 1 Sensor 2)',
    short: 'Downstream O2 no activity (B1)',
    severity: 'caution',
  },
  P0141: {
    description: 'O2 Sensor Heater Circuit (Bank 1 Sensor 2)',
    short: 'Downstream O2 sensor heater (B1)',
    severity: 'caution',
  },
  P0142: {
    description: 'O2 Sensor Circuit (Bank 1 Sensor 3)',
    short: 'O2 sensor 3 circuit (B1)',
    severity: 'caution',
  },
  P0143: {
    description: 'O2 Sensor Circuit Low Voltage (Bank 1 Sensor 3)',
    short: 'O2 sensor 3 low (B1)',
    severity: 'caution',
  },
  P0144: {
    description: 'O2 Sensor Circuit High Voltage (Bank 1 Sensor 3)',
    short: 'O2 sensor 3 high (B1)',
    severity: 'caution',
  },
  P0145: {
    description: 'O2 Sensor Circuit Slow Response (Bank 1 Sensor 3)',
    short: 'O2 sensor 3 slow (B1)',
    severity: 'caution',
  },
  P0146: {
    description: 'O2 Sensor Circuit No Activity Detected (Bank 1 Sensor 3)',
    short: 'O2 sensor 3 no activity (B1)',
    severity: 'caution',
  },
  P0147: {
    description: 'O2 Sensor Heater Circuit (Bank 1 Sensor 3)',
    short: 'O2 sensor 3 heater circuit (B1)',
    severity: 'caution',
  },
  P0148: { description: 'Fuel Delivery Error', short: 'Fuel delivery fault', severity: 'warning' },
  P0149: { description: 'Fuel Timing Error', short: 'Injection timing error', severity: 'warning' },
  P014A: {
    description: 'O2 Sensor Delayed Response - Rich to Lean (Bank 2 Sensor 2)',
    short: 'Downstream O2 late to lean (B2)',
    severity: 'caution',
  },
  P014B: {
    description: 'O2 Sensor Delayed Response - Lean to Rich (Bank 2 Sensor 2)',
    short: 'Downstream O2 late to rich (B2)',
    severity: 'caution',
  },
  P014C: {
    description: 'O2 Sensor Slow Response - Rich to Lean (Bank 1 Sensor 1)',
    short: 'Upstream O2 slow to lean (B1)',
    severity: 'caution',
  },
  P014D: {
    description: 'O2 Sensor Slow Response - Lean to Rich (Bank 1 Sensor 1)',
    short: 'Upstream O2 slow to rich (B1)',
    severity: 'caution',
  },
  P014E: {
    description: 'O2 Sensor Slow Response - Rich to Lean (Bank 2 Sensor 1)',
    short: 'Upstream O2 slow to lean (B2)',
    severity: 'caution',
  },
  P014F: {
    description: 'O2 Sensor Slow Response - Lean to Rich (Bank 2 Sensor 1)',
    short: 'Upstream O2 slow to rich (B2)',
    severity: 'caution',
  },
  P0150: {
    description: 'O2 Sensor Circuit (Bank 2 Sensor 1)',
    short: 'Upstream O2 sensor circuit (B2)',
    severity: 'caution',
  },
  P0151: {
    description: 'O2 Sensor Circuit Low Voltage (Bank 2 Sensor 1)',
    short: 'Upstream O2 sensor low (B2)',
    severity: 'caution',
  },
  P0152: {
    description: 'O2 Sensor Circuit High Voltage (Bank 2 Sensor 1)',
    short: 'Upstream O2 sensor high (B2)',
    severity: 'caution',
  },
  P0153: {
    description: 'O2 Sensor Circuit Slow Response (Bank 2 Sensor 1)',
    short: 'Upstream O2 sensor slow (B2)',
    severity: 'caution',
  },
  P0154: {
    description: 'O2 Sensor Circuit No Activity Detected (Bank 2 Sensor 1)',
    short: 'Upstream O2 no activity (B2)',
    severity: 'caution',
  },
  P0155: {
    description: 'O2 Sensor Heater Circuit (Bank 2 Sensor 1)',
    short: 'Upstream O2 heater circuit (B2)',
    severity: 'caution',
  },
  P0156: {
    description: 'O2 Sensor Circuit (Bank 2 Sensor 2)',
    short: 'Downstream O2 circuit (B2)',
    severity: 'caution',
  },
  P0157: {
    description: 'O2 Sensor Circuit Low Voltage (Bank 2 Sensor 2)',
    short: 'Downstream O2 sensor low (B2)',
    severity: 'caution',
  },
  P0158: {
    description: 'O2 Sensor Circuit High Voltage (Bank 2 Sensor 2)',
    short: 'Downstream O2 sensor high (B2)',
    severity: 'caution',
  },
  P0159: {
    description: 'O2 Sensor Circuit Slow Response (Bank 2 Sensor 2)',
    short: 'Downstream O2 sensor slow (B2)',
    severity: 'caution',
  },
  P015A: {
    description: 'O2 Sensor Delayed Response - Rich to Lean (Bank 1 Sensor 1)',
    short: 'Upstream O2 late to lean (B1)',
    severity: 'caution',
  },
  P015B: {
    description: 'O2 Sensor Delayed Response - Lean to Rich (Bank 1 Sensor 1)',
    short: 'Upstream O2 late to rich (B1)',
    severity: 'caution',
  },
  P015C: {
    description: 'O2 Sensor Delayed Response - Rich to Lean (Bank 2 Sensor 1)',
    short: 'Upstream O2 late to lean (B2)',
    severity: 'caution',
  },
  P015D: {
    description: 'O2 Sensor Delayed Response - Lean to Rich (Bank 2 Sensor 1)',
    short: 'Upstream O2 late to rich (B2)',
    severity: 'caution',
  },
  P0160: {
    description: 'O2 Sensor Circuit No Activity Detected (Bank 2 Sensor 2)',
    short: 'Downstream O2 no activity (B2)',
    severity: 'caution',
  },
  P0161: {
    description: 'O2 Sensor Heater Circuit (Bank 2 Sensor 2)',
    short: 'Downstream O2 sensor heater (B2)',
    severity: 'caution',
  },
  P0162: {
    description: 'O2 Sensor Circuit (Bank 2 Sensor 3)',
    short: 'O2 sensor 3 circuit (B2)',
    severity: 'caution',
  },
  P0163: {
    description: 'O2 Sensor Circuit Low Voltage (Bank 2 Sensor 3)',
    short: 'O2 sensor 3 low (B2)',
    severity: 'caution',
  },
  P0164: {
    description: 'O2 Sensor Circuit High Voltage (Bank 2 Sensor 3)',
    short: 'O2 sensor 3 high (B2)',
    severity: 'caution',
  },
  P0165: {
    description: 'O2 Sensor Circuit Slow Response (Bank 2 Sensor 3)',
    short: 'O2 sensor 3 slow (B2)',
    severity: 'caution',
  },
  P0166: {
    description: 'O2 Sensor Circuit No Activity Detected (Bank 2 Sensor 3)',
    short: 'O2 sensor 3 no activity (B2)',
    severity: 'caution',
  },
  P0167: {
    description: 'O2 Sensor Heater Circuit (Bank 2 Sensor 3)',
    short: 'O2 sensor 3 heater circuit (B2)',
    severity: 'caution',
  },
  P0168: { description: 'Fuel Temperature Too High', short: 'Fuel too hot', severity: 'warning' },
  P0169: {
    description: 'Incorrect Fuel Composition',
    short: 'Wrong fuel blend detected',
    severity: 'caution',
  },
  P0170: { description: 'Fuel Trim (Bank 1)', short: 'Fuel trim fault (B1)', severity: 'caution' },
  P0171: {
    description: 'System Too Lean (Bank 1)',
    short: 'Engine running lean (B1)',
    severity: 'caution',
  },
  P0172: {
    description: 'System Too Rich (Bank 1)',
    short: 'Engine running rich (B1)',
    severity: 'caution',
  },
  P0173: { description: 'Fuel Trim (Bank 2)', short: 'Fuel trim fault (B2)', severity: 'caution' },
  P0174: {
    description: 'System Too Lean (Bank 2)',
    short: 'Engine running lean (B2)',
    severity: 'caution',
  },
  P0175: {
    description: 'System Too Rich (Bank 2)',
    short: 'Engine running rich (B2)',
    severity: 'caution',
  },
  P0176: {
    description: 'Fuel Composition Sensor Circuit',
    short: 'Flex-fuel sensor circuit',
    severity: 'caution',
  },
  P0177: {
    description: 'Fuel Composition Sensor Circuit Range/Performance',
    short: 'Flex-fuel sensor out of range',
    severity: 'caution',
  },
  P0178: {
    description: 'Fuel Composition Sensor Circuit Low',
    short: 'Flex-fuel sensor low',
    severity: 'caution',
  },
  P0179: {
    description: 'Fuel Composition Sensor Circuit High',
    short: 'Flex-fuel sensor high',
    severity: 'caution',
  },
  P0180: {
    description: 'Fuel Temperature Sensor "A" Circuit',
    short: 'Fuel temp sensor A circuit',
    severity: 'caution',
  },
  P0181: {
    description: 'Fuel Temperature Sensor "A" Circuit Range/Performance',
    short: 'Fuel temp sensor A out of range',
    severity: 'caution',
  },
  P0182: {
    description: 'Fuel Temperature Sensor "A" Circuit Low',
    short: 'Fuel temp sensor A low',
    severity: 'caution',
  },
  P0183: {
    description: 'Fuel Temperature Sensor "A" Circuit High',
    short: 'Fuel temp sensor A high',
    severity: 'caution',
  },
  P0184: {
    description: 'Fuel Temperature Sensor "A" Circuit Intermittent',
    short: 'Fuel temp sensor A intermittent',
    severity: 'caution',
  },
  P0185: {
    description: 'Fuel Temperature Sensor "B" Circuit',
    short: 'Fuel temp sensor B circuit',
    severity: 'caution',
  },
  P0186: {
    description: 'Fuel Temperature Sensor "B" Circuit Range/Performance',
    short: 'Fuel temp sensor B out of range',
    severity: 'caution',
  },
  P0187: {
    description: 'Fuel Temperature Sensor "B" Circuit Low',
    short: 'Fuel temp sensor B low',
    severity: 'caution',
  },
  P0188: {
    description: 'Fuel Temperature Sensor "B" Circuit High',
    short: 'Fuel temp sensor B high',
    severity: 'caution',
  },
  P0189: {
    description: 'Fuel Temperature Sensor "B" Circuit Intermittent',
    short: 'Fuel temp sensor B intermittent',
    severity: 'caution',
  },
  P0190: {
    description: 'Fuel Rail Pressure Sensor Circuit (Bank 1)',
    short: 'Fuel pressure sensor (B1)',
    severity: 'warning',
  },
  P0191: {
    description: 'Fuel Rail Pressure Sensor Circuit Range/Performance (Bank 1)',
    short: 'Fuel pressure sensor fault (B1)',
    severity: 'warning',
  },
  P0192: {
    description: 'Fuel Rail Pressure Sensor Circuit Low (Bank 1)',
    short: 'Fuel pressure sensor low (B1)',
    severity: 'warning',
  },
  P0193: {
    description: 'Fuel Rail Pressure Sensor Circuit High (Bank 1)',
    short: 'Fuel pressure sensor high (B1)',
    severity: 'warning',
  },
  P0194: {
    description: 'Fuel Rail Pressure Sensor Circuit Intermittent/Erratic (Bank 1)',
    short: 'Fuel rail sensor erratic (B1)',
    severity: 'warning',
  },
  P0195: {
    description: 'Engine Oil Temperature Sensor "A" Circuit',
    short: 'Oil temp sensor circuit',
    severity: 'caution',
  },
  P0196: {
    description: 'Engine Oil Temperature Sensor "A" Range/Performance',
    short: 'Oil temp sensor out of range',
    severity: 'caution',
  },
  P0197: {
    description: 'Engine Oil Temperature Sensor "A" Circuit Low',
    short: 'Oil temp sensor signal low',
    severity: 'caution',
  },
  P0198: {
    description: 'Engine Oil Temperature Sensor "A" Circuit High',
    short: 'Oil temp sensor signal high',
    severity: 'caution',
  },
  P0199: {
    description: 'Engine Oil Temperature Sensor "A" Circuit Intermittent/Erratic',
    short: 'Oil temp sensor erratic',
    severity: 'caution',
  },

  // P02xx — fuel and air metering: injectors, throttle/pedal sensors, fuel pump, boost
  P0200: {
    description: 'Injector Circuit/Open',
    short: 'Fuel injector circuit',
    severity: 'warning',
  },
  P0201: {
    description: 'Cylinder 1 Injector "A" Circuit',
    short: 'Cylinder 1 injector circuit',
    severity: 'warning',
  },
  P0202: {
    description: 'Cylinder 2 Injector "A" Circuit',
    short: 'Cylinder 2 injector circuit',
    severity: 'warning',
  },
  P0203: {
    description: 'Cylinder 3 Injector "A" Circuit',
    short: 'Cylinder 3 injector circuit',
    severity: 'warning',
  },
  P0204: {
    description: 'Cylinder 4 Injector "A" Circuit',
    short: 'Cylinder 4 injector circuit',
    severity: 'warning',
  },
  P0205: {
    description: 'Cylinder 5 Injector "A" Circuit',
    short: 'Cylinder 5 injector circuit',
    severity: 'warning',
  },
  P0206: {
    description: 'Cylinder 6 Injector "A" Circuit',
    short: 'Cylinder 6 injector circuit',
    severity: 'warning',
  },
  P0207: {
    description: 'Cylinder 7 Injector "A" Circuit',
    short: 'Cylinder 7 injector circuit',
    severity: 'warning',
  },
  P0208: {
    description: 'Cylinder 8 Injector "A" Circuit',
    short: 'Cylinder 8 injector circuit',
    severity: 'warning',
  },
  P0209: {
    description: 'Cylinder 9 Injector "A" Circuit',
    short: 'Cylinder 9 injector circuit',
    severity: 'warning',
  },
  P0210: {
    description: 'Cylinder 10 Injector "A" Circuit',
    short: 'Cylinder 10 injector circuit',
    severity: 'warning',
  },
  P0211: {
    description: 'Cylinder 11 Injector "A" Circuit',
    short: 'Cylinder 11 injector circuit',
    severity: 'warning',
  },
  P0212: {
    description: 'Cylinder 12 Injector "A" Circuit',
    short: 'Cylinder 12 injector circuit',
    severity: 'warning',
  },
  P0213: {
    description: 'Cold Start Injector 1',
    short: 'Cold start injector 1 fault',
    severity: 'caution',
  },
  P0214: {
    description: 'Cold Start Injector 2',
    short: 'Cold start injector 2 fault',
    severity: 'caution',
  },
  P0215: {
    description: 'Engine Shutoff Solenoid',
    short: 'Engine shutoff solenoid fault',
    severity: 'warning',
  },
  P0216: {
    description: 'Injector/Injection Timing Control Circuit',
    short: 'Injection timing control circuit',
    severity: 'warning',
  },
  P0217: {
    description: 'Engine Coolant Over Temperature Condition',
    short: 'Engine overheating',
    severity: 'critical',
  },
  P0218: {
    description: 'Transmission Fluid Over Temperature Condition',
    short: 'Transmission overheating',
    severity: 'critical',
  },
  P0219: {
    description: 'Engine Overspeed Condition',
    short: 'Engine over-revved',
    severity: 'warning',
  },
  P0220: {
    description: 'Throttle/Pedal Position Sensor/Switch "B" Circuit',
    short: 'Throttle/pedal sensor B circuit',
    severity: 'warning',
  },
  P0221: {
    description: 'Throttle/Pedal Position Sensor/Switch "B" Circuit Range/Performance',
    short: 'Throttle/pedal sensor B fault',
    severity: 'warning',
  },
  P0222: {
    description: 'Throttle/Pedal Position Sensor/Switch "B" Circuit Low',
    short: 'Throttle/pedal sensor B low',
    severity: 'warning',
  },
  P0223: {
    description: 'Throttle/Pedal Position Sensor/Switch "B" Circuit High',
    short: 'Throttle/pedal sensor B high',
    severity: 'warning',
  },
  P0224: {
    description: 'Throttle/Pedal Position Sensor/Switch "B" Circuit Intermittent',
    short: 'Throttle/pedal sensor B erratic',
    severity: 'warning',
  },
  P0225: {
    description: 'Throttle/Pedal Position Sensor/Switch "C" Circuit',
    short: 'Throttle/pedal sensor C circuit',
    severity: 'warning',
  },
  P0226: {
    description: 'Throttle/Pedal Position Sensor/Switch "C" Circuit Range/Performance',
    short: 'Throttle/pedal sensor C fault',
    severity: 'warning',
  },
  P0227: {
    description: 'Throttle/Pedal Position Sensor/Switch "C" Circuit Low',
    short: 'Throttle/pedal sensor C low',
    severity: 'warning',
  },
  P0228: {
    description: 'Throttle/Pedal Position Sensor/Switch "C" Circuit High',
    short: 'Throttle/pedal sensor C high',
    severity: 'warning',
  },
  P0229: {
    description: 'Throttle/Pedal Position Sensor/Switch "C" Circuit Intermittent',
    short: 'Throttle/pedal sensor C erratic',
    severity: 'warning',
  },
  P0230: {
    description: 'Fuel Pump Primary Circuit',
    short: 'Fuel pump circuit',
    severity: 'warning',
  },
  P0231: {
    description: 'Fuel Pump Secondary Circuit Low',
    short: 'Fuel pump circuit low',
    severity: 'warning',
  },
  P0232: {
    description: 'Fuel Pump Secondary Circuit High',
    short: 'Fuel pump circuit high',
    severity: 'warning',
  },
  P0233: {
    description: 'Fuel Pump Secondary Circuit Intermittent',
    short: 'Fuel pump circuit intermittent',
    severity: 'warning',
  },
  P0234: {
    description: 'Turbocharger/Supercharger "A" Overboost Condition',
    short: 'Turbo overboost',
    severity: 'warning',
  },
  P0235: {
    description: 'Turbocharger/Supercharger Boost Sensor "A" Circuit',
    short: 'Boost sensor A circuit',
    severity: 'warning',
  },
  P0236: {
    description: 'Turbocharger/Supercharger Boost Sensor "A" Circuit Range/Performance',
    short: 'Boost sensor A out of range',
    severity: 'warning',
  },
  P0237: {
    description: 'Turbocharger/Supercharger Boost Sensor "A" Circuit Low',
    short: 'Boost sensor A low',
    severity: 'warning',
  },
  P0238: {
    description: 'Turbocharger/Supercharger Boost Sensor "A" Circuit High',
    short: 'Boost sensor A high',
    severity: 'warning',
  },
  P0239: {
    description: 'Turbocharger/Supercharger Boost Sensor "B" Circuit',
    short: 'Boost sensor B circuit',
    severity: 'warning',
  },
  P0240: {
    description: 'Turbocharger/Supercharger Boost Sensor "B" Circuit Range/Performance',
    short: 'Boost sensor B out of range',
    severity: 'warning',
  },
  P0241: {
    description: 'Turbocharger/Supercharger Boost Sensor "B" Circuit Low',
    short: 'Boost sensor B low',
    severity: 'warning',
  },
  P0242: {
    description: 'Turbocharger/Supercharger Boost Sensor "B" Circuit High',
    short: 'Boost sensor B high',
    severity: 'warning',
  },
  P0243: {
    description: 'Turbocharger/Supercharger Wastegate Actuator "A"',
    short: 'Turbo wastegate A fault',
    severity: 'warning',
  },
  P0244: {
    description: 'Turbocharger/Supercharger Wastegate Actuator "A" Range/Performance',
    short: 'Turbo wastegate A out of range',
    severity: 'warning',
  },
  P0245: {
    description: 'Turbocharger/Supercharger Wastegate Actuator "A" Low',
    short: 'Turbo wastegate A low',
    severity: 'warning',
  },
  P0246: {
    description: 'Turbocharger/Supercharger Wastegate Actuator "A" High',
    short: 'Turbo wastegate A high',
    severity: 'warning',
  },
  P0247: {
    description: 'Turbocharger/Supercharger Wastegate Actuator "B"',
    short: 'Turbo wastegate B fault',
    severity: 'warning',
  },
  P0248: {
    description: 'Turbocharger/Supercharger Wastegate Actuator "B" Range/Performance',
    short: 'Turbo wastegate B out of range',
    severity: 'warning',
  },
  P0249: {
    description: 'Turbocharger/Supercharger Wastegate Actuator "B" Low',
    short: 'Turbo wastegate B low',
    severity: 'warning',
  },
  P0250: {
    description: 'Turbocharger/Supercharger Wastegate Actuator "B" High',
    short: 'Turbo wastegate B high',
    severity: 'warning',
  },
  P0251: {
    description: 'Injection Pump Fuel Metering Control "A" (Cam/Rotor/Injector)',
    short: 'Injection pump metering A fault',
    severity: 'warning',
  },
  P0252: {
    description: 'Injection Pump Fuel Metering Control "A" Range/Performance (Cam/Rotor/Injector)',
    short: 'Injection pump A out of range',
    severity: 'warning',
  },
  P0253: {
    description: 'Injection Pump Fuel Metering Control "A" Low (Cam/Rotor/Injector)',
    short: 'Injection pump A low',
    severity: 'warning',
  },
  P0254: {
    description: 'Injection Pump Fuel Metering Control "A" High (Cam/Rotor/Injector)',
    short: 'Injection pump A high',
    severity: 'warning',
  },
  P0255: {
    description: 'Injection Pump Fuel Metering Control "A" Intermittent (Cam/Rotor/Injector)',
    short: 'Injection pump A intermittent',
    severity: 'warning',
  },
  P0256: {
    description: 'Injection Pump Fuel Metering Control "B" (Cam/Rotor/Injector)',
    short: 'Injection pump metering B fault',
    severity: 'warning',
  },
  P0257: {
    description: 'Injection Pump Fuel Metering Control "B" Range/Performance (Cam/Rotor/Injector)',
    short: 'Injection pump B out of range',
    severity: 'warning',
  },
  P0258: {
    description: 'Injection Pump Fuel Metering Control "B" Low (Cam/Rotor/Injector)',
    short: 'Injection pump B low',
    severity: 'warning',
  },
  P0259: {
    description: 'Injection Pump Fuel Metering Control "B" High (Cam/Rotor/Injector)',
    short: 'Injection pump B high',
    severity: 'warning',
  },
  P025A: {
    description: 'Fuel Pump Module "A" Control Circuit/Open',
    short: 'Fuel pump module circuit',
    severity: 'warning',
  },
  P025B: {
    description: 'Fuel Pump Module "A" Control Circuit Range/Performance',
    short: 'Fuel pump module control fault',
    severity: 'warning',
  },
  P025C: {
    description: 'Fuel Pump Module "A" Control Circuit Low',
    short: 'Fuel pump module control low',
    severity: 'warning',
  },
  P025D: {
    description: 'Fuel Pump Module "A" Control Circuit High',
    short: 'Fuel pump module control high',
    severity: 'warning',
  },
  P0260: {
    description: 'Injection Pump Fuel Metering Control "B" Intermittent (Cam/Rotor/Injector)',
    short: 'Injection pump B intermittent',
    severity: 'warning',
  },
  P0261: {
    description: 'Cylinder 1 Injector "A" Circuit Low',
    short: 'Cylinder 1 injector low',
    severity: 'warning',
  },
  P0262: {
    description: 'Cylinder 1 Injector "A" Circuit High',
    short: 'Cylinder 1 injector high',
    severity: 'warning',
  },
  P0263: {
    description: 'Cylinder 1 Contribution/Balance',
    short: 'Cylinder 1 power balance fault',
    severity: 'warning',
  },
  P0264: {
    description: 'Cylinder 2 Injector "A" Circuit Low',
    short: 'Cylinder 2 injector low',
    severity: 'warning',
  },
  P0265: {
    description: 'Cylinder 2 Injector "A" Circuit High',
    short: 'Cylinder 2 injector high',
    severity: 'warning',
  },
  P0266: {
    description: 'Cylinder 2 Contribution/Balance',
    short: 'Cylinder 2 power balance fault',
    severity: 'warning',
  },
  P0267: {
    description: 'Cylinder 3 Injector "A" Circuit Low',
    short: 'Cylinder 3 injector low',
    severity: 'warning',
  },
  P0268: {
    description: 'Cylinder 3 Injector "A" Circuit High',
    short: 'Cylinder 3 injector high',
    severity: 'warning',
  },
  P0269: {
    description: 'Cylinder 3 Contribution/Balance',
    short: 'Cylinder 3 power balance fault',
    severity: 'warning',
  },
  P0270: {
    description: 'Cylinder 4 Injector "A" Circuit Low',
    short: 'Cylinder 4 injector low',
    severity: 'warning',
  },
  P0271: {
    description: 'Cylinder 4 Injector "A" Circuit High',
    short: 'Cylinder 4 injector high',
    severity: 'warning',
  },
  P0272: {
    description: 'Cylinder 4 Contribution/Balance',
    short: 'Cylinder 4 power balance fault',
    severity: 'warning',
  },
  P0273: {
    description: 'Cylinder 5 Injector "A" Circuit Low',
    short: 'Cylinder 5 injector low',
    severity: 'warning',
  },
  P0274: {
    description: 'Cylinder 5 Injector "A" Circuit High',
    short: 'Cylinder 5 injector high',
    severity: 'warning',
  },
  P0275: {
    description: 'Cylinder 5 Contribution/Balance',
    short: 'Cylinder 5 power balance fault',
    severity: 'warning',
  },
  P0276: {
    description: 'Cylinder 6 Injector "A" Circuit Low',
    short: 'Cylinder 6 injector low',
    severity: 'warning',
  },
  P0277: {
    description: 'Cylinder 6 Injector "A" Circuit High',
    short: 'Cylinder 6 injector high',
    severity: 'warning',
  },
  P0278: {
    description: 'Cylinder 6 Contribution/Balance',
    short: 'Cylinder 6 power balance fault',
    severity: 'warning',
  },
  P0279: {
    description: 'Cylinder 7 Injector "A" Circuit Low',
    short: 'Cylinder 7 injector low',
    severity: 'warning',
  },
  P0280: {
    description: 'Cylinder 7 Injector "A" Circuit High',
    short: 'Cylinder 7 injector high',
    severity: 'warning',
  },
  P0281: {
    description: 'Cylinder 7 Contribution/Balance',
    short: 'Cylinder 7 power balance fault',
    severity: 'warning',
  },
  P0282: {
    description: 'Cylinder 8 Injector "A" Circuit Low',
    short: 'Cylinder 8 injector low',
    severity: 'warning',
  },
  P0283: {
    description: 'Cylinder 8 Injector "A" Circuit High',
    short: 'Cylinder 8 injector high',
    severity: 'warning',
  },
  P0284: {
    description: 'Cylinder 8 Contribution/Balance',
    short: 'Cylinder 8 power balance fault',
    severity: 'warning',
  },
  P0285: {
    description: 'Cylinder 9 Injector "A" Circuit Low',
    short: 'Cylinder 9 injector low',
    severity: 'warning',
  },
  P0286: {
    description: 'Cylinder 9 Injector "A" Circuit High',
    short: 'Cylinder 9 injector high',
    severity: 'warning',
  },
  P0287: {
    description: 'Cylinder 9 Contribution/Balance',
    short: 'Cylinder 9 power balance fault',
    severity: 'warning',
  },
  P0288: {
    description: 'Cylinder 10 Injector "A" Circuit Low',
    short: 'Cylinder 10 injector low',
    severity: 'warning',
  },
  P0289: {
    description: 'Cylinder 10 Injector "A" Circuit High',
    short: 'Cylinder 10 injector high',
    severity: 'warning',
  },
  P0290: {
    description: 'Cylinder 10 Contribution/Balance',
    short: 'Cylinder 10 power balance fault',
    severity: 'warning',
  },
  P0291: {
    description: 'Cylinder 11 Injector "A" Circuit Low',
    short: 'Cylinder 11 injector low',
    severity: 'warning',
  },
  P0292: {
    description: 'Cylinder 11 Injector "A" Circuit High',
    short: 'Cylinder 11 injector high',
    severity: 'warning',
  },
  P0293: {
    description: 'Cylinder 11 Contribution/Balance',
    short: 'Cylinder 11 power balance fault',
    severity: 'warning',
  },
  P0294: {
    description: 'Cylinder 12 Injector "A" Circuit Low',
    short: 'Cylinder 12 injector low',
    severity: 'warning',
  },
  P0295: {
    description: 'Cylinder 12 Injector "A" Circuit High',
    short: 'Cylinder 12 injector high',
    severity: 'warning',
  },
  P0296: {
    description: 'Cylinder 12 Contribution/Balance',
    short: 'Cylinder 12 power balance fault',
    severity: 'warning',
  },
  P0297: {
    description: 'Vehicle Overspeed Condition',
    short: 'Vehicle overspeed',
    severity: 'caution',
  },
  P0298: {
    description: 'Engine Oil Over Temperature',
    short: 'Engine oil overheating',
    severity: 'critical',
  },
  P0299: {
    description: 'Turbocharger/Supercharger "A" Underboost Condition',
    short: 'Turbo underboost',
    severity: 'warning',
  },

  // P03xx — ignition system and misfire
  P0300: {
    description: 'Random/Multiple Cylinder Misfire Detected',
    short: 'Random/multiple misfire',
    severity: 'warning',
  },
  P0301: {
    description: 'Cylinder 1 Misfire Detected',
    short: 'Cylinder 1 misfire',
    severity: 'warning',
  },
  P0302: {
    description: 'Cylinder 2 Misfire Detected',
    short: 'Cylinder 2 misfire',
    severity: 'warning',
  },
  P0303: {
    description: 'Cylinder 3 Misfire Detected',
    short: 'Cylinder 3 misfire',
    severity: 'warning',
  },
  P0304: {
    description: 'Cylinder 4 Misfire Detected',
    short: 'Cylinder 4 misfire',
    severity: 'warning',
  },
  P0305: {
    description: 'Cylinder 5 Misfire Detected',
    short: 'Cylinder 5 misfire',
    severity: 'warning',
  },
  P0306: {
    description: 'Cylinder 6 Misfire Detected',
    short: 'Cylinder 6 misfire',
    severity: 'warning',
  },
  P0307: {
    description: 'Cylinder 7 Misfire Detected',
    short: 'Cylinder 7 misfire',
    severity: 'warning',
  },
  P0308: {
    description: 'Cylinder 8 Misfire Detected',
    short: 'Cylinder 8 misfire',
    severity: 'warning',
  },
  P0309: {
    description: 'Cylinder 9 Misfire Detected',
    short: 'Cylinder 9 misfire',
    severity: 'warning',
  },
  P0310: {
    description: 'Cylinder 10 Misfire Detected',
    short: 'Cylinder 10 misfire',
    severity: 'warning',
  },
  P0311: {
    description: 'Cylinder 11 Misfire Detected',
    short: 'Cylinder 11 misfire',
    severity: 'warning',
  },
  P0312: {
    description: 'Cylinder 12 Misfire Detected',
    short: 'Cylinder 12 misfire',
    severity: 'warning',
  },
  P0313: {
    description: 'Misfire Detected With Low Fuel',
    short: 'Misfire with low fuel',
    severity: 'warning',
  },
  P0314: {
    description: 'Single Cylinder Misfire (Cylinder not Specified)',
    short: 'Single cylinder misfire',
    severity: 'warning',
  },
  P0315: {
    description: 'Crankshaft Position System Variation Not Learned',
    short: 'Crank variation not learned',
    severity: 'caution',
  },
  P0316: {
    description: 'Engine Misfire Detected on Startup (First 1000 Revolutions)',
    short: 'Misfire on startup',
    severity: 'warning',
  },
  P0317: {
    description: 'Rough Road Hardware Not Present',
    short: 'Rough road sensor missing',
    severity: 'caution',
  },
  P0318: {
    description: 'Rough Road Sensor "A" Signal Circuit',
    short: 'Rough road sensor A circuit',
    severity: 'caution',
  },
  P0319: {
    description: 'Rough Road Sensor "B" Signal Circuit',
    short: 'Rough road sensor B circuit',
    severity: 'caution',
  },
  P0320: {
    description: 'Ignition/Distributor Engine Speed Input Circuit',
    short: 'Ignition RPM signal circuit',
    severity: 'warning',
  },
  P0321: {
    description: 'Ignition/Distributor Engine Speed Input Circuit Range/Performance',
    short: 'Ignition RPM signal out of range',
    severity: 'warning',
  },
  P0322: {
    description: 'Ignition/Distributor Engine Speed Input Circuit No Signal',
    short: 'Ignition RPM signal missing',
    severity: 'warning',
  },
  P0323: {
    description: 'Ignition/Distributor Engine Speed Input Circuit Intermittent',
    short: 'Ignition RPM signal intermittent',
    severity: 'warning',
  },
  P0324: {
    description: 'Knock/Combustion Vibration Control System Error',
    short: 'Knock control system error',
    severity: 'caution',
  },
  P0325: {
    description: 'Knock/Combustion Vibration Sensor "A" Circuit',
    short: 'Knock sensor A circuit',
    severity: 'caution',
  },
  P0326: {
    description: 'Knock/Combustion Vibration Sensor "A" Circuit Range/Performance',
    short: 'Knock sensor A out of range',
    severity: 'caution',
  },
  P0327: {
    description: 'Knock/Combustion Vibration Sensor "A" Circuit Low',
    short: 'Knock sensor A low',
    severity: 'caution',
  },
  P0328: {
    description: 'Knock/Combustion Vibration Sensor "A" Circuit High',
    short: 'Knock sensor A high',
    severity: 'caution',
  },
  P0329: {
    description: 'Knock/Combustion Vibration Sensor "A" Circuit Intermittent',
    short: 'Knock sensor A intermittent',
    severity: 'caution',
  },
  P0330: {
    description: 'Knock/Combustion Vibration Sensor "B" Circuit',
    short: 'Knock sensor B circuit',
    severity: 'caution',
  },
  P0331: {
    description: 'Knock/Combustion Vibration Sensor "B" Circuit Range/Performance',
    short: 'Knock sensor B out of range',
    severity: 'caution',
  },
  P0332: {
    description: 'Knock/Combustion Vibration Sensor "B" Circuit Low',
    short: 'Knock sensor B low',
    severity: 'caution',
  },
  P0333: {
    description: 'Knock/Combustion Vibration Sensor "B" Circuit High',
    short: 'Knock sensor B high',
    severity: 'caution',
  },
  P0334: {
    description: 'Knock/Combustion Vibration Sensor "B" Circuit Intermittent',
    short: 'Knock sensor B intermittent',
    severity: 'caution',
  },
  P0335: {
    description: 'Crankshaft Position Sensor "A" Circuit',
    short: 'Crank sensor A circuit',
    severity: 'warning',
  },
  P0336: {
    description: 'Crankshaft Position Sensor "A" Circuit Range/Performance',
    short: 'Crank sensor A out of range',
    severity: 'warning',
  },
  P0337: {
    description: 'Crankshaft Position Sensor "A" Circuit Low',
    short: 'Crank sensor A low',
    severity: 'warning',
  },
  P0338: {
    description: 'Crankshaft Position Sensor "A" Circuit High',
    short: 'Crank sensor A high',
    severity: 'warning',
  },
  P0339: {
    description: 'Crankshaft Position Sensor "A" Circuit Intermittent',
    short: 'Crank sensor A intermittent',
    severity: 'warning',
  },
  P0340: {
    description: 'Camshaft Position Sensor "A" Circuit (Bank 1 or Single Sensor)',
    short: 'Cam sensor A circuit (B1)',
    severity: 'warning',
  },
  P0341: {
    description: 'Camshaft Position Sensor "A" Circuit Range/Performance (Bank 1 or Single Sensor)',
    short: 'Cam sensor A out of range (B1)',
    severity: 'warning',
  },
  P0342: {
    description: 'Camshaft Position Sensor "A" Circuit Low (Bank 1 or Single Sensor)',
    short: 'Cam sensor A low (B1)',
    severity: 'warning',
  },
  P0343: {
    description: 'Camshaft Position Sensor "A" Circuit High (Bank 1 or Single Sensor)',
    short: 'Cam sensor A high (B1)',
    severity: 'warning',
  },
  P0344: {
    description: 'Camshaft Position Sensor "A" Circuit Intermittent (Bank 1 or Single Sensor)',
    short: 'Cam sensor A intermittent (B1)',
    severity: 'warning',
  },
  P0345: {
    description: 'Camshaft Position Sensor "A" Circuit (Bank 2)',
    short: 'Cam sensor A circuit (B2)',
    severity: 'warning',
  },
  P0346: {
    description: 'Camshaft Position Sensor "A" Circuit Range/Performance (Bank 2)',
    short: 'Cam sensor A out of range (B2)',
    severity: 'warning',
  },
  P0347: {
    description: 'Camshaft Position Sensor "A" Circuit Low (Bank 2)',
    short: 'Cam sensor A low (B2)',
    severity: 'warning',
  },
  P0348: {
    description: 'Camshaft Position Sensor "A" Circuit High (Bank 2)',
    short: 'Cam sensor A high (B2)',
    severity: 'warning',
  },
  P0349: {
    description: 'Camshaft Position Sensor "A" Circuit Intermittent (Bank 2)',
    short: 'Cam sensor A intermittent (B2)',
    severity: 'warning',
  },
  P0350: {
    description: 'Ignition Coil Primary/Secondary Circuit/Open',
    short: 'Ignition coil circuit',
    severity: 'warning',
  },
  P0351: {
    description: 'Ignition Coil "A" Primary Control Circuit/Open',
    short: 'Ignition coil A circuit',
    severity: 'warning',
  },
  P0352: {
    description: 'Ignition Coil "B" Primary Control Circuit/Open',
    short: 'Ignition coil B circuit',
    severity: 'warning',
  },
  P0353: {
    description: 'Ignition Coil "C" Primary Control Circuit/Open',
    short: 'Ignition coil C circuit',
    severity: 'warning',
  },
  P0354: {
    description: 'Ignition Coil "D" Primary Control Circuit/Open',
    short: 'Ignition coil D circuit',
    severity: 'warning',
  },
  P0355: {
    description: 'Ignition Coil "E" Primary Control Circuit/Open',
    short: 'Ignition coil E circuit',
    severity: 'warning',
  },
  P0356: {
    description: 'Ignition Coil "F" Primary Control Circuit/Open',
    short: 'Ignition coil F circuit',
    severity: 'warning',
  },
  P0357: {
    description: 'Ignition Coil "G" Primary Control Circuit/Open',
    short: 'Ignition coil G circuit',
    severity: 'warning',
  },
  P0358: {
    description: 'Ignition Coil "H" Primary Control Circuit/Open',
    short: 'Ignition coil H circuit',
    severity: 'warning',
  },
  P0359: {
    description: 'Ignition Coil "I" Primary Control Circuit/Open',
    short: 'Ignition coil I circuit',
    severity: 'warning',
  },
  P0360: {
    description: 'Ignition Coil "J" Primary Control Circuit/Open',
    short: 'Ignition coil J circuit',
    severity: 'warning',
  },
  P0361: {
    description: 'Ignition Coil "K" Primary Control Circuit/Open',
    short: 'Ignition coil K circuit',
    severity: 'warning',
  },
  P0362: {
    description: 'Ignition Coil "L" Primary Control Circuit/Open',
    short: 'Ignition coil L circuit',
    severity: 'warning',
  },
  P0363: {
    description: 'Misfire Detected - Fueling Disabled',
    short: 'Misfire - fuel cut to cylinder',
    severity: 'warning',
  },
  P0365: {
    description: 'Camshaft Position Sensor "B" Circuit (Bank 1)',
    short: 'Cam sensor B circuit (B1)',
    severity: 'warning',
  },
  P0366: {
    description: 'Camshaft Position Sensor "B" Circuit Range/Performance (Bank 1)',
    short: 'Cam sensor B out of range (B1)',
    severity: 'warning',
  },
  P0367: {
    description: 'Camshaft Position Sensor "B" Circuit Low (Bank 1)',
    short: 'Cam sensor B low (B1)',
    severity: 'warning',
  },
  P0368: {
    description: 'Camshaft Position Sensor "B" Circuit High (Bank 1)',
    short: 'Cam sensor B high (B1)',
    severity: 'warning',
  },
  P0369: {
    description: 'Camshaft Position Sensor "B" Circuit Intermittent (Bank 1)',
    short: 'Cam sensor B intermittent (B1)',
    severity: 'warning',
  },
  P0370: {
    description: 'Timing Reference High Resolution Signal "A"',
    short: 'Timing reference A signal',
    severity: 'warning',
  },
  P0371: {
    description: 'Timing Reference High Resolution Signal "A" Too Many Pulses',
    short: 'Timing ref A too many pulses',
    severity: 'warning',
  },
  P0372: {
    description: 'Timing Reference High Resolution Signal "A" Too Few Pulses',
    short: 'Timing ref A too few pulses',
    severity: 'warning',
  },
  P0373: {
    description: 'Timing Reference High Resolution Signal "A" Intermittent/Erratic Pulses',
    short: 'Timing ref A erratic pulses',
    severity: 'warning',
  },
  P0374: {
    description: 'Timing Reference High Resolution Signal "A" No Pulses',
    short: 'Timing ref A no pulses',
    severity: 'warning',
  },
  P0375: {
    description: 'Timing Reference High Resolution Signal "B"',
    short: 'Timing reference B signal',
    severity: 'warning',
  },
  P0376: {
    description: 'Timing Reference High Resolution Signal "B" Too Many Pulses',
    short: 'Timing ref B too many pulses',
    severity: 'warning',
  },
  P0377: {
    description: 'Timing Reference High Resolution Signal "B" Too Few Pulses',
    short: 'Timing ref B too few pulses',
    severity: 'warning',
  },
  P0378: {
    description: 'Timing Reference High Resolution Signal "B" Intermittent/Erratic Pulses',
    short: 'Timing ref B erratic pulses',
    severity: 'warning',
  },
  P0379: {
    description: 'Timing Reference High Resolution Signal "B" No Pulses',
    short: 'Timing ref B no pulses',
    severity: 'warning',
  },
  P0380: {
    description: 'Glow Plug/Heater Circuit "A"',
    short: 'Glow plug circuit A',
    severity: 'caution',
  },
  P0381: {
    description: 'Glow Plug/Heater Indicator Control Circuit/Open',
    short: 'Glow plug lamp circuit',
    severity: 'info',
  },
  P0382: {
    description: 'Glow Plug/Heater Circuit "B"',
    short: 'Glow plug circuit B',
    severity: 'caution',
  },
  P0383: {
    description: 'Glow Plug Control Module 1 Control Circuit Low',
    short: 'Glow plug module circuit low',
    severity: 'caution',
  },
  P0384: {
    description: 'Glow Plug Control Module 1 Control Circuit High',
    short: 'Glow plug module circuit high',
    severity: 'caution',
  },
  P0385: {
    description: 'Crankshaft Position Sensor "B" Circuit',
    short: 'Crank sensor B circuit',
    severity: 'warning',
  },
  P0386: {
    description: 'Crankshaft Position Sensor "B" Circuit Range/Performance',
    short: 'Crank sensor B out of range',
    severity: 'warning',
  },
  P0387: {
    description: 'Crankshaft Position Sensor "B" Circuit Low',
    short: 'Crank sensor B low',
    severity: 'warning',
  },
  P0388: {
    description: 'Crankshaft Position Sensor "B" Circuit High',
    short: 'Crank sensor B high',
    severity: 'warning',
  },
  P0389: {
    description: 'Crankshaft Position Sensor "B" Circuit Intermittent',
    short: 'Crank sensor B intermittent',
    severity: 'warning',
  },
  P0390: {
    description: 'Camshaft Position Sensor "B" Circuit (Bank 2)',
    short: 'Cam sensor B circuit (B2)',
    severity: 'warning',
  },
  P0391: {
    description: 'Camshaft Position Sensor "B" Circuit Range/Performance (Bank 2)',
    short: 'Cam sensor B out of range (B2)',
    severity: 'warning',
  },
  P0392: {
    description: 'Camshaft Position Sensor "B" Circuit Low (Bank 2)',
    short: 'Cam sensor B low (B2)',
    severity: 'warning',
  },
  P0393: {
    description: 'Camshaft Position Sensor "B" Circuit High (Bank 2)',
    short: 'Cam sensor B high (B2)',
    severity: 'warning',
  },
  P0394: {
    description: 'Camshaft Position Sensor "B" Circuit Intermittent (Bank 2)',
    short: 'Cam sensor B intermittent (B2)',
    severity: 'warning',
  },
  P0395: {
    description: 'Cylinder 1 Pressure Sensor Circuit',
    short: 'Cylinder 1 pressure sensor',
    severity: 'caution',
  },
  P0396: {
    description: 'Cylinder 1 Pressure Sensor Circuit Range/Performance',
    short: 'Cylinder 1 pressure sensor fault',
    severity: 'caution',
  },
  P0397: {
    description: 'Cylinder 1 Pressure Sensor Circuit Low',
    short: 'Cylinder 1 pressure sensor low',
    severity: 'caution',
  },
  P0398: {
    description: 'Cylinder 1 Pressure Sensor Circuit High',
    short: 'Cylinder 1 pressure sensor high',
    severity: 'caution',
  },
  P0399: {
    description: 'Cylinder 1 Pressure Sensor Circuit Intermittent/Erratic',
    short: 'Cyl 1 pressure sensor erratic',
    severity: 'caution',
  },

  // P04xx — auxiliary emission controls: EGR, secondary air, catalyst, EVAP, fans
  P0400: {
    description: 'Exhaust Gas Recirculation "A" Flow',
    short: 'EGR flow fault',
    severity: 'caution',
  },
  P0401: {
    description: 'Exhaust Gas Recirculation "A" Flow Insufficient Detected',
    short: 'EGR flow too low',
    severity: 'caution',
  },
  P0402: {
    description: 'Exhaust Gas Recirculation "A" Flow Excessive Detected',
    short: 'EGR flow too high',
    severity: 'caution',
  },
  P0403: {
    description: 'Exhaust Gas Recirculation "A" Control Circuit/Open',
    short: 'EGR valve control circuit',
    severity: 'caution',
  },
  P0404: {
    description: 'Exhaust Gas Recirculation "A" Control Circuit Range/Performance',
    short: 'EGR valve performance',
    severity: 'caution',
  },
  P0405: {
    description: 'Exhaust Gas Recirculation Sensor "A" Circuit Low',
    short: 'EGR sensor A low',
    severity: 'caution',
  },
  P0406: {
    description: 'Exhaust Gas Recirculation Sensor "A" Circuit High',
    short: 'EGR sensor A high',
    severity: 'caution',
  },
  P0407: {
    description: 'Exhaust Gas Recirculation Sensor "B" Circuit Low',
    short: 'EGR sensor B low',
    severity: 'caution',
  },
  P0408: {
    description: 'Exhaust Gas Recirculation Sensor "B" Circuit High',
    short: 'EGR sensor B high',
    severity: 'caution',
  },
  P0409: {
    description: 'Exhaust Gas Recirculation Sensor "A" Circuit',
    short: 'EGR sensor A circuit',
    severity: 'caution',
  },
  P0410: {
    description: 'Secondary Air Injection System "A"',
    short: 'Secondary air injection fault',
    severity: 'caution',
  },
  P0411: {
    description: 'Secondary Air Injection System "A" Incorrect Flow Detected',
    short: 'Secondary air flow incorrect',
    severity: 'caution',
  },
  P0412: {
    description: 'Secondary Air Injection System Switching Valve "A" Circuit',
    short: 'Secondary air valve A circuit',
    severity: 'caution',
  },
  P0413: {
    description: 'Secondary Air Injection System Switching Valve "A" Circuit Open',
    short: 'Sec. air valve A circuit open',
    severity: 'caution',
  },
  P0414: {
    description: 'Secondary Air Injection System Switching Valve "A" Circuit Shorted',
    short: 'Secondary air valve A shorted',
    severity: 'caution',
  },
  P0415: {
    description: 'Secondary Air Injection System Switching Valve "B" Circuit',
    short: 'Secondary air valve B circuit',
    severity: 'caution',
  },
  P0416: {
    description: 'Secondary Air Injection System Switching Valve "B" Circuit Open',
    short: 'Sec. air valve B circuit open',
    severity: 'caution',
  },
  P0417: {
    description: 'Secondary Air Injection System Switching Valve "B" Circuit Shorted',
    short: 'Secondary air valve B shorted',
    severity: 'caution',
  },
  P0418: {
    description: 'Secondary Air Injection System Control "A" Circuit',
    short: 'Secondary air control A circuit',
    severity: 'caution',
  },
  P0419: {
    description: 'Secondary Air Injection System Control "B" Circuit',
    short: 'Secondary air control B circuit',
    severity: 'caution',
  },
  P0420: {
    description: 'Catalyst System Efficiency Below Threshold (Bank 1)',
    short: 'Catalytic converter efficiency',
    severity: 'caution',
  },
  P0421: {
    description: 'Warm Up Catalyst Efficiency Below Threshold (Bank 1)',
    short: 'Warm-up catalyst efficiency',
    severity: 'caution',
  },
  P0422: {
    description: 'Main Catalyst Efficiency Below Threshold (Bank 1)',
    short: 'Main catalyst efficiency',
    severity: 'caution',
  },
  P0423: {
    description: 'Heated Catalyst Efficiency Below Threshold (Bank 1)',
    short: 'Heated catalyst efficiency',
    severity: 'caution',
  },
  P0424: {
    description: 'Heated Catalyst Temperature Below Threshold (Bank 1)',
    short: 'Heated catalyst too cold',
    severity: 'caution',
  },
  P0425: {
    description: 'Catalyst Temperature Sensor Circuit (Bank 1 Sensor 1)',
    short: 'Catalyst temp sensor (B1)',
    severity: 'caution',
  },
  P0426: {
    description: 'Catalyst Temperature Sensor Circuit Range/Performance (Bank 1 Sensor 1)',
    short: 'Catalyst temp sensor fault (B1)',
    severity: 'caution',
  },
  P0427: {
    description: 'Catalyst Temperature Sensor Circuit Low (Bank 1 Sensor 1)',
    short: 'Catalyst temp sensor low (B1)',
    severity: 'caution',
  },
  P0428: {
    description: 'Catalyst Temperature Sensor Circuit High (Bank 1 Sensor 1)',
    short: 'Catalyst temp sensor high (B1)',
    severity: 'caution',
  },
  P0429: {
    description: 'Catalyst Heater Control Circuit/Open (Bank 1)',
    short: 'Catalyst heater circuit (B1)',
    severity: 'caution',
  },
  P042E: {
    description: 'Exhaust Gas Recirculation "A" Control Stuck Open',
    short: 'EGR valve stuck open',
    severity: 'warning',
  },
  P042F: {
    description: 'Exhaust Gas Recirculation "A" Control Stuck Closed',
    short: 'EGR valve stuck closed',
    severity: 'caution',
  },
  P0430: {
    description: 'Catalyst System Efficiency Below Threshold (Bank 2)',
    short: 'Catalytic converter eff. (B2)',
    severity: 'caution',
  },
  P0431: {
    description: 'Warm Up Catalyst Efficiency Below Threshold (Bank 2)',
    short: 'Warm-up catalyst eff. (B2)',
    severity: 'caution',
  },
  P0432: {
    description: 'Main Catalyst Efficiency Below Threshold (Bank 2)',
    short: 'Main catalyst efficiency (B2)',
    severity: 'caution',
  },
  P0433: {
    description: 'Heated Catalyst Efficiency Below Threshold (Bank 2)',
    short: 'Heated catalyst eff. (B2)',
    severity: 'caution',
  },
  P0434: {
    description: 'Heated Catalyst Temperature Below Threshold (Bank 2)',
    short: 'Heated catalyst too cold (B2)',
    severity: 'caution',
  },
  P0435: {
    description: 'Catalyst Temperature Sensor Circuit (Bank 2 Sensor 1)',
    short: 'Catalyst temp sensor (B2)',
    severity: 'caution',
  },
  P0436: {
    description: 'Catalyst Temperature Sensor Circuit Range/Performance (Bank 2 Sensor 1)',
    short: 'Catalyst temp sensor fault (B2)',
    severity: 'caution',
  },
  P0437: {
    description: 'Catalyst Temperature Sensor Circuit Low (Bank 2 Sensor 1)',
    short: 'Catalyst temp sensor low (B2)',
    severity: 'caution',
  },
  P0438: {
    description: 'Catalyst Temperature Sensor Circuit High (Bank 2 Sensor 1)',
    short: 'Catalyst temp sensor high (B2)',
    severity: 'caution',
  },
  P0439: {
    description: 'Catalyst Heater Control Circuit/Open (Bank 2)',
    short: 'Catalyst heater circuit (B2)',
    severity: 'caution',
  },
  P043E: {
    description: 'Evaporative Emission System Leak Detection Reference Orifice Low Flow',
    short: 'EVAP leak test flow too low',
    severity: 'caution',
  },
  P043F: {
    description: 'Evaporative Emission System Leak Detection Reference Orifice High Flow',
    short: 'EVAP leak test flow too high',
    severity: 'caution',
  },
  P0440: {
    description: 'Evaporative Emission System',
    short: 'Fuel vapor system (EVAP) fault',
    severity: 'caution',
  },
  P0441: {
    description: 'Evaporative Emission System Incorrect Purge Flow',
    short: 'EVAP purge flow incorrect',
    severity: 'caution',
  },
  P0442: {
    description: 'Evaporative Emission System Leak Detected (small leak)',
    short: 'Small fuel vapor leak (EVAP)',
    severity: 'info',
  },
  P0443: {
    description: 'Evaporative Emission System Purge Control Valve "A" Circuit',
    short: 'EVAP purge valve circuit',
    severity: 'caution',
  },
  P0444: {
    description: 'Evaporative Emission System Purge Control Valve "A" Circuit Open',
    short: 'EVAP purge valve circuit open',
    severity: 'caution',
  },
  P0445: {
    description: 'Evaporative Emission System Purge Control Valve "A" Circuit Shorted',
    short: 'EVAP purge valve circuit shorted',
    severity: 'caution',
  },
  P0446: {
    description: 'Evaporative Emission System Vent Control Circuit',
    short: 'EVAP vent control circuit',
    severity: 'caution',
  },
  P0447: {
    description: 'Evaporative Emission System Vent Control Circuit Open',
    short: 'EVAP vent control circuit open',
    severity: 'caution',
  },
  P0448: {
    description: 'Evaporative Emission System Vent Control Circuit Shorted',
    short: 'EVAP vent control shorted',
    severity: 'caution',
  },
  P0449: {
    description: 'Evaporative Emission System Vent Valve Control Circuit/Open',
    short: 'EVAP vent valve circuit',
    severity: 'caution',
  },
  P0450: {
    description: 'Evaporative Emission System Pressure Sensor/Switch "A" Circuit',
    short: 'EVAP pressure sensor circuit',
    severity: 'caution',
  },
  P0451: {
    description: 'Evaporative Emission System Pressure Sensor/Switch "A" Circuit Range/Performance',
    short: 'EVAP pressure sensor fault',
    severity: 'caution',
  },
  P0452: {
    description: 'Evaporative Emission System Pressure Sensor/Switch "A" Circuit Low',
    short: 'EVAP pressure sensor low',
    severity: 'caution',
  },
  P0453: {
    description: 'Evaporative Emission System Pressure Sensor/Switch "A" Circuit High',
    short: 'EVAP pressure sensor high',
    severity: 'caution',
  },
  P0454: {
    description: 'Evaporative Emission System Pressure Sensor/Switch "A" Circuit Intermittent',
    short: 'EVAP pressure sensor erratic',
    severity: 'caution',
  },
  P0455: {
    description: 'Evaporative Emission System Leak Detected (large leak)',
    short: 'Large fuel vapor leak (EVAP)',
    severity: 'caution',
  },
  P0456: {
    description: 'Evaporative Emission System Leak Detected (very small leak)',
    short: 'Tiny fuel vapor leak (EVAP)',
    severity: 'info',
  },
  P0457: {
    description: 'Evaporative Emission System Leak Detected (fuel cap loose/off)',
    short: 'Fuel cap loose or missing',
    severity: 'info',
  },
  P0458: {
    description: 'Evaporative Emission System Purge Control Valve "A" Circuit Low',
    short: 'EVAP purge valve low',
    severity: 'caution',
  },
  P0459: {
    description: 'Evaporative Emission System Purge Control Valve "A" Circuit High',
    short: 'EVAP purge valve high',
    severity: 'caution',
  },
  P0460: {
    description: 'Fuel Level Sensor "A" Circuit',
    short: 'Fuel level sensor circuit',
    severity: 'caution',
  },
  P0461: {
    description: 'Fuel Level Sensor "A" Circuit Range/Performance',
    short: 'Fuel level sensor out of range',
    severity: 'caution',
  },
  P0462: {
    description: 'Fuel Level Sensor "A" Circuit Low',
    short: 'Fuel level sensor signal low',
    severity: 'caution',
  },
  P0463: {
    description: 'Fuel Level Sensor "A" Circuit High',
    short: 'Fuel level sensor signal high',
    severity: 'caution',
  },
  P0464: {
    description: 'Fuel Level Sensor "A" Circuit Intermittent',
    short: 'Fuel level sensor intermittent',
    severity: 'caution',
  },
  P0465: {
    description: 'EVAP Purge Flow Sensor Circuit',
    short: 'EVAP flow sensor circuit',
    severity: 'caution',
  },
  P0466: {
    description: 'EVAP Purge Flow Sensor Circuit Range/Performance',
    short: 'EVAP flow sensor out of range',
    severity: 'caution',
  },
  P0467: {
    description: 'EVAP Purge Flow Sensor Circuit Low',
    short: 'EVAP flow sensor low',
    severity: 'caution',
  },
  P0468: {
    description: 'EVAP Purge Flow Sensor Circuit High',
    short: 'EVAP flow sensor high',
    severity: 'caution',
  },
  P0469: {
    description: 'EVAP Purge Flow Sensor Circuit Intermittent',
    short: 'EVAP flow sensor intermittent',
    severity: 'caution',
  },
  P0470: {
    description: 'Exhaust Pressure Sensor "A" Circuit',
    short: 'Exhaust pressure sensor circuit',
    severity: 'caution',
  },
  P0471: {
    description: 'Exhaust Pressure Sensor "A" Circuit Range/Performance',
    short: 'Exhaust pressure sensor fault',
    severity: 'caution',
  },
  P0472: {
    description: 'Exhaust Pressure Sensor "A" Circuit Low',
    short: 'Exhaust pressure sensor low',
    severity: 'caution',
  },
  P0473: {
    description: 'Exhaust Pressure Sensor "A" Circuit High',
    short: 'Exhaust pressure sensor high',
    severity: 'caution',
  },
  P0474: {
    description: 'Exhaust Pressure Sensor "A" Circuit Intermittent/Erratic',
    short: 'Exhaust pressure sensor erratic',
    severity: 'caution',
  },
  P0475: {
    description: 'Exhaust Pressure Control Valve "A"',
    short: 'Exhaust pressure valve fault',
    severity: 'caution',
  },
  P0476: {
    description: 'Exhaust Pressure Control Valve "A" Range/Performance',
    short: 'Exhaust pressure valve fault',
    severity: 'caution',
  },
  P0477: {
    description: 'Exhaust Pressure Control Valve "A" Low',
    short: 'Exhaust pressure valve low',
    severity: 'caution',
  },
  P0478: {
    description: 'Exhaust Pressure Control Valve "A" High',
    short: 'Exhaust pressure valve high',
    severity: 'caution',
  },
  P0479: {
    description: 'Exhaust Pressure Control Valve "A" Intermittent',
    short: 'Exhaust pressure valve erratic',
    severity: 'caution',
  },
  P0480: {
    description: 'Fan 1 Control Circuit',
    short: 'Cooling fan 1 circuit',
    severity: 'warning',
  },
  P0481: {
    description: 'Fan 2 Control Circuit',
    short: 'Cooling fan 2 circuit',
    severity: 'warning',
  },
  P0482: {
    description: 'Fan 3 Control Circuit',
    short: 'Cooling fan 3 circuit',
    severity: 'warning',
  },
  P0483: {
    description: 'Fan Rationality Check',
    short: 'Cooling fan check failed',
    severity: 'warning',
  },
  P0484: {
    description: 'Fan Circuit Current High',
    short: 'Cooling fan over current',
    severity: 'warning',
  },
  P0485: {
    description: 'Fan Power/Ground Circuit',
    short: 'Cooling fan power/ground',
    severity: 'warning',
  },
  P0486: {
    description: 'Exhaust Gas Recirculation Sensor "B" Circuit',
    short: 'EGR sensor B circuit',
    severity: 'caution',
  },
  P0487: {
    description: 'Exhaust Gas Recirculation Throttle Control Circuit "A"/Open',
    short: 'EGR throttle control circuit',
    severity: 'caution',
  },
  P0488: {
    description: 'Exhaust Gas Recirculation Throttle Control Circuit "A" Range/Performance',
    short: 'EGR throttle control fault',
    severity: 'caution',
  },
  P0489: {
    description: 'Exhaust Gas Recirculation "A" Control Circuit Low',
    short: 'EGR control circuit low',
    severity: 'caution',
  },
  P0490: {
    description: 'Exhaust Gas Recirculation "A" Control Circuit High',
    short: 'EGR control circuit high',
    severity: 'caution',
  },
  P0491: {
    description: 'Secondary Air Injection System Insufficient Flow (Bank 1)',
    short: 'Secondary air flow low (B1)',
    severity: 'caution',
  },
  P0492: {
    description: 'Secondary Air Injection System Insufficient Flow (Bank 2)',
    short: 'Secondary air flow low (B2)',
    severity: 'caution',
  },
  P0493: { description: 'Fan Overspeed', short: 'Cooling fan overspeed', severity: 'caution' },
  P0494: { description: 'Fan Speed Low', short: 'Cooling fan speed low', severity: 'warning' },
  P0495: { description: 'Fan Speed High', short: 'Cooling fan speed high', severity: 'caution' },
  P0496: {
    description: 'Evaporative Emission System High Purge Flow',
    short: 'EVAP purge flow too high',
    severity: 'caution',
  },
  P0497: {
    description: 'Evaporative Emission System Low Purge Flow',
    short: 'EVAP purge flow too low',
    severity: 'caution',
  },
  P0498: {
    description: 'Evaporative Emission System Vent Valve Control Circuit Low',
    short: 'EVAP vent valve low',
    severity: 'caution',
  },
  P0499: {
    description: 'Evaporative Emission System Vent Valve Control Circuit High',
    short: 'EVAP vent valve high',
    severity: 'caution',
  },
  P04DB: {
    description: 'Crankcase Ventilation System Disconnected',
    short: 'PCV hose disconnected',
    severity: 'caution',
  },
  P04DF: {
    description: 'Evaporative Emission System Purge Control Valve "A" Performance/Stuck Open',
    short: 'EVAP purge valve stuck open',
    severity: 'caution',
  },
  P04E0: {
    description: 'Evaporative Emission System Purge Control Valve "A" Stuck Closed',
    short: 'EVAP purge valve stuck closed',
    severity: 'caution',
  },

  // P05xx — vehicle speed, idle and cruise control, auxiliary inputs, system voltage
  P0500: {
    description: 'Vehicle Speed Sensor "A" Circuit',
    short: 'Vehicle speed sensor circuit',
    severity: 'warning',
  },
  P0501: {
    description: 'Vehicle Speed Sensor "A" Circuit Range/Performance',
    short: 'Vehicle speed sensor fault',
    severity: 'warning',
  },
  P0502: {
    description: 'Vehicle Speed Sensor "A" Circuit Low',
    short: 'Vehicle speed sensor low',
    severity: 'warning',
  },
  P0503: {
    description: 'Vehicle Speed Sensor "A" Circuit Intermittent/Erratic/High',
    short: 'Vehicle speed sensor erratic',
    severity: 'warning',
  },
  P0504: {
    description: 'Brake Switch "A"/"B" Correlation',
    short: 'Brake switch A/B mismatch',
    severity: 'warning',
  },
  P0505: { description: 'Idle Control System', short: 'Idle control fault', severity: 'caution' },
  P0506: {
    description: 'Idle Control System RPM Lower Than Expected',
    short: 'Idle speed too low',
    severity: 'caution',
  },
  P0507: {
    description: 'Idle Control System RPM Higher Than Expected',
    short: 'Idle speed too high',
    severity: 'caution',
  },
  P0508: {
    description: 'Idle Air Control System Circuit Low',
    short: 'Idle air valve low',
    severity: 'caution',
  },
  P0509: {
    description: 'Idle Air Control System Circuit High',
    short: 'Idle air valve high',
    severity: 'caution',
  },
  P050A: {
    description: 'Cold Start Idle Air Control System Performance',
    short: 'Cold start idle control fault',
    severity: 'caution',
  },
  P050B: {
    description: 'Cold Start Ignition Timing Performance',
    short: 'Cold start ignition timing',
    severity: 'caution',
  },
  P050C: {
    description: 'Cold Start Engine Coolant Temperature Performance',
    short: 'Cold start coolant temp fault',
    severity: 'caution',
  },
  P050D: {
    description: 'Cold Start Rough Idle',
    short: 'Rough idle when cold',
    severity: 'caution',
  },
  P050E: {
    description: 'Cold Start Engine Exhaust Temperature Too Low',
    short: 'Cold start exhaust too cool',
    severity: 'caution',
  },
  P0510: {
    description: 'Closed Throttle Position Switch',
    short: 'Closed throttle switch fault',
    severity: 'caution',
  },
  P0511: {
    description: 'Idle Air Control Circuit',
    short: 'Idle air valve circuit',
    severity: 'caution',
  },
  P0512: {
    description: 'Starter Request Circuit',
    short: 'Start request signal fault',
    severity: 'warning',
  },
  P0513: {
    description: 'Incorrect Immobilizer Key',
    short: 'Immobilizer key not accepted',
    severity: 'warning',
  },
  P0514: {
    description: 'Battery Temperature Sensor Circuit Range/Performance',
    short: 'Battery temp sensor out of range',
    severity: 'caution',
  },
  P0515: {
    description: 'Battery Temperature Sensor Circuit',
    short: 'Battery temp sensor circuit',
    severity: 'caution',
  },
  P0516: {
    description: 'Battery Temperature Sensor Circuit Low',
    short: 'Battery temp sensor low',
    severity: 'caution',
  },
  P0517: {
    description: 'Battery Temperature Sensor Circuit High',
    short: 'Battery temp sensor high',
    severity: 'caution',
  },
  P0518: {
    description: 'Idle Air Control Circuit Intermittent',
    short: 'Idle air valve intermittent',
    severity: 'caution',
  },
  P0519: {
    description: 'Idle Air Control System Performance',
    short: 'Idle control performance',
    severity: 'caution',
  },
  P0520: {
    description: 'Engine Oil Pressure Sensor/Switch "A" Circuit',
    short: 'Oil pressure sensor circuit',
    severity: 'warning',
  },
  P0521: {
    description: 'Engine Oil Pressure Sensor/Switch "A" Range/Performance',
    short: 'Oil pressure sensor out of range',
    severity: 'warning',
  },
  P0522: {
    description: 'Engine Oil Pressure Sensor/Switch "A" Low',
    short: 'Oil pressure sensor signal low',
    severity: 'warning',
  },
  P0523: {
    description: 'Engine Oil Pressure Sensor/Switch "A" High',
    short: 'Oil pressure sensor signal high',
    severity: 'warning',
  },
  P0524: {
    description: 'Engine Oil Pressure Too Low',
    short: 'Oil pressure too low',
    severity: 'critical',
  },
  P0525: {
    description: 'Cruise Control Servo Control Circuit Range/Performance',
    short: 'Cruise servo out of range',
    severity: 'info',
  },
  P0526: {
    description: 'Fan Speed Sensor Circuit',
    short: 'Cooling fan speed sensor circuit',
    severity: 'caution',
  },
  P0527: {
    description: 'Fan Speed Sensor Circuit Range/Performance',
    short: 'Fan speed sensor out of range',
    severity: 'caution',
  },
  P0528: {
    description: 'Fan Speed Sensor Circuit No Signal',
    short: 'Fan speed sensor no signal',
    severity: 'caution',
  },
  P0529: {
    description: 'Fan Speed Sensor Circuit Intermittent',
    short: 'Cooling fan speed sensor erratic',
    severity: 'caution',
  },
  P0530: {
    description: 'A/C Refrigerant Pressure Sensor "A" Circuit',
    short: 'A/C pressure sensor circuit',
    severity: 'info',
  },
  P0531: {
    description: 'A/C Refrigerant Pressure Sensor "A" Circuit Range/Performance',
    short: 'A/C pressure sensor out of range',
    severity: 'info',
  },
  P0532: {
    description: 'A/C Refrigerant Pressure Sensor "A" Circuit Low',
    short: 'A/C pressure sensor low',
    severity: 'info',
  },
  P0533: {
    description: 'A/C Refrigerant Pressure Sensor "A" Circuit High',
    short: 'A/C pressure sensor high',
    severity: 'info',
  },
  P0534: {
    description: 'A/C Refrigerant Charge Loss',
    short: 'A/C refrigerant low',
    severity: 'info',
  },
  P0535: {
    description: 'A/C Evaporator Temperature Sensor Circuit',
    short: 'A/C evaporator temp sensor',
    severity: 'info',
  },
  P0536: {
    description: 'A/C Evaporator Temperature Sensor Circuit Range/Performance',
    short: 'A/C evaporator temp sensor fault',
    severity: 'info',
  },
  P0537: {
    description: 'A/C Evaporator Temperature Sensor Circuit Low',
    short: 'A/C evaporator temp sensor low',
    severity: 'info',
  },
  P0538: {
    description: 'A/C Evaporator Temperature Sensor Circuit High',
    short: 'A/C evaporator temp sensor high',
    severity: 'info',
  },
  P0539: {
    description: 'A/C Evaporator Temperature Sensor Circuit Intermittent',
    short: 'A/C evap temp sensor erratic',
    severity: 'info',
  },
  P0540: {
    description: 'Intake Air Heater "A" Circuit',
    short: 'Intake air heater circuit',
    severity: 'caution',
  },
  P0541: {
    description: 'Intake Air Heater "A" Circuit Low',
    short: 'Intake air heater low',
    severity: 'caution',
  },
  P0542: {
    description: 'Intake Air Heater "A" Circuit High',
    short: 'Intake air heater high',
    severity: 'caution',
  },
  P0543: {
    description: 'Intake Air Heater "A" Circuit Open',
    short: 'Intake air heater circuit open',
    severity: 'caution',
  },
  P0544: {
    description: 'Exhaust Gas Temperature Sensor Circuit (Bank 1 Sensor 1)',
    short: 'Exhaust temp sensor (B1)',
    severity: 'caution',
  },
  P0545: {
    description: 'Exhaust Gas Temperature Sensor Circuit Low (Bank 1 Sensor 1)',
    short: 'Exhaust temp sensor low (B1)',
    severity: 'caution',
  },
  P0546: {
    description: 'Exhaust Gas Temperature Sensor Circuit High (Bank 1 Sensor 1)',
    short: 'Exhaust temp sensor high (B1)',
    severity: 'caution',
  },
  P0547: {
    description: 'Exhaust Gas Temperature Sensor Circuit (Bank 2 Sensor 1)',
    short: 'Exhaust temp sensor (B2)',
    severity: 'caution',
  },
  P0548: {
    description: 'Exhaust Gas Temperature Sensor Circuit Low (Bank 2 Sensor 1)',
    short: 'Exhaust temp sensor low (B2)',
    severity: 'caution',
  },
  P0549: {
    description: 'Exhaust Gas Temperature Sensor Circuit High (Bank 2 Sensor 1)',
    short: 'Exhaust temp sensor high (B2)',
    severity: 'caution',
  },
  P0550: {
    description: 'Power Steering Pressure Sensor/Switch Circuit',
    short: 'Power steering pressure sensor',
    severity: 'caution',
  },
  P0551: {
    description: 'Power Steering Pressure Sensor/Switch Circuit Range/Performance',
    short: 'Steering pressure sensor fault',
    severity: 'caution',
  },
  P0552: {
    description: 'Power Steering Pressure Sensor/Switch Circuit Low',
    short: 'Steering pressure sensor low',
    severity: 'caution',
  },
  P0553: {
    description: 'Power Steering Pressure Sensor/Switch Circuit High',
    short: 'Steering pressure sensor high',
    severity: 'caution',
  },
  P0554: {
    description: 'Power Steering Pressure Sensor/Switch Circuit Intermittent',
    short: 'Steering pressure sensor erratic',
    severity: 'caution',
  },
  P0555: {
    description: 'Brake Booster Pressure Sensor Circuit',
    short: 'Brake booster sensor circuit',
    severity: 'warning',
  },
  P0556: {
    description: 'Brake Booster Pressure Sensor Circuit Range/Performance',
    short: 'Brake booster sensor fault',
    severity: 'warning',
  },
  P0557: {
    description: 'Brake Booster Pressure Sensor Circuit Low',
    short: 'Brake booster sensor low',
    severity: 'warning',
  },
  P0558: {
    description: 'Brake Booster Pressure Sensor Circuit High',
    short: 'Brake booster sensor high',
    severity: 'warning',
  },
  P0559: {
    description: 'Brake Booster Pressure Sensor Circuit Intermittent',
    short: 'Brake booster sensor erratic',
    severity: 'warning',
  },
  P0560: {
    description: 'System Voltage',
    short: 'Battery/charging voltage fault',
    severity: 'warning',
  },
  P0561: {
    description: 'System Voltage Unstable',
    short: 'Battery voltage unstable',
    severity: 'warning',
  },
  P0562: { description: 'System Voltage Low', short: 'Battery voltage low', severity: 'warning' },
  P0563: {
    description: 'System Voltage High',
    short: 'Charging voltage too high',
    severity: 'warning',
  },
  P0564: {
    description: 'Cruise Control Multi-Function Input "A" Circuit',
    short: 'Cruise control switch A',
    severity: 'info',
  },
  P0565: {
    description: 'Cruise Control On Signal',
    short: 'Cruise on signal fault',
    severity: 'info',
  },
  P0566: {
    description: 'Cruise Control Off Signal',
    short: 'Cruise off signal fault',
    severity: 'info',
  },
  P0567: {
    description: 'Cruise Control Resume Signal',
    short: 'Cruise resume signal fault',
    severity: 'info',
  },
  P0568: {
    description: 'Cruise Control Set Signal',
    short: 'Cruise set signal fault',
    severity: 'info',
  },
  P0569: {
    description: 'Cruise Control Coast Signal',
    short: 'Cruise coast signal fault',
    severity: 'info',
  },
  P0570: {
    description: 'Cruise Control Accelerate Signal',
    short: 'Cruise accel signal fault',
    severity: 'info',
  },
  P0571: {
    description: 'Brake Switch "A" Circuit',
    short: 'Brake switch A circuit',
    severity: 'warning',
  },
  P0572: {
    description: 'Brake Switch "A" Circuit Low',
    short: 'Brake switch A low',
    severity: 'warning',
  },
  P0573: {
    description: 'Brake Switch "A" Circuit High',
    short: 'Brake switch A high',
    severity: 'warning',
  },
  P0574: {
    description: 'Cruise Control System - Vehicle Speed Too High',
    short: 'Cruise speed too high',
    severity: 'info',
  },
  P0575: {
    description: 'Cruise Control Input Circuit',
    short: 'Cruise switch input circuit',
    severity: 'info',
  },
  P0576: {
    description: 'Cruise Control Input Circuit Low',
    short: 'Cruise switch input low',
    severity: 'info',
  },
  P0577: {
    description: 'Cruise Control Input Circuit High',
    short: 'Cruise switch input high',
    severity: 'info',
  },
  P0578: {
    description: 'Cruise Control Multi-Function Input "A" Circuit Stuck',
    short: 'Cruise control switch A stuck',
    severity: 'info',
  },
  P0579: {
    description: 'Cruise Control Multi-Function Input "A" Circuit Range/Performance',
    short: 'Cruise control switch A fault',
    severity: 'info',
  },
  P0580: {
    description: 'Cruise Control Multi-Function Input "A" Circuit Low',
    short: 'Cruise control switch A low',
    severity: 'info',
  },
  P0581: {
    description: 'Cruise Control Multi-Function Input "A" Circuit High',
    short: 'Cruise control switch A high',
    severity: 'info',
  },
  P0582: {
    description: 'Cruise Control Vacuum Control Circuit/Open',
    short: 'Cruise vacuum control circuit',
    severity: 'info',
  },
  P0583: {
    description: 'Cruise Control Vacuum Control Circuit Low',
    short: 'Cruise vacuum control low',
    severity: 'info',
  },
  P0584: {
    description: 'Cruise Control Vacuum Control Circuit High',
    short: 'Cruise vacuum control high',
    severity: 'info',
  },
  P0585: {
    description: 'Cruise Control Multi-Function Input "A"/"B" Correlation',
    short: 'Cruise switch A/B mismatch',
    severity: 'info',
  },
  P0586: {
    description: 'Cruise Control Vent Control Circuit/Open',
    short: 'Cruise vent control circuit',
    severity: 'info',
  },
  P0587: {
    description: 'Cruise Control Vent Control Circuit Low',
    short: 'Cruise vent control low',
    severity: 'info',
  },
  P0588: {
    description: 'Cruise Control Vent Control Circuit High',
    short: 'Cruise vent control high',
    severity: 'info',
  },
  P0589: {
    description: 'Cruise Control Multi-Function Input "B" Circuit',
    short: 'Cruise control switch B circuit',
    severity: 'info',
  },
  P0590: {
    description: 'Cruise Control Multi-Function Input "B" Circuit Stuck',
    short: 'Cruise control switch B stuck',
    severity: 'info',
  },
  P0591: {
    description: 'Cruise Control Multi-Function Input "B" Circuit Range/Performance',
    short: 'Cruise control switch B fault',
    severity: 'info',
  },
  P0592: {
    description: 'Cruise Control Multi-Function Input "B" Circuit Low',
    short: 'Cruise control switch B low',
    severity: 'info',
  },
  P0593: {
    description: 'Cruise Control Multi-Function Input "B" Circuit High',
    short: 'Cruise control switch B high',
    severity: 'info',
  },
  P0594: {
    description: 'Cruise Control Servo Control Circuit/Open',
    short: 'Cruise servo control circuit',
    severity: 'info',
  },
  P0595: {
    description: 'Cruise Control Servo Control Circuit Low',
    short: 'Cruise servo control low',
    severity: 'info',
  },
  P0596: {
    description: 'Cruise Control Servo Control Circuit High',
    short: 'Cruise servo control high',
    severity: 'info',
  },
  P0597: {
    description: 'Thermostat Heater Control Circuit/Open',
    short: 'Thermostat heater circuit',
    severity: 'caution',
  },
  P0598: {
    description: 'Thermostat Heater Control Circuit Low',
    short: 'Thermostat heater low',
    severity: 'caution',
  },
  P0599: {
    description: 'Thermostat Heater Control Circuit High',
    short: 'Thermostat heater high',
    severity: 'caution',
  },
  P059F: {
    description: 'Active Grille Air Shutter "A" Performance/Stuck Off',
    short: 'Grille shutter A not working',
    severity: 'caution',
  },

  // P06xx — control modules and output circuits
  P0600: {
    description: 'Serial Communication Link',
    short: 'Engine computer comms link',
    severity: 'warning',
  },
  P0601: {
    description: 'Internal Control Module Memory Checksum Error',
    short: 'Engine computer checksum error',
    severity: 'warning',
  },
  P0602: {
    description: 'Control Module Programming Error',
    short: 'Engine computer program error',
    severity: 'warning',
  },
  P0603: {
    description: 'Internal Control Module Keep Alive Memory (KAM) Error',
    short: 'Engine computer memory (KAM)',
    severity: 'warning',
  },
  P0604: {
    description: 'Internal Control Module Random Access Memory (RAM) Error',
    short: 'Engine computer RAM error',
    severity: 'warning',
  },
  P0605: {
    description: 'Internal Control Module Read Only Memory (ROM) Error',
    short: 'Engine computer ROM error',
    severity: 'warning',
  },
  P0606: {
    description: 'Control Module Processor',
    short: 'Engine computer processor fault',
    severity: 'warning',
  },
  P0607: {
    description: 'Control Module Performance',
    short: 'Engine computer performance',
    severity: 'warning',
  },
  P0608: {
    description: 'Control Module VSS Output "A"',
    short: 'Speed signal output A',
    severity: 'caution',
  },
  P0609: {
    description: 'Control Module VSS Output "B"',
    short: 'Speed signal output B',
    severity: 'caution',
  },
  P060A: {
    description: 'Internal Control Module Monitoring Processor Performance',
    short: 'Engine computer monitor fault',
    severity: 'warning',
  },
  P060B: {
    description: 'Internal Control Module A/D Processing Performance',
    short: 'Engine computer A/D fault',
    severity: 'warning',
  },
  P060C: {
    description: 'Internal Control Module Main Processor Performance',
    short: 'Engine computer main CPU fault',
    severity: 'warning',
  },
  P060D: {
    description: 'Internal Control Module Accelerator Pedal Position Performance',
    short: 'Engine computer pedal check',
    severity: 'warning',
  },
  P060E: {
    description: 'Internal Control Module Throttle Position Performance',
    short: 'Engine computer throttle check',
    severity: 'warning',
  },
  P060F: {
    description: 'Internal Control Module Coolant Temperature Performance',
    short: 'Engine computer coolant check',
    severity: 'warning',
  },
  P0610: {
    description: 'Control Module Vehicle Options Error',
    short: 'Vehicle options error',
    severity: 'caution',
  },
  P0611: {
    description: 'Fuel Injector Control Module Performance',
    short: 'Injector control module fault',
    severity: 'warning',
  },
  P0612: {
    description: 'Fuel Injector Control Module Relay Control',
    short: 'Injector module relay control',
    severity: 'warning',
  },
  P0613: {
    description: 'TCM Processor',
    short: 'Transmission computer fault',
    severity: 'warning',
  },
  P0614: {
    description: 'ECM/TCM Incompatible',
    short: 'ECU/TCM incompatible',
    severity: 'warning',
  },
  P0615: {
    description: 'Starter Relay "A" Circuit',
    short: 'Starter relay circuit',
    severity: 'warning',
  },
  P0616: {
    description: 'Starter Relay "A" Circuit Low',
    short: 'Starter relay low',
    severity: 'warning',
  },
  P0617: {
    description: 'Starter Relay "A" Circuit High',
    short: 'Starter relay high',
    severity: 'warning',
  },
  P0618: {
    description: 'Alternative Fuel Control Module KAM Error',
    short: 'Alternative fuel module memory',
    severity: 'caution',
  },
  P0619: {
    description: 'Alternative Fuel Control Module RAM/ROM Error',
    short: 'Alternative fuel module RAM/ROM',
    severity: 'caution',
  },
  P061A: {
    description: 'Internal Control Module Torque Performance',
    short: 'Engine computer torque check',
    severity: 'warning',
  },
  P061B: {
    description: 'Internal Control Module Torque Calculation Performance',
    short: 'Engine computer torque calc',
    severity: 'warning',
  },
  P061C: {
    description: 'Internal Control Module Engine RPM Performance',
    short: 'Engine computer RPM check',
    severity: 'warning',
  },
  P061D: {
    description: 'Internal Control Module Engine Air Mass Performance',
    short: 'Engine computer airflow check',
    severity: 'warning',
  },
  P061E: {
    description: 'Internal Control Module Brake Signal Performance',
    short: 'Engine computer brake check',
    severity: 'warning',
  },
  P061F: {
    description: 'Internal Control Module Throttle Actuator Controller Performance',
    short: 'Engine computer throttle driver',
    severity: 'warning',
  },
  P0620: {
    description: 'Generator Control Circuit',
    short: 'Alternator control circuit',
    severity: 'warning',
  },
  P0621: {
    description: 'Generator Lamp/L Terminal Circuit',
    short: 'Alternator lamp/L terminal',
    severity: 'warning',
  },
  P0622: {
    description: 'Generator Field/F Terminal Circuit',
    short: 'Alternator field circuit',
    severity: 'warning',
  },
  P0623: {
    description: 'Generator Lamp Control Circuit',
    short: 'Alternator lamp circuit',
    severity: 'caution',
  },
  P0624: {
    description: 'Fuel Cap Lamp Control Circuit',
    short: 'Fuel cap lamp circuit',
    severity: 'info',
  },
  P0625: {
    description: 'Generator Field/F Terminal Circuit Low',
    short: 'Alternator field low',
    severity: 'warning',
  },
  P0626: {
    description: 'Generator Field/F Terminal Circuit High',
    short: 'Alternator field high',
    severity: 'warning',
  },
  P0627: {
    description: 'Fuel Pump "A" Control Circuit/Open',
    short: 'Fuel pump control circuit',
    severity: 'warning',
  },
  P0628: {
    description: 'Fuel Pump "A" Control Circuit Low',
    short: 'Fuel pump control low',
    severity: 'warning',
  },
  P0629: {
    description: 'Fuel Pump "A" Control Circuit High',
    short: 'Fuel pump control high',
    severity: 'warning',
  },
  P062B: {
    description: 'Internal Control Module Fuel Injector Control Performance',
    short: 'Engine computer injector driver',
    severity: 'warning',
  },
  P062C: {
    description: 'Internal Control Module Vehicle Speed Performance',
    short: 'Engine computer speed check',
    severity: 'warning',
  },
  P062F: {
    description: 'Internal Control Module EEPROM Error',
    short: 'Engine computer EEPROM error',
    severity: 'warning',
  },
  P0630: {
    description: 'VIN Not Programmed or Incompatible - ECM/PCM',
    short: 'VIN not programmed (ECU)',
    severity: 'caution',
  },
  P0631: {
    description: 'VIN Not Programmed or Incompatible - TCM',
    short: 'VIN not programmed (TCM)',
    severity: 'caution',
  },
  P0632: {
    description: 'Odometer Not Programmed - ECM/PCM',
    short: 'Odometer not programmed',
    severity: 'caution',
  },
  P0633: {
    description: 'Immobilizer Key Not Programmed - ECM/PCM',
    short: 'Immobilizer key not programmed',
    severity: 'warning',
  },
  P0634: {
    description: 'Control Module Internal Temperature "A" Too High',
    short: 'Control module overheating',
    severity: 'warning',
  },
  P0635: {
    description: 'Power Steering Control Circuit',
    short: 'Steering assist control circuit',
    severity: 'warning',
  },
  P0636: {
    description: 'Power Steering Control Circuit Low',
    short: 'Steering assist control low',
    severity: 'warning',
  },
  P0637: {
    description: 'Power Steering Control Circuit High',
    short: 'Steering assist control high',
    severity: 'warning',
  },
  P0638: {
    description: 'Throttle Actuator Control Range/Performance (Bank 1)',
    short: 'Throttle actuator fault (B1)',
    severity: 'warning',
  },
  P0639: {
    description: 'Throttle Actuator Control Range/Performance (Bank 2)',
    short: 'Throttle actuator fault (B2)',
    severity: 'warning',
  },
  P0640: {
    description: 'Intake Air Heater Control Circuit',
    short: 'Intake air heater control',
    severity: 'caution',
  },
  P0641: {
    description: 'Sensor Reference Voltage "A" Circuit/Open',
    short: 'Sensor supply voltage A circuit',
    severity: 'warning',
  },
  P0642: {
    description: 'Sensor Reference Voltage "A" Circuit Low',
    short: 'Sensor supply voltage A low',
    severity: 'warning',
  },
  P0643: {
    description: 'Sensor Reference Voltage "A" Circuit High',
    short: 'Sensor supply voltage A high',
    severity: 'warning',
  },
  P0644: {
    description: 'Driver Display Serial Communication Circuit',
    short: 'Driver display comms',
    severity: 'caution',
  },
  P0645: {
    description: 'A/C Clutch Relay Control Circuit',
    short: 'A/C clutch relay circuit',
    severity: 'info',
  },
  P0646: {
    description: 'A/C Clutch Relay Control Circuit Low',
    short: 'A/C clutch relay low',
    severity: 'info',
  },
  P0647: {
    description: 'A/C Clutch Relay Control Circuit High',
    short: 'A/C clutch relay high',
    severity: 'info',
  },
  P0648: {
    description: 'Immobilizer Lamp Control Circuit',
    short: 'Immobilizer lamp circuit',
    severity: 'info',
  },
  P0649: {
    description: 'Speed Control Lamp Control Circuit',
    short: 'Cruise lamp circuit',
    severity: 'info',
  },
  P064F: {
    description: 'Unauthorized Software/Calibration Detected',
    short: 'Unauthorized ECU software',
    severity: 'caution',
  },
  P0650: {
    description: 'Malfunction Indicator Lamp (MIL) Control Circuit/Open',
    short: 'Check engine light circuit',
    severity: 'caution',
  },
  P0651: {
    description: 'Sensor Reference Voltage "B" Circuit/Open',
    short: 'Sensor supply voltage B circuit',
    severity: 'warning',
  },
  P0652: {
    description: 'Sensor Reference Voltage "B" Circuit Low',
    short: 'Sensor supply voltage B low',
    severity: 'warning',
  },
  P0653: {
    description: 'Sensor Reference Voltage "B" Circuit High',
    short: 'Sensor supply voltage B high',
    severity: 'warning',
  },
  P0654: {
    description: 'Engine RPM Output Circuit/Open',
    short: 'Tachometer output circuit',
    severity: 'caution',
  },
  P0655: {
    description: 'Engine Hot Lamp Output Control Circuit',
    short: 'Engine hot lamp circuit',
    severity: 'caution',
  },
  P0656: {
    description: 'Fuel Level Output Circuit',
    short: 'Fuel gauge output circuit',
    severity: 'caution',
  },
  P0657: {
    description: 'Actuator Supply Voltage "A" Circuit/Open',
    short: 'Actuator supply A circuit',
    severity: 'warning',
  },
  P0658: {
    description: 'Actuator Supply Voltage "A" Circuit Low',
    short: 'Actuator supply voltage A low',
    severity: 'warning',
  },
  P0659: {
    description: 'Actuator Supply Voltage "A" Circuit High',
    short: 'Actuator supply voltage A high',
    severity: 'warning',
  },
  P0660: {
    description: 'Intake Manifold Tuning Valve Control Circuit/Open (Bank 1)',
    short: 'Intake runner valve circuit (B1)',
    severity: 'caution',
  },
  P0661: {
    description: 'Intake Manifold Tuning Valve Control Circuit Low (Bank 1)',
    short: 'Intake runner valve low (B1)',
    severity: 'caution',
  },
  P0662: {
    description: 'Intake Manifold Tuning Valve Control Circuit High (Bank 1)',
    short: 'Intake runner valve high (B1)',
    severity: 'caution',
  },
  P0663: {
    description: 'Intake Manifold Tuning Valve Control Circuit/Open (Bank 2)',
    short: 'Intake runner valve circuit (B2)',
    severity: 'caution',
  },
  P0664: {
    description: 'Intake Manifold Tuning Valve Control Circuit Low (Bank 2)',
    short: 'Intake runner valve low (B2)',
    severity: 'caution',
  },
  P0665: {
    description: 'Intake Manifold Tuning Valve Control Circuit High (Bank 2)',
    short: 'Intake runner valve high (B2)',
    severity: 'caution',
  },
  P0666: {
    description: 'Control Module Internal Temperature Sensor "A" Circuit',
    short: 'Control module temp sensor',
    severity: 'caution',
  },
  P0667: {
    description: 'Control Module Internal Temperature Sensor "A" Range/Performance',
    short: 'Module temp sensor out of range',
    severity: 'caution',
  },
  P0668: {
    description: 'Control Module Internal Temperature Sensor "A" Circuit Low',
    short: 'Control module temp sensor low',
    severity: 'caution',
  },
  P0669: {
    description: 'Control Module Internal Temperature Sensor "A" Circuit High',
    short: 'Control module temp sensor high',
    severity: 'caution',
  },
  P0670: {
    description: 'Glow Plug Control Module 1 Control Circuit/Open',
    short: 'Glow plug module circuit',
    severity: 'caution',
  },
  P0671: {
    description: 'Cylinder 1 Glow Plug Circuit/Open',
    short: 'Cylinder 1 glow plug circuit',
    severity: 'caution',
  },
  P0672: {
    description: 'Cylinder 2 Glow Plug Circuit/Open',
    short: 'Cylinder 2 glow plug circuit',
    severity: 'caution',
  },
  P0673: {
    description: 'Cylinder 3 Glow Plug Circuit/Open',
    short: 'Cylinder 3 glow plug circuit',
    severity: 'caution',
  },
  P0674: {
    description: 'Cylinder 4 Glow Plug Circuit/Open',
    short: 'Cylinder 4 glow plug circuit',
    severity: 'caution',
  },
  P0675: {
    description: 'Cylinder 5 Glow Plug Circuit/Open',
    short: 'Cylinder 5 glow plug circuit',
    severity: 'caution',
  },
  P0676: {
    description: 'Cylinder 6 Glow Plug Circuit/Open',
    short: 'Cylinder 6 glow plug circuit',
    severity: 'caution',
  },
  P0677: {
    description: 'Cylinder 7 Glow Plug Circuit/Open',
    short: 'Cylinder 7 glow plug circuit',
    severity: 'caution',
  },
  P0678: {
    description: 'Cylinder 8 Glow Plug Circuit/Open',
    short: 'Cylinder 8 glow plug circuit',
    severity: 'caution',
  },
  P0679: {
    description: 'Cylinder 9 Glow Plug Circuit/Open',
    short: 'Cylinder 9 glow plug circuit',
    severity: 'caution',
  },
  P0680: {
    description: 'Cylinder 10 Glow Plug Circuit/Open',
    short: 'Cylinder 10 glow plug circuit',
    severity: 'caution',
  },
  P0681: {
    description: 'Cylinder 11 Glow Plug Circuit/Open',
    short: 'Cylinder 11 glow plug circuit',
    severity: 'caution',
  },
  P0682: {
    description: 'Cylinder 12 Glow Plug Circuit/Open',
    short: 'Cylinder 12 glow plug circuit',
    severity: 'caution',
  },
  P0683: {
    description: 'Glow Plug Control Module 1 to PCM Communication Circuit',
    short: 'Glow plug module comms',
    severity: 'caution',
  },
  P0684: {
    description: 'Glow Plug Control Module 1 to PCM Communication Circuit Range/Performance',
    short: 'Glow plug module comms range',
    severity: 'caution',
  },
  P0685: {
    description: 'ECM/PCM Power Relay Control Circuit/Open',
    short: 'ECU power relay control circuit',
    severity: 'warning',
  },
  P0686: {
    description: 'ECM/PCM Power Relay Control Circuit Low',
    short: 'ECU power relay low',
    severity: 'warning',
  },
  P0687: {
    description: 'ECM/PCM Power Relay Control Circuit High',
    short: 'ECU power relay high',
    severity: 'warning',
  },
  P0688: {
    description: 'ECM/PCM Power Relay Sense Circuit/Open',
    short: 'ECU power relay sense circuit',
    severity: 'warning',
  },
  P0689: {
    description: 'ECM/PCM Power Relay Sense Circuit Low',
    short: 'ECU power relay sense low',
    severity: 'warning',
  },
  P0690: {
    description: 'ECM/PCM Power Relay Sense Circuit High',
    short: 'ECU power relay sense high',
    severity: 'warning',
  },
  P0691: {
    description: 'Fan 1 Control Circuit Low',
    short: 'Cooling fan 1 control low',
    severity: 'warning',
  },
  P0692: {
    description: 'Fan 1 Control Circuit High',
    short: 'Cooling fan 1 control high',
    severity: 'warning',
  },
  P0693: {
    description: 'Fan 2 Control Circuit Low',
    short: 'Cooling fan 2 control low',
    severity: 'warning',
  },
  P0694: {
    description: 'Fan 2 Control Circuit High',
    short: 'Cooling fan 2 control high',
    severity: 'warning',
  },
  P0695: {
    description: 'Fan 3 Control Circuit Low',
    short: 'Cooling fan 3 control low',
    severity: 'warning',
  },
  P0696: {
    description: 'Fan 3 Control Circuit High',
    short: 'Cooling fan 3 control high',
    severity: 'warning',
  },
  P0697: {
    description: 'Sensor Reference Voltage "C" Circuit/Open',
    short: 'Sensor supply voltage C circuit',
    severity: 'warning',
  },
  P0698: {
    description: 'Sensor Reference Voltage "C" Circuit Low',
    short: 'Sensor supply voltage C low',
    severity: 'warning',
  },
  P0699: {
    description: 'Sensor Reference Voltage "C" Circuit High',
    short: 'Sensor supply voltage C high',
    severity: 'warning',
  },
  P069E: {
    description: 'Fuel Pump Control Module Requested MIL Illumination',
    short: 'Fuel pump module fault reported',
    severity: 'warning',
  },
  P06A3: {
    description: 'Sensor Reference Voltage "D" Circuit/Open',
    short: 'Sensor supply voltage D circuit',
    severity: 'warning',
  },
  P06A4: {
    description: 'Sensor Reference Voltage "D" Circuit Low',
    short: 'Sensor supply voltage D low',
    severity: 'warning',
  },
  P06A5: {
    description: 'Sensor Reference Voltage "D" Circuit High',
    short: 'Sensor supply voltage D high',
    severity: 'warning',
  },
  P06B8: {
    description: 'Internal Control Module Non-Volatile Random Access Memory (NVRAM) Error',
    short: 'Engine computer NVRAM error',
    severity: 'warning',
  },
  P06DA: {
    description: 'Engine Oil Pressure Control Circuit/Open',
    short: 'Oil pressure control circuit',
    severity: 'warning',
  },
  P06DB: {
    description: 'Engine Oil Pressure Control Circuit Low',
    short: 'Oil pressure control low',
    severity: 'warning',
  },
  P06DC: {
    description: 'Engine Oil Pressure Control Circuit High',
    short: 'Oil pressure control high',
    severity: 'warning',
  },
  P06DD: {
    description: 'Engine Oil Pressure Control Circuit Performance/Stuck Off',
    short: 'Oil pressure control stuck off',
    severity: 'warning',
  },
  P06DE: {
    description: 'Engine Oil Pressure Control Circuit Stuck On',
    short: 'Oil pressure control stuck on',
    severity: 'warning',
  },
  P06E9: {
    description: 'Engine Starter Performance',
    short: 'Starter motor performance',
    severity: 'warning',
  },

  // P07xx — transmission
  P0700: {
    description: 'Transmission Control System (MIL Request)',
    short: 'Transmission fault reported',
    severity: 'warning',
  },
  P0701: {
    description: 'Transmission Control System Range/Performance',
    short: 'Trans control performance',
    severity: 'warning',
  },
  P0702: {
    description: 'Transmission Control System Electrical',
    short: 'Transmission electrical fault',
    severity: 'warning',
  },
  P0703: {
    description: 'Brake Switch "B" Circuit',
    short: 'Brake switch B circuit',
    severity: 'warning',
  },
  P0704: {
    description: 'Clutch Switch Input Circuit',
    short: 'Clutch switch circuit',
    severity: 'caution',
  },
  P0705: {
    description: 'Transmission Range Sensor "A" Circuit (PRNDL Input)',
    short: 'Gear selector sensor circuit',
    severity: 'warning',
  },
  P0706: {
    description: 'Transmission Range Sensor "A" Circuit Range/Performance',
    short: 'Gear selector sensor fault',
    severity: 'warning',
  },
  P0707: {
    description: 'Transmission Range Sensor "A" Circuit Low',
    short: 'Gear selector sensor low',
    severity: 'warning',
  },
  P0708: {
    description: 'Transmission Range Sensor "A" Circuit High',
    short: 'Gear selector sensor high',
    severity: 'warning',
  },
  P0709: {
    description: 'Transmission Range Sensor "A" Circuit Intermittent',
    short: 'Gear selector sensor erratic',
    severity: 'warning',
  },
  P0710: {
    description: 'Transmission Fluid Temperature Sensor "A" Circuit',
    short: 'Trans fluid temp sensor circuit',
    severity: 'warning',
  },
  P0711: {
    description: 'Transmission Fluid Temperature Sensor "A" Circuit Range/Performance',
    short: 'Trans fluid temp sensor fault',
    severity: 'warning',
  },
  P0712: {
    description: 'Transmission Fluid Temperature Sensor "A" Circuit Low',
    short: 'Trans fluid temp signal low',
    severity: 'warning',
  },
  P0713: {
    description: 'Transmission Fluid Temperature Sensor "A" Circuit High',
    short: 'Trans fluid temp signal high',
    severity: 'warning',
  },
  P0714: {
    description: 'Transmission Fluid Temperature Sensor "A" Circuit Intermittent',
    short: 'Trans fluid temp sensor erratic',
    severity: 'warning',
  },
  P0715: {
    description: 'Input/Turbine Shaft Speed Sensor "A" Circuit',
    short: 'Input speed sensor circuit',
    severity: 'warning',
  },
  P0716: {
    description: 'Input/Turbine Shaft Speed Sensor "A" Circuit Range/Performance',
    short: 'Input speed sensor out of range',
    severity: 'warning',
  },
  P0717: {
    description: 'Input/Turbine Shaft Speed Sensor "A" Circuit No Signal',
    short: 'Input speed sensor no signal',
    severity: 'warning',
  },
  P0718: {
    description: 'Input/Turbine Shaft Speed Sensor "A" Circuit Intermittent',
    short: 'Input speed sensor intermittent',
    severity: 'warning',
  },
  P0719: {
    description: 'Brake Switch "B" Circuit Low',
    short: 'Brake switch B low',
    severity: 'warning',
  },
  P0720: {
    description: 'Output Shaft Speed Sensor Circuit',
    short: 'Output speed sensor circuit',
    severity: 'warning',
  },
  P0721: {
    description: 'Output Shaft Speed Sensor Circuit Range/Performance',
    short: 'Output speed sensor out of range',
    severity: 'warning',
  },
  P0722: {
    description: 'Output Shaft Speed Sensor Circuit No Signal',
    short: 'Output speed sensor no signal',
    severity: 'warning',
  },
  P0723: {
    description: 'Output Shaft Speed Sensor Circuit Intermittent',
    short: 'Output speed sensor intermittent',
    severity: 'warning',
  },
  P0724: {
    description: 'Brake Switch "B" Circuit High',
    short: 'Brake switch B high',
    severity: 'warning',
  },
  P0725: {
    description: 'Engine Speed Input Circuit',
    short: 'Engine RPM input circuit',
    severity: 'warning',
  },
  P0726: {
    description: 'Engine Speed Input Circuit Range/Performance',
    short: 'Engine RPM input out of range',
    severity: 'warning',
  },
  P0727: {
    description: 'Engine Speed Input Circuit No Signal',
    short: 'Engine RPM input no signal',
    severity: 'warning',
  },
  P0728: {
    description: 'Engine Speed Input Circuit Intermittent',
    short: 'Engine RPM input intermittent',
    severity: 'warning',
  },
  P0729: {
    description: 'Gear 6 Incorrect Ratio',
    short: 'Wrong gear ratio in 6th',
    severity: 'warning',
  },
  P0730: { description: 'Incorrect Gear Ratio', short: 'Wrong gear ratio', severity: 'warning' },
  P0731: {
    description: 'Gear 1 Incorrect Ratio',
    short: 'Wrong gear ratio in 1st',
    severity: 'warning',
  },
  P0732: {
    description: 'Gear 2 Incorrect Ratio',
    short: 'Wrong gear ratio in 2nd',
    severity: 'warning',
  },
  P0733: {
    description: 'Gear 3 Incorrect Ratio',
    short: 'Wrong gear ratio in 3rd',
    severity: 'warning',
  },
  P0734: {
    description: 'Gear 4 Incorrect Ratio',
    short: 'Wrong gear ratio in 4th',
    severity: 'warning',
  },
  P0735: {
    description: 'Gear 5 Incorrect Ratio',
    short: 'Wrong gear ratio in 5th',
    severity: 'warning',
  },
  P0736: {
    description: 'Reverse Incorrect Ratio',
    short: 'Wrong gear ratio in reverse',
    severity: 'warning',
  },
  P0737: {
    description: 'TCM Engine Speed Output Circuit',
    short: 'TCM engine RPM output circuit',
    severity: 'caution',
  },
  P0738: {
    description: 'TCM Engine Speed Output Circuit Low',
    short: 'TCM engine RPM output low',
    severity: 'caution',
  },
  P0739: {
    description: 'TCM Engine Speed Output Circuit High',
    short: 'TCM engine RPM output high',
    severity: 'caution',
  },
  P0740: {
    description: 'Torque Converter Clutch Circuit/Open',
    short: 'Torque converter clutch circuit',
    severity: 'warning',
  },
  P0741: {
    description: 'Torque Converter Clutch Circuit Performance/Stuck Off',
    short: 'Converter clutch stuck off',
    severity: 'warning',
  },
  P0742: {
    description: 'Torque Converter Clutch Circuit Stuck On',
    short: 'Torque converter clutch stuck on',
    severity: 'warning',
  },
  P0743: {
    description: 'Torque Converter Clutch Circuit Electrical',
    short: 'Converter clutch electrical',
    severity: 'warning',
  },
  P0744: {
    description: 'Torque Converter Clutch Circuit Intermittent',
    short: 'Torque converter clutch erratic',
    severity: 'warning',
  },
  P0745: {
    description: 'Pressure Control Solenoid "A"',
    short: 'Pressure solenoid A fault',
    severity: 'warning',
  },
  P0746: {
    description: 'Pressure Control Solenoid "A" Performance/Stuck Off',
    short: 'Pressure solenoid A stuck off',
    severity: 'warning',
  },
  P0747: {
    description: 'Pressure Control Solenoid "A" Stuck On',
    short: 'Pressure solenoid A stuck on',
    severity: 'warning',
  },
  P0748: {
    description: 'Pressure Control Solenoid "A" Electrical',
    short: 'Pressure solenoid A electrical',
    severity: 'warning',
  },
  P0749: {
    description: 'Pressure Control Solenoid "A" Intermittent',
    short: 'Pressure solenoid A intermittent',
    severity: 'warning',
  },
  P0750: {
    description: 'Shift Solenoid "A"',
    short: 'Shift solenoid A fault',
    severity: 'warning',
  },
  P0751: {
    description: 'Shift Solenoid "A" Performance/Stuck Off',
    short: 'Shift solenoid A stuck off',
    severity: 'warning',
  },
  P0752: {
    description: 'Shift Solenoid "A" Stuck On',
    short: 'Shift solenoid A stuck on',
    severity: 'warning',
  },
  P0753: {
    description: 'Shift Solenoid "A" Electrical',
    short: 'Shift solenoid A electrical',
    severity: 'warning',
  },
  P0754: {
    description: 'Shift Solenoid "A" Intermittent',
    short: 'Shift solenoid A intermittent',
    severity: 'warning',
  },
  P0755: {
    description: 'Shift Solenoid "B"',
    short: 'Shift solenoid B fault',
    severity: 'warning',
  },
  P0756: {
    description: 'Shift Solenoid "B" Performance/Stuck Off',
    short: 'Shift solenoid B stuck off',
    severity: 'warning',
  },
  P0757: {
    description: 'Shift Solenoid "B" Stuck On',
    short: 'Shift solenoid B stuck on',
    severity: 'warning',
  },
  P0758: {
    description: 'Shift Solenoid "B" Electrical',
    short: 'Shift solenoid B electrical',
    severity: 'warning',
  },
  P0759: {
    description: 'Shift Solenoid "B" Intermittent',
    short: 'Shift solenoid B intermittent',
    severity: 'warning',
  },
  P0760: {
    description: 'Shift Solenoid "C"',
    short: 'Shift solenoid C fault',
    severity: 'warning',
  },
  P0761: {
    description: 'Shift Solenoid "C" Performance/Stuck Off',
    short: 'Shift solenoid C stuck off',
    severity: 'warning',
  },
  P0762: {
    description: 'Shift Solenoid "C" Stuck On',
    short: 'Shift solenoid C stuck on',
    severity: 'warning',
  },
  P0763: {
    description: 'Shift Solenoid "C" Electrical',
    short: 'Shift solenoid C electrical',
    severity: 'warning',
  },
  P0764: {
    description: 'Shift Solenoid "C" Intermittent',
    short: 'Shift solenoid C intermittent',
    severity: 'warning',
  },
  P0765: {
    description: 'Shift Solenoid "D"',
    short: 'Shift solenoid D fault',
    severity: 'warning',
  },
  P0766: {
    description: 'Shift Solenoid "D" Performance/Stuck Off',
    short: 'Shift solenoid D stuck off',
    severity: 'warning',
  },
  P0767: {
    description: 'Shift Solenoid "D" Stuck On',
    short: 'Shift solenoid D stuck on',
    severity: 'warning',
  },
  P0768: {
    description: 'Shift Solenoid "D" Electrical',
    short: 'Shift solenoid D electrical',
    severity: 'warning',
  },
  P0769: {
    description: 'Shift Solenoid "D" Intermittent',
    short: 'Shift solenoid D intermittent',
    severity: 'warning',
  },
  P0770: {
    description: 'Shift Solenoid "E"',
    short: 'Shift solenoid E fault',
    severity: 'warning',
  },
  P0771: {
    description: 'Shift Solenoid "E" Performance/Stuck Off',
    short: 'Shift solenoid E stuck off',
    severity: 'warning',
  },
  P0772: {
    description: 'Shift Solenoid "E" Stuck On',
    short: 'Shift solenoid E stuck on',
    severity: 'warning',
  },
  P0773: {
    description: 'Shift Solenoid "E" Electrical',
    short: 'Shift solenoid E electrical',
    severity: 'warning',
  },
  P0774: {
    description: 'Shift Solenoid "E" Intermittent',
    short: 'Shift solenoid E intermittent',
    severity: 'warning',
  },
  P0775: {
    description: 'Pressure Control Solenoid "B"',
    short: 'Pressure solenoid B fault',
    severity: 'warning',
  },
  P0776: {
    description: 'Pressure Control Solenoid "B" Performance/Stuck Off',
    short: 'Pressure solenoid B stuck off',
    severity: 'warning',
  },
  P0777: {
    description: 'Pressure Control Solenoid "B" Stuck On',
    short: 'Pressure solenoid B stuck on',
    severity: 'warning',
  },
  P0778: {
    description: 'Pressure Control Solenoid "B" Electrical',
    short: 'Pressure solenoid B electrical',
    severity: 'warning',
  },
  P0779: {
    description: 'Pressure Control Solenoid "B" Intermittent',
    short: 'Pressure solenoid B intermittent',
    severity: 'warning',
  },
  P0780: { description: 'Shift Error', short: 'Transmission shift error', severity: 'warning' },
  P0781: { description: '1-2 Shift', short: '1-2 shift fault', severity: 'warning' },
  P0782: { description: '2-3 Shift', short: '2-3 shift fault', severity: 'warning' },
  P0783: { description: '3-4 Shift', short: '3-4 shift fault', severity: 'warning' },
  P0784: { description: '4-5 Shift', short: '4-5 shift fault', severity: 'warning' },
  P0785: {
    description: 'Shift Timing Solenoid "A"',
    short: 'Shift timing solenoid fault',
    severity: 'warning',
  },
  P0786: {
    description: 'Shift Timing Solenoid "A" Range/Performance',
    short: 'Shift timing solenoid fault',
    severity: 'warning',
  },
  P0787: {
    description: 'Shift Timing Solenoid "A" Low',
    short: 'Shift timing solenoid low',
    severity: 'warning',
  },
  P0788: {
    description: 'Shift Timing Solenoid "A" High',
    short: 'Shift timing solenoid high',
    severity: 'warning',
  },
  P0789: {
    description: 'Shift Timing Solenoid "A" Intermittent',
    short: 'Shift timing solenoid erratic',
    severity: 'warning',
  },
  P0790: {
    description: 'Normal/Performance Switch Circuit',
    short: 'Normal/sport switch circuit',
    severity: 'info',
  },
  P0791: {
    description: 'Intermediate Shaft Speed Sensor "A" Circuit',
    short: 'Mid-shaft speed sensor circuit',
    severity: 'warning',
  },
  P0792: {
    description: 'Intermediate Shaft Speed Sensor "A" Circuit Range/Performance',
    short: 'Mid-shaft speed sensor fault',
    severity: 'warning',
  },
  P0793: {
    description: 'Intermediate Shaft Speed Sensor "A" Circuit No Signal',
    short: 'Mid-shaft speed sensor no signal',
    severity: 'warning',
  },
  P0794: {
    description: 'Intermediate Shaft Speed Sensor "A" Circuit Intermittent',
    short: 'Mid-shaft speed sensor erratic',
    severity: 'warning',
  },
  P0795: {
    description: 'Pressure Control Solenoid "C"',
    short: 'Pressure solenoid C fault',
    severity: 'warning',
  },
  P0796: {
    description: 'Pressure Control Solenoid "C" Performance/Stuck Off',
    short: 'Pressure solenoid C stuck off',
    severity: 'warning',
  },
  P0797: {
    description: 'Pressure Control Solenoid "C" Stuck On',
    short: 'Pressure solenoid C stuck on',
    severity: 'warning',
  },
  P0798: {
    description: 'Pressure Control Solenoid "C" Electrical',
    short: 'Pressure solenoid C electrical',
    severity: 'warning',
  },
  P0799: {
    description: 'Pressure Control Solenoid "C" Intermittent',
    short: 'Pressure solenoid C intermittent',
    severity: 'warning',
  },

  // P08xx — transmission, transfer case and driveline
  P0800: {
    description: 'Transfer Case Control System (MIL Request)',
    short: 'Transfer case fault reported',
    severity: 'warning',
  },
  P0801: {
    description: 'Reverse Inhibit Control Circuit/Open',
    short: 'Reverse inhibit circuit',
    severity: 'warning',
  },
  P0802: {
    description: 'Transmission Control System MIL Request Circuit/Open',
    short: 'Trans warning request circuit',
    severity: 'caution',
  },
  P0803: {
    description: 'Upshift/Skip Shift Solenoid Control Circuit',
    short: 'Skip-shift solenoid circuit',
    severity: 'caution',
  },
  P0804: {
    description: 'Upshift/Skip Shift Lamp Control Circuit',
    short: 'Skip-shift lamp circuit',
    severity: 'info',
  },
  P0805: {
    description: 'Clutch Position Sensor "A" Circuit',
    short: 'Clutch position sensor circuit',
    severity: 'warning',
  },
  P0806: {
    description: 'Clutch Position Sensor "A" Circuit Range/Performance',
    short: 'Clutch position sensor fault',
    severity: 'warning',
  },
  P0807: {
    description: 'Clutch Position Sensor "A" Circuit Low',
    short: 'Clutch position sensor low',
    severity: 'warning',
  },
  P0808: {
    description: 'Clutch Position Sensor "A" Circuit High',
    short: 'Clutch position sensor high',
    severity: 'warning',
  },
  P0809: {
    description: 'Clutch Position Sensor "A" Circuit Intermittent',
    short: 'Clutch position sensor erratic',
    severity: 'warning',
  },
  P0810: {
    description: 'Clutch Position Control Error',
    short: 'Clutch position control fault',
    severity: 'warning',
  },
  P0811: {
    description: 'Excessive Clutch "A" Slippage',
    short: 'Clutch slipping',
    severity: 'warning',
  },
  P0812: {
    description: 'Reverse Input Circuit',
    short: 'Reverse gear input circuit',
    severity: 'warning',
  },
  P0813: {
    description: 'Reverse Output Circuit',
    short: 'Reverse gear output circuit',
    severity: 'warning',
  },
  P0814: {
    description: 'Transmission Range Display Circuit',
    short: 'Gear display circuit',
    severity: 'caution',
  },
  P0815: {
    description: 'Upshift Switch Circuit',
    short: 'Upshift paddle/switch circuit',
    severity: 'caution',
  },
  P0816: {
    description: 'Downshift Switch Circuit',
    short: 'Downshift paddle/switch circuit',
    severity: 'caution',
  },
  P0817: {
    description: 'Starter Disable Circuit/Open',
    short: 'Starter disable circuit',
    severity: 'warning',
  },
  P0818: {
    description: 'Driveline Disconnect Switch Input Circuit',
    short: 'Driveline disconnect switch',
    severity: 'warning',
  },
  P0819: {
    description: 'Up and Down Shift Switch to Transmission Range Correlation',
    short: 'Shift switch/range mismatch',
    severity: 'caution',
  },
  P0820: {
    description: 'Gear Lever X-Y Position Sensor Circuit',
    short: 'Gear lever position sensor',
    severity: 'warning',
  },
  P0821: {
    description: 'Gear Lever X Position Sensor 1 Circuit',
    short: 'Gear lever X sensor circuit',
    severity: 'warning',
  },
  P0822: {
    description: 'Gear Lever Y Position Sensor 1 Circuit',
    short: 'Gear lever Y sensor circuit',
    severity: 'warning',
  },
  P0823: {
    description: 'Gear Lever X Position Sensor 1 Circuit Intermittent/Erratic',
    short: 'Gear lever X sensor erratic',
    severity: 'warning',
  },
  P0824: {
    description: 'Gear Lever Y Position Sensor 1 Circuit Intermittent/Erratic',
    short: 'Gear lever Y sensor erratic',
    severity: 'warning',
  },
  P0825: {
    description: 'Gear Lever Push-Pull Switch (Shift Anticipate)',
    short: 'Gear lever push-pull switch',
    severity: 'caution',
  },
  P0826: {
    description: 'Up and Down Shift Switch Circuit',
    short: 'Up/down shift switch circuit',
    severity: 'caution',
  },
  P0827: {
    description: 'Up and Down Shift Switch Circuit Low',
    short: 'Up/down shift switch low',
    severity: 'caution',
  },
  P0828: {
    description: 'Up and Down Shift Switch Circuit High',
    short: 'Up/down shift switch high',
    severity: 'caution',
  },
  P0829: { description: '5-6 Shift', short: '5-6 shift fault', severity: 'warning' },
  P0830: {
    description: 'Clutch Pedal Switch "A" Circuit',
    short: 'Clutch pedal switch A circuit',
    severity: 'caution',
  },
  P0831: {
    description: 'Clutch Pedal Switch "A" Circuit Low',
    short: 'Clutch pedal switch A low',
    severity: 'caution',
  },
  P0832: {
    description: 'Clutch Pedal Switch "A" Circuit High',
    short: 'Clutch pedal switch A high',
    severity: 'caution',
  },
  P0833: {
    description: 'Clutch Pedal Switch "B" Circuit',
    short: 'Clutch pedal switch B circuit',
    severity: 'caution',
  },
  P0834: {
    description: 'Clutch Pedal Switch "B" Circuit Low',
    short: 'Clutch pedal switch B low',
    severity: 'caution',
  },
  P0835: {
    description: 'Clutch Pedal Switch "B" Circuit High',
    short: 'Clutch pedal switch B high',
    severity: 'caution',
  },
  P0836: {
    description: 'Four Wheel Drive (4WD) Switch Circuit',
    short: '4WD switch circuit',
    severity: 'caution',
  },
  P0837: {
    description: 'Four Wheel Drive (4WD) Switch Circuit Range/Performance',
    short: '4WD switch out of range',
    severity: 'caution',
  },
  P0838: {
    description: 'Four Wheel Drive (4WD) Switch Circuit Low',
    short: '4WD switch low',
    severity: 'caution',
  },
  P0839: {
    description: 'Four Wheel Drive (4WD) Switch Circuit High',
    short: '4WD switch high',
    severity: 'caution',
  },
  P0840: {
    description: 'Transmission Fluid Pressure Sensor/Switch "A" Circuit',
    short: 'Trans pressure sensor A circuit',
    severity: 'warning',
  },
  P0841: {
    description: 'Transmission Fluid Pressure Sensor/Switch "A" Circuit Range/Performance',
    short: 'Trans pressure sensor A fault',
    severity: 'warning',
  },
  P0842: {
    description: 'Transmission Fluid Pressure Sensor/Switch "A" Circuit Low',
    short: 'Trans pressure sensor A low',
    severity: 'warning',
  },
  P0843: {
    description: 'Transmission Fluid Pressure Sensor/Switch "A" Circuit High',
    short: 'Trans pressure sensor A high',
    severity: 'warning',
  },
  P0844: {
    description: 'Transmission Fluid Pressure Sensor/Switch "A" Circuit Intermittent',
    short: 'Trans pressure sensor A erratic',
    severity: 'warning',
  },
  P0845: {
    description: 'Transmission Fluid Pressure Sensor/Switch "B" Circuit',
    short: 'Trans pressure sensor B circuit',
    severity: 'warning',
  },
  P0846: {
    description: 'Transmission Fluid Pressure Sensor/Switch "B" Circuit Range/Performance',
    short: 'Trans pressure sensor B fault',
    severity: 'warning',
  },
  P0847: {
    description: 'Transmission Fluid Pressure Sensor/Switch "B" Circuit Low',
    short: 'Trans pressure sensor B low',
    severity: 'warning',
  },
  P0848: {
    description: 'Transmission Fluid Pressure Sensor/Switch "B" Circuit High',
    short: 'Trans pressure sensor B high',
    severity: 'warning',
  },
  P0849: {
    description: 'Transmission Fluid Pressure Sensor/Switch "B" Circuit Intermittent',
    short: 'Trans pressure sensor B erratic',
    severity: 'warning',
  },
  P0850: {
    description: 'Park/Neutral Switch Input Circuit',
    short: 'Park/neutral switch circuit',
    severity: 'warning',
  },
  P0851: {
    description: 'Park/Neutral Switch Input Circuit Low',
    short: 'Park/neutral switch low',
    severity: 'warning',
  },
  P0852: {
    description: 'Park/Neutral Switch Input Circuit High',
    short: 'Park/neutral switch high',
    severity: 'warning',
  },
  P0853: {
    description: 'Drive Switch Input Circuit',
    short: 'Drive position switch circuit',
    severity: 'warning',
  },
  P0854: {
    description: 'Drive Switch Input Circuit Low',
    short: 'Drive position switch low',
    severity: 'warning',
  },
  P0855: {
    description: 'Drive Switch Input Circuit High',
    short: 'Drive position switch high',
    severity: 'warning',
  },
  P0856: {
    description: 'Traction Control Input Signal',
    short: 'Traction control signal fault',
    severity: 'caution',
  },
  P0857: {
    description: 'Traction Control Input Signal Range/Performance',
    short: 'Traction control input fault',
    severity: 'caution',
  },
  P0858: {
    description: 'Traction Control Input Signal Low',
    short: 'Traction control input low',
    severity: 'caution',
  },
  P0859: {
    description: 'Traction Control Input Signal High',
    short: 'Traction control input high',
    severity: 'caution',
  },
  P0860: {
    description: 'Gear Shift Control Module "A" Communication Circuit',
    short: 'Shift module comms circuit',
    severity: 'warning',
  },
  P0861: {
    description: 'Gear Shift Control Module "A" Communication Circuit Low',
    short: 'Shift module comms low',
    severity: 'warning',
  },
  P0862: {
    description: 'Gear Shift Control Module "A" Communication Circuit High',
    short: 'Shift module comms high',
    severity: 'warning',
  },
  P0863: {
    description: 'TCM Communication Circuit',
    short: 'Trans computer comms circuit',
    severity: 'warning',
  },
  P0864: {
    description: 'TCM Communication Circuit Range/Performance',
    short: 'Trans computer comms fault',
    severity: 'warning',
  },
  P0865: {
    description: 'TCM Communication Circuit Low',
    short: 'Trans computer comms low',
    severity: 'warning',
  },
  P0866: {
    description: 'TCM Communication Circuit High',
    short: 'Trans computer comms high',
    severity: 'warning',
  },
  P0867: {
    description: 'Transmission Fluid Pressure',
    short: 'Trans fluid pressure fault',
    severity: 'warning',
  },
  P0868: {
    description: 'Transmission Fluid Pressure Low',
    short: 'Trans fluid pressure low',
    severity: 'warning',
  },
  P0869: {
    description: 'Transmission Fluid Pressure High',
    short: 'Trans fluid pressure high',
    severity: 'warning',
  },
  P0870: {
    description: 'Transmission Fluid Pressure Sensor/Switch "C" Circuit',
    short: 'Trans pressure sensor C circuit',
    severity: 'warning',
  },
  P0871: {
    description: 'Transmission Fluid Pressure Sensor/Switch "C" Circuit Range/Performance',
    short: 'Trans pressure sensor C fault',
    severity: 'warning',
  },
  P0872: {
    description: 'Transmission Fluid Pressure Sensor/Switch "C" Circuit Low',
    short: 'Trans pressure sensor C low',
    severity: 'warning',
  },
  P0873: {
    description: 'Transmission Fluid Pressure Sensor/Switch "C" Circuit High',
    short: 'Trans pressure sensor C high',
    severity: 'warning',
  },
  P0874: {
    description: 'Transmission Fluid Pressure Sensor/Switch "C" Circuit Intermittent',
    short: 'Trans pressure sensor C erratic',
    severity: 'warning',
  },
  P0875: {
    description: 'Transmission Fluid Pressure Sensor/Switch "D" Circuit',
    short: 'Trans pressure sensor D circuit',
    severity: 'warning',
  },
  P0876: {
    description: 'Transmission Fluid Pressure Sensor/Switch "D" Circuit Range/Performance',
    short: 'Trans pressure sensor D fault',
    severity: 'warning',
  },
  P0877: {
    description: 'Transmission Fluid Pressure Sensor/Switch "D" Circuit Low',
    short: 'Trans pressure sensor D low',
    severity: 'warning',
  },
  P0878: {
    description: 'Transmission Fluid Pressure Sensor/Switch "D" Circuit High',
    short: 'Trans pressure sensor D high',
    severity: 'warning',
  },
  P0879: {
    description: 'Transmission Fluid Pressure Sensor/Switch "D" Circuit Intermittent',
    short: 'Trans pressure sensor D erratic',
    severity: 'warning',
  },
  P0880: {
    description: 'TCM Power Input Signal',
    short: 'Trans computer power input',
    severity: 'warning',
  },
  P0881: {
    description: 'TCM Power Input Signal Range/Performance',
    short: 'Trans computer power input fault',
    severity: 'warning',
  },
  P0882: {
    description: 'TCM Power Input Signal Low',
    short: 'Trans computer power input low',
    severity: 'warning',
  },
  P0883: {
    description: 'TCM Power Input Signal High',
    short: 'Trans computer power input high',
    severity: 'warning',
  },
  P0884: {
    description: 'TCM Power Input Signal Intermittent',
    short: 'TCM power input intermittent',
    severity: 'warning',
  },
  P0885: {
    description: 'TCM Power Relay Control Circuit/Open',
    short: 'TCM power relay control circuit',
    severity: 'warning',
  },
  P0886: {
    description: 'TCM Power Relay Control Circuit Low',
    short: 'TCM power relay low',
    severity: 'warning',
  },
  P0887: {
    description: 'TCM Power Relay Control Circuit High',
    short: 'TCM power relay high',
    severity: 'warning',
  },
  P0888: {
    description: 'TCM Power Relay Sense Circuit',
    short: 'TCM relay sense circuit',
    severity: 'warning',
  },
  P0889: {
    description: 'TCM Power Relay Sense Circuit Range/Performance',
    short: 'TCM relay sense out of range',
    severity: 'warning',
  },
  P0890: {
    description: 'TCM Power Relay Sense Circuit Low',
    short: 'TCM power relay sense low',
    severity: 'warning',
  },
  P0891: {
    description: 'TCM Power Relay Sense Circuit High',
    short: 'TCM power relay sense high',
    severity: 'warning',
  },
  P0892: {
    description: 'TCM Power Relay Sense Circuit Intermittent',
    short: 'TCM power relay sense erratic',
    severity: 'warning',
  },
  P0893: {
    description: 'Multiple Gears Engaged',
    short: 'More than one gear engaged',
    severity: 'warning',
  },
  P0894: {
    description: 'Transmission Component Slipping',
    short: 'Transmission slipping',
    severity: 'warning',
  },
  P0895: {
    description: 'Shift Time Too Short',
    short: 'Gear shifts too quick',
    severity: 'warning',
  },
  P0896: { description: 'Shift Time Too Long', short: 'Gear shifts too slow', severity: 'warning' },
  P0897: {
    description: 'Transmission Fluid Deteriorated',
    short: 'Transmission fluid degraded',
    severity: 'warning',
  },
  P0898: {
    description: 'Transmission Control System MIL Request Circuit Low',
    short: 'Trans warning request low',
    severity: 'caution',
  },
  P0899: {
    description: 'Transmission Control System MIL Request Circuit High',
    short: 'Trans warning request high',
    severity: 'caution',
  },

  // P09xx — transmission (automated manual and shift-by-wire)
  P0900: {
    description: 'Clutch "A" Actuator Control Circuit/Open',
    short: 'Clutch actuator A circuit',
    severity: 'warning',
  },
  P0901: {
    description: 'Clutch "A" Actuator Control Circuit Range/Performance',
    short: 'Clutch actuator A out of range',
    severity: 'warning',
  },
  P0902: {
    description: 'Clutch "A" Actuator Control Circuit Low',
    short: 'Clutch actuator A low',
    severity: 'warning',
  },
  P0903: {
    description: 'Clutch "A" Actuator Control Circuit High',
    short: 'Clutch actuator A high',
    severity: 'warning',
  },
  P0904: {
    description: 'Gate Select Position Circuit "A"',
    short: 'Gate select position circuit',
    severity: 'warning',
  },
  P0905: {
    description: 'Gate Select Position Circuit "A" Range/Performance',
    short: 'Gate select position fault',
    severity: 'warning',
  },
  P0906: {
    description: 'Gate Select Position Circuit "A" Low',
    short: 'Gate select position low',
    severity: 'warning',
  },
  P0907: {
    description: 'Gate Select Position Circuit "A" High',
    short: 'Gate select position high',
    severity: 'warning',
  },
  P0908: {
    description: 'Gate Select Position Circuit "A" Intermittent',
    short: 'Gate select position erratic',
    severity: 'warning',
  },
  P0909: {
    description: 'Gate Select Control Error',
    short: 'Gear gate select error',
    severity: 'warning',
  },
  P0910: {
    description: 'Gate Select Actuator Circuit/Open',
    short: 'Gate select actuator circuit',
    severity: 'warning',
  },
  P0911: {
    description: 'Gate Select Actuator Circuit Range/Performance',
    short: 'Gate select actuator fault',
    severity: 'warning',
  },
  P0912: {
    description: 'Gate Select Actuator Circuit Low',
    short: 'Gate select actuator low',
    severity: 'warning',
  },
  P0913: {
    description: 'Gate Select Actuator Circuit High',
    short: 'Gate select actuator high',
    severity: 'warning',
  },
  P0914: {
    description: 'Gear Shift Position Circuit "A"',
    short: 'Gear shift position circuit',
    severity: 'warning',
  },
  P0915: {
    description: 'Gear Shift Position Circuit "A" Range/Performance',
    short: 'Gear shift position out of range',
    severity: 'warning',
  },
  P0916: {
    description: 'Gear Shift Position Circuit "A" Low',
    short: 'Gear shift position low',
    severity: 'warning',
  },
  P0917: {
    description: 'Gear Shift Position Circuit "A" High',
    short: 'Gear shift position high',
    severity: 'warning',
  },
  P0918: {
    description: 'Gear Shift Position Circuit "A" Intermittent',
    short: 'Gear shift position intermittent',
    severity: 'warning',
  },
  P0919: {
    description: 'Gear Shift Position Control Error',
    short: 'Gear shift position control',
    severity: 'warning',
  },
  P0920: {
    description: 'Gear Shift Forward Actuator Circuit/Open',
    short: 'Forward shift actuator circuit',
    severity: 'warning',
  },
  P0921: {
    description: 'Gear Shift Forward Actuator Circuit Range/Performance',
    short: 'Forward shift actuator fault',
    severity: 'warning',
  },
  P0922: {
    description: 'Gear Shift Forward Actuator Circuit Low',
    short: 'Forward shift actuator low',
    severity: 'warning',
  },
  P0923: {
    description: 'Gear Shift Forward Actuator Circuit High',
    short: 'Forward shift actuator high',
    severity: 'warning',
  },
  P0924: {
    description: 'Gear Shift Reverse Actuator Circuit/Open',
    short: 'Reverse shift actuator circuit',
    severity: 'warning',
  },
  P0925: {
    description: 'Gear Shift Reverse Actuator Circuit Range/Performance',
    short: 'Reverse shift actuator fault',
    severity: 'warning',
  },
  P0926: {
    description: 'Gear Shift Reverse Actuator Circuit Low',
    short: 'Reverse shift actuator low',
    severity: 'warning',
  },
  P0927: {
    description: 'Gear Shift Reverse Actuator Circuit High',
    short: 'Reverse shift actuator high',
    severity: 'warning',
  },
  P0928: {
    description: 'Gear Shift Lock Solenoid/Actuator Control Circuit "A"/Open',
    short: 'Shift lock solenoid circuit',
    severity: 'warning',
  },
  P0929: {
    description: 'Gear Shift Lock Solenoid/Actuator Control Circuit "A" Range/Performance',
    short: 'Shift lock solenoid out of range',
    severity: 'warning',
  },
  P0930: {
    description: 'Gear Shift Lock Solenoid/Actuator Control Circuit "A" Low',
    short: 'Shift lock solenoid low',
    severity: 'warning',
  },
  P0931: {
    description: 'Gear Shift Lock Solenoid/Actuator Control Circuit "A" High',
    short: 'Shift lock solenoid high',
    severity: 'warning',
  },
  P0932: {
    description: 'Hydraulic Pressure Sensor Circuit',
    short: 'Trans hydraulic pressure sensor',
    severity: 'warning',
  },
  P0933: {
    description: 'Hydraulic Pressure Sensor Range/Performance',
    short: 'Trans hydraulic sensor fault',
    severity: 'warning',
  },
  P0934: {
    description: 'Hydraulic Pressure Sensor Circuit Low',
    short: 'Trans hydraulic sensor low',
    severity: 'warning',
  },
  P0935: {
    description: 'Hydraulic Pressure Sensor Circuit High',
    short: 'Trans hydraulic sensor high',
    severity: 'warning',
  },
  P0936: {
    description: 'Hydraulic Pressure Sensor Circuit Intermittent',
    short: 'Trans hydraulic sensor erratic',
    severity: 'warning',
  },
  P0937: {
    description: 'Hydraulic Oil Temperature Sensor Circuit',
    short: 'Trans hydraulic temp sensor',
    severity: 'warning',
  },
  P0938: {
    description: 'Hydraulic Oil Temperature Sensor Range/Performance',
    short: 'Trans hydraulic temp fault',
    severity: 'warning',
  },
  P0939: {
    description: 'Hydraulic Oil Temperature Sensor Circuit Low',
    short: 'Trans hydraulic temp sensor low',
    severity: 'warning',
  },
  P0940: {
    description: 'Hydraulic Oil Temperature Sensor Circuit High',
    short: 'Trans hydraulic temp sensor high',
    severity: 'warning',
  },
  P0941: {
    description: 'Hydraulic Oil Temperature Sensor Circuit Intermittent',
    short: 'Trans hydraulic temp erratic',
    severity: 'warning',
  },
  P0942: {
    description: 'Hydraulic Pressure Unit',
    short: 'Trans hydraulic unit fault',
    severity: 'warning',
  },
  P0943: {
    description: 'Hydraulic Pressure Unit Cycling Period Too Short',
    short: 'Hydraulic unit cycling too fast',
    severity: 'warning',
  },
  P0944: {
    description: 'Hydraulic Pressure Unit Loss of Pressure',
    short: 'Trans hydraulic pressure lost',
    severity: 'warning',
  },
  P0945: {
    description: 'Hydraulic Pump Relay/Control Circuit/Open',
    short: 'Hydraulic pump relay circuit',
    severity: 'warning',
  },
  P0946: {
    description: 'Hydraulic Pump Relay/Control Circuit Range/Performance',
    short: 'Trans hydraulic pump relay fault',
    severity: 'warning',
  },
  P0947: {
    description: 'Hydraulic Pump Relay/Control Circuit Low',
    short: 'Trans hydraulic pump relay low',
    severity: 'warning',
  },
  P0948: {
    description: 'Hydraulic Pump Relay/Control Circuit High',
    short: 'Trans hydraulic pump relay high',
    severity: 'warning',
  },
  P0949: {
    description: 'Auto Shift Manual Adaptive Learning Not Complete',
    short: 'Gearbox learning incomplete',
    severity: 'caution',
  },
  P0950: {
    description: 'Auto Shift Manual Control Circuit',
    short: 'Manual shift control circuit',
    severity: 'warning',
  },
  P0951: {
    description: 'Auto Shift Manual Control Circuit Range/Performance',
    short: 'Manual shift control fault',
    severity: 'warning',
  },
  P0952: {
    description: 'Auto Shift Manual Control Circuit Low',
    short: 'Manual shift control low',
    severity: 'warning',
  },
  P0953: {
    description: 'Auto Shift Manual Control Circuit High',
    short: 'Manual shift control high',
    severity: 'warning',
  },
  P0954: {
    description: 'Auto Shift Manual Control Circuit Intermittent',
    short: 'Manual shift control erratic',
    severity: 'warning',
  },
  P0955: {
    description: 'Auto Shift Manual Mode Circuit',
    short: 'Manual shift mode circuit',
    severity: 'warning',
  },
  P0956: {
    description: 'Auto Shift Manual Mode Circuit Range/Performance',
    short: 'Manual shift mode out of range',
    severity: 'warning',
  },
  P0957: {
    description: 'Auto Shift Manual Mode Circuit Low',
    short: 'Manual shift mode low',
    severity: 'warning',
  },
  P0958: {
    description: 'Auto Shift Manual Mode Circuit High',
    short: 'Manual shift mode high',
    severity: 'warning',
  },
  P0959: {
    description: 'Auto Shift Manual Mode Circuit Intermittent',
    short: 'Manual shift mode intermittent',
    severity: 'warning',
  },
  P0960: {
    description: 'Pressure Control Solenoid "A" Control Circuit/Open',
    short: 'Pressure solenoid A circuit',
    severity: 'warning',
  },
  P0961: {
    description: 'Pressure Control Solenoid "A" Control Circuit Range/Performance',
    short: 'Pressure solenoid A out of range',
    severity: 'warning',
  },
  P0962: {
    description: 'Pressure Control Solenoid "A" Control Circuit Low',
    short: 'Pressure solenoid A low',
    severity: 'warning',
  },
  P0963: {
    description: 'Pressure Control Solenoid "A" Control Circuit High',
    short: 'Pressure solenoid A high',
    severity: 'warning',
  },
  P0964: {
    description: 'Pressure Control Solenoid "B" Control Circuit/Open',
    short: 'Pressure solenoid B circuit',
    severity: 'warning',
  },
  P0965: {
    description: 'Pressure Control Solenoid "B" Control Circuit Range/Performance',
    short: 'Pressure solenoid B out of range',
    severity: 'warning',
  },
  P0966: {
    description: 'Pressure Control Solenoid "B" Control Circuit Low',
    short: 'Pressure solenoid B low',
    severity: 'warning',
  },
  P0967: {
    description: 'Pressure Control Solenoid "B" Control Circuit High',
    short: 'Pressure solenoid B high',
    severity: 'warning',
  },
  P0968: {
    description: 'Pressure Control Solenoid "C" Control Circuit/Open',
    short: 'Pressure solenoid C circuit',
    severity: 'warning',
  },
  P0969: {
    description: 'Pressure Control Solenoid "C" Control Circuit Range/Performance',
    short: 'Pressure solenoid C out of range',
    severity: 'warning',
  },
  P0970: {
    description: 'Pressure Control Solenoid "C" Control Circuit Low',
    short: 'Pressure solenoid C low',
    severity: 'warning',
  },
  P0971: {
    description: 'Pressure Control Solenoid "C" Control Circuit High',
    short: 'Pressure solenoid C high',
    severity: 'warning',
  },
  P0972: {
    description: 'Shift Solenoid "A" Control Circuit Range/Performance',
    short: 'Shift solenoid A out of range',
    severity: 'warning',
  },
  P0973: {
    description: 'Shift Solenoid "A" Control Circuit Low',
    short: 'Shift solenoid A low',
    severity: 'warning',
  },
  P0974: {
    description: 'Shift Solenoid "A" Control Circuit High',
    short: 'Shift solenoid A high',
    severity: 'warning',
  },
  P0975: {
    description: 'Shift Solenoid "B" Control Circuit Range/Performance',
    short: 'Shift solenoid B out of range',
    severity: 'warning',
  },
  P0976: {
    description: 'Shift Solenoid "B" Control Circuit Low',
    short: 'Shift solenoid B low',
    severity: 'warning',
  },
  P0977: {
    description: 'Shift Solenoid "B" Control Circuit High',
    short: 'Shift solenoid B high',
    severity: 'warning',
  },
  P0978: {
    description: 'Shift Solenoid "C" Control Circuit Range/Performance',
    short: 'Shift solenoid C out of range',
    severity: 'warning',
  },
  P0979: {
    description: 'Shift Solenoid "C" Control Circuit Low',
    short: 'Shift solenoid C low',
    severity: 'warning',
  },
  P0980: {
    description: 'Shift Solenoid "C" Control Circuit High',
    short: 'Shift solenoid C high',
    severity: 'warning',
  },
  P0981: {
    description: 'Shift Solenoid "D" Control Circuit Range/Performance',
    short: 'Shift solenoid D out of range',
    severity: 'warning',
  },
  P0982: {
    description: 'Shift Solenoid "D" Control Circuit Low',
    short: 'Shift solenoid D low',
    severity: 'warning',
  },
  P0983: {
    description: 'Shift Solenoid "D" Control Circuit High',
    short: 'Shift solenoid D high',
    severity: 'warning',
  },
  P0984: {
    description: 'Shift Solenoid "E" Control Circuit Range/Performance',
    short: 'Shift solenoid E out of range',
    severity: 'warning',
  },
  P0985: {
    description: 'Shift Solenoid "E" Control Circuit Low',
    short: 'Shift solenoid E low',
    severity: 'warning',
  },
  P0986: {
    description: 'Shift Solenoid "E" Control Circuit High',
    short: 'Shift solenoid E high',
    severity: 'warning',
  },
  P0987: {
    description: 'Transmission Fluid Pressure Sensor/Switch "E" Circuit',
    short: 'Trans pressure sensor E circuit',
    severity: 'warning',
  },
  P0988: {
    description: 'Transmission Fluid Pressure Sensor/Switch "E" Circuit Range/Performance',
    short: 'Trans pressure sensor E fault',
    severity: 'warning',
  },
  P0989: {
    description: 'Transmission Fluid Pressure Sensor/Switch "E" Circuit Low',
    short: 'Trans pressure sensor E low',
    severity: 'warning',
  },
  P0990: {
    description: 'Transmission Fluid Pressure Sensor/Switch "E" Circuit High',
    short: 'Trans pressure sensor E high',
    severity: 'warning',
  },
  P0991: {
    description: 'Transmission Fluid Pressure Sensor/Switch "E" Circuit Intermittent',
    short: 'Trans pressure sensor E erratic',
    severity: 'warning',
  },
  P0992: {
    description: 'Transmission Fluid Pressure Sensor/Switch "F" Circuit',
    short: 'Trans pressure sensor F circuit',
    severity: 'warning',
  },
  P0993: {
    description: 'Transmission Fluid Pressure Sensor/Switch "F" Circuit Range/Performance',
    short: 'Trans pressure sensor F fault',
    severity: 'warning',
  },
  P0994: {
    description: 'Transmission Fluid Pressure Sensor/Switch "F" Circuit Low',
    short: 'Trans pressure sensor F low',
    severity: 'warning',
  },
  P0995: {
    description: 'Transmission Fluid Pressure Sensor/Switch "F" Circuit High',
    short: 'Trans pressure sensor F high',
    severity: 'warning',
  },
  P0996: {
    description: 'Transmission Fluid Pressure Sensor/Switch "F" Circuit Intermittent',
    short: 'Trans pressure sensor F erratic',
    severity: 'warning',
  },
  P0997: {
    description: 'Shift Solenoid "F" Control Circuit Range/Performance',
    short: 'Shift solenoid F out of range',
    severity: 'warning',
  },
  P0998: {
    description: 'Shift Solenoid "F" Control Circuit Low',
    short: 'Shift solenoid F low',
    severity: 'warning',
  },
  P0999: {
    description: 'Shift Solenoid "F" Control Circuit High',
    short: 'Shift solenoid F high',
    severity: 'warning',
  },

  // P0Axx — hybrid / electric propulsion
  P0A00: {
    description: 'Motor Electronics Coolant Temperature Sensor "A" Circuit',
    short: 'Hybrid coolant temp sensor',
    severity: 'warning',
  },
  P0A01: {
    description: 'Motor Electronics Coolant Temperature Sensor "A" Circuit Range/Performance',
    short: 'Hybrid coolant temp sensor fault',
    severity: 'warning',
  },
  P0A02: {
    description: 'Motor Electronics Coolant Temperature Sensor "A" Circuit Low',
    short: 'Hybrid coolant temp sensor low',
    severity: 'warning',
  },
  P0A03: {
    description: 'Motor Electronics Coolant Temperature Sensor "A" Circuit High',
    short: 'Hybrid coolant temp sensor high',
    severity: 'warning',
  },
  P0A04: {
    description: 'Motor Electronics Coolant Temperature Sensor "A" Circuit Intermittent',
    short: 'Hybrid coolant sensor erratic',
    severity: 'warning',
  },
  P0A05: {
    description: 'Motor Electronics Coolant Pump "A" Control Circuit/Open',
    short: 'Hybrid coolant pump circuit',
    severity: 'warning',
  },
  P0A06: {
    description: 'Motor Electronics Coolant Pump "A" Control Circuit Low',
    short: 'Hybrid coolant pump low',
    severity: 'warning',
  },
  P0A07: {
    description: 'Motor Electronics Coolant Pump "A" Control Circuit High',
    short: 'Hybrid coolant pump high',
    severity: 'warning',
  },
  P0A08: {
    description: 'DC/DC Converter Status Circuit',
    short: 'DC/DC converter signal circuit',
    severity: 'warning',
  },
  P0A09: {
    description: 'DC/DC Converter Status Circuit Low',
    short: 'DC/DC converter signal low',
    severity: 'warning',
  },
  P0A0A: {
    description: 'High Voltage System Interlock Circuit "A"',
    short: 'High-voltage interlock circuit',
    severity: 'warning',
  },
  P0A0B: {
    description: 'High Voltage System Interlock Circuit "A" Performance',
    short: 'HV interlock performance',
    severity: 'warning',
  },
  P0A0C: {
    description: 'High Voltage System Interlock Circuit "A" Low',
    short: 'High-voltage interlock low',
    severity: 'warning',
  },
  P0A0D: {
    description: 'High Voltage System Interlock Circuit "A" High',
    short: 'High-voltage interlock high',
    severity: 'warning',
  },
  P0A0E: {
    description: 'High Voltage System Interlock Circuit "A" Intermittent',
    short: 'High-voltage interlock erratic',
    severity: 'warning',
  },
  P0A0F: {
    description: 'Engine Failed to Start',
    short: 'Engine did not start',
    severity: 'warning',
  },
  P0A10: {
    description: 'DC/DC Converter Status Circuit High',
    short: 'DC/DC converter signal high',
    severity: 'warning',
  },
  P0A11: {
    description: 'DC/DC Converter Enable Circuit/Open',
    short: 'DC/DC converter enable circuit',
    severity: 'warning',
  },
  P0A12: {
    description: 'DC/DC Converter Enable Circuit Low',
    short: 'DC/DC converter enable low',
    severity: 'warning',
  },
  P0A13: {
    description: 'DC/DC Converter Enable Circuit High',
    short: 'DC/DC converter enable high',
    severity: 'warning',
  },
  P0A14: {
    description: 'Engine Mount "A" Control Circuit/Open',
    short: 'Active engine mount A circuit',
    severity: 'caution',
  },
  P0A15: {
    description: 'Engine Mount "A" Control Circuit Low',
    short: 'Active engine mount A low',
    severity: 'caution',
  },
  P0A16: {
    description: 'Engine Mount "A" Control Circuit High',
    short: 'Active engine mount A high',
    severity: 'caution',
  },
  P0A17: {
    description: 'Motor Torque Sensor Circuit',
    short: 'Drive motor torque sensor',
    severity: 'warning',
  },
  P0A18: {
    description: 'Motor Torque Sensor Circuit Range/Performance',
    short: 'Drive motor torque sensor fault',
    severity: 'warning',
  },
  P0A19: {
    description: 'Motor Torque Sensor Circuit Low',
    short: 'Drive motor torque sensor low',
    severity: 'warning',
  },
  P0A1A: {
    description: 'Generator Control Module',
    short: 'Generator control module fault',
    severity: 'warning',
  },
  P0A1B: {
    description: 'Drive Motor "A" Control Module Performance',
    short: 'Drive motor A control module',
    severity: 'warning',
  },
  P0A1C: {
    description: 'Drive Motor "B" Control Module Performance',
    short: 'Drive motor B control module',
    severity: 'warning',
  },
  P0A1D: {
    description: 'Hybrid/EV Powertrain Control Module "A"',
    short: 'Hybrid control module fault',
    severity: 'warning',
  },
  P0A1E: {
    description: 'Starter/Generator Control Module',
    short: 'Starter/generator module',
    severity: 'warning',
  },
  P0A1F: {
    description: 'Battery Energy Control Module "A" Performance',
    short: 'Hybrid battery control module',
    severity: 'warning',
  },
  P0A20: {
    description: 'Motor Torque Sensor Circuit High',
    short: 'Drive motor torque sensor high',
    severity: 'warning',
  },
  P0A21: {
    description: 'Motor Torque Sensor Circuit Intermittent',
    short: 'Motor torque sensor erratic',
    severity: 'warning',
  },
  P0A22: {
    description: 'Generator Torque Sensor Circuit',
    short: 'Generator torque sensor wiring',
    severity: 'warning',
  },
  P0A23: {
    description: 'Generator Torque Sensor Circuit Range/Performance',
    short: 'Generator torque sensor fault',
    severity: 'warning',
  },
  P0A24: {
    description: 'Generator Torque Sensor Circuit Low',
    short: 'Generator torque sensor low',
    severity: 'warning',
  },
  P0A25: {
    description: 'Generator Torque Sensor Circuit High',
    short: 'Generator torque sensor high',
    severity: 'warning',
  },
  P0A26: {
    description: 'Generator Torque Sensor Circuit Intermittent',
    short: 'Generator torque sensor erratic',
    severity: 'warning',
  },
  P0A27: {
    description: 'Hybrid/EV Battery Power Off Circuit',
    short: 'HV battery power-off circuit',
    severity: 'warning',
  },
  P0A28: {
    description: 'Hybrid/EV Battery Power Off Circuit Low',
    short: 'HV battery power-off low',
    severity: 'warning',
  },
  P0A29: {
    description: 'Hybrid/EV Battery Power Off Circuit High',
    short: 'HV battery power-off high',
    severity: 'warning',
  },
  P0A2A: {
    description: 'Drive Motor "A" Temperature Sensor "A" Circuit',
    short: 'Drive motor A temp sensor',
    severity: 'warning',
  },
  P0A2B: {
    description: 'Drive Motor "A" Temperature Sensor "A" Circuit Range/Performance',
    short: 'Motor A temp sensor out of range',
    severity: 'warning',
  },
  P0A2C: {
    description: 'Drive Motor "A" Temperature Sensor "A" Circuit Low',
    short: 'Drive motor A temp sensor low',
    severity: 'warning',
  },
  P0A2D: {
    description: 'Drive Motor "A" Temperature Sensor "A" Circuit High',
    short: 'Drive motor A temp sensor high',
    severity: 'warning',
  },
  P0A2E: {
    description: 'Drive Motor "A" Temperature Sensor "A" Circuit Intermittent',
    short: 'Motor A temp sensor intermittent',
    severity: 'warning',
  },
  P0A2F: {
    description: 'Drive Motor "A" Over Temperature',
    short: 'Drive motor A overheating',
    severity: 'warning',
  },
  P0A30: {
    description: 'Drive Motor "B" Temperature Sensor Circuit',
    short: 'Drive motor B temp sensor',
    severity: 'warning',
  },
  P0A31: {
    description: 'Drive Motor "B" Temperature Sensor Circuit Range/Performance',
    short: 'Motor B temp sensor out of range',
    severity: 'warning',
  },
  P0A32: {
    description: 'Drive Motor "B" Temperature Sensor Circuit Low',
    short: 'Drive motor B temp sensor low',
    severity: 'warning',
  },
  P0A33: {
    description: 'Drive Motor "B" Temperature Sensor Circuit High',
    short: 'Drive motor B temp sensor high',
    severity: 'warning',
  },
  P0A34: {
    description: 'Drive Motor "B" Temperature Sensor Circuit Intermittent',
    short: 'Motor B temp sensor intermittent',
    severity: 'warning',
  },
  P0A35: {
    description: 'Drive Motor "B" Over Temperature',
    short: 'Drive motor B overheating',
    severity: 'warning',
  },
  P0A36: {
    description: 'Generator Temperature Sensor Circuit',
    short: 'Generator temp sensor circuit',
    severity: 'warning',
  },
  P0A37: {
    description: 'Generator Temperature Sensor Circuit Range/Performance',
    short: 'Generator temp sensor fault',
    severity: 'warning',
  },
  P0A38: {
    description: 'Generator Temperature Sensor Circuit Low',
    short: 'Generator temp sensor low',
    severity: 'warning',
  },
  P0A39: {
    description: 'Generator Temperature Sensor Circuit High',
    short: 'Generator temp sensor high',
    severity: 'warning',
  },
  P0A3A: {
    description: 'Generator Temperature Sensor Circuit Intermittent',
    short: 'Generator temp sensor erratic',
    severity: 'warning',
  },
  P0A3B: {
    description: 'Generator "A" Over Temperature',
    short: 'Generator overheating',
    severity: 'warning',
  },
  P0A3C: {
    description: 'Drive Motor "A" Inverter Over Temperature',
    short: 'Motor A inverter overheating',
    severity: 'warning',
  },
  P0A3D: {
    description: 'Drive Motor "B" Inverter Over Temperature',
    short: 'Motor B inverter overheating',
    severity: 'warning',
  },
  P0A3E: {
    description: 'Generator Inverter Over Temperature',
    short: 'Generator inverter overheating',
    severity: 'warning',
  },
  P0A3F: {
    description: 'Drive Motor "A" Position Sensor Circuit',
    short: 'Motor A position sensor circuit',
    severity: 'warning',
  },
  P0A40: {
    description: 'Drive Motor "A" Position Sensor Circuit Range/Performance',
    short: 'Motor A position sensor fault',
    severity: 'warning',
  },
  P0A41: {
    description: 'Drive Motor "A" Position Sensor Circuit Low',
    short: 'Motor A position sensor low',
    severity: 'warning',
  },
  P0A42: {
    description: 'Drive Motor "A" Position Sensor Circuit High',
    short: 'Motor A position sensor high',
    severity: 'warning',
  },
  P0A43: {
    description: 'Drive Motor "A" Position Sensor Circuit Intermittent',
    short: 'Motor A position sensor erratic',
    severity: 'warning',
  },
  P0A44: {
    description: 'Drive Motor "A" Position Sensor Circuit Overspeed',
    short: 'Motor A position overspeed',
    severity: 'warning',
  },
  P0A45: {
    description: 'Drive Motor "B" Position Sensor Circuit',
    short: 'Motor B position sensor circuit',
    severity: 'warning',
  },
  P0A46: {
    description: 'Drive Motor "B" Position Sensor Circuit Range/Performance',
    short: 'Motor B position sensor fault',
    severity: 'warning',
  },
  P0A47: {
    description: 'Drive Motor "B" Position Sensor Circuit Low',
    short: 'Motor B position sensor low',
    severity: 'warning',
  },
  P0A48: {
    description: 'Drive Motor "B" Position Sensor Circuit High',
    short: 'Motor B position sensor high',
    severity: 'warning',
  },
  P0A49: {
    description: 'Drive Motor "B" Position Sensor Circuit Intermittent',
    short: 'Motor B position sensor erratic',
    severity: 'warning',
  },
  P0A4A: {
    description: 'Drive Motor "B" Position Sensor Circuit Overspeed',
    short: 'Motor B position overspeed',
    severity: 'warning',
  },
  P0A4B: {
    description: 'Generator Position Sensor Circuit',
    short: 'Generator position sensor',
    severity: 'warning',
  },
  P0A4C: {
    description: 'Generator Position Sensor Circuit Range/Performance',
    short: 'Generator position sensor fault',
    severity: 'warning',
  },
  P0A4D: {
    description: 'Generator Position Sensor Circuit Low',
    short: 'Generator position sensor low',
    severity: 'warning',
  },
  P0A4E: {
    description: 'Generator Position Sensor Circuit High',
    short: 'Generator position sensor high',
    severity: 'warning',
  },
  P0A4F: {
    description: 'Generator Position Sensor Circuit Intermittent',
    short: 'Gen. position sensor erratic',
    severity: 'warning',
  },
  P0A50: {
    description: 'Generator Position Sensor Circuit Overspeed',
    short: 'Generator position overspeed',
    severity: 'warning',
  },
  P0A51: {
    description: 'Drive Motor "A" Current Sensor Circuit',
    short: 'Motor A current sensor circuit',
    severity: 'warning',
  },
  P0A52: {
    description: 'Drive Motor "A" Current Sensor Circuit Range/Performance',
    short: 'Motor A current sensor fault',
    severity: 'warning',
  },
  P0A53: {
    description: 'Drive Motor "A" Current Sensor Circuit Low',
    short: 'Motor A current sensor low',
    severity: 'warning',
  },
  P0A54: {
    description: 'Drive Motor "A" Current Sensor Circuit High',
    short: 'Motor A current sensor high',
    severity: 'warning',
  },
  P0A55: {
    description: 'Drive Motor "B" Current Sensor Circuit',
    short: 'Motor B current sensor circuit',
    severity: 'warning',
  },
  P0A56: {
    description: 'Drive Motor "B" Current Sensor Circuit Range/Performance',
    short: 'Motor B current sensor fault',
    severity: 'warning',
  },
  P0A57: {
    description: 'Drive Motor "B" Current Sensor Circuit Low',
    short: 'Motor B current sensor low',
    severity: 'warning',
  },
  P0A58: {
    description: 'Drive Motor "B" Current Sensor Circuit High',
    short: 'Motor B current sensor high',
    severity: 'warning',
  },
  P0A59: {
    description: 'Generator Current Sensor Circuit',
    short: 'Generator current sensor wiring',
    severity: 'warning',
  },
  P0A5A: {
    description: 'Generator Current Sensor Circuit Range/Performance',
    short: 'Generator current sensor fault',
    severity: 'warning',
  },
  P0A5B: {
    description: 'Generator Current Sensor Circuit Low',
    short: 'Generator current sensor low',
    severity: 'warning',
  },
  P0A5C: {
    description: 'Generator Current Sensor Circuit High',
    short: 'Generator current sensor high',
    severity: 'warning',
  },
  P0A5D: {
    description: 'Drive Motor "A" Phase U Current',
    short: 'Motor A phase U current fault',
    severity: 'warning',
  },
  P0A5E: {
    description: 'Drive Motor "A" Phase U Current Low',
    short: 'Motor A current low (phase U)',
    severity: 'warning',
  },
  P0A5F: {
    description: 'Drive Motor "A" Phase U Current High',
    short: 'Motor A current high (phase U)',
    severity: 'warning',
  },
  P0A60: {
    description: 'Drive Motor "A" Phase V Current',
    short: 'Motor A phase V current fault',
    severity: 'warning',
  },
  P0A61: {
    description: 'Drive Motor "A" Phase V Current Low',
    short: 'Motor A current low (phase V)',
    severity: 'warning',
  },
  P0A62: {
    description: 'Drive Motor "A" Phase V Current High',
    short: 'Motor A current high (phase V)',
    severity: 'warning',
  },
  P0A63: {
    description: 'Drive Motor "A" Phase W Current',
    short: 'Motor A phase W current fault',
    severity: 'warning',
  },
  P0A64: {
    description: 'Drive Motor "A" Phase W Current Low',
    short: 'Motor A current low (phase W)',
    severity: 'warning',
  },
  P0A65: {
    description: 'Drive Motor "A" Phase W Current High',
    short: 'Motor A current high (phase W)',
    severity: 'warning',
  },
  P0A66: {
    description: 'Drive Motor "B" Phase U Current',
    short: 'Motor B phase U current fault',
    severity: 'warning',
  },
  P0A67: {
    description: 'Drive Motor "B" Phase U Current Low',
    short: 'Motor B current low (phase U)',
    severity: 'warning',
  },
  P0A68: {
    description: 'Drive Motor "B" Phase U Current High',
    short: 'Motor B current high (phase U)',
    severity: 'warning',
  },
  P0A69: {
    description: 'Drive Motor "B" Phase V Current',
    short: 'Motor B phase V current fault',
    severity: 'warning',
  },
  P0A6A: {
    description: 'Drive Motor "B" Phase V Current Low',
    short: 'Motor B current low (phase V)',
    severity: 'warning',
  },
  P0A6B: {
    description: 'Drive Motor "B" Phase V Current High',
    short: 'Motor B current high (phase V)',
    severity: 'warning',
  },
  P0A6C: {
    description: 'Drive Motor "B" Phase W Current',
    short: 'Motor B phase W current fault',
    severity: 'warning',
  },
  P0A6D: {
    description: 'Drive Motor "B" Phase W Current Low',
    short: 'Motor B current low (phase W)',
    severity: 'warning',
  },
  P0A6E: {
    description: 'Drive Motor "B" Phase W Current High',
    short: 'Motor B current high (phase W)',
    severity: 'warning',
  },
  P0A6F: {
    description: 'Generator Phase U Current',
    short: 'Generator phase U current fault',
    severity: 'warning',
  },
  P0A70: {
    description: 'Generator Phase U Current Low',
    short: 'Generator current low (phase U)',
    severity: 'warning',
  },
  P0A71: {
    description: 'Generator Phase U Current High',
    short: 'Generator current high (phase U)',
    severity: 'warning',
  },
  P0A72: {
    description: 'Generator Phase V Current',
    short: 'Generator phase V current fault',
    severity: 'warning',
  },
  P0A73: {
    description: 'Generator Phase V Current Low',
    short: 'Generator current low (phase V)',
    severity: 'warning',
  },
  P0A74: {
    description: 'Generator Phase V Current High',
    short: 'Generator current high (phase V)',
    severity: 'warning',
  },
  P0A75: {
    description: 'Generator Phase W Current',
    short: 'Generator phase W current fault',
    severity: 'warning',
  },
  P0A76: {
    description: 'Generator Phase W Current Low',
    short: 'Generator current low (phase W)',
    severity: 'warning',
  },
  P0A77: {
    description: 'Generator Phase W Current High',
    short: 'Generator current high (phase W)',
    severity: 'warning',
  },
  P0A78: {
    description: 'Drive Motor "A" Inverter Performance',
    short: 'Motor A inverter fault',
    severity: 'warning',
  },
  P0A79: {
    description: 'Drive Motor "B" Inverter Performance',
    short: 'Motor B inverter fault',
    severity: 'warning',
  },
  P0A7A: {
    description: 'Generator Inverter Performance',
    short: 'Generator inverter fault',
    severity: 'warning',
  },
  P0A7B: {
    description: 'Battery Energy Control Module Requested MIL Illumination',
    short: 'Hybrid battery fault reported',
    severity: 'warning',
  },
  P0A7C: {
    description: 'Motor Electronics Over Temperature',
    short: 'Motor electronics overheating',
    severity: 'warning',
  },
  P0A7D: {
    description: 'Hybrid/EV Battery Pack State of Charge Low',
    short: 'Hybrid battery charge low',
    severity: 'warning',
  },
  P0A7E: {
    description: 'Hybrid/EV Battery Pack "A" Over Temperature',
    short: 'Hybrid battery overheating',
    severity: 'critical',
  },
  P0A7F: {
    description: 'Hybrid/EV Battery Pack "A" Deterioration',
    short: 'Hybrid battery deteriorated',
    severity: 'warning',
  },
  P0A80: {
    description: 'Replace Hybrid/EV Battery Pack',
    short: 'Replace hybrid battery',
    severity: 'warning',
  },
  P0A81: {
    description: 'Hybrid/EV Battery Pack Cooling Fan 1 Control Circuit/Open',
    short: 'Hybrid battery fan 1 circuit',
    severity: 'warning',
  },
  P0A82: {
    description: 'Hybrid/EV Battery Pack Cooling Fan 1 Performance/Stuck Off',
    short: 'Hybrid battery fan 1 stuck off',
    severity: 'warning',
  },
  P0A83: {
    description: 'Hybrid/EV Battery Pack Cooling Fan 1 Stuck On',
    short: 'Hybrid battery fan 1 stuck on',
    severity: 'warning',
  },
  P0A84: {
    description: 'Hybrid/EV Battery Pack Cooling Fan 1 Control Circuit Low',
    short: 'Hybrid battery fan 1 low',
    severity: 'warning',
  },
  P0A85: {
    description: 'Hybrid/EV Battery Pack Cooling Fan 1 Control Circuit High',
    short: 'Hybrid battery fan 1 high',
    severity: 'warning',
  },
  P0A86: {
    description: '14 Volt Power Module Current Sensor "A" Circuit',
    short: '12V converter current sensor',
    severity: 'warning',
  },
  P0A87: {
    description: '14 Volt Power Module Current Sensor "A" Circuit Range/Performance',
    short: '12V converter sensor fault',
    severity: 'warning',
  },
  P0A88: {
    description: '14 Volt Power Module Current Sensor "A" Circuit Low',
    short: '12V converter current sensor low',
    severity: 'warning',
  },
  P0A89: {
    description: '14 Volt Power Module Current Sensor "A" Circuit High',
    short: '12V converter sensor high',
    severity: 'warning',
  },
  P0A8A: {
    description: '14 Volt Power Module Current Sensor "A" Circuit Intermittent',
    short: '12V converter sensor erratic',
    severity: 'warning',
  },
  P0A8B: {
    description: '14 Volt Power Module System Voltage',
    short: '12V converter voltage fault',
    severity: 'warning',
  },
  P0A8C: {
    description: '14 Volt Power Module System Voltage Unstable',
    short: '12V converter voltage unstable',
    severity: 'warning',
  },
  P0A8D: {
    description: '14 Volt Power Module System Voltage Low',
    short: '12V converter voltage low',
    severity: 'warning',
  },
  P0A8E: {
    description: '14 Volt Power Module System Voltage High',
    short: '12V converter voltage high',
    severity: 'warning',
  },
  P0A8F: {
    description: '14 Volt Power Module System Performance',
    short: '12V converter performance',
    severity: 'warning',
  },
  P0A90: {
    description: 'Drive Motor "A" Performance',
    short: 'Drive motor A performance',
    severity: 'warning',
  },
  P0A91: {
    description: 'Drive Motor "B" Performance',
    short: 'Drive motor B performance',
    severity: 'warning',
  },
  P0A92: {
    description: 'Hybrid Generator Performance',
    short: 'Hybrid generator fault',
    severity: 'warning',
  },
  P0A93: {
    description: 'Inverter "A" Cooling System Performance',
    short: 'Inverter cooling fault',
    severity: 'warning',
  },
  P0A94: {
    description: 'DC/DC Converter "A" Performance',
    short: 'DC/DC converter fault',
    severity: 'warning',
  },
  P0A95: {
    description: 'High Voltage Fuse "A"',
    short: 'High-voltage fuse fault',
    severity: 'warning',
  },
  P0A96: {
    description: 'Hybrid/EV Battery Pack Cooling Fan 2 Control Circuit/Open',
    short: 'Hybrid battery fan 2 circuit',
    severity: 'warning',
  },
  P0A97: {
    description: 'Hybrid/EV Battery Pack Cooling Fan 2 Performance/Stuck Off',
    short: 'Hybrid battery fan 2 stuck off',
    severity: 'warning',
  },
  P0A98: {
    description: 'Hybrid/EV Battery Pack Cooling Fan 2 Stuck On',
    short: 'Hybrid battery fan 2 stuck on',
    severity: 'warning',
  },
  P0A99: {
    description: 'Hybrid/EV Battery Pack Cooling Fan 2 Control Circuit Low',
    short: 'Hybrid battery fan 2 low',
    severity: 'warning',
  },
  P0A9A: {
    description: 'Hybrid/EV Battery Pack Cooling Fan 2 Control Circuit High',
    short: 'Hybrid battery fan 2 high',
    severity: 'warning',
  },
  P0A9B: {
    description: 'Hybrid/EV Battery Temperature Sensor "A" Circuit',
    short: 'HV battery temp sensor A circuit',
    severity: 'warning',
  },
  P0A9C: {
    description: 'Hybrid/EV Battery Temperature Sensor "A" Circuit Range/Performance',
    short: 'HV battery temp sensor A fault',
    severity: 'warning',
  },
  P0A9D: {
    description: 'Hybrid/EV Battery Temperature Sensor "A" Circuit Low',
    short: 'HV battery temp sensor A low',
    severity: 'warning',
  },
  P0A9E: {
    description: 'Hybrid/EV Battery Temperature Sensor "A" Circuit High',
    short: 'HV battery temp sensor A high',
    severity: 'warning',
  },
  P0A9F: {
    description: 'Hybrid/EV Battery Temperature Sensor "A" Circuit Intermittent/Erratic',
    short: 'HV battery temp sensor A erratic',
    severity: 'warning',
  },
  P0AA0: {
    description: 'Hybrid/EV Battery Positive Contactor Circuit',
    short: 'Positive contactor circuit',
    severity: 'warning',
  },
  P0AA1: {
    description: 'Hybrid/EV Battery Positive Contactor Circuit Stuck Closed',
    short: 'Positive contactor stuck closed',
    severity: 'warning',
  },
  P0AA2: {
    description: 'Hybrid/EV Battery Positive Contactor Circuit Stuck Open',
    short: 'Positive contactor stuck open',
    severity: 'warning',
  },
  P0AA3: {
    description: 'Hybrid/EV Battery Negative Contactor Circuit',
    short: 'Negative contactor circuit',
    severity: 'warning',
  },
  P0AA4: {
    description: 'Hybrid/EV Battery Negative Contactor Circuit Stuck Closed',
    short: 'Negative contactor stuck closed',
    severity: 'warning',
  },
  P0AA5: {
    description: 'Hybrid/EV Battery Negative Contactor Circuit Stuck Open',
    short: 'Negative contactor stuck open',
    severity: 'warning',
  },
  P0AA6: {
    description: 'Hybrid/EV Battery Voltage System Isolation Fault',
    short: 'High-voltage isolation fault',
    severity: 'critical',
  },
  P0AA7: {
    description: 'Hybrid/EV Battery Voltage Isolation Sensor Circuit',
    short: 'HV isolation sensor circuit',
    severity: 'warning',
  },
  P0AA8: {
    description: 'Hybrid/EV Battery Voltage Isolation Sensor Circuit Range/Performance',
    short: 'HV isolation sensor out of range',
    severity: 'warning',
  },
  P0AA9: {
    description: 'Hybrid/EV Battery Voltage Isolation Sensor Circuit Low',
    short: 'HV isolation sensor low',
    severity: 'warning',
  },
  P0AAA: {
    description: 'Hybrid/EV Battery Voltage Isolation Sensor Circuit High',
    short: 'HV isolation sensor high',
    severity: 'warning',
  },
  P0AAB: {
    description: 'Hybrid/EV Battery Voltage Isolation Sensor Circuit Intermittent/Erratic',
    short: 'HV isolation sensor erratic',
    severity: 'warning',
  },
  P0AAC: {
    description: 'Hybrid/EV Battery Pack Air Temperature Sensor "A" Circuit',
    short: 'Battery air temp sensor A',
    severity: 'warning',
  },
  P0AAD: {
    description: 'Hybrid/EV Battery Pack Air Temperature Sensor "A" Circuit Range/Performance',
    short: 'Battery air temp A out of range',
    severity: 'warning',
  },
  P0AAE: {
    description: 'Hybrid/EV Battery Pack Air Temperature Sensor "A" Circuit Low',
    short: 'Battery air temp sensor A low',
    severity: 'warning',
  },
  P0AAF: {
    description: 'Hybrid/EV Battery Pack Air Temperature Sensor "A" Circuit High',
    short: 'Battery air temp sensor A high',
    severity: 'warning',
  },
  P0AB0: {
    description: 'Hybrid/EV Battery Pack Air Temperature Sensor "A" Circuit Intermittent/Erratic',
    short: 'Battery air temp A erratic',
    severity: 'warning',
  },
  P0AB1: {
    description: 'Hybrid/EV Battery Pack Air Temperature Sensor "B" Circuit',
    short: 'Battery air temp sensor B',
    severity: 'warning',
  },
  P0AB2: {
    description: 'Hybrid/EV Battery Pack Air Temperature Sensor "B" Circuit Range/Performance',
    short: 'Battery air temp B out of range',
    severity: 'warning',
  },
  P0AB3: {
    description: 'Hybrid/EV Battery Pack Air Temperature Sensor "B" Circuit Low',
    short: 'Battery air temp sensor B low',
    severity: 'warning',
  },
  P0AB4: {
    description: 'Hybrid/EV Battery Pack Air Temperature Sensor "B" Circuit High',
    short: 'Battery air temp sensor B high',
    severity: 'warning',
  },
  P0AB5: {
    description: 'Hybrid/EV Battery Pack Air Temperature Sensor "B" Circuit Intermittent/Erratic',
    short: 'Battery air temp B erratic',
    severity: 'warning',
  },
  P0AB6: {
    description: 'Engine Mount "B" Control Circuit/Open',
    short: 'Active engine mount B circuit',
    severity: 'caution',
  },
  P0AB7: {
    description: 'Engine Mount "B" Control Circuit Low',
    short: 'Active engine mount B low',
    severity: 'caution',
  },
  P0AB8: {
    description: 'Engine Mount "B" Control Circuit High',
    short: 'Active engine mount B high',
    severity: 'caution',
  },
  P0AB9: {
    description: 'Hybrid/EV System Performance',
    short: 'Hybrid system performance',
    severity: 'warning',
  },
  P0ABA: {
    description: 'Hybrid/EV Battery Pack Voltage Sense "A" Circuit',
    short: 'Battery voltage sense A circuit',
    severity: 'warning',
  },
  P0ABB: {
    description: 'Hybrid/EV Battery Pack Voltage Sense "A" Circuit Range/Performance',
    short: 'Battery voltage sense A fault',
    severity: 'warning',
  },
  P0ABC: {
    description: 'Hybrid/EV Battery Pack Voltage Sense "A" Circuit Low',
    short: 'Battery voltage sense A low',
    severity: 'warning',
  },
  P0ABD: {
    description: 'Hybrid/EV Battery Pack Voltage Sense "A" Circuit High',
    short: 'Battery voltage sense A high',
    severity: 'warning',
  },
  P0ABE: {
    description: 'Hybrid/EV Battery Pack Voltage Sense "A" Circuit Intermittent/Erratic',
    short: 'Battery voltage sense A erratic',
    severity: 'warning',
  },
  P0ABF: {
    description: 'Hybrid/EV Battery Pack Current Sensor "A" Circuit',
    short: 'Battery current sensor A circuit',
    severity: 'warning',
  },
  P0AC0: {
    description: 'Hybrid/EV Battery Pack Current Sensor "A" Circuit Range/Performance',
    short: 'Battery current sensor A fault',
    severity: 'warning',
  },
  P0AC1: {
    description: 'Hybrid/EV Battery Pack Current Sensor "A" Circuit Low',
    short: 'Battery current sensor A low',
    severity: 'warning',
  },
  P0AC2: {
    description: 'Hybrid/EV Battery Pack Current Sensor "A" Circuit High',
    short: 'Battery current sensor A high',
    severity: 'warning',
  },
  P0AC3: {
    description: 'Hybrid/EV Battery Pack Current Sensor "A" Circuit Intermittent/Erratic',
    short: 'Battery current sensor A erratic',
    severity: 'warning',
  },
  P0AC4: {
    description: 'Hybrid/EV Powertrain Control Module Requested MIL Illumination',
    short: 'Hybrid system fault reported',
    severity: 'warning',
  },
  P0AC5: {
    description: 'Hybrid/EV Battery Temperature Sensor "B" Circuit',
    short: 'HV battery temp sensor B circuit',
    severity: 'warning',
  },
  P0AC6: {
    description: 'Hybrid/EV Battery Temperature Sensor "B" Circuit Range/Performance',
    short: 'HV battery temp sensor B fault',
    severity: 'warning',
  },
  P0AC7: {
    description: 'Hybrid/EV Battery Temperature Sensor "B" Circuit Low',
    short: 'HV battery temp sensor B low',
    severity: 'warning',
  },
  P0AC8: {
    description: 'Hybrid/EV Battery Temperature Sensor "B" Circuit High',
    short: 'HV battery temp sensor B high',
    severity: 'warning',
  },
  P0AC9: {
    description: 'Hybrid/EV Battery Temperature Sensor "B" Circuit Intermittent/Erratic',
    short: 'HV battery temp sensor B erratic',
    severity: 'warning',
  },
  P0ACA: {
    description: 'Hybrid/EV Battery Temperature Sensor "C" Circuit',
    short: 'HV battery temp sensor C circuit',
    severity: 'warning',
  },
  P0ACB: {
    description: 'Hybrid/EV Battery Temperature Sensor "C" Circuit Range/Performance',
    short: 'HV battery temp sensor C fault',
    severity: 'warning',
  },
  P0ACC: {
    description: 'Hybrid/EV Battery Temperature Sensor "C" Circuit Low',
    short: 'HV battery temp sensor C low',
    severity: 'warning',
  },
  P0ACD: {
    description: 'Hybrid/EV Battery Temperature Sensor "C" Circuit High',
    short: 'HV battery temp sensor C high',
    severity: 'warning',
  },
  P0ACE: {
    description: 'Hybrid/EV Battery Temperature Sensor "C" Circuit Intermittent/Erratic',
    short: 'HV battery temp sensor C erratic',
    severity: 'warning',
  },
  P0ACF: {
    description: 'Hybrid/EV Battery Pack Cooling Fan 3 Control Circuit/Open',
    short: 'Hybrid battery fan 3 circuit',
    severity: 'warning',
  },
  P0AD0: {
    description: 'Hybrid/EV Battery Pack Cooling Fan 3 Performance/Stuck Off',
    short: 'Hybrid battery fan 3 stuck off',
    severity: 'warning',
  },
  P0AD1: {
    description: 'Hybrid/EV Battery Pack Cooling Fan 3 Stuck On',
    short: 'Hybrid battery fan 3 stuck on',
    severity: 'warning',
  },
  P0AD2: {
    description: 'Hybrid/EV Battery Pack Cooling Fan 3 Control Circuit Low',
    short: 'Hybrid battery fan 3 low',
    severity: 'warning',
  },
  P0AD3: {
    description: 'Hybrid/EV Battery Pack Cooling Fan 3 Control Circuit High',
    short: 'Hybrid battery fan 3 high',
    severity: 'warning',
  },
  P0AD4: {
    description: 'Hybrid/EV Battery Pack Air Flow System Insufficient Air Flow',
    short: 'Battery cooling airflow low',
    severity: 'warning',
  },
  P0AD5: {
    description: 'Hybrid/EV Battery Pack Air Flow Valve "A" Control Circuit/Open',
    short: 'Battery air flow valve A circuit',
    severity: 'warning',
  },
  P0AD6: {
    description: 'Hybrid/EV Battery Pack Air Flow Valve "A" Control Circuit Range/Performance',
    short: 'Battery air valve A out of range',
    severity: 'warning',
  },
  P0AD7: {
    description: 'Hybrid/EV Battery Pack Air Flow Valve "A" Control Circuit Low',
    short: 'Battery air flow valve A low',
    severity: 'warning',
  },
  P0AD8: {
    description: 'Hybrid/EV Battery Pack Air Flow Valve "A" Control Circuit High',
    short: 'Battery air flow valve A high',
    severity: 'warning',
  },
  P0AD9: {
    description: 'Hybrid/EV Battery Positive Contactor Control Circuit/Open',
    short: 'Positive contactor control',
    severity: 'warning',
  },
  P0ADA: {
    description: 'Hybrid/EV Battery Positive Contactor Control Circuit Range/Performance',
    short: 'Positive contactor out of range',
    severity: 'warning',
  },
  P0ADB: {
    description: 'Hybrid/EV Battery Positive Contactor Control Circuit Low',
    short: 'Positive contactor control low',
    severity: 'warning',
  },
  P0ADC: {
    description: 'Hybrid/EV Battery Positive Contactor Control Circuit High',
    short: 'Positive contactor control high',
    severity: 'warning',
  },
  P0ADD: {
    description: 'Hybrid/EV Battery Negative Contactor Control Circuit/Open',
    short: 'Negative contactor control',
    severity: 'warning',
  },
  P0ADE: {
    description: 'Hybrid/EV Battery Negative Contactor Control Circuit Range/Performance',
    short: 'Negative contactor out of range',
    severity: 'warning',
  },
  P0ADF: {
    description: 'Hybrid/EV Battery Negative Contactor Control Circuit Low',
    short: 'Negative contactor control low',
    severity: 'warning',
  },
  P0AE0: {
    description: 'Hybrid/EV Battery Negative Contactor Control Circuit High',
    short: 'Negative contactor control high',
    severity: 'warning',
  },
  P0AE1: {
    description: 'Hybrid/EV Battery Precharge Contactor Circuit',
    short: 'Precharge contactor circuit',
    severity: 'warning',
  },
  P0AE2: {
    description: 'Hybrid/EV Battery Precharge Contactor Circuit Stuck Closed',
    short: 'Precharge contactor stuck closed',
    severity: 'warning',
  },
  P0AE3: {
    description: 'Hybrid/EV Battery Precharge Contactor Circuit Stuck Open',
    short: 'Precharge contactor stuck open',
    severity: 'warning',
  },
  P0AE4: {
    description: 'Hybrid/EV Battery Precharge Contactor "A" Control Circuit/Open',
    short: 'Precharge contactor A circuit',
    severity: 'warning',
  },
  P0AE5: {
    description: 'Hybrid/EV Battery Precharge Contactor "A" Control Circuit Range/Performance',
    short: 'Precharge contactor A fault',
    severity: 'warning',
  },
  P0AE6: {
    description: 'Hybrid/EV Battery Precharge Contactor "A" Control Circuit Low',
    short: 'Precharge contactor A low',
    severity: 'warning',
  },
  P0AE7: {
    description: 'Hybrid/EV Battery Precharge Contactor "A" Control Circuit High',
    short: 'Precharge contactor A high',
    severity: 'warning',
  },
  P0AE8: {
    description: 'Hybrid/EV Battery Temperature Sensor "D" Circuit',
    short: 'HV battery temp sensor D circuit',
    severity: 'warning',
  },
  P0AE9: {
    description: 'Hybrid/EV Battery Temperature Sensor "D" Circuit Range/Performance',
    short: 'HV battery temp sensor D fault',
    severity: 'warning',
  },
  P0AEA: {
    description: 'Hybrid/EV Battery Temperature Sensor "D" Circuit Low',
    short: 'HV battery temp sensor D low',
    severity: 'warning',
  },
  P0AEB: {
    description: 'Hybrid/EV Battery Temperature Sensor "D" Circuit High',
    short: 'HV battery temp sensor D high',
    severity: 'warning',
  },
  P0AEC: {
    description: 'Hybrid/EV Battery Temperature Sensor "D" Circuit Intermittent/Erratic',
    short: 'HV battery temp sensor D erratic',
    severity: 'warning',
  },
  P0AED: {
    description: 'Drive Motor Inverter Temperature Sensor "A" Circuit',
    short: 'Inverter temp sensor A circuit',
    severity: 'warning',
  },
  P0AEE: {
    description: 'Drive Motor Inverter Temperature Sensor "A" Circuit Range/Performance',
    short: 'Inverter temp sensor A fault',
    severity: 'warning',
  },
  P0AEF: {
    description: 'Drive Motor Inverter Temperature Sensor "A" Circuit Low',
    short: 'Inverter temp sensor A low',
    severity: 'warning',
  },
  P0AF0: {
    description: 'Drive Motor Inverter Temperature Sensor "A" Circuit High',
    short: 'Inverter temp sensor A high',
    severity: 'warning',
  },
  P0AF1: {
    description: 'Drive Motor Inverter Temperature Sensor "A" Circuit Intermittent/Erratic',
    short: 'Inverter temp sensor A erratic',
    severity: 'warning',
  },
  P0AF2: {
    description: 'Drive Motor Inverter Temperature Sensor "B" Circuit',
    short: 'Inverter temp sensor B circuit',
    severity: 'warning',
  },
  P0AF3: {
    description: 'Drive Motor Inverter Temperature Sensor "B" Circuit Range/Performance',
    short: 'Inverter temp sensor B fault',
    severity: 'warning',
  },
  P0AF4: {
    description: 'Drive Motor Inverter Temperature Sensor "B" Circuit Low',
    short: 'Inverter temp sensor B low',
    severity: 'warning',
  },
  P0AF5: {
    description: 'Drive Motor Inverter Temperature Sensor "B" Circuit High',
    short: 'Inverter temp sensor B high',
    severity: 'warning',
  },
  P0AF6: {
    description: 'Drive Motor Inverter Temperature Sensor "B" Circuit Intermittent/Erratic',
    short: 'Inverter temp sensor B erratic',
    severity: 'warning',
  },
  P0AF7: {
    description: '14 Volt Power Module Internal Temperature Too High',
    short: '12V converter overheating',
    severity: 'warning',
  },
  P0AF8: {
    description: 'Hybrid/EV Battery System Voltage',
    short: 'HV battery voltage fault',
    severity: 'warning',
  },
  P0AF9: {
    description: 'Hybrid/EV Battery System Voltage Unstable',
    short: 'HV battery voltage unstable',
    severity: 'warning',
  },
  P0AFA: {
    description: 'Hybrid/EV Battery System Voltage Low',
    short: 'HV battery voltage low',
    severity: 'warning',
  },
  P0AFB: {
    description: 'Hybrid/EV Battery System Voltage High',
    short: 'HV battery voltage high',
    severity: 'warning',
  },
  P0AFC: {
    description: 'Hybrid/EV Battery Pack Sensor Module',
    short: 'Battery sensor module fault',
    severity: 'warning',
  },
  P0AFD: {
    description: 'Hybrid/EV Battery Pack Temperature Too Low',
    short: 'Hybrid battery too cold',
    severity: 'caution',
  },
  P0AFE: {
    description: 'Hybrid/EV Battery System Voltage Too Low for Voltage Step Up Conversion',
    short: 'HV voltage too low for boost',
    severity: 'warning',
  },
  P0AFF: {
    description: 'System Voltage Too Low for Voltage Step Down Conversion',
    short: 'Voltage too low for DC/DC',
    severity: 'warning',
  },
};
