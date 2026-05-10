import { describe, it, expect } from 'vitest';
import { fetchForBearing, calcWaves, KNOWN_LOCATION_IDS } from './waveCalc.js';

describe('fetchForBearing', () => {
  it('returns exact table value at a known bearing', () => {
    // NNW (337.5°) for lake-grove-road = 4.5 mi
    expect(fetchForBearing('lake-grove-road', 337.5)).toBe(4.5);
    // E (90°) = 0.1 mi
    expect(fetchForBearing('lake-grove-road', 90)).toBe(0.1);
  });

  it('interpolates between bearings', () => {
    // Midpoint between N (0°, 4.0 mi) and NNE (22.5°, 3.5 mi) → 11.25° → 3.75 mi
    const result = fetchForBearing('lake-grove-road', 11.25);
    expect(result).toBeCloseTo(3.75, 5);
  });

  it('wraps correctly at 0/360 boundary', () => {
    // 360° should equal 0°
    expect(fetchForBearing('lake-grove-road', 360)).toBeCloseTo(
      fetchForBearing('lake-grove-road', 0), 5,
    );
  });

  it('throws for an unknown location', () => {
    expect(() => fetchForBearing('unknown-location', 90)).toThrow('Unknown location ID');
  });

  it('all three preset locations are defined', () => {
    expect(KNOWN_LOCATION_IDS).toContain('lake-grove-road');
    expect(KNOWN_LOCATION_IDS).toContain('legacy-water-sports');
    expect(KNOWN_LOCATION_IDS).toContain('bear-cove-marina');
  });
});

describe('calcWaves', () => {
  it('returns calm conditions for zero wind speed', () => {
    const result = calcWaves('lake-grove-road', 0, 270);
    expect(result.waveHeight_ft).toBe(0);
    expect(result.wavePeriod_s).toBe(0);
    expect(result.conditions).toBe('calm');
    expect(result.dockStatus).toBe('ok');
  });

  it('returns calm conditions for variable wind direction', () => {
    const result = calcWaves('lake-grove-road', 20, null);
    expect(result.waveHeight_ft).toBe(0);
    expect(result.conditions).toBe('calm');
  });

  it('produces higher waves for NNW (longest fetch) vs E (shortest fetch)', () => {
    const nnw = calcWaves('lake-grove-road', 20, 337.5);
    const e   = calcWaves('lake-grove-road', 20, 90);
    expect(nnw.waveHeight_ft).toBeGreaterThan(e.waveHeight_ft);
  });

  it('wave height increases monotonically with wind speed', () => {
    const low  = calcWaves('lake-grove-road', 5,  315);
    const mid  = calcWaves('lake-grove-road', 15, 315);
    const high = calcWaves('lake-grove-road', 30, 315);
    expect(mid.waveHeight_ft).toBeGreaterThan(low.waveHeight_ft);
    expect(high.waveHeight_ft).toBeGreaterThan(mid.waveHeight_ft);
  });

  it('classifies rough conditions correctly', () => {
    // 30 mph NNW should produce rough wave heights
    const result = calcWaves('lake-grove-road', 30, 337.5);
    expect(result.waveHeight_ft).toBeGreaterThan(1.5);
    expect(['rough', 'very-rough']).toContain(result.conditions);
    expect(result.dockStatus).toBe('avoid');
  });

  it('bear-cove-marina W wind is near-calm (western tip faces land)', () => {
    const bcm = calcWaves('bear-cove-marina', 20, 270);  // 20 mph due W
    const lgr = calcWaves('lake-grove-road',  20, 270);
    // Bear Cove faces land for W wind → fetch 0.05 mi (rounds to 0.1 in output)
    expect(bcm.fetchMi).toBeLessThanOrEqual(0.1);
    // 5152 Lake Grove Rd has 1.5 mi W fetch — significantly rougher
    expect(lgr.waveHeight_ft).toBeGreaterThan(bcm.waveHeight_ft * 4);
  });

  it('bear-cove-marina ESE wind uses maximum arm-length fetch', () => {
    expect(fetchForBearing('bear-cove-marina', 112.5)).toBe(5.0);
  });

  it('bear-cove-marina produces shorter S fetch than lake-grove-road', () => {
    const bcm = calcWaves('bear-cove-marina',  20, 180);
    const lgr = calcWaves('lake-grove-road',   20, 180);
    expect(bcm.fetchMi).toBeLessThan(lgr.fetchMi);
    expect(bcm.waveHeight_ft).toBeLessThan(lgr.waveHeight_ft);
  });

  it('returns correct wave height for a known input (regression)', () => {
    // 15 mph from NNW (337.5°) at lake-grove-road (fetch = 4.5 mi) → 1.07 ft
    const result = calcWaves('lake-grove-road', 15, 337.5);
    expect(result.waveHeight_ft).toBe(1.07);
    expect(result.wavePeriod_s).toBeGreaterThan(1);
    expect(result.conditions).toBe('moderate');
    expect(result.dockStatus).toBe('jetting-only');
  });
});
