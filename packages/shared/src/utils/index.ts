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
