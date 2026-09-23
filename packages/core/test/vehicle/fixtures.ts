import type { VehicleConfig } from '../../src/types/config.ts';

/** A self-contained vehicle config for tests (independent of the default config). */
export function testVehicle(overrides: Partial<VehicleConfig> = {}): VehicleConfig {
  return {
    name: 'Test car',
    fuelType: 'gasoline',
    tankCapacityL: 50,
    displacementL: 2.0,
    volumetricEfficiency: 0.85,
    transmission: 'manual',
    redlineRpm: 6500,
    idleRpm: 800,
    gearRatiosRpmPerKph: null,
    fuelPricePerL: 1.8,
    hasTpms: false,
    ...overrides,
  };
}
