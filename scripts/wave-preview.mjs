#!/usr/bin/env node
/**
 * wave-preview.mjs — Walloon Lake wave-height preview (Phase 0)
 *
 * Fetches the NWS 48-hour hourly wind forecast and runs it through the
 * CERC/SPM fetch-limited wave model. Prints a row every two hours for
 * 5152 Lake Grove Road on the eastern shore of Walloon Lake, MI.
 *
 * No dependencies — requires Node.js 18+ (native fetch).
 *
 * Usage:
 *   node scripts/wave-preview.mjs                        # mariner view (default)
 *   node scripts/wave-preview.mjs --activity=dock        # dock installer view
 *   node scripts/wave-preview.mjs --activity=dock --gust # dock view + gust speeds
 *   node scripts/wave-preview.mjs --gust                 # mariner view + gust speeds
 *
 * Activity modes (anticipates website toggle):
 *   mariner  General wave conditions for boating safety.
 *   dock     Two-phase dock installation planning: assembly windows (< 0.75 ft,
 *            pre-whitecap) and jetting windows (< 1.5 ft). Dock sections floating
 *            before the support legs are jetted into the lakebed are at risk of
 *            being knocked apart by whitecaps — this view makes that risk explicit.
 */

// ─── constants ────────────────────────────────────────────────────────────────

const G          = 9.81;     // m/s²
const MPH_TO_MS  = 0.44704;
const MI_TO_M    = 1609.34;
const M_TO_FT    = 3.28084;
const TIMEZONE   = 'America/Detroit';

// NWS points API — any coordinate on Walloon Lake resolves to the same forecast grid.
const NWS_POINT_URL = 'https://api.weather.gov/points/45.1050,-84.9435';

// ─── dock installation thresholds ────────────────────────────────────────────
//
// Assembly phase: sections are floating loose or just bolted together, before
//   the H-frame support legs are jetted into the lakebed. Whitecaps (~0.75 ft)
//   can knock sections apart. Keep this phase strictly below whitecap onset.
//
// Jetting phase: dock is fully assembled and connected. Pump operator is in
//   the water with a dry suit, working methodically. Tolerates more chop, but
//   rough waves make pump control difficult and increase fall risk.
//
const ASSEMBLY_MAX_FT = 0.75;  // Rippled/Choppy boundary — whitecap onset
const JETTING_MAX_FT  = 1.5;   // Choppy/Rough boundary

// ─── fetch table for 5152 Lake Grove Road ────────────────────────────────────
//
// "Fetch" is the length of open water upwind of this location (miles).
// 5152 Lake Grove Rd sits on the eastern shore, southern portion of the main body.
//
// Key geometry facts baked into this table:
//   • The lake's main axis runs NNW–SSE; NNW gives the full ~4.5-mile run.
//   • Easterly winds (E, ESE) have almost no fetch — the location is right at
//     the east shore, so waves arrive from the open lake to the west/north.
//   • The west arm (toward Petoskey Road) adds a little fetch for W and WNW.
//
// These values are estimated from Walloon Lake's geometry and will be replaced
// by exact shoreline-ray-intersection calculations in Phase 3.
//
const FETCH_TABLE = [
  { bearing:   0.0, label: 'N',   mi: 4.0 },  // up the long main body
  { bearing:  22.5, label: 'NNE', mi: 3.5 },
  { bearing:  45.0, label: 'NE',  mi: 2.5 },
  { bearing:  67.5, label: 'ENE', mi: 1.0 },
  { bearing:  90.0, label: 'E',   mi: 0.1 },  // right at the east shore
  { bearing: 112.5, label: 'ESE', mi: 0.1 },
  { bearing: 135.0, label: 'SE',  mi: 0.3 },
  { bearing: 157.5, label: 'SSE', mi: 0.8 },
  { bearing: 180.0, label: 'S',   mi: 1.5 },  // south toward Boyne City end
  { bearing: 202.5, label: 'SSW', mi: 2.0 },
  { bearing: 225.0, label: 'SW',  mi: 2.5 },
  { bearing: 247.5, label: 'WSW', mi: 1.8 },
  { bearing: 270.0, label: 'W',   mi: 1.5 },  // across the lake width
  { bearing: 292.5, label: 'WNW', mi: 2.5 },  // picks up west-arm fetch
  { bearing: 315.0, label: 'NW',  mi: 3.5 },
  { bearing: 337.5, label: 'NNW', mi: 4.5 },  // longest run — most dangerous
];

