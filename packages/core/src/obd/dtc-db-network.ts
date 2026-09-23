import type { DtcDbEntry } from './dtc-database.ts';

/**
 * Generic network codes (SAE J2012 / ISO 15031-6): communication bus faults U0001–U0088, lost
 * communication U0100–U02A6, software incompatibility U0300–U0339, invalid data U0400–U05A7 and
 * the module self-diagnostics U3000–U3017 (supply voltage, grounds, ignition inputs).
 *
 * Coverage: every U0/U3 code in the 2002 J2012 table and the ISO 15031-6 generic list, plus the
 * later J2012 additions that two independent code lists agree on. U040A carries the current text
 * (Air Conditioning Control Module, the invalid-data twin of U010F); the 2002 table had repeated
 * U048A's disc-player text there by mistake. U02A0 is left out (an "invalid data" text inside the
 * lost-communication block that could not be verified). U1xxx/U2xxx are manufacturer-defined.
 *
 * Generic body (B0xxx) and chassis (C0xxx) codes are deliberately absent. J2012 defines them (for
 * example C0035 "Right Front Wheel Speed Sensor Supply", B0012 "Passenger Frontal Stage 3
 * Deployment Control"), but major manufacturers report the same numbers with different meanings
 * (GM: C0035 is the left-front wheel speed sensor, B0012 the driver frontal deployment loop), and
 * B/C codes rarely reach an OBD-II service 03 scan anyway. The range fallback in `dtc-ranges.ts`
 * ("Generic chassis code …") is never wrong for them; a specific SAE text could be.
 *
 * `short` is a glanceable HUD label (at most 32 characters): "<module> offline" for lost
 * communication, "<module>: bad data" for invalid data and "<module>: wrong software" for software
 * incompatibility; "Engine computer" is the ECM/PCM, "Transmission computer" the TCM. The U30xx
 * codes describe a fault seen by whichever module reported them.
 *
 * `severity`: warning for modules that affect drivability or safety (engine, transmission and
 * hybrid/EV drive, brakes/ABS, stability control, steering, airbags, body control, instrument
 * cluster, gateways) and for the high-speed CAN and vehicle buses; caution for emissions modules,
 * driver-assistance sensors, lighting, security and the slower CAN buses; info for comfort and
 * infotainment modules.
 */
