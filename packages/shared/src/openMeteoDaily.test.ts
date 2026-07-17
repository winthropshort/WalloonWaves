import { describe, it, expect } from 'vitest';
import { windChillF, classifyPrecip, degToCompassOrNull, meanPressureForDate } from './openMeteoDaily.js';

describe('windChillF', () => {
  it('computes wind chill when cold and windy enough', () => {
    expect(windChillF(30, 15)).toBeCloseTo(19.0, 1);
  });

  it('returns null above 50F', () => {
    expect(windChillF(55, 15)).toBeNull();
  });

  it('returns null below 3mph', () => {
    expect(windChillF(30, 2)).toBeNull();
  });

  it('returns null for missing inputs', () => {
    expect(windChillF(null, 15)).toBeNull();
    expect(windChillF(30, null)).toBeNull();
  });
});

describe('classifyPrecip', () => {
  it('classifies rain only', () => {
    expect(classifyPrecip(0.5, 0, null)).toBe('rain');
  });

  it('classifies snow only', () => {
    expect(classifyPrecip(0, 1.0, null)).toBe('snow');
  });

  it('classifies mixed', () => {
    expect(classifyPrecip(0.3, 0.5, null)).toBe('mixed');
  });

  it('classifies possible when no measurable amount but high probability', () => {
    expect(classifyPrecip(0, 0, 60)).toBe('possible');
  });

  it('classifies none below thresholds and probability', () => {
    expect(classifyPrecip(0.01, 0.01, 20)).toBe('none');
  });
});

describe('degToCompassOrNull', () => {
  it('converts a bearing to the nearest compass point', () => {
    expect(degToCompassOrNull(0)).toBe('N');
    expect(degToCompassOrNull(315)).toBe('NW');
  });

  it('passes through null/undefined instead of throwing', () => {
    expect(degToCompassOrNull(null)).toBeNull();
    expect(degToCompassOrNull(undefined)).toBeNull();
  });
});

describe('meanPressureForDate', () => {
  it('averages hourly pressure readings matching the local date', () => {
    const hourly = {
      time: ['2026-01-01T00:00', '2026-01-01T12:00', '2026-01-02T00:00'],
      pressure_msl: [1000, 1010, 990],
    };
    expect(meanPressureForDate(hourly, '2026-01-01')).toBe(1005);
  });

  it('returns null when hourly data is absent', () => {
    expect(meanPressureForDate(null, '2026-01-01')).toBeNull();
  });
});