// NWS compass strings → degrees (wind direction the wind is coming FROM)
const DIR_TO_DEG = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

// ─── fetch interpolation ──────────────────────────────────────────────────────
//
// Linear interpolation between the two nearest compass bearings (circular).
//
function fetchForDir(windDirDeg) {
  const n = FETCH_TABLE.length;
  let lo = n - 1;
  for (let i = 0; i < n; i++) {
    if (FETCH_TABLE[i].bearing <= windDirDeg) lo = i;
  }
  const hi = (lo + 1) % n;
  const loBear = FETCH_TABLE[lo].bearing;
  const hiBear = hi === 0 ? 360 : FETCH_TABLE[hi].bearing;
  const t = (windDirDeg - loBear) / (hiBear - loBear);
  return FETCH_TABLE[lo].mi * (1 - t) + FETCH_TABLE[hi].mi * t;
}

// ─── wave model ───────────────────────────────────────────────────────────────
//
// CERC / Shore Protection Manual (1984) fetch-limited formulas:
//
//   H̃_s = 0.00162 · F̃^½        where H̃_s = g·H_s / U_A²
//   T̃_p = 0.286  · F̃^⅓                 F̃  = g·F   / U_A²
//                                         T̃_p = g·T_p / U_A
//
// U_A is the adjusted wind speed (SPM 1984 eq. 3-28a):
//   U_A = 0.71 · U^1.23   (U and U_A in m/s)
//
// Solving for dimensional form:
//   H_s = 0.00162 · √(U_A² · F / g)        [metres]
//   T_p = 0.286  · (U_A / g) · (gF/U_A²)^⅓  [seconds]
//
// This is fetch-limited (storm assumed long enough to reach fetch equilibrium),
// which is the conservative assumption appropriate for planning and safety.
//
function calcWaves(windSpeedMph, windDirDeg) {
  const fetchMi = fetchForDir(windDirDeg);
  const F       = fetchMi * MI_TO_M;         // metres
  const U       = windSpeedMph * MPH_TO_MS;  // m/s

  if (U < 0.5) {
    return { H_ft: 0.00, T_s: 0.0, fetchMi: round1(fetchMi), condLabel: 'Calm' };
  }

  const U_A  = 0.71 * Math.pow(U, 1.23);    // adjusted wind speed (m/s)
  const H_m  = 0.00162 * Math.sqrt(U_A * U_A * F / G);
  const dimF = (G * F) / (U_A * U_A);
  const T_s  = 0.286 * (U_A / G) * Math.pow(dimF, 1 / 3);

  const H_ft = H_m * M_TO_FT;

  return {
    H_ft:      Math.round(H_ft * 100) / 100,
    T_s:       round1(T_s),
    fetchMi:   round1(fetchMi),
    condLabel: waveCondLabel(H_ft),
  };
}

function waveCondLabel(H_ft) {
  if (H_ft < 0.25) return 'Calm';
  if (H_ft < 0.75) return 'Rippled';
  if (H_ft < 1.5)  return 'Choppy';
  if (H_ft < 2.5)  return 'Rough';
  return 'Dangerous';
}

// ─── dock status ──────────────────────────────────────────────────────────────
//
// Translates a wave height into a two-phase dock installation status.
// Assembly is the critical phase — loose sections are at whitecap risk.
// Jetting is more forgiving once the dock is fully assembled and floating.
//
function dockStatusLabel(H_ft) {
  if (H_ft < ASSEMBLY_MAX_FT) return '✓ Assembly OK';
  if (H_ft < JETTING_MAX_FT)  return '~ Jetting only';
  return                              '✗ Avoid';
}

function dockStatusColor(H_ft) {
  if (H_ft < ASSEMBLY_MAX_FT) return C.green;
  if (H_ft < JETTING_MAX_FT)  return C.yellow;
  return                              C.red;
}