export const BCU_CODES: Readonly<Record<string, DtcDbEntry>> = {
  // U00xx — network electrical: CAN and vehicle communication buses
  U0001: {
    description: 'High Speed CAN Communication Bus',
    short: 'High-speed CAN bus fault',
    severity: 'warning',
  },
  U0002: {
    description: 'High Speed CAN Communication Bus Performance',
    short: 'High-speed CAN bus performance',
    severity: 'warning',
  },
  U0003: {
    description: 'High Speed CAN Communication Bus (+) Open',
    short: 'High-speed CAN bus (+) open',
    severity: 'warning',
  },
  U0004: {
    description: 'High Speed CAN Communication Bus (+) Low',
    short: 'High-speed CAN bus (+) low',
    severity: 'warning',
  },
  U0005: {
    description: 'High Speed CAN Communication Bus (+) High',
    short: 'High-speed CAN bus (+) high',
    severity: 'warning',
  },
  U0006: {
    description: 'High Speed CAN Communication Bus (-) Open',
    short: 'High-speed CAN bus (-) open',
    severity: 'warning',
  },
  U0007: {
    description: 'High Speed CAN Communication Bus (-) Low',
    short: 'High-speed CAN bus (-) low',
    severity: 'warning',
  },
  U0008: {
    description: 'High Speed CAN Communication Bus (-) High',
    short: 'High-speed CAN bus (-) high',
    severity: 'warning',
  },
  U0009: {
    description: 'High Speed CAN Communication Bus (-) shorted to Bus (+)',
    short: 'High-speed CAN bus +/- shorted',
    severity: 'warning',
  },
  U0010: {
    description: 'Medium Speed CAN Communication Bus',
    short: 'Mid-speed CAN bus fault',
    severity: 'caution',
  },
  U0011: {
    description: 'Medium Speed CAN Communication Bus Performance',
    short: 'Mid-speed CAN bus performance',
    severity: 'caution',
  },
  U0012: {
    description: 'Medium Speed CAN Communication Bus (+) Open',
    short: 'Mid-speed CAN bus (+) open',
    severity: 'caution',
  },
  U0013: {
    description: 'Medium Speed CAN Communication Bus (+) Low',
    short: 'Mid-speed CAN bus (+) low',
    severity: 'caution',
  },
  U0014: {
    description: 'Medium Speed CAN Communication Bus (+) High',
    short: 'Mid-speed CAN bus (+) high',
    severity: 'caution',
  },
  U0015: {
    description: 'Medium Speed CAN Communication Bus (-) Open',
    short: 'Mid-speed CAN bus (-) open',
    severity: 'caution',
  },
  U0016: {
    description: 'Medium Speed CAN Communication Bus (-) Low',
    short: 'Mid-speed CAN bus (-) low',
    severity: 'caution',
  },
  U0017: {
    description: 'Medium Speed CAN Communication Bus (-) High',
    short: 'Mid-speed CAN bus (-) high',
    severity: 'caution',
  },
  U0018: {
    description: 'Medium Speed CAN Communication Bus (-) shorted to Bus (+)',
    short: 'Mid-speed CAN bus +/- shorted',
    severity: 'caution',
  },
  U0019: {
    description: 'Low Speed CAN Communication Bus',
    short: 'Low-speed CAN bus fault',
    severity: 'caution',
  },
  U0020: {
    description: 'Low Speed CAN Communication Bus Performance',
    short: 'Low-speed CAN bus performance',
    severity: 'caution',
  },
  U0021: {
    description: 'Low Speed CAN Communication Bus (+) Open',
    short: 'Low-speed CAN bus (+) open',
    severity: 'caution',
  },
  U0022: {
    description: 'Low Speed CAN Communication Bus (+) Low',
    short: 'Low-speed CAN bus (+) low',
    severity: 'caution',
  },
  U0023: {
    description: 'Low Speed CAN Communication Bus (+) High',
    short: 'Low-speed CAN bus (+) high',
    severity: 'caution',
  },
  U0024: {
    description: 'Low Speed CAN Communication Bus (-) Open',
    short: 'Low-speed CAN bus (-) open',
    severity: 'caution',
  },
  U0025: {
    description: 'Low Speed CAN Communication Bus (-) Low',
    short: 'Low-speed CAN bus (-) low',
    severity: 'caution',
  },
  U0026: {
    description: 'Low Speed CAN Communication Bus (-) High',
    short: 'Low-speed CAN bus (-) high',
    severity: 'caution',
  },
  U0027: {
    description: 'Low Speed CAN Communication Bus (-) shorted to Bus (+)',
    short: 'Low-speed CAN bus +/- shorted',
    severity: 'caution',
  },
  U0028: {
    description: 'Vehicle Communication Bus A',
    short: 'Vehicle bus A fault',
    severity: 'warning',
  },
  U0029: {
    description: 'Vehicle Communication Bus A Performance',
    short: 'Vehicle bus A performance',
    severity: 'warning',
  },
  U0030: {
    description: 'Vehicle Communication Bus A (+) Open',
    short: 'Vehicle bus A (+) open',
    severity: 'warning',
  },
  U0031: {
    description: 'Vehicle Communication Bus A (+) Low',
    short: 'Vehicle bus A (+) low',
    severity: 'warning',
  },
  U0032: {
    description: 'Vehicle Communication Bus A (+) High',
    short: 'Vehicle bus A (+) high',
    severity: 'warning',
  },
  U0033: {
    description: 'Vehicle Communication Bus A (-) Open',
    short: 'Vehicle bus A (-) open',
    severity: 'warning',
  },
  U0034: {
    description: 'Vehicle Communication Bus A (-) Low',
    short: 'Vehicle bus A (-) low',
    severity: 'warning',
  },
  U0035: {
    description: 'Vehicle Communication Bus A (-) High',
    short: 'Vehicle bus A (-) high',
    severity: 'warning',
  },
  U0036: {
    description: 'Vehicle Communication Bus A (-) shorted to Bus A (+)',
    short: 'Vehicle bus A +/- shorted',
    severity: 'warning',
  },
  U0037: {
    description: 'Vehicle Communication Bus B',
    short: 'Vehicle bus B fault',
    severity: 'warning',
  },
  U0038: {
    description: 'Vehicle Communication Bus B Performance',
    short: 'Vehicle bus B performance',
    severity: 'warning',
  },
  U0039: {
    description: 'Vehicle Communication Bus B (+) Open',
    short: 'Vehicle bus B (+) open',
    severity: 'warning',
  },
  U0040: {
    description: 'Vehicle Communication Bus B (+) Low',
    short: 'Vehicle bus B (+) low',
    severity: 'warning',
  },
  U0041: {
    description: 'Vehicle Communication Bus B (+) High',
    short: 'Vehicle bus B (+) high',
    severity: 'warning',
  },
  U0042: {
    description: 'Vehicle Communication Bus B (-) Open',
    short: 'Vehicle bus B (-) open',
    severity: 'warning',
  },
  U0043: {
    description: 'Vehicle Communication Bus B (-) Low',
    short: 'Vehicle bus B (-) low',
    severity: 'warning',
  },
  U0044: {
    description: 'Vehicle Communication Bus B (-) High',
    short: 'Vehicle bus B (-) high',
    severity: 'warning',
  },
  U0045: {
    description: 'Vehicle Communication Bus B (-) shorted to Bus B (+)',
    short: 'Vehicle bus B +/- shorted',
    severity: 'warning',
  },
  U0046: {
    description: 'Vehicle Communication Bus C',
    short: 'Vehicle bus C fault',
    severity: 'warning',
  },
  U0047: {
    description: 'Vehicle Communication Bus C Performance',
    short: 'Vehicle bus C performance',
    severity: 'warning',
  },
  U0048: {
    description: 'Vehicle Communication Bus C (+) Open',
    short: 'Vehicle bus C (+) open',
    severity: 'warning',
  },
  U0049: {
    description: 'Vehicle Communication Bus C (+) Low',
    short: 'Vehicle bus C (+) low',
    severity: 'warning',
  },
  U0050: {
    description: 'Vehicle Communication Bus C (+) High',
    short: 'Vehicle bus C (+) high',
    severity: 'warning',
  },
  U0051: {
    description: 'Vehicle Communication Bus C (-) Open',
    short: 'Vehicle bus C (-) open',
    severity: 'warning',
  },
  U0052: {
    description: 'Vehicle Communication Bus C (-) Low',
    short: 'Vehicle bus C (-) low',
    severity: 'warning',
  },
  U0053: {
    description: 'Vehicle Communication Bus C (-) High',
    short: 'Vehicle bus C (-) high',
    severity: 'warning',
  },
  U0054: {
    description: 'Vehicle Communication Bus C (-) shorted to Bus C (+)',
    short: 'Vehicle bus C +/- shorted',
    severity: 'warning',
  },
  U0055: {
    description: 'Vehicle Communication Bus D',
    short: 'Vehicle bus D fault',
    severity: 'warning',
  },
  U0056: {
    description: 'Vehicle Communication Bus D Performance',
    short: 'Vehicle bus D performance',
    severity: 'warning',
  },
  U0057: {
    description: 'Vehicle Communication Bus D (+) Open',
    short: 'Vehicle bus D (+) open',
    severity: 'warning',
  },
  U0058: {
    description: 'Vehicle Communication Bus D (+) Low',
    short: 'Vehicle bus D (+) low',
    severity: 'warning',
  },
  U0059: {
    description: 'Vehicle Communication Bus D (+) High',
    short: 'Vehicle bus D (+) high',
    severity: 'warning',
  },
  U0060: {
    description: 'Vehicle Communication Bus D (-) Open',
    short: 'Vehicle bus D (-) open',
    severity: 'warning',
  },
  U0061: {
    description: 'Vehicle Communication Bus D (-) Low',
    short: 'Vehicle bus D (-) low',
    severity: 'warning',
  },
  U0062: {
    description: 'Vehicle Communication Bus D (-) High',
    short: 'Vehicle bus D (-) high',
    severity: 'warning',
  },
  U0063: {
    description: 'Vehicle Communication Bus D (-) shorted to Bus D (+)',
    short: 'Vehicle bus D +/- shorted',
    severity: 'warning',
  },
  U0064: {
    description: 'Vehicle Communication Bus E',
    short: 'Vehicle bus E fault',
    severity: 'warning',
  },
  U0065: {
    description: 'Vehicle Communication Bus E Performance',
    short: 'Vehicle bus E performance',
    severity: 'warning',
  },
  U0066: {
    description: 'Vehicle Communication Bus E (+) Open',
    short: 'Vehicle bus E (+) open',
    severity: 'warning',
  },
  U0067: {
    description: 'Vehicle Communication Bus E (+) Low',
    short: 'Vehicle bus E (+) low',
    severity: 'warning',
  },
  U0068: {
    description: 'Vehicle Communication Bus E (+) High',
    short: 'Vehicle bus E (+) high',
    severity: 'warning',
  },
  U0069: {
    description: 'Vehicle Communication Bus E (-) Open',
    short: 'Vehicle bus E (-) open',
    severity: 'warning',
  },
  U0070: {
    description: 'Vehicle Communication Bus E (-) Low',
    short: 'Vehicle bus E (-) low',
    severity: 'warning',
  },
  U0071: {
    description: 'Vehicle Communication Bus E (-) High',
    short: 'Vehicle bus E (-) high',
    severity: 'warning',
  },
  U0072: {
    description: 'Vehicle Communication Bus E (-) shorted to Bus E (+)',
    short: 'Vehicle bus E +/- shorted',
    severity: 'warning',
  },
  U0073: {
    description: 'Control Module Communication Bus A Off',
    short: 'Module comms bus A off',
    severity: 'warning',
  },
  U0074: {
    description: 'Control Module Communication Bus B Off',
    short: 'Module comms bus B off',
    severity: 'warning',
  },
  U0075: {
    description: 'Control Module Communication Bus C Off',
    short: 'Module comms bus C off',
    severity: 'warning',
  },
  U0076: {
    description: 'Control Module Communication Bus D Off',
    short: 'Module comms bus D off',
    severity: 'warning',
  },
  U0077: {
    description: 'Control Module Communication Bus E Off',
    short: 'Module comms bus E off',
    severity: 'warning',
  },
  U0078: {
    description: 'Control Module Communication Bus F Off',
    short: 'Module comms bus F off',
    severity: 'warning',
  },
  U0079: {
    description: 'Control Module Communication Bus G Off',
    short: 'Module comms bus G off',
    severity: 'warning',
  },
  U007A: {
    description: 'Control Module Communication Bus H Off',
    short: 'Module comms bus H off',
    severity: 'warning',
  },
  U007B: {
    description: 'Control Module Communication Bus I Off',
    short: 'Module comms bus I off',
    severity: 'warning',
  },
  U0080: {
    description: 'Vehicle Communication Bus F',
    short: 'Vehicle bus F fault',
    severity: 'warning',
  },
  U0081: {
    description: 'Vehicle Communication Bus F Performance',
    short: 'Vehicle bus F performance',
    severity: 'warning',
  },
  U0082: {
    description: 'Vehicle Communication Bus F (+) Open',
    short: 'Vehicle bus F (+) open',
    severity: 'warning',
  },
  U0083: {
    description: 'Vehicle Communication Bus F (+) Low',
    short: 'Vehicle bus F (+) low',
    severity: 'warning',
  },
  U0084: {
    description: 'Vehicle Communication Bus F (+) High',
    short: 'Vehicle bus F (+) high',
    severity: 'warning',
  },
  U0085: {
    description: 'Vehicle Communication Bus F (-) Open',
    short: 'Vehicle bus F (-) open',
    severity: 'warning',
  },
  U0086: {
    description: 'Vehicle Communication Bus F (-) Low',
    short: 'Vehicle bus F (-) low',
    severity: 'warning',
  },
  U0087: {
    description: 'Vehicle Communication Bus F (-) High',
    short: 'Vehicle bus F (-) high',
    severity: 'warning',
  },
  U0088: {
    description: 'Vehicle Communication Bus F (-) shorted to Bus F (+)',
    short: 'Vehicle bus F +/- shorted',
    severity: 'warning',
  },

  // U01xx — lost communication with powertrain, chassis and body modules
  U0100: {
    description: 'Lost Communication With ECM/PCM "A"',
    short: 'Engine computer offline',
    severity: 'warning',
  },
  U0101: {
    description: 'Lost Communication With TCM',
    short: 'Transmission computer offline',
    severity: 'warning',
  },
  U0102: {
    description: 'Lost Communication With Transfer Case Control Module',
    short: 'Transfer case module offline',
    severity: 'warning',
  },
  U0103: {
    description: 'Lost Communication With Gear Shift Control Module "A"',
    short: 'Gear shift module A offline',
    severity: 'warning',
  },
  U0104: {
    description: 'Lost Communication With Cruise Control Module',
    short: 'Cruise control module offline',
    severity: 'caution',
  },
  U0105: {
    description: 'Lost Communication With Fuel Injector Control Module',
    short: 'Injector module offline',
    severity: 'warning',
  },
  U0106: {
    description: 'Lost Communication With Glow Plug Control Module 1',
    short: 'Glow plug module 1 offline',
    severity: 'caution',
  },
  U0107: {
    description: 'Lost Communication With Throttle Actuator "A" Control Module',
    short: 'Throttle module A offline',
    severity: 'warning',
  },
  U0108: {
    description: 'Lost Communication With Alternative Fuel Control Module',
    short: 'Alt-fuel module offline',
    severity: 'warning',
  },
  U0109: {
    description: 'Lost Communication With Fuel Pump Control Module "A"',
    short: 'Fuel pump module A offline',
    severity: 'warning',
  },
  U010A: {
    description: 'Lost Communication With Exhaust Gas Recirculation Control Module "A"',
    short: 'EGR module A offline',
    severity: 'caution',
  },
  U010B: {
    description: 'Lost Communication With Exhaust Gas Recirculation Control Module "B"',
    short: 'EGR module B offline',
    severity: 'caution',
  },
  U010C: {
    description: 'Lost Communication With Turbocharger/Supercharger Control Module "A"',
    short: 'Turbo module A offline',
    severity: 'warning',
  },
  U010D: {
    description: 'Lost Communication With Turbocharger/Supercharger Control Module "B"',
    short: 'Turbo module B offline',
    severity: 'warning',
  },
  U010E: {
    description: 'Lost Communication With Reductant Control Module',
    short: 'DEF module offline',
    severity: 'caution',
  },
  U010F: {
    description: 'Lost Communication With Air Conditioning Control Module',
    short: 'A/C module offline',
    severity: 'info',
  },
  U0110: {
    description: 'Lost Communication With Drive Motor Control Module "A"',
    short: 'Drive motor module A offline',
    severity: 'warning',
  },
  U0111: {
    description: 'Lost Communication With Battery Energy Control Module "A"',
    short: 'Hybrid battery module A offline',
    severity: 'warning',
  },
  U0112: {
    description: 'Lost Communication With Battery Energy Control Module "B"',
    short: 'Hybrid battery module B offline',
    severity: 'warning',
  },
  U0113: {
    description: 'Lost Communication With Emissions Critical Control Information',
    short: 'Emissions data link lost',
    severity: 'caution',
  },
  U0114: {
    description: 'Lost Communication With Four-Wheel Drive Clutch Control Module',
    short: '4WD clutch module offline',
    severity: 'warning',
  },
  U0115: {
    description: 'Lost Communication With ECM/PCM "B"',
    short: 'Engine computer B offline',
    severity: 'warning',
  },
  U0116: {
    description: 'Lost Communication With Coolant Temperature Control Module',
    short: 'Coolant temp module offline',
    severity: 'warning',
  },
  U0117: {
    description: 'Lost Communication With PTO Control Module',
    short: 'PTO module offline',
    severity: 'info',
  },
  U0118: {
    description: 'Lost Communication With Fuel Additive Control Module',
    short: 'Fuel additive module offline',
    severity: 'caution',
  },
  U0119: {
    description: 'Lost Communication With Fuel Cell Control Module',
    short: 'Fuel cell module offline',
    severity: 'warning',
  },
  U011A: {
    description: 'Lost Communication With Exhaust Gas Sensor Module "A"',
    short: 'Exhaust sensor module A offline',
    severity: 'caution',
  },
  U011B: {
    description: 'Lost Communication With Rocker Arm Control Module "A"',
    short: 'Rocker arm module A offline',
    severity: 'warning',
  },
  U011C: {
    description: 'Lost Communication With Rocker Arm Control Module "B"',
    short: 'Rocker arm module B offline',
    severity: 'warning',
  },
  U011D: {
    description: 'Lost Communication With All Wheel Drive Control Module',
    short: 'AWD module offline',
    severity: 'warning',
  },
  U011E: {
    description: 'Lost Communication With Throttle Actuator "B" Control Module',
    short: 'Throttle module B offline',
    severity: 'warning',
  },
  U0120: {
    description: 'Lost Communication With Starter/Generator Control Module',
    short: 'Starter/generator module offline',
    severity: 'warning',
  },
  U0121: {
    description: 'Lost Communication With Anti-Lock Brake System (ABS) Control Module',
    short: 'ABS module offline',
    severity: 'warning',
  },
  U0122: {
    description: 'Lost Communication With Vehicle Dynamics Control Module',
    short: 'Stability control module offline',
    severity: 'warning',
  },
  U0123: {
    description: 'Lost Communication With Yaw Rate Sensor Module',
    short: 'Yaw rate sensor offline',
    severity: 'warning',
  },
  U0124: {
    description: 'Lost Communication With Lateral Acceleration Sensor Module',
    short: 'Lateral accel. sensor offline',
    severity: 'warning',
  },
  U0125: {
    description: 'Lost Communication With Multi-axis Acceleration Sensor Module',
    short: 'Motion sensor module offline',
    severity: 'warning',
  },
  U0126: {
    description: 'Lost Communication With Steering Angle Sensor Module',
    short: 'Steering angle sensor offline',
    severity: 'warning',
  },
  U0127: {
    description: 'Lost Communication With Tire Pressure Monitor Module',
    short: 'Tire pressure module offline',
    severity: 'caution',
  },
  U0128: {
    description: 'Lost Communication With Park Brake Control Module',
    short: 'Parking brake module offline',
    severity: 'warning',
  },
  U0129: {
    description: 'Lost Communication With Brake System Control Module',
    short: 'Brake module offline',
    severity: 'warning',
  },
  U012A: {
    description: 'Lost Communication With Chassis Control Module "A"',
    short: 'Chassis module A offline',
    severity: 'warning',
  },
  U012B: {
    description: 'Lost Communication With Chassis Control Module "B"',
    short: 'Chassis module B offline',
    severity: 'warning',
  },
  U012C: {
    description: 'Lost Communication With Active Vibration Control Module',
    short: 'Vibration control module offline',
    severity: 'info',
  },
  U012D: {
    description: 'Lost Communication With Generator Control Module',
    short: 'Alternator module offline',
    severity: 'warning',
  },
  U0130: {
    description: 'Lost Communication With Steering Effort Control Module',
    short: 'Steering effort module offline',
    severity: 'warning',
  },
  U0131: {
    description: 'Lost Communication With Power Steering Control Module',
    short: 'Power steering module offline',
    severity: 'warning',
  },
  U0132: {
    description: 'Lost Communication With Suspension Control Module "A"',
    short: 'Suspension module A offline',
    severity: 'warning',
  },
  U0133: {
    description: 'Lost Communication With Active Roll Control Module',
    short: 'Roll control module offline',
    severity: 'warning',
  },
  U0134: {
    description: 'Lost Communication With Power Steering Control Module - Rear',
    short: 'Rear steering module offline',
    severity: 'warning',
  },
  U0135: {
    description: 'Lost Communication With Differential Control Module - Front',
    short: 'Front diff module offline',
    severity: 'warning',
  },
  U0136: {
    description: 'Lost Communication With Differential Control Module - Rear',
    short: 'Rear diff module offline',
    severity: 'warning',
  },
  U0137: {
    description: 'Lost Communication With Trailer Brake Control Module',
    short: 'Trailer brake module offline',
    severity: 'warning',
  },
  U0138: {
    description: 'Lost Communication With All Terrain Control Module',
    short: 'Terrain control module offline',
    severity: 'caution',
  },
  U0139: {
    description: 'Lost Communication With Suspension Control Module "B"',
    short: 'Suspension module B offline',
    severity: 'warning',
  },
  U013C: {
    description: 'Lost Communication With Accelerator Pedal Module',
    short: 'Gas pedal module offline',
    severity: 'warning',
  },
  U013D: {
    description: 'Lost Communication With Vacuum Sensor "A"',
    short: 'Vacuum sensor A offline',
    severity: 'caution',
  },
  U013E: {
    description: 'Lost Communication With Vacuum Sensor "B"',
    short: 'Vacuum sensor B offline',
    severity: 'caution',
  },
  U0140: {
    description: 'Lost Communication With Body Control Module',
    short: 'Body control module offline',
    severity: 'warning',
  },
  U0141: {
    description: 'Lost Communication With Body Control Module "A"',
    short: 'Body control module A offline',
    severity: 'warning',
  },
  U0142: {
    description: 'Lost Communication With Body Control Module "B"',
    short: 'Body control module B offline',
    severity: 'warning',
  },
  U0143: {
    description: 'Lost Communication With Body Control Module "C"',
    short: 'Body control module C offline',
    severity: 'warning',
  },
  U0144: {
    description: 'Lost Communication With Body Control Module "D"',
    short: 'Body control module D offline',
    severity: 'warning',
  },
  U0145: {
    description: 'Lost Communication With Body Control Module "E"',
    short: 'Body control module E offline',
    severity: 'warning',
  },
  U0146: {
    description: 'Lost Communication With Gateway "A"',
    short: 'Network gateway A offline',
    severity: 'warning',
  },
  U0147: {
    description: 'Lost Communication With Gateway "B"',
    short: 'Network gateway B offline',
    severity: 'warning',
  },
  U0148: {
    description: 'Lost Communication With Gateway "C"',
    short: 'Network gateway C offline',
    severity: 'warning',
  },
  U0149: {
    description: 'Lost Communication With Gateway "D"',
    short: 'Network gateway D offline',
    severity: 'warning',
  },
  U0150: {
    description: 'Lost Communication With Gateway "E"',
    short: 'Network gateway E offline',
    severity: 'warning',
  },
  U0151: {
    description: 'Lost Communication With Restraints Control Module',
    short: 'Airbag module offline',
    severity: 'warning',
  },
  U0152: {
    description: 'Lost Communication With Side Restraints Control Module - Left',
    short: 'Left airbag module offline',
    severity: 'warning',
  },
  U0153: {
    description: 'Lost Communication With Side Restraints Control Module - Right',
    short: 'Right airbag module offline',
    severity: 'warning',
  },
  U0154: {
    description: 'Lost Communication With Restraints Occupant Classification System Module',
    short: 'Seat occupant sensor offline',
    severity: 'warning',
  },
  U0155: {
    description: 'Lost Communication With Instrument Panel Cluster (IPC) Control Module',
    short: 'Instrument cluster offline',
    severity: 'warning',
  },
  U0156: {
    description: 'Lost Communication With Information Center "A"',
    short: 'Info center A offline',
    severity: 'info',
  },
  U0157: {
    description: 'Lost Communication With Information Center "B"',
    short: 'Info center B offline',
    severity: 'info',
  },
  U0158: {
    description: 'Lost Communication With Head Up Display',
    short: 'Head-up display offline',
    severity: 'info',
  },
  U0159: {
    description: 'Lost Communication With Parking Assist Control Module "A"',
    short: 'Parking assist module A offline',
    severity: 'info',
  },
  U0160: {
    description: 'Lost Communication With Audible Alert Control Module',
    short: 'Warning chime module offline',
    severity: 'info',
  },
  U0161: {
    description: 'Lost Communication With Compass Module',
    short: 'Compass module offline',
    severity: 'info',
  },
  U0162: {
    description: 'Lost Communication With Navigation Display Module',
    short: 'Navigation display offline',
    severity: 'info',
  },
  U0163: {
    description: 'Lost Communication With Navigation Control Module',
    short: 'Navigation module offline',
    severity: 'info',
  },
  U0164: {
    description: 'Lost Communication With HVAC Control Module',
    short: 'Climate control module offline',
    severity: 'info',
  },
  U0165: {
    description: 'Lost Communication With HVAC Control Module - Rear',
    short: 'Rear climate module offline',
    severity: 'info',
  },
  U0166: {
    description: 'Lost Communication With Auxiliary Heater Control Module',
    short: 'Aux heater module offline',
    severity: 'info',
  },
  U0167: {
    description: 'Lost Communication With Vehicle Immobilizer Control Module',
    short: 'Immobilizer offline',
    severity: 'caution',
  },
  U0168: {
    description: 'Lost Communication With Vehicle Security Control Module',
    short: 'Security module offline',
    severity: 'caution',
  },
  U0169: {
    description: 'Lost Communication With Sunroof Control Module',
    short: 'Sunroof module offline',
    severity: 'info',
  },
  U016A: {
    description: 'Lost Communication With Global Positioning System Module',
    short: 'GPS module offline',
    severity: 'info',
  },
  U016B: {
    description: 'Lost Communication With Electric A/C Compressor Control Module',
    short: 'A/C compressor module offline',
    severity: 'caution',
  },
  U016C: {
    description: 'Lost Communication With Fuel Pump Control Module "B"',
    short: 'Fuel pump module B offline',
    severity: 'warning',
  },
  U016D: {
    description: 'Lost Communication With Exhaust Gas Sensor Module "B"',
    short: 'Exhaust sensor module B offline',
    severity: 'caution',
  },
  U0170: {
    description: 'Lost Communication With Restraints System Sensor "A"',
    short: 'Airbag sensor A offline',
    severity: 'warning',
  },
  U0171: {
    description: 'Lost Communication With Restraints System Sensor "B"',
    short: 'Airbag sensor B offline',
    severity: 'warning',
  },
  U0172: {
    description: 'Lost Communication With Restraints System Sensor "C"',
    short: 'Airbag sensor C offline',
    severity: 'warning',
  },
  U0173: {
    description: 'Lost Communication With Restraints System Sensor "D"',
    short: 'Airbag sensor D offline',
    severity: 'warning',
  },
  U0174: {
    description: 'Lost Communication With Restraints System Sensor "E"',
    short: 'Airbag sensor E offline',
    severity: 'warning',
  },
  U0175: {
    description: 'Lost Communication With Restraints System Sensor "F"',
    short: 'Airbag sensor F offline',
    severity: 'warning',
  },
  U0176: {
    description: 'Lost Communication With Restraints System Sensor "G"',
    short: 'Airbag sensor G offline',
    severity: 'warning',
  },
  U0177: {
    description: 'Lost Communication With Restraints System Sensor "H"',
    short: 'Airbag sensor H offline',
    severity: 'warning',
  },
  U0178: {
    description: 'Lost Communication With Restraints System Sensor "I"',
    short: 'Airbag sensor I offline',
    severity: 'warning',
  },
  U0179: {
    description: 'Lost Communication With Restraints System Sensor "J"',
    short: 'Airbag sensor J offline',
    severity: 'warning',
  },
  U017A: {
    description: 'Lost Communication With Restraints System Sensor "K"',
    short: 'Airbag sensor K offline',
    severity: 'warning',
  },
  U017B: {
    description: 'Lost Communication With Restraints System Sensor "L"',
    short: 'Airbag sensor L offline',
    severity: 'warning',
  },
  U017C: {
    description: 'Lost Communication With Restraints System Sensor "M"',
    short: 'Airbag sensor M offline',
    severity: 'warning',
  },
  U017D: {
    description: 'Lost Communication With Restraints System Sensor "N"',
    short: 'Airbag sensor N offline',
    severity: 'warning',
  },
  U017E: {
    description: 'Lost Communication With Seat Belt Pretensioner Module "A"',
    short: 'Seat belt module A offline',
    severity: 'warning',
  },
  U017F: {
    description: 'Lost Communication With Seat Belt Pretensioner Module "B"',
    short: 'Seat belt module B offline',
    severity: 'warning',
  },
  U0180: {
    description: 'Lost Communication With Automatic Lighting Control Module',
    short: 'Auto lighting module offline',
    severity: 'caution',
  },
  U0181: {
    description: 'Lost Communication With Headlamp Leveling Control Module',
    short: 'Headlamp leveling module offline',
    severity: 'info',
  },
  U0182: {
    description: 'Lost Communication With Lighting Control Module - Front',
    short: 'Front lighting module offline',
    severity: 'caution',
  },
  U0183: {
    description: 'Lost Communication With Lighting Control Module - Rear "A"',
    short: 'Rear lighting module A offline',
    severity: 'caution',
  },
  U0184: {
    description: 'Lost Communication With Radio',
    short: 'Radio offline',
    severity: 'info',
  },
  U0185: {
    description: 'Lost Communication With Antenna Control Module',
    short: 'Antenna module offline',
    severity: 'info',
  },
  U0186: {
    description: 'Lost Communication With Audio Amplifier "A"',
    short: 'Audio amplifier A offline',
    severity: 'info',
  },
  U0187: {
    description: 'Lost Communication With Digital Disc Player/Changer Module "A"',
    short: 'Disc player A offline',
    severity: 'info',
  },
  U0188: {
    description: 'Lost Communication With Digital Disc Player/Changer Module "B"',
    short: 'Disc player B offline',
    severity: 'info',
  },
  U0189: {
    description: 'Lost Communication With Digital Disc Player/Changer Module "C"',
    short: 'Disc player C offline',
    severity: 'info',
  },
  U0190: {
    description: 'Lost Communication With Digital Disc Player/Changer Module "D"',
    short: 'Disc player D offline',
    severity: 'info',
  },
  U0191: {
    description: 'Lost Communication With Television',
    short: 'TV module offline',
    severity: 'info',
  },
  U0192: {
    description: 'Lost Communication With Personal Computer',
    short: 'On-board PC offline',
    severity: 'info',
  },
  U0193: {
    description: 'Lost Communication With Digital Audio Control Module "A"',
    short: 'Digital audio module A offline',
    severity: 'info',
  },
  U0194: {
    description: 'Lost Communication With Digital Audio Control Module "B"',
    short: 'Digital audio module B offline',
    severity: 'info',
  },
  U0195: {
    description: 'Lost Communication With Subscription Entertainment Receiver Module',
    short: 'Satellite radio offline',
    severity: 'info',
  },
  U0196: {
    description: 'Lost Communication With Entertainment Control Module - Rear "A"',
    short: 'Rear entertainment A offline',
    severity: 'info',
  },
  U0197: {
    description: 'Lost Communication With Telephone Control Module',
    short: 'Phone module offline',
    severity: 'info',
  },
  U0198: {
    description: 'Lost Communication With Telematic Control Module',
    short: 'Telematics module offline',
    severity: 'info',
  },
  U0199: {
    description: 'Lost Communication With Door Control Module "A"',
    short: 'Door module A offline',
    severity: 'info',
  },
  U019A: {
    description: 'Lost Communication With Tachograph Module',
    short: 'Tachograph offline',
    severity: 'info',
  },
  U019B: {
    description: 'Lost Communication With Battery Charger Control Module',
    short: 'Battery charger module offline',
    severity: 'caution',
  },
  U019C: {
    description: 'Lost Communication With Glow Plug Control Module 2',
    short: 'Glow plug module 2 offline',
    severity: 'caution',
  },
  U019D: {
    description: 'Lost Communication With Direct Ozone Reduction Catalyst Temperature Sensor',
    short: 'Ozone catalyst sensor offline',
    severity: 'caution',
  },
  U019E: {
    description: 'Lost Communication With Transmission Range Control Module',
    short: 'Gear selector module offline',
    severity: 'warning',
  },
  U019F: {
    description: 'Lost Communication With Engine Coolant Pump Control Module',
    short: 'Coolant pump module offline',
    severity: 'warning',
  },
  U01A0: {
    description: 'Lost Communication With Hybrid/EV Battery Interface Control Module "A"',
    short: 'HV battery interface A offline',
    severity: 'warning',
  },
  U01A1: {
    description: 'Lost Communication With Hybrid/EV Battery Interface Control Module "B"',
    short: 'HV battery interface B offline',
    severity: 'warning',
  },
  U01A2: {
    description: 'Lost Communication With Hybrid/EV Battery Interface Control Module "C"',
    short: 'HV battery interface C offline',
    severity: 'warning',
  },
  U01A3: {
    description: 'Lost Communication With Hybrid/EV Battery Interface Control Module "D"',
    short: 'HV battery interface D offline',
    severity: 'warning',
  },
  U01A4: {
    description: 'Lost Communication With Hybrid/EV Battery Interface Control Module "E"',
    short: 'HV battery interface E offline',
    severity: 'warning',
  },
  U01A5: {
    description: 'Lost Communication With Hybrid/EV Battery Interface Control Module "F"',
    short: 'HV battery interface F offline',
    severity: 'warning',
  },
  U01A6: {
    description: 'Lost Communication With Hybrid/EV Battery Interface Control Module "G"',
    short: 'HV battery interface G offline',
    severity: 'warning',
  },
  U01A7: {
    description: 'Lost Communication With Hybrid/EV Battery Interface Control Module "H"',
    short: 'HV battery interface H offline',
    severity: 'warning',
  },
  U01A8: {
    description: 'Lost Communication With Hybrid/EV Battery Interface Control Module "I"',
    short: 'HV battery interface I offline',
    severity: 'warning',
  },
  U01A9: {
    description: 'Lost Communication With Hybrid/EV Battery Interface Control Module "J"',
    short: 'HV battery interface J offline',
    severity: 'warning',
  },
  U01AA: {
    description: 'Lost Communication With Hybrid/EV Battery Interface Control Module "K"',
    short: 'HV battery interface K offline',
    severity: 'warning',
  },
  U01AB: {
    description: 'Lost Communication With Hybrid/EV Battery Interface Control Module "L"',
    short: 'HV battery interface L offline',
    severity: 'warning',
  },
  U01AC: {
    description: 'Lost Communication With Hybrid/EV Battery Interface Control Module "M"',
    short: 'HV battery interface M offline',
    severity: 'warning',
  },
  U01AD: {
    description: 'Lost Communication With Hybrid/EV Battery Interface Control Module "N"',
    short: 'HV battery interface N offline',
    severity: 'warning',
  },
  U01AE: {
    description: 'Lost Communication With Hybrid/EV Battery Interface Control Module "O"',
    short: 'HV battery interface O offline',
    severity: 'warning',
  },
  U01AF: {
    description: 'Lost Communication With Hybrid/EV Battery Interface Control Module "P"',
    short: 'HV battery interface P offline',
    severity: 'warning',
  },
  U01B0: {
    description: 'Lost Communication With Battery Monitor Module',
    short: 'Battery monitor offline',
    severity: 'caution',
  },
  U01B1: {
    description: 'Lost Communication With Particulate Matter Sensor "B"',
    short: 'Soot sensor B offline',
    severity: 'caution',
  },

  // U02xx — lost communication with body, comfort, driver-assistance and EV modules
  U0200: {
    description: 'Lost Communication With Door Control Module "B"',
    short: 'Door module B offline',
    severity: 'info',
  },
  U0201: {
    description: 'Lost Communication With Door Control Module "C"',
    short: 'Door module C offline',
    severity: 'info',
  },
  U0202: {
    description: 'Lost Communication With Door Control Module "D"',
    short: 'Door module D offline',
    severity: 'info',
  },
  U0203: {
    description: 'Lost Communication With Door Control Module "E"',
    short: 'Door module E offline',
    severity: 'info',
  },
  U0204: {
    description: 'Lost Communication With Door Control Module "F"',
    short: 'Door module F offline',
    severity: 'info',
  },
  U0205: {
    description: 'Lost Communication With Door Control Module "G"',
    short: 'Door module G offline',
    severity: 'info',
  },
  U0206: {
    description: 'Lost Communication With Folding Top Control Module',
    short: 'Convertible top module offline',
    severity: 'info',
  },
  U0207: {
    description: 'Lost Communication With Moveable Roof Control Module "A"',
    short: 'Moving roof module A offline',
    severity: 'info',
  },
  U0208: {
    description: 'Lost Communication With Seat Control Module "A"',
    short: 'Seat module A offline',
    severity: 'info',
  },
  U0209: {
    description: 'Lost Communication With Seat Control Module "B"',
    short: 'Seat module B offline',
    severity: 'info',
  },
  U020A: {
    description: 'Lost Communication With Moveable Roof Control Module "B"',
    short: 'Moving roof module B offline',
    severity: 'info',
  },
  U0210: {
    description: 'Lost Communication With Seat Control Module "C"',
    short: 'Seat module C offline',
    severity: 'info',
  },
  U0211: {
    description: 'Lost Communication With Seat Control Module "D"',
    short: 'Seat module D offline',
    severity: 'info',
  },
  U0212: {
    description: 'Lost Communication With Steering Column Control Module',
    short: 'Steering column module offline',
    severity: 'caution',
  },
  U0213: {
    description: 'Lost Communication With Mirror Control Module "A"',
    short: 'Mirror module A offline',
    severity: 'info',
  },
  U0214: {
    description: 'Lost Communication With Remote Function Actuation',
    short: 'Keyless remote module offline',
    severity: 'info',
  },
  U0215: {
    description: 'Lost Communication With Door Switch "A"',
    short: 'Door switch A offline',
    severity: 'info',
  },
  U0216: {
    description: 'Lost Communication With Door Switch "B"',
    short: 'Door switch B offline',
    severity: 'info',
  },
  U0217: {
    description: 'Lost Communication With Door Switch "C"',
    short: 'Door switch C offline',
    severity: 'info',
  },
  U0218: {
    description: 'Lost Communication With Door Switch "D"',
    short: 'Door switch D offline',
    severity: 'info',
  },
  U0219: {
    description: 'Lost Communication With Door Switch "E"',
    short: 'Door switch E offline',
    severity: 'info',
  },
  U0220: {
    description: 'Lost Communication With Door Switch "F"',
    short: 'Door switch F offline',
    severity: 'info',
  },
  U0221: {
    description: 'Lost Communication With Door Switch "G"',
    short: 'Door switch G offline',
    severity: 'info',
  },
  U0222: {
    description: 'Lost Communication With Door Window Motor "A"',
    short: 'Window motor A offline',
    severity: 'info',
  },
  U0223: {
    description: 'Lost Communication With Door Window Motor "B"',
    short: 'Window motor B offline',
    severity: 'info',
  },
  U0224: {
    description: 'Lost Communication With Door Window Motor "C"',
    short: 'Window motor C offline',
    severity: 'info',
  },
  U0225: {
    description: 'Lost Communication With Door Window Motor "D"',
    short: 'Window motor D offline',
    severity: 'info',
  },
  U0226: {
    description: 'Lost Communication With Door Window Motor "E"',
    short: 'Window motor E offline',
    severity: 'info',
  },
  U0227: {
    description: 'Lost Communication With Door Window Motor "F"',
    short: 'Window motor F offline',
    severity: 'info',
  },
  U0228: {
    description: 'Lost Communication With Door Window Motor "G"',
    short: 'Window motor G offline',
    severity: 'info',
  },
  U0229: {
    description: 'Lost Communication With Heated Steering Wheel Module',
    short: 'Heated wheel module offline',
    severity: 'info',
  },
  U0230: {
    description: 'Lost Communication With Rear Gate Module',
    short: 'Tailgate module offline',
    severity: 'info',
  },
  U0231: {
    description: 'Lost Communication With Rain Sensing Module',
    short: 'Rain sensor offline',
    severity: 'info',
  },
  U0232: {
    description: 'Lost Communication With Side Obstacle Detection Control Module Left',
    short: 'Left blind spot module offline',
    severity: 'caution',
  },
  U0233: {
    description: 'Lost Communication With Side Obstacle Detection Control Module Right',
    short: 'Right blind spot module offline',
    severity: 'caution',
  },
  U0234: {
    description: 'Lost Communication With Convenience Recall Module',
    short: 'Memory settings module offline',
    severity: 'info',
  },
  U0235: {
    description: 'Lost Communication With Front Distance Range Sensor - Single Sensor or Center',
    short: 'Front radar offline',
    severity: 'caution',
  },
  U0236: {
    description: 'Lost Communication With Column Lock Module',
    short: 'Steering lock module offline',
    severity: 'warning',
  },
  U0237: {
    description: 'Lost Communication With Digital Audio Control Module "C"',
    short: 'Digital audio module C offline',
    severity: 'info',
  },
  U0238: {
    description: 'Lost Communication With Digital Audio Control Module "D"',
    short: 'Digital audio module D offline',
    severity: 'info',
  },
  U0239: {
    description: 'Lost Communication With Entrapment Control Module "A"',
    short: 'Anti-pinch module A offline',
    severity: 'info',
  },
  U023A: {
    description: 'Lost Communication With Image Processing Module "A"',
    short: 'Camera module A offline',
    severity: 'caution',
  },
  U023B: {
    description: 'Lost Communication With Image Processing Module "B"',
    short: 'Camera module B offline',
    severity: 'caution',
  },
  U023C: {
    description: 'Lost Communication With Image Processing Module "C"',
    short: 'Camera module C offline',
    severity: 'caution',
  },
  U023D: {
    description: 'Lost Communication With Front Distance Range Sensor - Left',
    short: 'Left front radar offline',
    severity: 'caution',
  },
  U023E: {
    description: 'Lost Communication With Front Distance Range Sensor - Right',
    short: 'Right front radar offline',
    severity: 'caution',
  },
  U0240: {
    description: 'Lost Communication With Entrapment Control Module "B"',
    short: 'Anti-pinch module B offline',
    severity: 'info',
  },
  U0241: {
    description: 'Lost Communication With Headlamp Control Module "A"',
    short: 'Headlamp module A offline',
    severity: 'caution',
  },
  U0242: {
    description: 'Lost Communication With Headlamp Control Module "B"',
    short: 'Headlamp module B offline',
    severity: 'caution',
  },
  U0243: {
    description: 'Lost Communication With Parking Assist Control Module "B"',
    short: 'Parking assist module B offline',
    severity: 'info',
  },
  U0244: {
    description: 'Lost Communication With Running Board Control Module "A"',
    short: 'Running board module A offline',
    severity: 'info',
  },
  U0245: {
    description: 'Lost Communication With Entertainment Control Module - Front',
    short: 'Front entertainment offline',
    severity: 'info',
  },
  U0246: {
    description: 'Lost Communication With Seat Control Module "E"',
    short: 'Seat module E offline',
    severity: 'info',
  },
  U0247: {
    description: 'Lost Communication With Seat Control Module "F"',
    short: 'Seat module F offline',
    severity: 'info',
  },
  U0248: {
    description: 'Lost Communication With Remote Accessory Module',
    short: 'Remote accessory module offline',
    severity: 'info',
  },
  U0249: {
    description: 'Lost Communication With Entertainment Control Module - Rear "B"',
    short: 'Rear entertainment B offline',
    severity: 'info',
  },
  U024A: {
    description: 'Lost Communication With Interior Lighting Control Module',
    short: 'Interior lighting module offline',
    severity: 'info',
  },
  U024B: {
    description: 'Lost Communication With Seat Control Module "G"',
    short: 'Seat module G offline',
    severity: 'info',
  },
  U024C: {
    description: 'Lost Communication With Seat Control Module "H"',
    short: 'Seat module H offline',
    severity: 'info',
  },
  U0250: {
    description: 'Lost Communication With Impact Classification System Module',
    short: 'Impact sensor module offline',
    severity: 'warning',
  },
  U0251: {
    description: 'Lost Communication With Running Board Control Module "B"',
    short: 'Running board module B offline',
    severity: 'info',
  },
  U0252: {
    description: 'Lost Communication With Lighting Control Module - Rear "B"',
    short: 'Rear lighting module B offline',
    severity: 'caution',
  },
  U0253: {
    description: 'Lost Communication With Accessory Protocol Interface Module',
    short: 'Accessory interface offline',
    severity: 'info',
  },
  U0254: {
    description: 'Lost Communication With Remote Start Module',
    short: 'Remote start module offline',
    severity: 'info',
  },
  U0255: {
    description: 'Lost Communication With Front Display Interface Module',
    short: 'Front display module offline',
    severity: 'info',
  },
  U0256: {
    description: 'Lost Communication With Front Controls Interface Module "A"',
    short: 'Front controls module A offline',
    severity: 'info',
  },
  U0257: {
    description: 'Lost Communication With Front Controls/Display Interface Module',
    short: 'Front controls/display offline',
    severity: 'info',
  },
  U0258: {
    description: 'Lost Communication With Radio Transceiver',
    short: 'Radio transceiver offline',
    severity: 'info',
  },
  U0259: {
    description: 'Lost Communication With Special Purpose Vehicle Control Module "A"',
    short: 'Special vehicle module A offline',
    severity: 'info',
  },
  U025A: {
    description: 'Lost Communication With Special Purpose Vehicle Control Module "B"',
    short: 'Special vehicle module B offline',
    severity: 'info',
  },
  U025B: {
    description: 'Lost Communication With Special Purpose Vehicle Control Module "C"',
    short: 'Special vehicle module C offline',
    severity: 'info',
  },
  U025C: {
    description: 'Lost Communication With Special Purpose Vehicle Control Module "D"',
    short: 'Special vehicle module D offline',
    severity: 'info',
  },
  U025D: {
    description: 'Lost Communication With Front Controls Interface Module "B"',
    short: 'Front controls module B offline',
    severity: 'info',
  },
  U0260: {
    description: 'Lost Communication With Seat Control Switch Module "A"',
    short: 'Seat switch module A offline',
    severity: 'info',
  },
  U0261: {
    description: 'Lost Communication With Seat Control Switch Module "B"',
    short: 'Seat switch module B offline',
    severity: 'info',
  },
  U0262: {
    description: 'Lost Communication With Audio Amplifier "B"',
    short: 'Audio amplifier B offline',
    severity: 'info',
  },
  U0263: {
    description: 'Lost Communication With Speech Recognition Module',
    short: 'Voice control module offline',
    severity: 'info',
  },
  U0264: {
    description: 'Lost Communication With Camera Module - Rear',
    short: 'Rear camera offline',
    severity: 'caution',
  },
  U0265: {
    description: 'Lost Communication With Image Processing Sensor "A"',
    short: 'Camera sensor A offline',
    severity: 'caution',
  },
  U0266: {
    description: 'Lost Communication With Image Processing Sensor "B"',
    short: 'Camera sensor B offline',
    severity: 'caution',
  },
  U0267: {
    description: 'Lost Communication With Image Processing Sensor "C"',
    short: 'Camera sensor C offline',
    severity: 'caution',
  },
  U0268: {
    description: 'Lost Communication With Image Processing Sensor "D"',
    short: 'Camera sensor D offline',
    severity: 'caution',
  },
  U0269: {
    description: 'Lost Communication With Image Processing Sensor "E"',
    short: 'Camera sensor E offline',
    severity: 'caution',
  },
  U026A: {
    description: 'Lost Communication With Image Processing Sensor "F"',
    short: 'Camera sensor F offline',
    severity: 'caution',
  },
  U026B: {
    description: 'Lost Communication With Image Processing Sensor "G"',
    short: 'Camera sensor G offline',
    severity: 'caution',
  },
  U026C: {
    description: 'Lost Communication With Image Processing Sensor "H"',
    short: 'Camera sensor H offline',
    severity: 'caution',
  },
  U026D: {
    description: 'Lost Communication With Image Processing Sensor "I"',
    short: 'Camera sensor I offline',
    severity: 'caution',
  },
  U026E: {
    description: 'Lost Communication With Image Processing Sensor "J"',
    short: 'Camera sensor J offline',
    severity: 'caution',
  },
  U026F: {
    description: 'Lost Communication With Image Processing Sensor "K"',
    short: 'Camera sensor K offline',
    severity: 'caution',
  },
  U0270: {
    description: 'Lost Communication With Image Processing Sensor "L"',
    short: 'Camera sensor L offline',
    severity: 'caution',
  },
  U0284: {
    description: 'Lost Communication With Active Grille Air Shutter Module "A"',
    short: 'Grille shutter module A offline',
    severity: 'caution',
  },
  U0285: {
    description: 'Lost Communication With Active Grille Air Shutter Module "B"',
    short: 'Grille shutter module B offline',
    severity: 'caution',
  },
  U0286: {
    description: 'Lost Communication With Radiator Anti Tamper Device',
    short: 'Radiator tamper sensor offline',
    severity: 'caution',
  },
  U0287: {
    description: 'Lost Communication With Transmission Fluid Pump Module',
    short: 'Trans pump module offline',
    severity: 'warning',
  },
  U0288: {
    description: 'Lost Communication With DC to AC Converter Control Module "A"',
    short: 'DC/AC converter A offline',
    severity: 'warning',
  },
  U0289: {
    description: 'Lost Communication With DC to AC Converter Control Module "B"',
    short: 'DC/AC converter B offline',
    severity: 'warning',
  },
  U0291: {
    description: 'Lost Communication With Gear Shift Control Module "B"',
    short: 'Gear shift module B offline',
    severity: 'warning',
  },
  U0292: {
    description: 'Lost Communication With Drive Motor Control Module "B"',
    short: 'Drive motor module B offline',
    severity: 'warning',
  },
  U0293: {
    description: 'Lost Communication With Hybrid/EV Powertrain Control Module',
    short: 'Hybrid powertrain module offline',
    severity: 'warning',
  },
  U0294: {
    description: 'Lost Communication With Powertrain Control Monitor Module',
    short: 'Powertrain monitor offline',
    severity: 'warning',
  },
  U0295: {
    description: 'Lost Communication With AC to AC Converter Control Module',
    short: 'AC/AC converter offline',
    severity: 'warning',
  },
  U0296: {
    description: 'Lost Communication With AC to DC Converter Control Module "A"',
    short: 'AC/DC converter A offline',
    severity: 'warning',
  },
  U0297: {
    description: 'Lost Communication With AC to DC Converter Control Module "B"',
    short: 'AC/DC converter B offline',
    severity: 'warning',
  },
  U0298: {
    description: 'Lost Communication With DC to DC Converter Control Module "A"',
    short: 'DC/DC converter A offline',
    severity: 'warning',
  },
  U0299: {
    description: 'Lost Communication With DC to DC Converter Control Module "B"',
    short: 'DC/DC converter B offline',
    severity: 'warning',
  },
  U029A: {
    description: 'Lost Communication With Hybrid/EV Battery Pack Sensor Module',
    short: 'HV battery sensor module offline',
    severity: 'warning',
  },
  U029B: {
    description: 'Lost Communication With Drive Motor Control Module "C"',
    short: 'Drive motor module C offline',
    severity: 'warning',
  },
  U029C: {
    description: 'Lost Communication With Drive Motor Control Module "D"',
    short: 'Drive motor module D offline',
    severity: 'warning',
  },
  U029D: {
    description: 'Lost Communication With NOx Sensor "A"',
    short: 'NOx sensor A offline',
    severity: 'caution',
  },
  U029E: {
    description: 'Lost Communication With NOx Sensor "B"',
    short: 'NOx sensor B offline',
    severity: 'caution',
  },
  U029F: {
    description:
      'Lost Communication With Evaporative Emission System Leak Detection Control Module',
    short: 'EVAP leak module offline',
    severity: 'caution',
  },
  U02A2: {
    description: 'Lost Communication With Reductant Quality Module',
    short: 'DEF quality module offline',
    severity: 'caution',
  },
  U02A3: {
    description: 'Lost Communication With Particulate Matter Sensor',
    short: 'Soot sensor offline',
    severity: 'caution',
  },
  U02A4: {
    description: 'Lost Communication With NH3 Sensor',
    short: 'Ammonia sensor offline',
    severity: 'caution',
  },
  U02A5: {
    description: 'Lost Communication With Reductant Heater Control Module',
    short: 'DEF heater module offline',
    severity: 'caution',
  },
  U02A6: {
    description: 'Lost Communication With Safety Integration Control Module',
    short: 'Safety module offline',
    severity: 'warning',
  },

  // U03xx — software incompatibility
  U0300: {
    description: 'Internal Control Module Software Incompatibility',
    short: 'Module software mismatch',
    severity: 'warning',
  },
  U0301: {
    description: 'Software Incompatibility With ECM/PCM',
    short: 'Engine computer: wrong software',
    severity: 'warning',
  },
  U0302: {
    description: 'Software Incompatibility With Transmission Control Module',
    short: 'Trans computer: wrong software',
    severity: 'warning',
  },
  U0303: {
    description: 'Software Incompatibility With Transfer Case Control Module',
    short: '4WD module: wrong software',
    severity: 'warning',
  },
  U0304: {
    description: 'Software Incompatibility With Gear Shift Control Module "A"',
    short: 'Shifter module A: wrong software',
    severity: 'warning',
  },
  U0305: {
    description: 'Software Incompatibility With Cruise Control Module',
    short: 'Cruise module: wrong software',
    severity: 'caution',
  },
  U0306: {
    description: 'Software Incompatibility With Fuel Injector Control Module',
    short: 'Injector module: wrong software',
    severity: 'warning',
  },
  U0307: {
    description: 'Software Incompatibility With Glow Plug Control Module 1',
    short: 'Glow plug unit 1: wrong software',
    severity: 'caution',
  },
  U0308: {
    description: 'Software Incompatibility With Throttle Actuator Control Module',
    short: 'Throttle module: wrong software',
    severity: 'warning',
  },
  U0309: {
    description: 'Software Incompatibility With Alternative Fuel Control Module',
    short: 'Alt-fuel module: wrong software',
    severity: 'warning',
  },
  U030A: {
    description:
      'Software Incompatibility With Evaporative Emission System Leak Detection Control Module',
    short: 'EVAP leak module: wrong software',
    severity: 'caution',
  },
  U030B: {
    description: 'Software Incompatibility With Glow Plug Control Module 2',
    short: 'Glow plug unit 2: wrong software',
    severity: 'caution',
  },
  U030C: {
    description: 'Software Incompatibility With Reductant Quality Module',
    short: 'DEF quality unit: wrong software',
    severity: 'caution',
  },
  U030D: {
    description: 'Software Incompatibility With NOx Sensor "A"',
    short: 'NOx sensor A: wrong software',
    severity: 'caution',
  },
  U030E: {
    description: 'Software Incompatibility With NOx Sensor "B"',
    short: 'NOx sensor B: wrong software',
    severity: 'caution',
  },
  U0310: {
    description: 'Software Incompatibility With Fuel Pump Control Module',
    short: 'Fuel pump module: wrong software',
    severity: 'warning',
  },
  U0311: {
    description: 'Software Incompatibility With Drive Motor Control Module',
    short: 'Motor module: wrong software',
    severity: 'warning',
  },
  U0312: {
    description: 'Software Incompatibility With Battery Energy Control Module "A"',
    short: 'HV battery A: wrong software',
    severity: 'warning',
  },
  U0313: {
    description: 'Software Incompatibility With Battery Energy Control Module "B"',
    short: 'HV battery B: wrong software',
    severity: 'warning',
  },
  U0314: {
    description: 'Software Incompatibility With Four-Wheel Drive Clutch Control Module',
    short: '4WD clutch unit: wrong software',
    severity: 'warning',
  },
  U0315: {
    description: 'Software Incompatibility With Anti-Lock Brake System Control Module',
    short: 'ABS module: wrong software',
    severity: 'warning',
  },
  U0316: {
    description: 'Software Incompatibility With Vehicle Dynamics Control Module',
    short: 'Stability module: wrong software',
    severity: 'warning',
  },
  U0317: {
    description: 'Software Incompatibility With Park Brake Control Module',
    short: 'Park brake unit: wrong software',
    severity: 'warning',
  },
  U0318: {
    description: 'Software Incompatibility With Brake System Control Module',
    short: 'Brake module: wrong software',
    severity: 'warning',
  },
  U0319: {
    description: 'Software Incompatibility With Steering Effort Control Module',
    short: 'Steering effort: wrong software',
    severity: 'warning',
  },
  U031A: {
    description: 'Software Incompatibility With Transmission Range Control Module',
    short: 'Gear selector: wrong software',
    severity: 'warning',
  },
  U031B: {
    description: 'Software Incompatibility With DC to DC Converter Control Module "A"',
    short: 'DC/DC unit A: wrong software',
    severity: 'warning',
  },
  U0320: {
    description: 'Software Incompatibility With Power Steering Control Module',
    short: 'Power steering: wrong software',
    severity: 'warning',
  },
  U0321: {
    description: 'Software Incompatibility With Suspension Control Module "A"',
    short: 'Suspension A: wrong software',
    severity: 'warning',
  },
  U0322: {
    description: 'Software Incompatibility With Body Control Module',
    short: 'Body module: wrong software',
    severity: 'warning',
  },
  U0323: {
    description: 'Software Incompatibility With Instrument Panel Control Module',
    short: 'Gauge cluster: wrong software',
    severity: 'warning',
  },
  U0324: {
    description: 'Software Incompatibility With HVAC Control Module',
    short: 'Climate module: wrong software',
    severity: 'info',
  },
  U0325: {
    description: 'Software Incompatibility With Auxiliary Heater Control Module',
    short: 'Aux heater: wrong software',
    severity: 'info',
  },
  U0326: {
    description: 'Software Incompatibility With Vehicle Immobilizer Control Module',
    short: 'Immobilizer: wrong software',
    severity: 'caution',
  },
  U0327: {
    description: 'Software Incompatibility With Vehicle Security Control Module',
    short: 'Security module: wrong software',
    severity: 'caution',
  },
  U0328: {
    description: 'Software Incompatibility With Steering Angle Sensor Module',
    short: 'Steering sensor: wrong software',
    severity: 'warning',
  },
  U0329: {
    description: 'Software Incompatibility With Steering Column Control Module',
    short: 'Column module: wrong software',
    severity: 'caution',
  },
  U0330: {
    description: 'Software Incompatibility With Tire Pressure Monitor Module',
    short: 'TPMS module: wrong software',
    severity: 'caution',
  },
  U0331: {
    description: 'Software Incompatibility With Body Control Module "A"',
    short: 'Body module A: wrong software',
    severity: 'warning',
  },
  U0332: {
    description: 'Software Incompatibility With Multi-axis Acceleration Sensor Module',
    short: 'Motion sensor: wrong software',
    severity: 'warning',
  },
  U0333: {
    description: 'Software Incompatibility With Gear Shift Control Module "B"',
    short: 'Shifter module B: wrong software',
    severity: 'warning',
  },
  U0334: {
    description: 'Software Incompatibility With Radio',
    short: 'Radio: wrong software',
    severity: 'info',
  },
  U0335: {
    description: 'Software Incompatibility With Hybrid/EV Battery Pack Sensor Module',
    short: 'HV pack sensor: wrong software',
    severity: 'warning',
  },
  U0336: {
    description: 'Software Incompatibility With Restraints Control Module',
    short: 'Airbag module: wrong software',
    severity: 'warning',
  },
  U0337: {
    description: 'Software Incompatibility With Battery Charger Control Module',
    short: 'Battery charger: wrong software',
    severity: 'caution',
  },
  U0338: {
    description: 'Software Incompatibility With Remote Function Actuation',
    short: 'Keyless remote: wrong software',
    severity: 'info',
  },
  U0339: {
    description: 'Software Incompatibility With Body Control Module "B"',
    short: 'Body module B: wrong software',
    severity: 'warning',
  },

  // U04xx — invalid data received
  U0400: {
    description: 'Invalid Data Received',
    short: 'Invalid data received',
    severity: 'caution',
  },
  U0401: {
    description: 'Invalid Data Received From ECM/PCM "A"',
    short: 'Engine computer: bad data',
    severity: 'warning',
  },
  U0402: {
    description: 'Invalid Data Received From TCM',
    short: 'Transmission computer: bad data',
    severity: 'warning',
  },
  U0403: {
    description: 'Invalid Data Received From Transfer Case Control Module',
    short: 'Transfer case module: bad data',
    severity: 'warning',
  },
  U0404: {
    description: 'Invalid Data Received From Gear Shift Control Module "A"',
    short: 'Gear shift module A: bad data',
    severity: 'warning',
  },
  U0405: {
    description: 'Invalid Data Received From Cruise Control Module',
    short: 'Cruise control module: bad data',
    severity: 'caution',
  },
  U0406: {
    description: 'Invalid Data Received From Fuel Injector Control Module',
    short: 'Injector module: bad data',
    severity: 'warning',
  },
  U0407: {
    description: 'Invalid Data Received From Glow Plug Control Module 1',
    short: 'Glow plug module 1: bad data',
    severity: 'caution',
  },
  U0408: {
    description: 'Invalid Data Received From Throttle Actuator "A" Control Module',
    short: 'Throttle module A: bad data',
    severity: 'warning',
  },
  U0409: {
    description: 'Invalid Data Received From Alternative Fuel Control Module',
    short: 'Alt-fuel module: bad data',
    severity: 'warning',
  },
  U040A: {
    description: 'Invalid Data Received From Air Conditioning Control Module',
    short: 'A/C module: bad data',
    severity: 'info',
  },
  U040B: {
    description: 'Invalid Data Received From Exhaust Gas Recirculation Control Module "A"',
    short: 'EGR module A: bad data',
    severity: 'caution',
  },
  U040C: {
    description: 'Invalid Data Received From Exhaust Gas Recirculation Control Module "B"',
    short: 'EGR module B: bad data',
    severity: 'caution',
  },
  U040D: {
    description: 'Invalid Data Received From Turbocharger/Supercharger Control Module "A"',
    short: 'Turbo module A: bad data',
    severity: 'warning',
  },
  U040E: {
    description: 'Invalid Data Received From Turbocharger/Supercharger Control Module "B"',
    short: 'Turbo module B: bad data',
    severity: 'warning',
  },
  U040F: {
    description: 'Invalid Data Received From Reductant Control Module',
    short: 'DEF module: bad data',
    severity: 'caution',
  },
  U0410: {
    description: 'Invalid Data Received From Fuel Pump Control Module "A"',
    short: 'Fuel pump module A: bad data',
    severity: 'warning',
  },
  U0411: {
    description: 'Invalid Data Received From Drive Motor Control Module "A"',
    short: 'Drive motor module A: bad data',
    severity: 'warning',
  },
  U0412: {
    description: 'Invalid Data Received From Battery Energy Control Module "A"',
    short: 'HV battery module A: bad data',
    severity: 'warning',
  },
  U0413: {
    description: 'Invalid Data Received From Battery Energy Control Module "B"',
    short: 'HV battery module B: bad data',
    severity: 'warning',
  },
  U0414: {
    description: 'Invalid Data Received From Four-Wheel Drive Clutch Control Module',
    short: '4WD clutch module: bad data',
    severity: 'warning',
  },
  U0415: {
    description: 'Invalid Data Received From Anti-Lock Brake System (ABS) Control Module',
    short: 'ABS module: bad data',
    severity: 'warning',
  },
  U0416: {
    description: 'Invalid Data Received From Vehicle Dynamics Control Module',
    short: 'Stability module: bad data',
    severity: 'warning',
  },
  U0417: {
    description: 'Invalid Data Received From Park Brake Control Module',
    short: 'Parking brake module: bad data',
    severity: 'warning',
  },
  U0418: {
    description: 'Invalid Data Received From Brake System Control Module',
    short: 'Brake module: bad data',
    severity: 'warning',
  },
  U0419: {
    description: 'Invalid Data Received From Steering Effort Control Module',
    short: 'Steering effort module: bad data',
    severity: 'warning',
  },
  U041B: {
    description: 'Invalid Data Received From Exhaust Gas Sensor Module "A"',
    short: 'Exhaust sensor A: bad data',
    severity: 'caution',
  },
  U041C: {
    description: 'Invalid Data Received From Rocker Arm Control Module "A"',
    short: 'Rocker arm module A: bad data',
    severity: 'warning',
  },
  U041D: {
    description: 'Invalid Data Received From Rocker Arm Control Module "B"',
    short: 'Rocker arm module B: bad data',
    severity: 'warning',
  },
  U041E: {
    description: 'Invalid Data Received From All Wheel Drive Control Module',
    short: 'AWD module: bad data',
    severity: 'warning',
  },
  U041F: {
    description: 'Invalid Data Received From Throttle Actuator "B" Control Module',
    short: 'Throttle module B: bad data',
    severity: 'warning',
  },
  U0420: {
    description: 'Invalid Data Received From Power Steering Control Module',
    short: 'Power steering module: bad data',
    severity: 'warning',
  },
  U0421: {
    description: 'Invalid Data Received From Suspension Control Module "A"',
    short: 'Suspension module A: bad data',
    severity: 'warning',
  },
  U0422: {
    description: 'Invalid Data Received From Body Control Module',
    short: 'Body control module: bad data',
    severity: 'warning',
  },
  U0423: {
    description: 'Invalid Data Received From Instrument Panel Cluster Control Module',
    short: 'Instrument cluster: bad data',
    severity: 'warning',
  },
  U0424: {
    description: 'Invalid Data Received From HVAC Control Module',
    short: 'Climate control module: bad data',
    severity: 'info',
  },
  U0425: {
    description: 'Invalid Data Received From Auxiliary Heater Control Module',
    short: 'Aux heater module: bad data',
    severity: 'info',
  },
  U0426: {
    description: 'Invalid Data Received From Vehicle Immobilizer Control Module',
    short: 'Immobilizer: bad data',
    severity: 'caution',
  },
  U0427: {
    description: 'Invalid Data Received From Vehicle Security Control Module',
    short: 'Security module: bad data',
    severity: 'caution',
  },
  U0428: {
    description: 'Invalid Data Received From Steering Angle Sensor Module',
    short: 'Steering angle sensor: bad data',
    severity: 'warning',
  },
  U0429: {
    description: 'Invalid Data Received From Steering Column Control Module',
    short: 'Steering column module: bad data',
    severity: 'caution',
  },
  U042B: {
    description: 'Invalid Data Received From Chassis Control Module "A"',
    short: 'Chassis module A: bad data',
    severity: 'warning',
  },
  U042C: {
    description: 'Invalid Data Received From Chassis Control Module "B"',
    short: 'Chassis module B: bad data',
    severity: 'warning',
  },
  U042D: {
    description: 'Invalid Data Received From Active Vibration Control Module',
    short: 'Vibration module: bad data',
    severity: 'info',
  },
  U042E: {
    description: 'Invalid Data Received From Generator Control Module',
    short: 'Alternator module: bad data',
    severity: 'warning',
  },
  U0430: {
    description: 'Invalid Data Received From Tire Pressure Monitor Module',
    short: 'Tire pressure module: bad data',
    severity: 'caution',
  },
  U0431: {
    description: 'Invalid Data Received From Body Control Module "A"',
    short: 'Body control module A: bad data',
    severity: 'warning',
  },
  U0432: {
    description: 'Invalid Data Received From Multi-axis Acceleration Sensor Module',
    short: 'Motion sensor module: bad data',
    severity: 'warning',
  },
  U0433: {
    description: 'Invalid Data Received From Front Distance Range Sensor - Single Sensor or Center',
    short: 'Front radar: bad data',
    severity: 'caution',
  },
  U0434: {
    description: 'Invalid Data Received From Active Roll Control Module',
    short: 'Roll control module: bad data',
    severity: 'warning',
  },
  U0435: {
    description: 'Invalid Data Received From Power Steering Control Module - Rear',
    short: 'Rear steering module: bad data',
    severity: 'warning',
  },
  U0436: {
    description: 'Invalid Data Received From Differential Control Module - Front',
    short: 'Front diff module: bad data',
    severity: 'warning',
  },
  U0437: {
    description: 'Invalid Data Received From Differential Control Module - Rear',
    short: 'Rear diff module: bad data',
    severity: 'warning',
  },
  U0438: {
    description: 'Invalid Data Received From Trailer Brake Control Module',
    short: 'Trailer brake module: bad data',
    severity: 'warning',
  },
  U0439: {
    description: 'Invalid Data Received From All Terrain Control Module',
    short: 'Terrain control module: bad data',
    severity: 'caution',
  },
  U043A: {
    description: 'Invalid Data Received From Suspension Control Module "B"',
    short: 'Suspension module B: bad data',
    severity: 'warning',
  },
  U043B: {
    description: 'Invalid Data Received From Front Distance Range Sensor - Left',
    short: 'Left front radar: bad data',
    severity: 'caution',
  },
  U043C: {
    description: 'Invalid Data Received From Front Distance Range Sensor - Right',
    short: 'Right front radar: bad data',
    severity: 'caution',
  },
  U043D: {
    description: 'Invalid Data Received From Accelerator Pedal Module',
    short: 'Gas pedal module: bad data',
    severity: 'warning',
  },
  U043E: {
    description: 'Invalid Data Received From Vacuum Sensor "A"',
    short: 'Vacuum sensor A: bad data',
    severity: 'caution',
  },
  U043F: {
    description: 'Invalid Data Received From Vacuum Sensor "B"',
    short: 'Vacuum sensor B: bad data',
    severity: 'caution',
  },
  U0441: {
    description: 'Invalid Data Received From Emissions Critical Control Information',
    short: 'Bad emissions control data',
    severity: 'caution',
  },
  U0442: {
    description: 'Invalid Data Received From ECM/PCM "B"',
    short: 'Engine computer B: bad data',
    severity: 'warning',
  },
  U0443: {
    description: 'Invalid Data Received From Body Control Module "B"',
    short: 'Body control module B: bad data',
    severity: 'warning',
  },
  U0444: {
    description: 'Invalid Data Received From Body Control Module "C"',
    short: 'Body control module C: bad data',
    severity: 'warning',
  },
  U0445: {
    description: 'Invalid Data Received From Body Control Module "D"',
    short: 'Body control module D: bad data',
    severity: 'warning',
  },
  U0446: {
    description: 'Invalid Data Received From Body Control Module "E"',
    short: 'Body control module E: bad data',
    severity: 'warning',
  },
  U0447: {
    description: 'Invalid Data Received From Gateway "A"',
    short: 'Network gateway A: bad data',
    severity: 'warning',
  },
  U0448: {
    description: 'Invalid Data Received From Gateway "B"',
    short: 'Network gateway B: bad data',
    severity: 'warning',
  },
  U0449: {
    description: 'Invalid Data Received From Gateway "C"',
    short: 'Network gateway C: bad data',
    severity: 'warning',
  },
  U044A: {
    description: 'Invalid Data Received From Gateway "D"',
    short: 'Network gateway D: bad data',
    severity: 'warning',
  },
  U0451: {
    description: 'Invalid Data Received From Gateway "E"',
    short: 'Network gateway E: bad data',
    severity: 'warning',
  },
  U0452: {
    description: 'Invalid Data Received From Restraints Control Module',
    short: 'Airbag module: bad data',
    severity: 'warning',
  },
  U0453: {
    description: 'Invalid Data Received From Side Restraints Control Module - Left',
    short: 'Left airbag module: bad data',
    severity: 'warning',
  },
  U0454: {
    description: 'Invalid Data Received From Side Restraints Control Module - Right',
    short: 'Right airbag module: bad data',
    severity: 'warning',
  },
  U0455: {
    description: 'Invalid Data Received From Restraints Occupant Classification System Module',
    short: 'Seat occupant sensor: bad data',
    severity: 'warning',
  },
  U0456: {
    description: 'Invalid Data Received From Coolant Temperature Control Module',
    short: 'Coolant temp module: bad data',
    severity: 'warning',
  },
  U0457: {
    description: 'Invalid Data Received From Information Center "A"',
    short: 'Info center A: bad data',
    severity: 'info',
  },
  U0458: {
    description: 'Invalid Data Received From Information Center "B"',
    short: 'Info center B: bad data',
    severity: 'info',
  },
  U0459: {
    description: 'Invalid Data Received From Head Up Display',
    short: 'Head-up display: bad data',
    severity: 'info',
  },
  U045A: {
    description: 'Invalid Data Received From Parking Assist Control Module "A"',
    short: 'Park assist A: bad data',
    severity: 'info',
  },
  U0461: {
    description: 'Invalid Data Received From Audible Alert Control Module',
    short: 'Warning chime module: bad data',
    severity: 'info',
  },
  U0462: {
    description: 'Invalid Data Received From Compass Module',
    short: 'Compass module: bad data',
    severity: 'info',
  },
  U0463: {
    description: 'Invalid Data Received From Navigation Display Module',
    short: 'Navigation display: bad data',
    severity: 'info',
  },
  U0464: {
    description: 'Invalid Data Received From Navigation Control Module',
    short: 'Navigation module: bad data',
    severity: 'info',
  },
  U0465: {
    description: 'Invalid Data Received From PTO Control Module',
    short: 'PTO module: bad data',
    severity: 'info',
  },
  U0466: {
    description: 'Invalid Data Received From HVAC Control Module - Rear',
    short: 'Rear climate module: bad data',
    severity: 'info',
  },
  U0467: {
    description: 'Invalid Data Received From Fuel Additive Control Module',
    short: 'Fuel additive module: bad data',
    severity: 'caution',
  },
  U0468: {
    description: 'Invalid Data Received From Fuel Cell Control Module',
    short: 'Fuel cell module: bad data',
    severity: 'warning',
  },
  U0469: {
    description: 'Invalid Data Received From Starter/Generator Control Module',
    short: 'Starter-gen module: bad data',
    severity: 'warning',
  },
  U046A: {
    description: 'Invalid Data Received From Sunroof Control Module',
    short: 'Sunroof module: bad data',
    severity: 'info',
  },
  U046B: {
    description: 'Invalid Data Received From Global Positioning System Module',
    short: 'GPS module: bad data',
    severity: 'info',
  },
  U046C: {
    description: 'Invalid Data Received From Electric A/C Compressor Control Module',
    short: 'A/C compressor module: bad data',
    severity: 'caution',
  },
  U046D: {
    description: 'Invalid Data Received From Fuel Pump Control Module "B"',
    short: 'Fuel pump module B: bad data',
    severity: 'warning',
  },
  U046E: {
    description: 'Invalid Data Received From Exhaust Gas Sensor Module "B"',
    short: 'Exhaust sensor B: bad data',
    severity: 'caution',
  },
  U0471: {
    description: 'Invalid Data Received From Restraints System Sensor "A"',
    short: 'Airbag sensor A: bad data',
    severity: 'warning',
  },
  U0472: {
    description: 'Invalid Data Received From Restraints System Sensor "B"',
    short: 'Airbag sensor B: bad data',
    severity: 'warning',
  },
  U0473: {
    description: 'Invalid Data Received From Restraints System Sensor "C"',
    short: 'Airbag sensor C: bad data',
    severity: 'warning',
  },
  U0474: {
    description: 'Invalid Data Received From Restraints System Sensor "D"',
    short: 'Airbag sensor D: bad data',
    severity: 'warning',
  },
  U0475: {
    description: 'Invalid Data Received From Restraints System Sensor "E"',
    short: 'Airbag sensor E: bad data',
    severity: 'warning',
  },
  U0476: {
    description: 'Invalid Data Received From Restraints System Sensor "F"',
    short: 'Airbag sensor F: bad data',
    severity: 'warning',
  },
  U0477: {
    description: 'Invalid Data Received From Restraints System Sensor "G"',
    short: 'Airbag sensor G: bad data',
    severity: 'warning',
  },
  U0478: {
    description: 'Invalid Data Received From Restraints System Sensor "H"',
    short: 'Airbag sensor H: bad data',
    severity: 'warning',
  },
  U0479: {
    description: 'Invalid Data Received From Restraints System Sensor "I"',
    short: 'Airbag sensor I: bad data',
    severity: 'warning',
  },
  U047A: {
    description: 'Invalid Data Received From Restraints System Sensor "J"',
    short: 'Airbag sensor J: bad data',
    severity: 'warning',
  },
  U047B: {
    description: 'Invalid Data Received From Restraints System Sensor "K"',
    short: 'Airbag sensor K: bad data',
    severity: 'warning',
  },
  U047C: {
    description: 'Invalid Data Received From Restraints System Sensor "L"',
    short: 'Airbag sensor L: bad data',
    severity: 'warning',
  },
  U047D: {
    description: 'Invalid Data Received From Restraints System Sensor "M"',
    short: 'Airbag sensor M: bad data',
    severity: 'warning',
  },
  U047E: {
    description: 'Invalid Data Received From Restraints System Sensor "N"',
    short: 'Airbag sensor N: bad data',
    severity: 'warning',
  },
  U047F: {
    description: 'Invalid Data Received From Seat Belt Pretensioner Module "A"',
    short: 'Seat belt module A: bad data',
    severity: 'warning',
  },
  U0480: {
    description: 'Invalid Data Received From Seat Belt Pretensioner Module "B"',
    short: 'Seat belt module B: bad data',
    severity: 'warning',
  },
  U0481: {
    description: 'Invalid Data Received From Automatic Lighting Control Module',
    short: 'Auto lighting module: bad data',
    severity: 'caution',
  },
  U0482: {
    description: 'Invalid Data Received From Headlamp Leveling Control Module',
    short: 'Headlamp leveling: bad data',
    severity: 'info',
  },
  U0483: {
    description: 'Invalid Data Received From Lighting Control Module - Front',
    short: 'Front lighting module: bad data',
    severity: 'caution',
  },
  U0484: {
    description: 'Invalid Data Received From Lighting Control Module - Rear "A"',
    short: 'Rear lighting module A: bad data',
    severity: 'caution',
  },
  U0485: {
    description: 'Invalid Data Received From Radio',
    short: 'Radio: bad data',
    severity: 'info',
  },
  U0486: {
    description: 'Invalid Data Received From Antenna Control Module',
    short: 'Antenna module: bad data',
    severity: 'info',
  },
  U0487: {
    description: 'Invalid Data Received From Audio Amplifier "A"',
    short: 'Audio amplifier A: bad data',
    severity: 'info',
  },
  U0488: {
    description: 'Invalid Data Received From Digital Disc Player/Changer Module "A"',
    short: 'Disc player A: bad data',
    severity: 'info',
  },
  U0489: {
    description: 'Invalid Data Received From Digital Disc Player/Changer Module "B"',
    short: 'Disc player B: bad data',
    severity: 'info',
  },
  U048A: {
    description: 'Invalid Data Received From Digital Disc Player/Changer Module "C"',
    short: 'Disc player C: bad data',
    severity: 'info',
  },
  U0491: {
    description: 'Invalid Data Received From Digital Disc Player/Changer Module "D"',
    short: 'Disc player D: bad data',
    severity: 'info',
  },
  U0492: {
    description: 'Invalid Data Received From Television',
    short: 'TV module: bad data',
    severity: 'info',
  },
  U0493: {
    description: 'Invalid Data Received From Personal Computer',
    short: 'On-board PC: bad data',
    severity: 'info',
  },
  U0494: {
    description: 'Invalid Data Received From Digital Audio Control Module "A"',
    short: 'Digital audio module A: bad data',
    severity: 'info',
  },
  U0495: {
    description: 'Invalid Data Received From Digital Audio Control Module "B"',
    short: 'Digital audio module B: bad data',
    severity: 'info',
  },
  U0496: {
    description: 'Invalid Data Received From Subscription Entertainment Receiver Module',
    short: 'Satellite radio: bad data',
    severity: 'info',
  },
  U0497: {
    description: 'Invalid Data Received From Entertainment Control Module - Rear "A"',
    short: 'Rear entertainment A: bad data',
    severity: 'info',
  },
  U0498: {
    description: 'Invalid Data Received From Telephone Control Module',
    short: 'Phone module: bad data',
    severity: 'info',
  },
  U0499: {
    description: 'Invalid Data Received From Telematic Control Module',
    short: 'Telematics module: bad data',
    severity: 'info',
  },
  U049A: {
    description: 'Invalid Data Received From Door Control Module "A"',
    short: 'Door module A: bad data',
    severity: 'info',
  },
  U049B: {
    description: 'Invalid Data Received From Tachograph Module',
    short: 'Tachograph: bad data',
    severity: 'info',
  },
  U049C: {
    description: 'Invalid Data Received From Battery Charger Control Module',
    short: 'Battery charger module: bad data',
    severity: 'caution',
  },
  U049D: {
    description: 'Invalid Data Received From Glow Plug Control Module 2',
    short: 'Glow plug module 2: bad data',
    severity: 'caution',
  },
  U049E: {
    description: 'Invalid Data Received From Direct Ozone Reduction Catalyst Temperature Sensor',
    short: 'Ozone catalyst sensor: bad data',
    severity: 'caution',
  },
  U049F: {
    description: 'Invalid Data Received From Transmission Range Control Module',
    short: 'Gear selector module: bad data',
    severity: 'warning',
  },
  U04A0: {
    description: 'Invalid Data Received From Engine Coolant Pump Control Module',
    short: 'Coolant pump module: bad data',
    severity: 'warning',
  },
  U04A1: {
    description: 'Invalid Data Received From Hybrid/EV Battery Interface Control Module "A"',
    short: 'HV battery interface A: bad data',
    severity: 'warning',
  },
  U04A2: {
    description: 'Invalid Data Received From Hybrid/EV Battery Interface Control Module "B"',
    short: 'HV battery interface B: bad data',
    severity: 'warning',
  },
  U04A3: {
    description: 'Invalid Data Received From Hybrid/EV Battery Interface Control Module "C"',
    short: 'HV battery interface C: bad data',
    severity: 'warning',
  },
  U04A4: {
    description: 'Invalid Data Received From Particulate Matter Sensor "A"',
    short: 'Soot sensor A: bad data',
    severity: 'caution',
  },
  U04A5: {
    description: 'Invalid Data Received From Hybrid/EV Battery Interface Control Module "E"',
    short: 'HV battery interface E: bad data',
    severity: 'warning',
  },
  U04A6: {
    description: 'Invalid Data Received From Hybrid/EV Battery Interface Control Module "F"',
    short: 'HV battery interface F: bad data',
    severity: 'warning',
  },
  U04A7: {
    description: 'Invalid Data Received From Hybrid/EV Battery Interface Control Module "G"',
    short: 'HV battery interface G: bad data',
    severity: 'warning',
  },
  U04A8: {
    description: 'Invalid Data Received From Hybrid/EV Battery Interface Control Module "H"',
    short: 'HV battery interface H: bad data',
    severity: 'warning',
  },
  U04A9: {
    description: 'Invalid Data Received From Hybrid/EV Battery Interface Control Module "I"',
    short: 'HV battery interface I: bad data',
    severity: 'warning',
  },
  U04AA: {
    description: 'Invalid Data Received From Hybrid/EV Battery Interface Control Module "J"',
    short: 'HV battery interface J: bad data',
    severity: 'warning',
  },
  U04AB: {
    description: 'Invalid Data Received From Hybrid/EV Battery Interface Control Module "K"',
    short: 'HV battery interface K: bad data',
    severity: 'warning',
  },
  U04AC: {
    description: 'Invalid Data Received From Hybrid/EV Battery Interface Control Module "L"',
    short: 'HV battery interface L: bad data',
    severity: 'warning',
  },
  U04AD: {
    description: 'Invalid Data Received From Hybrid/EV Battery Interface Control Module "M"',
    short: 'HV battery interface M: bad data',
    severity: 'warning',
  },
  U04AE: {
    description: 'Invalid Data Received From Hybrid/EV Battery Interface Control Module "N"',
    short: 'HV battery interface N: bad data',
    severity: 'warning',
  },
  U04AF: {
    description: 'Invalid Data Received From Hybrid/EV Battery Interface Control Module "O"',
    short: 'HV battery interface O: bad data',
    severity: 'warning',
  },
  U04B0: {
    description: 'Invalid Data Received From Hybrid/EV Battery Interface Control Module "P"',
    short: 'HV battery interface P: bad data',
    severity: 'warning',
  },
  U04B1: {
    description: 'Invalid Data Received From Battery Monitor Module',
    short: 'Battery monitor: bad data',
    severity: 'caution',
  },
  U04B2: {
    description: 'Invalid Data Received From Particulate Matter Sensor "B"',
    short: 'Soot sensor B: bad data',
    severity: 'caution',
  },

  // U05xx — invalid data received
  U0501: {
    description: 'Invalid Data Received From Door Control Module "B"',
    short: 'Door module B: bad data',
    severity: 'info',
  },
  U0502: {
    description: 'Invalid Data Received From Door Control Module "C"',
    short: 'Door module C: bad data',
    severity: 'info',
  },
  U0503: {
    description: 'Invalid Data Received From Door Control Module "D"',
    short: 'Door module D: bad data',
    severity: 'info',
  },
  U0504: {
    description: 'Invalid Data Received From Door Control Module "E"',
    short: 'Door module E: bad data',
    severity: 'info',
  },
  U0505: {
    description: 'Invalid Data Received From Door Control Module "F"',
    short: 'Door module F: bad data',
    severity: 'info',
  },
  U0506: {
    description: 'Invalid Data Received From Door Control Module "G"',
    short: 'Door module G: bad data',
    severity: 'info',
  },
  U0507: {
    description: 'Invalid Data Received From Folding Top Control Module',
    short: 'Convertible top module: bad data',
    severity: 'info',
  },
  U0508: {
    description: 'Invalid Data Received From Moveable Roof Control Module "A"',
    short: 'Moving roof module A: bad data',
    severity: 'info',
  },
  U0509: {
    description: 'Invalid Data Received From Seat Control Module "A"',
    short: 'Seat module A: bad data',
    severity: 'info',
  },
  U050A: {
    description: 'Invalid Data Received From Seat Control Module "B"',
    short: 'Seat module B: bad data',
    severity: 'info',
  },
  U050B: {
    description: 'Invalid Data Received From Moveable Roof Control Module "B"',
    short: 'Moving roof module B: bad data',
    severity: 'info',
  },
  U0511: {
    description: 'Invalid Data Received From Seat Control Module "C"',
    short: 'Seat module C: bad data',
    severity: 'info',
  },
  U0512: {
    description: 'Invalid Data Received From Seat Control Module "D"',
    short: 'Seat module D: bad data',
    severity: 'info',
  },
  U0513: {
    description: 'Invalid Data Received From Yaw Rate Sensor Module',
    short: 'Yaw rate sensor: bad data',
    severity: 'warning',
  },
  U0514: {
    description: 'Invalid Data Received From Mirror Control Module "A"',
    short: 'Mirror module A: bad data',
    severity: 'info',
  },
  U0515: {
    description: 'Invalid Data Received From Remote Function Actuation',
    short: 'Keyless remote module: bad data',
    severity: 'info',
  },
  U0516: {
    description: 'Invalid Data Received From Door Switch "A"',
    short: 'Door switch A: bad data',
    severity: 'info',
  },
  U0517: {
    description: 'Invalid Data Received From Door Switch "B"',
    short: 'Door switch B: bad data',
    severity: 'info',
  },
  U0518: {
    description: 'Invalid Data Received From Door Switch "C"',
    short: 'Door switch C: bad data',
    severity: 'info',
  },
  U0519: {
    description: 'Invalid Data Received From Door Switch "D"',
    short: 'Door switch D: bad data',
    severity: 'info',
  },
  U051A: {
    description: 'Invalid Data Received From Door Switch "E"',
    short: 'Door switch E: bad data',
    severity: 'info',
  },
  U0521: {
    description: 'Invalid Data Received From Door Switch "F"',
    short: 'Door switch F: bad data',
    severity: 'info',
  },
  U0522: {
    description: 'Invalid Data Received From Door Switch "G"',
    short: 'Door switch G: bad data',
    severity: 'info',
  },
  U0523: {
    description: 'Invalid Data Received From Door Window Motor "A"',
    short: 'Window motor A: bad data',
    severity: 'info',
  },
  U0524: {
    description: 'Invalid Data Received From Door Window Motor "B"',
    short: 'Window motor B: bad data',
    severity: 'info',
  },
  U0525: {
    description: 'Invalid Data Received From Door Window Motor "C"',
    short: 'Window motor C: bad data',
    severity: 'info',
  },
  U0526: {
    description: 'Invalid Data Received From Door Window Motor "D"',
    short: 'Window motor D: bad data',
    severity: 'info',
  },
  U0527: {
    description: 'Invalid Data Received From Door Window Motor "E"',
    short: 'Window motor E: bad data',
    severity: 'info',
  },
  U0528: {
    description: 'Invalid Data Received From Door Window Motor "F"',
    short: 'Window motor F: bad data',
    severity: 'info',
  },
  U0529: {
    description: 'Invalid Data Received From Door Window Motor "G"',
    short: 'Window motor G: bad data',
    severity: 'info',
  },
  U052A: {
    description: 'Invalid Data Received From Heated Steering Wheel Module',
    short: 'Heated wheel module: bad data',
    severity: 'info',
  },
  U0531: {
    description: 'Invalid Data Received From Rear Gate Module',
    short: 'Tailgate module: bad data',
    severity: 'info',
  },
  U0532: {
    description: 'Invalid Data Received From Rain Sensing Module',
    short: 'Rain sensor: bad data',
    severity: 'info',
  },
  U0533: {
    description: 'Invalid Data Received From Side Obstacle Detection Control Module Left',
    short: 'Left blind spot module: bad data',
    severity: 'caution',
  },
  U0534: {
    description: 'Invalid Data Received From Side Obstacle Detection Control Module Right',
    short: 'Right blind spot: bad data',
    severity: 'caution',
  },
  U0535: {
    description: 'Invalid Data Received From Convenience Recall Module',
    short: 'Memory settings module: bad data',
    severity: 'info',
  },
  U0536: {
    description: 'Invalid Data Received From Lateral Acceleration Sensor Module',
    short: 'Lateral accel. sensor: bad data',
    severity: 'warning',
  },
  U0537: {
    description: 'Invalid Data Received From Column Lock Module',
    short: 'Steering lock module: bad data',
    severity: 'warning',
  },
  U0538: {
    description: 'Invalid Data Received From Digital Audio Control Module "C"',
    short: 'Digital audio module C: bad data',
    severity: 'info',
  },
  U0539: {
    description: 'Invalid Data Received From Digital Audio Control Module "D"',
    short: 'Digital audio module D: bad data',
    severity: 'info',
  },
  U053A: {
    description: 'Invalid Data Received From Entrapment Control Module "A"',
    short: 'Anti-pinch module A: bad data',
    severity: 'info',
  },
  U053B: {
    description: 'Invalid Data Received From Image Processing Module "A"',
    short: 'Camera module A: bad data',
    severity: 'caution',
  },
  U053C: {
    description: 'Invalid Data Received From Image Processing Module "B"',
    short: 'Camera module B: bad data',
    severity: 'caution',
  },
  U053D: {
    description: 'Invalid Data Received From Image Processing Module "C"',
    short: 'Camera module C: bad data',
    severity: 'caution',
  },
  U0541: {
    description: 'Invalid Data Received From Entrapment Control Module "B"',
    short: 'Anti-pinch module B: bad data',
    severity: 'info',
  },
  U0542: {
    description: 'Invalid Data Received From Headlamp Control Module "A"',
    short: 'Headlamp module A: bad data',
    severity: 'caution',
  },
  U0543: {
    description: 'Invalid Data Received From Headlamp Control Module "B"',
    short: 'Headlamp module B: bad data',
    severity: 'caution',
  },
  U0544: {
    description: 'Invalid Data Received From Parking Assist Control Module "B"',
    short: 'Park assist B: bad data',
    severity: 'info',
  },
  U0545: {
    description: 'Invalid Data Received From Running Board Control Module',
    short: 'Running board module: bad data',
    severity: 'info',
  },
  U0546: {
    description: 'Invalid Data Received From Entertainment Control Module - Front',
    short: 'Front entertainment: bad data',
    severity: 'info',
  },
  U0547: {
    description: 'Invalid Data Received From Seat Control Module "E"',
    short: 'Seat module E: bad data',
    severity: 'info',
  },
  U0548: {
    description: 'Invalid Data Received From Seat Control Module "F"',
    short: 'Seat module F: bad data',
    severity: 'info',
  },
  U0549: {
    description: 'Invalid Data Received From Remote Accessory Module',
    short: 'Accessory module: bad data',
    severity: 'info',
  },
  U054A: {
    description: 'Invalid Data Received From Entertainment Control Module - Rear "B"',
    short: 'Rear entertainment B: bad data',
    severity: 'info',
  },
  U054B: {
    description: 'Invalid Data Received From Interior Lighting Control Module',
    short: 'Interior lights: bad data',
    severity: 'info',
  },
  U054C: {
    description: 'Invalid Data Received From Seat Control Module "G"',
    short: 'Seat module G: bad data',
    severity: 'info',
  },
  U054D: {
    description: 'Invalid Data Received From Seat Control Module "H"',
    short: 'Seat module H: bad data',
    severity: 'info',
  },
  U0551: {
    description: 'Invalid Data Received From Impact Classification System Module',
    short: 'Impact sensor module: bad data',
    severity: 'warning',
  },
  U0552: {
    description: 'Invalid Data Received From Running Board Control Module "B"',
    short: 'Running board module B: bad data',
    severity: 'info',
  },
  U0553: {
    description: 'Invalid Data Received From Lighting Control Module - Rear "B"',
    short: 'Rear lighting module B: bad data',
    severity: 'caution',
  },
  U0554: {
    description: 'Invalid Data Received From Accessory Protocol Interface Module',
    short: 'Accessory interface: bad data',
    severity: 'info',
  },
  U0555: {
    description: 'Invalid Data Received From Remote Start Module',
    short: 'Remote start module: bad data',
    severity: 'info',
  },
  U0556: {
    description: 'Invalid Data Received From Front Display Interface Module',
    short: 'Front display module: bad data',
    severity: 'info',
  },
  U0557: {
    description: 'Invalid Data Received From Front Controls Interface Module "A"',
    short: 'Front controls A: bad data',
    severity: 'info',
  },
  U0558: {
    description: 'Invalid Data Received From Front Controls/Display Interface Module',
    short: 'Front controls/display: bad data',
    severity: 'info',
  },
  U0559: {
    description: 'Invalid Data Received From Radio Transceiver',
    short: 'Radio transceiver: bad data',
    severity: 'info',
  },
  U055A: {
    description: 'Invalid Data Received From Special Purpose Vehicle Control Module "A"',
    short: 'Special vehicle A: bad data',
    severity: 'info',
  },
  U055B: {
    description: 'Invalid Data Received From Special Purpose Vehicle Control Module "B"',
    short: 'Special vehicle B: bad data',
    severity: 'info',
  },
  U055C: {
    description: 'Invalid Data Received From Special Purpose Vehicle Control Module "C"',
    short: 'Special vehicle C: bad data',
    severity: 'info',
  },
  U055D: {
    description: 'Invalid Data Received From Special Purpose Vehicle Control Module "D"',
    short: 'Special vehicle D: bad data',
    severity: 'info',
  },
  U055E: {
    description: 'Invalid Data Received From Front Controls Interface Module "B"',
    short: 'Front controls B: bad data',
    severity: 'info',
  },
  U0561: {
    description: 'Invalid Data Received From Seat Control Switch Module "A"',
    short: 'Seat switch module A: bad data',
    severity: 'info',
  },
  U0562: {
    description: 'Invalid Data Received From Seat Control Switch Module "B"',
    short: 'Seat switch module B: bad data',
    severity: 'info',
  },
  U0563: {
    description: 'Invalid Data Received From Audio Amplifier "B"',
    short: 'Audio amplifier B: bad data',
    severity: 'info',
  },
  U0564: {
    description: 'Invalid Data Received From Speech Recognition Module',
    short: 'Voice control module: bad data',
    severity: 'info',
  },
  U0565: {
    description: 'Invalid Data Received From Camera Module - Rear',
    short: 'Rear camera: bad data',
    severity: 'caution',
  },
  U0566: {
    description: 'Invalid Data Received From Image Processing Sensor "A"',
    short: 'Camera sensor A: bad data',
    severity: 'caution',
  },
  U0567: {
    description: 'Invalid Data Received From Image Processing Sensor "B"',
    short: 'Camera sensor B: bad data',
    severity: 'caution',
  },
  U0568: {
    description: 'Invalid Data Received From Image Processing Sensor "C"',
    short: 'Camera sensor C: bad data',
    severity: 'caution',
  },
  U0569: {
    description: 'Invalid Data Received From Image Processing Sensor "D"',
    short: 'Camera sensor D: bad data',
    severity: 'caution',
  },
  U056A: {
    description: 'Invalid Data Received From Image Processing Sensor "E"',
    short: 'Camera sensor E: bad data',
    severity: 'caution',
  },
  U056B: {
    description: 'Invalid Data Received From Image Processing Sensor "F"',
    short: 'Camera sensor F: bad data',
    severity: 'caution',
  },
  U056C: {
    description: 'Invalid Data Received From Image Processing Sensor "G"',
    short: 'Camera sensor G: bad data',
    severity: 'caution',
  },
  U056D: {
    description: 'Invalid Data Received From Image Processing Sensor "H"',
    short: 'Camera sensor H: bad data',
    severity: 'caution',
  },
  U056E: {
    description: 'Invalid Data Received From Image Processing Sensor "I"',
    short: 'Camera sensor I: bad data',
    severity: 'caution',
  },
  U056F: {
    description: 'Invalid Data Received From Image Processing Sensor "J"',
    short: 'Camera sensor J: bad data',
    severity: 'caution',
  },
  U0570: {
    description: 'Invalid Data Received From Image Processing Sensor "K"',
    short: 'Camera sensor K: bad data',
    severity: 'caution',
  },
  U0571: {
    description: 'Invalid Data Received From Image Processing Sensor "L"',
    short: 'Camera sensor L: bad data',
    severity: 'caution',
  },
  U0585: {
    description: 'Invalid Data Received From Active Grille Air Shutter Module "A"',
    short: 'Grille shutter A: bad data',
    severity: 'caution',
  },
  U0586: {
    description: 'Invalid Data Received From Active Grille Air Shutter Module "B"',
    short: 'Grille shutter B: bad data',
    severity: 'caution',
  },
  U0587: {
    description: 'Invalid Data Received From Radiator Anti Tamper Device',
    short: 'Radiator tamper sensor: bad data',
    severity: 'caution',
  },
  U0588: {
    description: 'Invalid Data Received From Transmission Fluid Pump Module',
    short: 'Trans pump module: bad data',
    severity: 'warning',
  },
  U0589: {
    description: 'Invalid Data Received From DC to AC Converter Control Module "A"',
    short: 'DC/AC converter A: bad data',
    severity: 'warning',
  },
  U058A: {
    description: 'Invalid Data Received From DC to AC Converter Control Module "B"',
    short: 'DC/AC converter B: bad data',
    severity: 'warning',
  },
  U0592: {
    description: 'Invalid Data Received From Gear Shift Control Module "B"',
    short: 'Gear shift module B: bad data',
    severity: 'warning',
  },
  U0593: {
    description: 'Invalid Data Received From Drive Motor Control Module "B"',
    short: 'Drive motor module B: bad data',
    severity: 'warning',
  },
  U0594: {
    description: 'Invalid Data Received From Hybrid/EV Powertrain Control Module',
    short: 'Hybrid control module: bad data',
    severity: 'warning',
  },
  U0595: {
    description: 'Invalid Data Received From Powertrain Control Monitor Module',
    short: 'Powertrain monitor: bad data',
    severity: 'warning',
  },
  U0596: {
    description: 'Invalid Data Received From AC to AC Converter Control Module',
    short: 'AC/AC converter: bad data',
    severity: 'warning',
  },
  U0597: {
    description: 'Invalid Data Received From AC to DC Converter Control Module "A"',
    short: 'AC/DC converter A: bad data',
    severity: 'warning',
  },
  U0598: {
    description: 'Invalid Data Received From AC to DC Converter Control Module "B"',
    short: 'AC/DC converter B: bad data',
    severity: 'warning',
  },
  U0599: {
    description: 'Invalid Data Received From DC to DC Converter Control Module "A"',
    short: 'DC/DC converter A: bad data',
    severity: 'warning',
  },
  U059A: {
    description: 'Invalid Data Received From DC to DC Converter Control Module "B"',
    short: 'DC/DC converter B: bad data',
    severity: 'warning',
  },
  U059B: {
    description: 'Invalid Data Received From Hybrid/EV Battery Pack Sensor Module',
    short: 'HV battery sensor: bad data',
    severity: 'warning',
  },
  U059C: {
    description: 'Invalid Data Received From Drive Motor Control Module "C"',
    short: 'Drive motor module C: bad data',
    severity: 'warning',
  },
  U059D: {
    description: 'Invalid Data Received From Drive Motor Control Module "D"',
    short: 'Drive motor module D: bad data',
    severity: 'warning',
  },
  U059E: {
    description: 'Invalid Data Received From NOx Sensor "A"',
    short: 'NOx sensor A: bad data',
    severity: 'caution',
  },
  U059F: {
    description: 'Invalid Data Received From NOx Sensor "B"',
    short: 'NOx sensor B: bad data',
    severity: 'caution',
  },
  U05A0: {
    description:
      'Invalid Data Received From Evaporative Emission System Leak Detection Control Module',
    short: 'EVAP leak module: bad data',
    severity: 'caution',
  },
  U05A1: {
    description: 'NOx Sensor "A" Received Invalid Data From ECM/PCM',
    short: 'NOx sensor A got bad engine data',
    severity: 'caution',
  },
  U05A2: {
    description: 'NOx Sensor "B" Received Invalid Data From ECM/PCM',
    short: 'NOx sensor B got bad engine data',
    severity: 'caution',
  },
  U05A3: {
    description: 'Invalid Data Received From Reductant Quality Module',
    short: 'DEF quality module: bad data',
    severity: 'caution',
  },
  U05A4: {
    description: 'Particulate Matter Sensor Received Invalid Data From ECM/PCM',
    short: 'Soot sensor got bad engine data',
    severity: 'caution',
  },
  U05A5: {
    description: 'Invalid Data Received From NH3 Sensor',
    short: 'Ammonia sensor: bad data',
    severity: 'caution',
  },
  U05A6: {
    description: 'Invalid Data Received From Reductant Heater Control Module',
    short: 'DEF heater module: bad data',
    severity: 'caution',
  },
  U05A7: {
    description: 'Invalid Data Received From Safety Integration Control Module',
    short: 'Safety module: bad data',
    severity: 'warning',
  },

  // U30xx — control module self-diagnostics: supply, ground, ignition inputs
  U3000: {
    description: 'Control Module',
    short: 'Control module fault',
    severity: 'warning',
  },
  U3001: {
    description: 'Control Module Improper Shutdown Performance',
    short: 'Module shut down improperly',
    severity: 'caution',
  },
  U3002: {
    description: 'Vehicle Identification Number',
    short: 'Module VIN fault',
    severity: 'caution',
  },
  U3003: {
    description: 'Battery Voltage',
    short: 'Battery voltage fault',
    severity: 'warning',
  },
  U3004: {
    description: 'Accessory Power Relay',
    short: 'Accessory power relay fault',
    severity: 'caution',
  },
  U3005: {
    description: 'Retained Accessory Power',
    short: 'Retained accessory power fault',
    severity: 'info',
  },
  U3006: {
    description: 'Control Module Input Power "A"',
    short: 'Module power input A fault',
    severity: 'warning',
  },
  U3007: {
    description: 'Control Module Input Power "B"',
    short: 'Module power input B fault',
    severity: 'warning',
  },
  U3008: {
    description: 'Control Module Ground "A"',
    short: 'Module ground A fault',
    severity: 'warning',
  },
  U3009: {
    description: 'Control Module Ground "B"',
    short: 'Module ground B fault',
    severity: 'warning',
  },
  U300A: {
    description: 'Ignition Switch',
    short: 'Ignition switch fault',
    severity: 'warning',
  },
  U300B: {
    description: 'Ignition Input Accessory/On/Start',
    short: 'Ign. acc/on/start input fault',
    severity: 'warning',
  },
  U300C: {
    description: 'Ignition Input Off/On/Start',
    short: 'Ign. off/on/start input fault',
    severity: 'warning',
  },
  U300D: {
    description: 'Ignition Input On/Start',
    short: 'Ignition on/start input fault',
    severity: 'warning',
  },
  U300E: {
    description: 'Ignition Input On',
    short: 'Ignition on input fault',
    severity: 'warning',
  },
  U300F: {
    description: 'Ignition Input Accessory',
    short: 'Ignition accessory input fault',
    severity: 'warning',
  },
  U3010: {
    description: 'Ignition Input Start',
    short: 'Ignition start input fault',
    severity: 'warning',
  },
  U3011: {
    description: 'Ignition Input Off',
    short: 'Ignition off input fault',
    severity: 'warning',
  },
  U3012: {
    description: 'Control Module Improper Wake-up Performance',
    short: 'Module woke up improperly',
    severity: 'caution',
  },
  U3013: {
    description: 'Control Module Input Power "C"',
    short: 'Module power input C fault',
    severity: 'warning',
  },
  U3014: {
    description: 'Control Module Input Power "D"',
    short: 'Module power input D fault',
    severity: 'warning',
  },
  U3015: {
    description: 'Control Module Ground "C"',
    short: 'Module ground C fault',
    severity: 'warning',
  },
  U3016: {
    description: 'Control Module Ground "D"',
    short: 'Module ground D fault',
    severity: 'warning',
  },
  U3017: {
    description: 'Control Module Timer/Clock Performance',
    short: 'Module clock fault',
    severity: 'caution',
  },
};
