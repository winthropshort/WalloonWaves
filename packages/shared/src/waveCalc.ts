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
// Walloon Lake geometry (confirmed coordinates):
//   Bear Cove Marina:   45.32619 N, 85.04375 W  — NW tip of west arm
//   5152 Lake Grove Rd: 45.30325 N, 85.01259 W  — SE end of arm / NW main body
//   Walloon Village:    45.26352 N, 84.93499 W  — SE end of main body
//
//   Arm axis (Bear Cove → 5152): bearing 136° (SE), length 2.2 mi, width ~0.7 mi.
//   5152 and Walloon Village sit on the east shore of the main body;
//   fetch is short toward E and large toward the NW (arm/body).
//   Bear Cove is at the NW tip: N/NW/W/SW winds blow off the shore → near-zero.
//   Maximum fetch at Bear Cove is SE (136°, along arm axis) = 2.2 mi.
//
// Fetch geometry for Bear Cove derived from a rectangular arm model:
//   For bearing θ, along-arm = 0.695·sinθ - 0.719·cosθ
//                  cross-arm = 0.719·sinθ + 0.695·cosθ
//   fetch = arm_halfwidth / |cross-arm|  when cross-arm hits a wall first,
//         = arm_length    /  along-arm   when along-arm hits the far end first.
//   Bearings with along-arm < 0 face the NW shore → fetch ≈ 0.
//
const FETCH_TABLES: Record<string, FetchEntry[]> = {

  // 5152 Lake Grove Road — 45.30325°N, 85.01259°W
  // Located on the east shore at the junction of the west arm and main body.
  // West arm runs NW (315°) toward Bear Cove, 2.2 mi.
  // Main body runs SE/S toward Walloon Village, max ~4.2 mi.
  // East shore is immediately to the right → E/ESE fetch ≈ 0.1 mi.
  'lake-grove-road': [
    { bearing:   0.0, mi: 1.5 },  // N   — limited by N shore of main body
    { bearing:  22.5, mi: 1.2 },  // NNE
    { bearing:  45.0, mi: 0.8 },  // NE
    { bearing:  67.5, mi: 0.3 },  // ENE
    { bearing:  90.0, mi: 0.1 },  // E   — eastern shore immediately
    { bearing: 112.5, mi: 0.1 },  // ESE — eastern shore
    { bearing: 135.0, mi: 2.5 },  // SE  — down main body toward Walloon Village
    { bearing: 157.5, mi: 3.5 },  // SSE
    { bearing: 180.0, mi: 4.2 },  // S   — long main body run (max fetch)
    { bearing: 202.5, mi: 3.8 },  // SSW
    { bearing: 225.0, mi: 3.0 },  // SW
    { bearing: 247.5, mi: 2.2 },  // WSW — through arm junction
    { bearing: 270.0, mi: 1.5 },  // W   — across arm width
    { bearing: 292.5, mi: 2.0 },  // WNW — into arm toward Bear Cove
    { bearing: 315.0, mi: 2.2 },  // NW  — arm axis toward Bear Cove
    { bearing: 337.5, mi: 1.8 },  // NNW — off-axis
  ],

  // Walloon Village — 45.26352°N, 84.93499°W — SE end of main body
  // Main body runs NW (315°) ~4.7 mi toward 5152. Eastern shore close to the right.
  'legacy-water-sports': [
    { bearing:   0.0, mi: 1.0 },  // N   — across body width
    { bearing:  22.5, mi: 0.8 },  // NNE
    { bearing:  45.0, mi: 0.4 },  // NE
    { bearing:  67.5, mi: 0.1 },  // ENE — toward east shore
    { bearing:  90.0, mi: 0.1 },  // E   — eastern shore
    { bearing: 112.5, mi: 0.1 },  // ESE — eastern shore
    { bearing: 135.0, mi: 0.2 },  // SE  — near SE tip of lake
    { bearing: 157.5, mi: 0.3 },  // SSE
    { bearing: 180.0, mi: 0.5 },  // S   — near south end
    { bearing: 202.5, mi: 0.8 },  // SSW
    { bearing: 225.0, mi: 1.5 },  // SW
    { bearing: 247.5, mi: 2.5 },  // WSW
    { bearing: 270.0, mi: 3.0 },  // W   — across body + toward arm
    { bearing: 292.5, mi: 4.0 },  // WNW — long run up body
    { bearing: 315.0, mi: 4.7 },  // NW  — body axis toward 5152 (max fetch)
    { bearing: 337.5, mi: 3.5 },  // NNW — off-axis
  ],

  // Bear Cove Marina — 45.32619°N, 85.04375°W — NW tip of west arm
  //
  // Arm axis: Bear Cove (45.32619,-85.04375) → 5152 (45.30325,-85.01259)
  //   Δlat = -0.02294° → -2552 m (south);  Δlon = +0.03116° → +2497 m (east)
  //   bearing = atan2(2497, -2552) ≈ 136° (SE), length 2.2 mi, half-width 0.35 mi
  //
  // Open sector: roughly SE (≈90°–225°). All NW-facing bearings hit land immediately.
  // Fetch geometry (unit vectors: along-arm = sin136°,cos136° = 0.695,−0.719):
  //   along-arm component = 0.695·sinθ − 0.719·cosθ   (> 0 means toward 5152)
  //   cross-arm component = 0.719·sinθ + 0.695·cosθ   (> 0 means NE wall)
  //   t_end  = arm_length  / along-arm   (reaches 5152 end)
  //   t_wall = half_width  / |cross-arm| (hits NE or SW wall)
  //   fetch  = min(t_end, t_wall); 0.05 mi when along-arm ≤ 0 (faces land)
  'bear-cove-marina': [
    { bearing:   0.0, mi: 0.05 }, // N   — faces NW shore (along-arm < 0)
    { bearing:  22.5, mi: 0.05 }, // NNE — faces NW shore
    { bearing:  45.0, mi: 0.05 }, // NE  — barely outside open sector
    { bearing:  67.5, mi: 0.4  }, // ENE — open; hits NE wall ~0.4 mi
    { bearing:  90.0, mi: 0.5  }, // E   — hits NE wall ~0.5 mi
    { bearing: 112.5, mi: 0.9  }, // ESE — hits NE wall ~0.9 mi
    { bearing: 135.0, mi: 2.2  }, // SE  — along arm axis: full length (max fetch)
    { bearing: 157.5, mi: 1.0  }, // SSE — hits SW wall ~1.0 mi
    { bearing: 180.0, mi: 0.5  }, // S   — hits SW wall ~0.5 mi
    { bearing: 202.5, mi: 0.4  }, // SSW — hits SW wall ~0.4 mi
    { bearing: 225.0, mi: 0.2  }, // SW  — barely open, narrow SW corridor
    { bearing: 247.5, mi: 0.05 }, // WSW — faces NW shore
    { bearing: 270.0, mi: 0.05 }, // W   — faces NW shore (wind blows off land)
    { bearing: 292.5, mi: 0.05 }, // WNW — faces NW shore
    { bearing: 315.0, mi: 0.05 }, // NW  — faces NW shore
    { bearing: 337.5, mi: 0.05 }, // NNW — faces NW shore
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