// ─── window finder ────────────────────────────────────────────────────────────
//
// Identifies contiguous blocks of time in the forecast where a given
// threshold is met. Returns an array of { start, end } time strings.
//
function findWindows(rows, maxFt) {
  const windows = [];
  let winStart = null;
  for (const row of rows) {
    const ok = !row.isVariable && row.H_ft <= maxFt;
    if (ok && winStart === null) {
      winStart = row.timeShort;
    } else if (!ok && winStart !== null) {
      windows.push(`${winStart} – ${row.timeShort}`);
      winStart = null;
    }
  }
  if (winStart !== null) windows.push(`${winStart} – end of forecast`);
  return windows;
}

// ─── terminal colors ──────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  orange: '\x1b[38;5;208m',
  red:    '\x1b[31m',
  purple: '\x1b[35m',
  cyan:   '\x1b[36m',
};

const WAVE_COLOR = {
  Calm:      C.green,
  Rippled:   C.yellow,
  Choppy:    C.orange,
  Rough:     C.red,
  Dangerous: C.purple,
};

// ─── NWS helpers ─────────────────────────────────────────────────────────────

async function nwsGet(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'WalloonWavesPreview/0.1 (wshort@gmail.com)' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`NWS HTTP ${res.status} — ${url}\n${body.slice(0, 300)}`);
  }
  return res.json();
}

// NWS windSpeed is "12 mph" or occasionally "10 to 15 mph" (take the upper bound).
function parseSpeed(s) {
  if (!s || /calm/i.test(s)) return 0;
  const nums = s.match(/\d+/g);
  if (!nums) return 0;
  return parseInt(nums[nums.length - 1], 10);  // last number = upper bound
}

// NWS windDirection is a compass string like "NW" or "VRB" (variable).
function parseDir(s) {
  if (!s || s === 'VRB') return null;
  return DIR_TO_DEG[s.trim().toUpperCase()] ?? null;
}

function fmtTimeLong(isoStr) {
  return new Date(isoStr).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: TIMEZONE,
  });
}

function fmtTimeShort(isoStr) {
  return new Date(isoStr).toLocaleString('en-US', {
    weekday: 'short', hour: 'numeric', hour12: true,
    timeZone: TIMEZONE,
  });
}

function round1(n) { return Math.round(n * 10) / 10; }

// ─── argument parsing ─────────────────────────────────────────────────────────

const useGust = process.argv.includes('--gust');
const actArg  = process.argv.find(a => a.startsWith('--activity='));
const activity = actArg ? actArg.split('=')[1] : 'mariner';

