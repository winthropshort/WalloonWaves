import { classifyConditions, classifyDockStatus } from './utils/index.js';
import type { WaveConditions } from './types/index.js';

const G         = 9.81;      // m/s²
const MPH_TO_MS = 0.44704;
const MI_TO_M   = 1609.34;
const M_TO_FT   = 3.28084;

interface FetchEntry {
  bearing: number;  // degrees clockwise from N, wind coming FROM this direction
  mi:      number;  // open-water fetch distance in miles
}

// ─── Per-location fetch tables ────────────────────────────────────────────────
//
// Walloon Lake geometry (polygon ray-cast from GPS shoreline coordinates):
//
//   West Arm: runs ~332°/152°, length ~2.9 mi (5152→Mud Lake narrows),
//             ~0.85 mi wide. East shore = Lake Grove Rd. West shore = Eagle Island
//             Rd / Fox Run / Bear Cove Ln. WA narrows (Tamarack Ln) connects south
//             to Wildwood Basin.
//
//   North Arm: runs ~N-S, ~0.6 mi wide, ~1.87 mi long. East shore = Jones Landing.
//             Narrows at ~45.28169°N connect south to West Arm / Wildwood.
//
//   5152 Lake Grove Rd (45.30325N, 85.01259W): east shore of West Arm, ~0.83 mi
//             N of WA narrows. Arm axis toward Mud Lake = 322° (peak fetch 2.91 mi);
//             32-bearing sample NWbN (326.25°) captures 2.65 mi.
//
//   Bear Cove Marina (45.32611N, 85.04358W): west shore of West Arm, ~0.7 mi S of
//             Mud Lake narrows. Arm axis toward WA narrows = 148° (peak 2.78 mi);
//             32-bearing sample SEbS (146.25°) captures 2.75 mi.
//
//   Jones Landing (45.30219N, 84.96792W): east shore of North Arm, mid-arm.
//             Maximum fetch S (180°) = 1.40 mi to the south narrows.
//
//   Walloon Village (45.26352N, 84.93499W): SE tip of The Foot. Open-water sector
//             ~255°–293°; maximum fetch WbN (281.25°) = 2.10 mi.
//
const FETCH_TABLES: Record<string, FetchEntry[]> = {

  // 5152 Lake Grove Road — 45.30325°N, 85.01259°W
  // East shore of the West Arm, ~0.83 mi N of WA narrows (Tamarack Ln).
  // Arm axis toward Mud Lake ~322° (peak fetch 2.91 mi); NWbN (326.25°) = 2.65 mi.
  // N through SEbS exits east shore immediately; shore cliff at ~331°.
  'lake-grove-road': [
    { bearing:   0.00, mi: 0.05 }, // N     — east shore immediately
    { bearing:  11.25, mi: 0.05 }, // NbE   — east shore
    { bearing:  22.50, mi: 0.05 }, // NNE   — east shore
    { bearing:  33.75, mi: 0.05 }, // NEbN  — east shore
    { bearing:  45.00, mi: 0.05 }, // NE    — east shore
    { bearing:  56.25, mi: 0.05 }, // NEbE  — east shore
    { bearing:  67.50, mi: 0.05 }, // ENE   — east shore
    { bearing:  78.75, mi: 0.05 }, // EbN   — east shore
    { bearing:  90.00, mi: 0.05 }, // E     — east shore
    { bearing: 101.25, mi: 0.05 }, // EbS   — east shore
    { bearing: 112.50, mi: 0.05 }, // ESE   — east shore
    { bearing: 123.75, mi: 0.05 }, // SEbE  — east shore
    { bearing: 135.00, mi: 0.05 }, // SE    — east shore
    { bearing: 146.25, mi: 0.05 }, // SEbS  — east shore
    { bearing: 157.50, mi: 0.40 }, // SSE   — cuts toward east shore south of 5152
    { bearing: 168.75, mi: 0.50 }, // SbE   — angled toward south shore
    { bearing: 180.00, mi: 0.75 }, // S     — down arm to WA narrows
    { bearing: 191.25, mi: 0.80 }, // SbW   — diagonal to west shore
    { bearing: 202.50, mi: 0.85 }, // SSW   — diagonal to west shore
    { bearing: 213.75, mi: 0.70 }, // SWbS  — SW diagonal
    { bearing: 225.00, mi: 0.65 }, // SW
    { bearing: 236.25, mi: 0.65 }, // SWbW
    { bearing: 247.50, mi: 0.70 }, // WSW
    { bearing: 258.75, mi: 0.90 }, // WbS   — wider diagonal cross
    { bearing: 270.00, mi: 0.85 }, // W     — arm width (~0.85 mi)
    { bearing: 281.25, mi: 0.85 }, // WbN   — arm width, slight diagonal
    { bearing: 292.50, mi: 0.90 }, // WNW
    { bearing: 303.75, mi: 1.40 }, // NWbW  — toward far NW shore
    { bearing: 315.00, mi: 2.10 }, // NW    — long diagonal up arm
    { bearing: 326.25, mi: 2.65 }, // NWbN  — near arm axis (322°); peak fetch
    { bearing: 337.50, mi: 0.05 }, // NNW   — exits east shore (shore ~331°)
    { bearing: 348.75, mi: 0.05 }, // NbW   — east shore
  ],

  // Walloon Village — 45.26352°N, 84.93499°W — SE tip of The Foot
  // The Foot: rhombus ~2.0 mi E-W × ~1.4 mi N-S. WV at extreme SE corner.
  // Open-water sector ~255°–293°; maximum fetch WbN (281.25°) = 2.10 mi.
  // All other directions blocked immediately by south/east shore.
  // NOTE: also registered as 'legacy-water-sports' for backward compat.
  'walloon-village': [
    { bearing:   0.00, mi: 0.05 }, // N     — SE tip, east shore immediately
    { bearing:  11.25, mi: 0.05 }, // NbE   — east shore
    { bearing:  22.50, mi: 0.05 }, // NNE   — east shore
    { bearing:  33.75, mi: 0.05 }, // NEbN  — east shore
    { bearing:  45.00, mi: 0.05 }, // NE    — east shore
    { bearing:  56.25, mi: 0.05 }, // NEbE  — east shore
    { bearing:  67.50, mi: 0.05 }, // ENE   — east shore
    { bearing:  78.75, mi: 0.05 }, // EbN   — east shore
    { bearing:  90.00, mi: 0.05 }, // E     — east shore
    { bearing: 101.25, mi: 0.05 }, // EbS   — east shore
    { bearing: 112.50, mi: 0.05 }, // ESE   — east shore
    { bearing: 123.75, mi: 0.05 }, // SEbE  — SE corner
    { bearing: 135.00, mi: 0.05 }, // SE    — SE corner
    { bearing: 146.25, mi: 0.05 }, // SEbS  — south shore
    { bearing: 157.50, mi: 0.05 }, // SSE   — south shore
    { bearing: 168.75, mi: 0.05 }, // SbE   — south shore
    { bearing: 180.00, mi: 0.05 }, // S     — south shore
    { bearing: 191.25, mi: 0.05 }, // SbW   — south shore
    { bearing: 202.50, mi: 0.05 }, // SSW   — south shore
    { bearing: 213.75, mi: 0.05 }, // SWbS  — south shore
    { bearing: 225.00, mi: 0.05 }, // SW    — south shore
    { bearing: 236.25, mi: 0.05 }, // SWbW  — south shore
    { bearing: 247.50, mi: 0.05 }, // WSW   — south shore (outside open sector)
    { bearing: 258.75, mi: 1.85 }, // WbS   — entering open sector
    { bearing: 270.00, mi: 1.95 }, // W     — long fetch across The Foot
    { bearing: 281.25, mi: 2.10 }, // WbN   — max fetch across The Foot
    { bearing: 292.50, mi: 2.00 }, // WNW   — long fetch
    { bearing: 303.75, mi: 0.05 }, // NWbW  — north shore (outside open sector)
    { bearing: 315.00, mi: 0.05 }, // NW    — north shore
    { bearing: 326.25, mi: 0.05 }, // NWbN  — east shore
    { bearing: 337.50, mi: 0.05 }, // NNW   — east shore
    { bearing: 348.75, mi: 0.05 }, // NbW   — east shore
  ],

  // Bear Cove Marina — 45.32611°N, 85.04358°W — west shore of West Arm
  // West shore, ~0.7 mi S of Mud Lake narrows. Arm axis toward WA narrows ~148°
  // (peak fetch 2.78 mi); SEbS (146.25°) captures 2.75 mi.
  // N through ESE cross to east shore (~0.45–0.70 mi). SbE through NWbN exit west shore.
  'bear-cove-marina': [
    { bearing:   0.00, mi: 0.65 }, // N     — to upper arm NE corner
    { bearing:  11.25, mi: 0.55 }, // NbE   — cross-arm
    { bearing:  22.50, mi: 0.50 }, // NNE   — cross-arm to east shore
    { bearing:  33.75, mi: 0.50 }, // NEbN  — cross-arm
    { bearing:  45.00, mi: 0.50 }, // NE    — cross-arm
    { bearing:  56.25, mi: 0.55 }, // NEbE  — cross-arm
    { bearing:  67.50, mi: 0.50 }, // ENE   — cross-arm (~0.85 mi wide here)
    { bearing:  78.75, mi: 0.45 }, // EbN   — cross-arm, shortest width
    { bearing:  90.00, mi: 0.50 }, // E     — cross-arm
    { bearing: 101.25, mi: 0.55 }, // EbS   — angled cross
    { bearing: 112.50, mi: 0.70 }, // ESE   — angled cross
    { bearing: 123.75, mi: 1.35 }, // SEbE  — toward far east shore, angled
    { bearing: 135.00, mi: 2.00 }, // SE    — along arm toward WA narrows
    { bearing: 146.25, mi: 2.75 }, // SEbS  — near arm axis (148°); peak fetch
    { bearing: 157.50, mi: 0.85 }, // SSE   — hits far east shore
    { bearing: 168.75, mi: 0.05 }, // SbE   — west shore immediately
    { bearing: 180.00, mi: 0.05 }, // S     — west shore
    { bearing: 191.25, mi: 0.05 }, // SbW   — west shore
    { bearing: 202.50, mi: 0.05 }, // SSW   — west shore
    { bearing: 213.75, mi: 0.05 }, // SWbS  — west shore
    { bearing: 225.00, mi: 0.05 }, // SW    — west shore
    { bearing: 236.25, mi: 0.05 }, // SWbW  — west shore
    { bearing: 247.50, mi: 0.05 }, // WSW   — west shore
    { bearing: 258.75, mi: 0.05 }, // WbS   — west shore
    { bearing: 270.00, mi: 0.05 }, // W     — west shore (wind off land)
    { bearing: 281.25, mi: 0.05 }, // WbN   — west shore
    { bearing: 292.50, mi: 0.05 }, // WNW   — west shore
    { bearing: 303.75, mi: 0.05 }, // NWbW  — west shore
    { bearing: 315.00, mi: 0.05 }, // NW    — west shore
    { bearing: 326.25, mi: 0.05 }, // NWbN  — west shore
    { bearing: 337.50, mi: 0.05 }, // NNW   — west shore
    { bearing: 348.75, mi: 0.15 }, // NbW   — slight gap toward north narrows
  ],

  // Jones Landing — 45.30219°N, 84.96792°W — east shore of North Arm
  // North Arm runs ~N-S, ~0.6 mi wide, ~1.87 mi long. JL on east shore, mid-arm.
  // Maximum fetch S (180°) = 1.40 mi to the south narrows (~45.28169°N).
  // N through SEbS and SSE exit east shore; W through NWbN cross arm to west shore.
  'jones-landing': [
    { bearing:   0.00, mi: 0.45 }, // N     — north to upper arm end
    { bearing:  11.25, mi: 0.40 }, // NbE   — east shore angles in
    { bearing:  22.50, mi: 0.05 }, // NNE   — east shore immediately
    { bearing:  33.75, mi: 0.05 }, // NEbN  — east shore
    { bearing:  45.00, mi: 0.05 }, // NE    — east shore
    { bearing:  56.25, mi: 0.05 }, // NEbE  — east shore
    { bearing:  67.50, mi: 0.05 }, // ENE   — east shore
    { bearing:  78.75, mi: 0.05 }, // EbN   — east shore
    { bearing:  90.00, mi: 0.05 }, // E     — east shore
    { bearing: 101.25, mi: 0.05 }, // EbS   — east shore
    { bearing: 112.50, mi: 0.05 }, // ESE   — east shore
    { bearing: 123.75, mi: 0.05 }, // SEbE  — east shore
    { bearing: 135.00, mi: 0.05 }, // SE    — east shore
    { bearing: 146.25, mi: 0.05 }, // SEbS  — east shore
    { bearing: 157.50, mi: 0.15 }, // SSE   — angled, clips east shore
    { bearing: 168.75, mi: 1.25 }, // SbE   — entering arm channel
    { bearing: 180.00, mi: 1.40 }, // S     — down arm to narrows (max fetch)
    { bearing: 191.25, mi: 0.70 }, // SbW   — diagonal to west shore
    { bearing: 202.50, mi: 0.65 }, // SSW   — diagonal
    { bearing: 213.75, mi: 0.60 }, // SWbS  — cross-arm diagonal
    { bearing: 225.00, mi: 0.55 }, // SW    — cross-arm
    { bearing: 236.25, mi: 0.45 }, // SWbW  — cross-arm, shorter
    { bearing: 247.50, mi: 0.40 }, // WSW   — cross-arm
    { bearing: 258.75, mi: 0.50 }, // WbS   — cross-arm
    { bearing: 270.00, mi: 0.55 }, // W     — cross-arm to west shore
    { bearing: 281.25, mi: 0.60 }, // WbN   — cross-arm
    { bearing: 292.50, mi: 0.60 }, // WNW   — cross-arm
    { bearing: 303.75, mi: 0.60 }, // NWbW  — cross-arm
    { bearing: 315.00, mi: 0.50 }, // NW    — cross-arm to west shore
    { bearing: 326.25, mi: 0.45 }, // NWbN  — west shore angles in
    { bearing: 337.50, mi: 0.45 }, // NNW   — west shore
    { bearing: 348.75, mi: 0.50 }, // NbW   — west shore, arm widens
  ],

  // Camp Michagania — ~45.3215°N, 84.9628°W — north tip of North Arm, east shore
  // Coordinates approximate; verify against actual camp property boundaries.
  // At the north tip, shore closes immediately N/E. Full arm fetch opens to the south.
  // Maximum fetch S (180°) ≈ 1.85 mi to south narrows; arm ~0.60 mi wide.
  'camp-michagania': [
    { bearing:   0.00, mi: 0.05 }, // N     — north shore
    { bearing:  11.25, mi: 0.05 }, // NbE   — east shore
    { bearing:  22.50, mi: 0.05 }, // NNE   — east shore
    { bearing:  33.75, mi: 0.05 }, // NEbN  — east shore
    { bearing:  45.00, mi: 0.05 }, // NE    — east shore
    { bearing:  56.25, mi: 0.05 }, // NEbE  — east shore
    { bearing:  67.50, mi: 0.05 }, // ENE   — east shore
    { bearing:  78.75, mi: 0.05 }, // EbN   — east shore
    { bearing:  90.00, mi: 0.05 }, // E     — east shore
    { bearing: 101.25, mi: 0.05 }, // EbS   — east shore
    { bearing: 112.50, mi: 0.05 }, // ESE   — east shore
    { bearing: 123.75, mi: 0.05 }, // SEbE  — east shore
    { bearing: 135.00, mi: 0.05 }, // SE    — east shore
    { bearing: 146.25, mi: 0.10 }, // SEbS  — entering channel
    { bearing: 157.50, mi: 0.60 }, // SSE   — channel opens
    { bearing: 168.75, mi: 1.60 }, // SbE   — down arm
    { bearing: 180.00, mi: 1.85 }, // S     — full arm (max fetch)
    { bearing: 191.25, mi: 1.20 }, // SbW   — diagonal to west shore
    { bearing: 202.50, mi: 0.90 }, // SSW   — diagonal
    { bearing: 213.75, mi: 0.75 }, // SWbS  — cross-arm diagonal
    { bearing: 225.00, mi: 0.65 }, // SW    — cross-arm
    { bearing: 236.25, mi: 0.55 }, // SWbW  — cross-arm
    { bearing: 247.50, mi: 0.50 }, // WSW   — cross-arm
    { bearing: 258.75, mi: 0.55 }, // WbS   — cross-arm
    { bearing: 270.00, mi: 0.60 }, // W     — arm width near north
    { bearing: 281.25, mi: 0.55 }, // WbN   — arm width
    { bearing: 292.50, mi: 0.45 }, // WNW   — angles to north shore
    { bearing: 303.75, mi: 0.30 }, // NWbW  — north shore approaching
    { bearing: 315.00, mi: 0.20 }, // NW    — north shore
    { bearing: 326.25, mi: 0.10 }, // NWbN  — north shore
    { bearing: 337.50, mi: 0.05 }, // NNW   — north shore
    { bearing: 348.75, mi: 0.05 }, // NbW   — north shore
  ],

  // Camp Daggett — ~45.3072°N, 84.9720°W — junction area, NW shore of main body
  // Coordinates approximate; verify against actual camp property boundaries.
  // At the junction of the North Arm and West Arm inflows; faces SW across main body.
  // S/SW fetch = 1.2–1.4 mi across The Foot; E = 0.8 mi; W = 0.4 mi (junction narrows).
  'camp-daggett': [
    { bearing:   0.00, mi: 0.05 }, // N     — north shore
    { bearing:  11.25, mi: 0.05 }, // NbE   — north shore
    { bearing:  22.50, mi: 0.05 }, // NNE   — north shore
    { bearing:  33.75, mi: 0.05 }, // NEbN  — north shore
    { bearing:  45.00, mi: 0.05 }, // NE    — north shore
    { bearing:  56.25, mi: 0.10 }, // NEbE  — short diagonal
    { bearing:  67.50, mi: 0.25 }, // ENE   — opens toward east
    { bearing:  78.75, mi: 0.50 }, // EbN   — east shore diagonal
    { bearing:  90.00, mi: 0.80 }, // E     — across to east shore
    { bearing: 101.25, mi: 0.75 }, // EbS   — east shore
    { bearing: 112.50, mi: 0.60 }, // ESE   — angled
    { bearing: 123.75, mi: 0.50 }, // SEbE  — diagonal SE
    { bearing: 135.00, mi: 0.55 }, // SE    — diagonal
    { bearing: 146.25, mi: 0.70 }, // SEbS  — opens toward south
    { bearing: 157.50, mi: 0.90 }, // SSE   — south opening
    { bearing: 168.75, mi: 1.20 }, // SbE   — main fetch opens
    { bearing: 180.00, mi: 1.40 }, // S     — max fetch across The Foot
    { bearing: 191.25, mi: 1.40 }, // SbW   — similar diagonal
    { bearing: 202.50, mi: 1.30 }, // SSW   — diagonal
    { bearing: 213.75, mi: 1.10 }, // SWbS  — shortening
    { bearing: 225.00, mi: 0.90 }, // SW    — diagonal
    { bearing: 236.25, mi: 0.65 }, // SWbW  — west shore approaching
    { bearing: 247.50, mi: 0.45 }, // WSW   — west shore
    { bearing: 258.75, mi: 0.30 }, // WbS   — junction narrows
    { bearing: 270.00, mi: 0.30 }, // W     — junction area
    { bearing: 281.25, mi: 0.15 }, // WbN   — junction closing
    { bearing: 292.50, mi: 0.05 }, // WNW   — north shore
    { bearing: 303.75, mi: 0.05 }, // NWbW  — north shore
    { bearing: 315.00, mi: 0.05 }, // NW    — north shore
    { bearing: 326.25, mi: 0.05 }, // NWbN  — north shore
    { bearing: 337.50, mi: 0.05 }, // NNW   — north shore
    { bearing: 348.75, mi: 0.05 }, // NbW   — north shore
  ],

  // Walloon Lake Country Club — ~45.2610°N, 84.9568°W — south shore of The Foot
  // Coordinates approximate; verify against actual club property boundaries.
  // On south shore west of Walloon Village. Open water faces NNW–NE (max fetch ~1.6 mi).
  // South shore blocks all southerly directions; west shore ~0.5 mi.
  'walloon-lake-cc': [
    { bearing:   0.00, mi: 1.60 }, // N     — max fetch north across The Foot
    { bearing:  11.25, mi: 1.55 }, // NbE   — slight diagonal
    { bearing:  22.50, mi: 1.45 }, // NNE   — diagonal
    { bearing:  33.75, mi: 1.25 }, // NEbN  — angling toward NE shore
    { bearing:  45.00, mi: 1.00 }, // NE    — NE shore
    { bearing:  56.25, mi: 0.80 }, // NEbE  — closing
    { bearing:  67.50, mi: 0.70 }, // ENE   — east
    { bearing:  78.75, mi: 0.75 }, // EbN   — east shore
    { bearing:  90.00, mi: 1.00 }, // E     — east shore (~1 mi)
    { bearing: 101.25, mi: 0.60 }, // EbS   — SE shore closing
    { bearing: 112.50, mi: 0.25 }, // ESE   — SE shore
    { bearing: 123.75, mi: 0.05 }, // SEbE  — south shore
    { bearing: 135.00, mi: 0.05 }, // SE    — south shore
    { bearing: 146.25, mi: 0.05 }, // SEbS  — south shore
    { bearing: 157.50, mi: 0.05 }, // SSE   — south shore
    { bearing: 168.75, mi: 0.05 }, // SbE   — south shore
    { bearing: 180.00, mi: 0.05 }, // S     — south shore
    { bearing: 191.25, mi: 0.05 }, // SbW   — south shore
    { bearing: 202.50, mi: 0.05 }, // SSW   — south shore
    { bearing: 213.75, mi: 0.05 }, // SWbS  — south shore
    { bearing: 225.00, mi: 0.05 }, // SW    — south shore
    { bearing: 236.25, mi: 0.05 }, // SWbW  — south shore
    { bearing: 247.50, mi: 0.10 }, // WSW   — west shore approaching
    { bearing: 258.75, mi: 0.30 }, // WbS   — west shore
    { bearing: 270.00, mi: 0.50 }, // W     — west shore (The Foot narrows here)
    { bearing: 281.25, mi: 0.65 }, // WbN   — NW diagonal
    { bearing: 292.50, mi: 0.80 }, // WNW   — NW fetch
    { bearing: 303.75, mi: 1.00 }, // NWbW  — NW
    { bearing: 315.00, mi: 1.20 }, // NW    — long NW fetch
    { bearing: 326.25, mi: 1.50 }, // NWbN  — opens toward north
    { bearing: 337.50, mi: 1.60 }, // NNW   — north shore
    { bearing: 348.75, mi: 1.60 }, // NbW   — north shore
  ],
};

