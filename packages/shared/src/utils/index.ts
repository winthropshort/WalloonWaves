/** Classify wave height into a condition label. */
export function classifyConditions(
  waveHeight_ft: number,
): 'calm' | 'slight' | 'moderate' | 'rough' | 'very-rough' {
  if (waveHeight_ft < 0.5) return 'calm';
  if (waveHeight_ft < 1.0) return 'slight';
  if (waveHeight_ft < 2.0) return 'moderate';
  if (waveHeight_ft < 3.0) return 'rough';
  return 'very-rough';
}

/** Dock installer status based on wave height thresholds. */
export function classifyDockStatus(
  waveHeight_ft: number,
): 'ok' | 'jetting-only' | 'avoid' {
  if (waveHeight_ft < 0.75) return 'ok';
  if (waveHeight_ft < 1.5) return 'jetting-only';
  return 'avoid';
}

/** Return Beaufort force number (0–12) from wind speed in mph. */
export function beaufortForce(windSpeed_mph: number): number {
  if (windSpeed_mph <  1) return 0;
  if (windSpeed_mph <  4) return 1;
  if (windSpeed_mph <  8) return 2;
  if (windSpeed_mph < 13) return 3;
  if (windSpeed_mph < 19) return 4;
  if (windSpeed_mph < 25) return 5;
  if (windSpeed_mph < 32) return 6;
  if (windSpeed_mph < 39) return 7;
  if (windSpeed_mph < 47) return 8;
  if (windSpeed_mph < 55) return 9;
  if (windSpeed_mph < 64) return 10;
  if (windSpeed_mph < 73) return 11;
  return 12;
}

const BEAUFORT_DESCRIPTIONS = [
  'Calm', 'Light Air', 'Light Breeze', 'Gentle Breeze',
  'Moderate Breeze', 'Fresh Breeze', 'Strong Breeze', 'Near Gale',
  'Gale', 'Strong Gale', 'Storm', 'Violent Storm', 'Hurricane',
] as const;

/** Return Beaufort wind description from wind speed in mph. */
export function beaufortDescription(windSpeed_mph: number): string {
  return BEAUFORT_DESCRIPTIONS[beaufortForce(windSpeed_mph)] ?? 'Hurricane';
}

/** Convert mph to knots. */
export function mphToKnots(mph: number): number {
  return mph * 0.868976;
}

/** Convert degrees to a 16-point compass label. */
export function degreesToCompass(deg: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return dirs[idx] ?? 'N';
}