if (activity !== 'mariner' && activity !== 'dock') {
  console.error(`\n  Unknown activity "${activity}". Use --activity=mariner or --activity=dock.\n`);
  process.exit(1);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const now = new Date().toLocaleString('en-US', {
    timeZone: TIMEZONE, dateStyle: 'full', timeStyle: 'short',
  });

  const activityLabel = activity === 'dock' ? 'Dock Installer View' : 'Mariner View';

  console.log();
  console.log(`${C.bold}  Walloon Lake — Wave Height Preview  ${C.dim}[${activityLabel}]${C.reset}`);
  console.log(`${C.bold}  5152 Lake Grove Road${C.reset}${C.dim}  (eastern shore, main body)${C.reset}`);
  console.log(`${C.dim}  ${now}${C.reset}`);
  if (useGust) console.log(`${C.dim}  Speed mode: gust (conservative upper-bound)${C.reset}`);
  console.log();

  // ── Step 1: resolve NWS grid ────────────────────────────────────────────────
  process.stdout.write(`${C.dim}  Resolving NWS grid point...${C.reset}`);
  const pointData = await nwsGet(NWS_POINT_URL);
  const { gridId, gridX, gridY, forecastHourly } = pointData.properties;
  console.log(`  ${C.cyan}${gridId} (${gridX},${gridY})${C.reset}`);

  // ── Step 2: fetch hourly forecast ───────────────────────────────────────────
  process.stdout.write(`${C.dim}  Fetching 48-hour hourly forecast...${C.reset}`);
  const hourlyData = await nwsGet(forecastHourly);
  const allPeriods = hourlyData.properties.periods;
  console.log(`  ${C.cyan}${allPeriods.length} hours received${C.reset}`);
  console.log();

  // ── Step 3: compute rows ────────────────────────────────────────────────────
  // Every other hour for 48 hours → up to 24 rows
  const rows = allPeriods.slice(0, 48)
    .filter((_, i) => i % 2 === 0)
    .map(p => {
      const baseSpeed = parseSpeed(p.windSpeed);
      const gustSpeed = parseSpeed(p.windGust);
      const mph       = useGust && gustSpeed > 0 ? gustSpeed : baseSpeed;
      const dirStr    = p.windDirection ?? '';
      const dirDeg    = parseDir(dirStr);
      const isVariable = dirDeg === null;

      let windStr = `${mph} mph`;
      if (!useGust && gustSpeed > baseSpeed) windStr += `g${gustSpeed}`;

      if (isVariable) {
        return { isVariable: true, timeLong: fmtTimeLong(p.startTime),
                 timeShort: fmtTimeShort(p.startTime), windStr, dirStr,
                 H_ft: null, T_s: null, fetchMi: null, condLabel: null };
      }

      const waves = calcWaves(mph, dirDeg);
      return {
        isVariable: false,
        timeLong:   fmtTimeLong(p.startTime),
        timeShort:  fmtTimeShort(p.startTime),
        windStr,
        dirStr,
        ...waves,
      };
    });

  // ── Step 4: dock window summary (dock mode only) ────────────────────────────
  if (activity === 'dock') {
    const assemblyWindows = findWindows(rows, ASSEMBLY_MAX_FT);
    const jettingWindows  = findWindows(rows, JETTING_MAX_FT);

    console.log(`  ${C.bold}Dock Installation Windows — next 48 hours${C.reset}`);
    console.log(`  ${'─'.repeat(56)}`);

    if (assemblyWindows.length === 0) {
      console.log(`  ${C.red}${C.bold}Assembly OK${C.reset}  ${C.dim}(< ${ASSEMBLY_MAX_FT} ft, pre-whitecap)${C.reset}  ${C.red}No safe windows in forecast${C.reset}`);
    } else {
      assemblyWindows.forEach((w, i) => {
        const prefix = i === 0
          ? `  ${C.green}${C.bold}Assembly OK${C.reset}  ${C.dim}(< ${ASSEMBLY_MAX_FT} ft, pre-whitecap)${C.reset}  `
          : `  ${' '.repeat(13)}`;
        console.log(`${prefix}${C.green}${w}${C.reset}`);
      });
    }

    if (jettingWindows.length === 0) {
      console.log(`  ${C.yellow}${C.bold}Jetting OK${C.reset}   ${C.dim}(< ${JETTING_MAX_FT} ft, assembled dock)${C.reset}  ${C.red}No safe windows in forecast${C.reset}`);
    } else {
      jettingWindows.forEach((w, i) => {
        const prefix = i === 0
          ? `  ${C.yellow}${C.bold}Jetting OK${C.reset}   ${C.dim}(< ${JETTING_MAX_FT} ft, assembled dock)${C.reset}  `
          : `  ${' '.repeat(13)}`;
        console.log(`${prefix}${C.yellow}${w}${C.reset}`);
      });
    }

    console.log(`  ${'─'.repeat(56)}`);
    console.log(`  ${C.dim}Whitecap onset at ~${ASSEMBLY_MAX_FT} ft — do not begin new sections above this threshold${C.reset}`);
    console.log();
  }

  // ── Step 5: table ───────────────────────────────────────────────────────────
  const W = { time: 26, wind: 11, dir: 5, fetch: 8, ht: 9, per: 8 };
  const lastColHeader = activity === 'dock' ? 'Dock Status' : 'Conditions';
  const headerCols = [
    'Time'.padEnd(W.time),
    'Wind'.padEnd(W.wind),
    'Dir'.padEnd(W.dir),
    'Fetch'.padEnd(W.fetch),
    'Wave Ht'.padEnd(W.ht),
    'Period'.padEnd(W.per),
    lastColHeader,
  ];
  const divider = '─'.repeat(headerCols.join('').length);

  console.log(`  ${C.bold}${headerCols.join('')}${C.reset}`);
  console.log(`  ${C.dim}${divider}${C.reset}`);

  for (const row of rows) {
    if (row.isVariable) {
      const timeCol = row.timeLong.padEnd(W.time);
      console.log(`  ${timeCol}${C.dim}${row.windStr.padEnd(W.wind)}${row.dirStr.padEnd(W.dir)}— variable wind${C.reset}`);
      continue;
    }

    let lastCol;
    if (activity === 'dock') {
      const color = dockStatusColor(row.H_ft);
      lastCol = `${color}${C.bold}${dockStatusLabel(row.H_ft)}${C.reset}`;
    } else {
      const color = WAVE_COLOR[row.condLabel] ?? C.reset;
      lastCol = `${color}${C.bold}${row.condLabel}${C.reset}`;
    }

    const tableRow = [
      row.timeLong.padEnd(W.time),
      row.windStr.padEnd(W.wind),
      row.dirStr.padEnd(W.dir),
      `${row.fetchMi} mi`.padEnd(W.fetch),
      `${row.H_ft.toFixed(2)} ft`.padEnd(W.ht),
      `${row.T_s} s`.padEnd(W.per),
      lastCol,
    ].join('');

    console.log(`  ${tableRow}`);
  }

  console.log(`  ${C.dim}${divider}${C.reset}`);

  // ── Step 6: legend ──────────────────────────────────────────────────────────
  console.log();

  if (activity === 'dock') {
    console.log(`  ${C.bold}Dock Installation Status${C.reset}`);
    console.log(`    ${C.green}${C.bold}✓ Assembly OK${C.reset}   < ${ASSEMBLY_MAX_FT} ft   Sections can be placed, connected, and H-frames installed`);
    console.log(`    ${C.yellow}${C.bold}~ Jetting only${C.reset}  ${ASSEMBLY_MAX_FT}–${JETTING_MAX_FT} ft  Dock assembled — safe to jet legs; no new sections`);
    console.log(`    ${C.red}${C.bold}✗ Avoid${C.reset}         > ${JETTING_MAX_FT} ft   Whitecap risk — sections may be knocked apart before jetting`);
  } else {
    console.log(`  ${C.bold}Conditions${C.reset}`);
    console.log(`    ${C.green}${C.bold}Calm${C.reset}         < 0.25 ft   Glassy or light ripple`);
    console.log(`    ${C.yellow}${C.bold}Rippled${C.reset}      0.25–0.75 ft  Gentle chop, comfortable for all boats`);
    console.log(`    ${C.orange}${C.bold}Choppy${C.reset}       0.75–1.5 ft   Noticeable chop, okay with care`);
    console.log(`    ${C.red}${C.bold}Rough${C.reset}        1.5–2.5 ft    Short steep waves, small craft caution`);
    console.log(`    ${C.purple}${C.bold}Dangerous${C.reset}    > 2.5 ft      Unsafe for small craft`);
  }

  console.log();
  console.log(`  ${C.dim}Wave model:  CERC/SPM fetch-limited — H_s = 0.00162√(U_A²·F/g)${C.reset}`);
  console.log(`  ${C.dim}             T_p = 0.286·(U_A/g)·(gF/U_A²)^⅓   where U_A = 0.71·U^1.23${C.reset}`);
  console.log(`  ${C.dim}Fetch table: estimated from lake geometry — exact ray-cast in Phase 3${C.reset}`);
  console.log(`  ${C.dim}Wind source: NWS hourly forecast, ${gridId} office${C.reset}`);
  console.log(`  ${C.dim}Tip: add --gust for worst-case wave heights · --activity=dock for dock view${C.reset}`);
  console.log();
}

main().catch(err => {
  console.error(`\n  ${C.bold}${C.red}Error:${C.reset} ${err.message}\n`);
  process.exit(1);
});