// Backward-compat alias — old ID used in existing DynamoDB records / client code
(FETCH_TABLES as Record<string, FetchEntry[]>)['legacy-water-sports'] = FETCH_TABLES['walloon-village']!;

export const KNOWN_LOCATION_IDS = Object.keys(FETCH_TABLES);

/**
 * Returns the interpolated fetch distance (miles) for a wind direction.
 * Uses circular linear interpolation between the two nearest compass bearings.
 */
export function fetchForBearing(locationId: string, windDirDeg: number): number {
  const table = FETCH_TABLES[locationId];
  if (!table) throw new Error(`Unknown location ID: "${locationId}"`);

  const n   = table.length;
  const deg = ((windDirDeg % 360) + 360) % 360;

  let lo = n - 1;
  for (let i = 0; i < n; i++) {
    if (table[i]!.bearing <= deg) lo = i;
  }
  const hi      = (lo + 1) % n;
  const loBear  = table[lo]!.bearing;
  const hiBear  = hi === 0 ? 360 : table[hi]!.bearing;
  const t       = (deg - loBear) / (hiBear - loBear);

  return table[lo]!.mi * (1 - t) + table[hi]!.mi * t;
}

/**
 * CERC / Shore Protection Manual (1984) fetch-limited wave model.
 *
 *   H_s = 0.00162 · √(U_A² · F / g)            [metres]
 *   T_p = 0.286  · (U_A / g) · (gF / U_A²)^⅓   [seconds]
 *   U_A = 0.71 · U^1.23                          [adjusted wind speed, m/s]
 *
 * This is the fetch-limited (conservative) assumption: the storm is long
 * enough to reach wave equilibrium over the full fetch distance.
 *
 * Returns zeroed WaveConditions for calm wind (< 0.5 mph) or variable direction.
 */
