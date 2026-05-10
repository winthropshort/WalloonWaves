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
// All three locations sit on the eastern shore of the main body of Walloon Lake.
// Values are estimated from lake geometry; exact shoreline ray-cast is deferred
// until a precise lake-boundary GeoJSON is available.
//
// Lake geometry:
//   • Main body axis: NNW–SSE, roughly 4.5 mi long.
//   • Width (E–W): ~1.5 mi at the widest point.
//   • West arm extends ~2.5 mi westward from the northern third of the main body.
//   • All three locations are on the eastern shore → near-zero fetch for E and ESE.
//
const FETCH_TABLES: Record<string, FetchEntry[]> = {

  // 5152 Lake Grove Road — 45.1050 N, eastern shore, south of midpoint
  'lake-grove-road': [
    { bearing:   0.0, mi: 4.0 },  // N   — up the long main body
    { bearing:  22.5, mi: 3.5 },  // NNE
    { bearing:  45.0, mi: 2.5 },  // NE
    { bearing:  67.5, mi: 1.0 },  // ENE
    { bearing:  90.0, mi: 0.1 },  // E   — right at the east shore
    { bearing: 112.5, mi: 0.1 },  // ESE
    { bearing: 135.0, mi: 0.3 },  // SE
    { bearing: 157.5, mi: 0.8 },  // SSE
    { bearing: 180.0, mi: 1.5 },  // S   — toward Boyne City end
    { bearing: 202.5, mi: 2.0 },  // SSW
    { bearing: 225.0, mi: 2.5 },  // SW
    { bearing: 247.5, mi: 1.8 },  // WSW
    { bearing: 270.0, mi: 1.5 },  // W   — across lake width
    { bearing: 292.5, mi: 2.5 },  // WNW — picks up west-arm fetch
    { bearing: 315.0, mi: 3.5 },  // NW
    { bearing: 337.5, mi: 4.5 },  // NNW — longest run, most dangerous
  ],

  // Legacy Water Sports Marina — 45.1020 N, ~350 m south of Lake Grove Rd
  'legacy-water-sports': [
    { bearing:   0.0, mi: 4.1 },
    { bearing:  22.5, mi: 3.6 },
    { bearing:  45.0, mi: 2.5 },
    { bearing:  67.5, mi: 0.8 },
    { bearing:  90.0, mi: 0.1 },
    { bearing: 112.5, mi: 0.1 },
    { bearing: 135.0, mi: 0.3 },
    { bearing: 157.5, mi: 0.7 },
    { bearing: 180.0, mi: 1.4 },
    { bearing: 202.5, mi: 1.9 },
    { bearing: 225.0, mi: 2.4 },
    { bearing: 247.5, mi: 1.7 },
    { bearing: 270.0, mi: 1.5 },
    { bearing: 292.5, mi: 2.5 },
    { bearing: 315.0, mi: 3.4 },
    { bearing: 337.5, mi: 4.4 },
  ],

  // Bear Cove Marina — 45.0990 N, ~700 m south of Lake Grove Rd
  // Closer to the south end of the lake: S/SSE fetch is shorter.
  'bear-cove-marina': [
    { bearing:   0.0, mi: 4.3 },
    { bearing:  22.5, mi: 3.8 },
    { bearing:  45.0, mi: 2.7 },
    { bearing:  67.5, mi: 0.6 },
    { bearing:  90.0, mi: 0.1 },
    { bearing: 112.5, mi: 0.1 },
    { bearing: 135.0, mi: 0.2 },
    { bearing: 157.5, mi: 0.5 },
    { bearing: 180.0, mi: 1.0 },
    { bearing: 202.5, mi: 1.5 },
    { bearing: 225.0, mi: 2.2 },
    { bearing: 247.5, mi: 1.6 },
    { bearing: 270.0, mi: 1.4 },
    { bearing: 292.5, mi: 2.4 },
    { bearing: 315.0, mi: 3.4 },
    { bearing: 337.5, mi: 4.5 },
  ],
};

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
