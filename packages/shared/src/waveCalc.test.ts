import { describe, it, expect } from 'vitest';
import { fetchForBearing, calcWaves, KNOWN_LOCATION_IDS } from './waveCalc.js';

describe('fetchForBearing', () => {
  it('returns exact table value at a known bearing', () => {
    // NNW (337.5°) for lake-grove-road = 1.8 mi
    expect(fetchForBearing('lake-grove-road', 337.5)).toBe(1.8);
    // E (90°) = 0.1 mi
    expect(fetchForBearing('lake-grove-road', 90)).toBe(0.1);
    // S (180°) = 4.2 mi (max fetch)
    expect(fetchForBearing('lake-grove-road', 180)).toBe(4.2);
  });

  it('interpolates between bearings', () => {
    // Midpoint between N (0°, 1.5 mi) and NNE (22.5°, 1.2 mi) → 11.25° → 1.35 mi
    const result = fetchForBearing('lake-grove-road', 11.25);
    expect(result).toBeCloseTo(1.35, 5);
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

  it('produces higher waves for S (longest fetch) vs E (shortest fetch)', () => {
    const s = calcWaves('lake-grove-road', 20, 180);
    const e = calcWaves('lake-grove-road', 20, 90);
    expect(s.waveHeight_ft).toBeGreaterThan(e.waveHeight_ft);
  });

  it('wave height increases monotonically with wind speed', () => {
    const low  = calcWaves('lake-grove-road', 5,  315);
    const mid  = calcWaves('lake-grove-road', 15, 315);
    const high = calcWaves('lake-grove-road', 30, 315);
    expect(mid.waveHeight_ft).toBeGreaterThan(low.waveHeight_ft);
    expect(high.waveHeight_ft).toBeGreaterThan(mid.waveHeight_ft);
  });

  it('classifies rough conditions correctly', () => {
    // 30 mph S (max fetch 4.2 mi) should produce rough wave heights
    const result = calcWaves('lake-grove-road', 30, 180);
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

  it('bear-cove-marina SE wind uses maximum arm-length fetch', () => {
    expect(fetchForBearing('bear-cove-marina', 135.0)).toBe(2.2);
  });

  it('bear-cove-marina produces shorter S fetch than lake-grove-road', () => {
    const bcm = calcWaves('bear-cove-marina',  20, 180);
    const lgr = calcWaves('lake-grove-road',   20, 180);
    expect(bcm.fetchMi).toBeLessThan(lgr.fetchMi);
    expect(bcm.waveHeight_ft).toBeLessThan(lgr.waveHeight_ft);
  });

  it('returns correct wave height for a known input (regression)', () => {
    // 15 mph from S (180°) at lake-grove-road (fetch = 4.2 mi) → 1.03 ft
    const result = calcWaves('lake-grove-road', 15, 180);
    expect(result.waveHeight_ft).toBe(1.03);
    expect(result.wavePeriod_s).toBe(2.3);
    expect(result.conditions).toBe('moderate');
    expect(result.dockStatus).toBe('jetting-only');
  });
});