export function calcWaves(
  locationId: string,
  windSpeed_mph: number,
  windDir_deg: number | null,
): WaveConditions {
  const isCalm = windDir_deg === null || windSpeed_mph < 0.5;

  if (isCalm) {
    return {
      waveHeight_ft: 0,
      wavePeriod_s:  0,
      fetchMi:       0,
      windSpeed_mph,
      windDir_deg:   windDir_deg ?? 0,
      conditions:    'calm',
      dockStatus:    'ok',
    };
  }

  const fetchMi = fetchForBearing(locationId, windDir_deg);
  const F       = fetchMi * MI_TO_M;
  const U       = windSpeed_mph * MPH_TO_MS;
  const U_A     = 0.71 * Math.pow(U, 1.23);
  const H_m     = 0.00162 * Math.sqrt(U_A * U_A * F / G);
  const H_ft    = H_m * M_TO_FT;
  const dimF    = (G * F) / (U_A * U_A);
  const T_s     = 0.286 * (U_A / G) * Math.pow(dimF, 1 / 3);

  return {
    waveHeight_ft: Math.round(H_ft * 100) / 100,
    wavePeriod_s:  Math.round(T_s  * 10)  / 10,
    fetchMi:       Math.round(fetchMi * 10) / 10,
    windSpeed_mph,
    windDir_deg,
    conditions:    classifyConditions(H_ft),
    dockStatus:    classifyDockStatus(H_ft),
  };
}
