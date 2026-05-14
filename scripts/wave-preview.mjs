#!/usr/bin/env node
/**
 * wave-preview.mjs — Walloon Lake wave-height preview
 *
 * Fetches the NWS hourly wind forecast and runs it through the CERC/SPM
 * fetch-limited wave model, using the same 32-direction fetch table as
 * the web app (packages/shared/src/waveCalc.ts, lake-grove-road location).
 *
 * Prints a row every two hours for 48 hours.  Time is displayed in
 * 24-hour (military) format, directions in 16-point compass labels.
 *
 * No dependencies — requires Node.js 18+ (native fetch).
 *
 * Usage:
 *   node scripts/wave-preview.mjs                        # mariner view (default)
 *   node scripts/wave-preview.mjs --activity=dock        # dock installer view
 *   node scripts/wave-preview.mjs --activity=dock --gust # dock view + gust speeds
 *   node scripts/wave-preview.mjs --gust                 # mariner view + gust speeds
 */

// ─── constants ────────────────────────────────────────────────────────────────

const G          = 9.81;
const MPH_TO_MS  = 0.44704;
const MI_TO_M    = 1609.34;
const M_TO_FT    = 3.28084;
const TIMEZONE   = 'America/Detroit';

const NWS_POINT_URL = 'https://api.weather.gov/points/45.1050,-84.9435';

// ─── dock installation thresholds ────────────────────────────────────────────

const ASSEMBLY_MAX_FT = 0.75;
const JETTING_MAX_FT  = 1.5;

// ─── 32-direction fetch table for 5152 Lake Grove Road ───────────────────────
//
// Matches packages/shared/src/waveCalc.ts (lake-grove-road).
// 5152 Lake Grove Rd sits on the east shore of the West Arm,
// ~0.83 mi N of Tamarack Ln narrows.  Arm axis toward Mud Lake ≈ 322°.
//
const FETCH_TABLE = [
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
];

// 16-point compass: NWS wind direction strings → degrees
const DIR_TO_DEG = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

// ─── fetch interpolation ──────────────────────────────────────────────────────

function fetchForDir(windDirDeg) {
  const n   = FETCH_TABLE.length;
  const deg = ((windDirDeg % 360) + 360) % 360;
  let lo    = n - 1;
  for (let i = 0; i < n; i++) {
    if (FETCH_TABLE[i].bearing <= deg) lo = i;
  }
  const hi     = (lo + 1) % n;
  const loBear = FETCH_TABLE[lo].bearing;
  const hiBear = hi === 0 ? 360 : FETCH_TABLE[hi].bearing;
  const t      = (deg - loBear) / (hiBear - loBear);
  return FETCH_TABLE[lo].mi * (1 - t) + FETCH_TABLE[hi].mi * t;
}

// ─── wave model (CERC/SPM 1984) ──────────────────────────────────────────────
//
//   H_s = 0.00162 · √(U_A² · F / g)            [metres]
//   T_p = 0.286  · (U_A / g) · (gF / U_A²)^⅓   [seconds]
//   U_A = 0.71 · U^1.23                          (m/s)
//
function calcWaves(windSpeedMph, windDirDeg) {
  const fetchMi = fetchForDir(windDirDeg);
  const F       = fetchMi * MI_TO_M;
  const U       = windSpeedMph * MPH_TO_MS;

  if (U < 0.5) {
    return { H_ft: 0.00, T_s: 0.0, fetchMi: round1(fetchMi), condLabel: 'Calm' };
  }

  const U_A  = 0.71 * Math.pow(U, 1.23);
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

// Matches classifyConditions() in packages/shared/src/utils/index.ts
function waveCondLabel(H_ft) {
  if (H_ft < 0.5) return 'Calm';
  if (H_ft < 1.0) return 'Slight';
  if (H_ft < 2.0) return 'Moderate';
  if (H_ft < 3.0) return 'Rough';
  return 'Very Rough';
}

// Matches classifyDockStatus() in packages/shared/src/utils/index.ts
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

function findWindows(rows, maxFt) {
  const windows = [];
  let winStart  = null;
  for (const row of rows) {
    const ok = !row.isVariable && row.H_ft !== null && row.H_ft <= maxFt;
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
  Calm:       C.green,
  Slight:     C.yellow,
  Moderate:   C.orange,
  Rough:      C.red,
  'Very Rough': C.purple,
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

function parseSpeed(s) {
  if (!s || /calm/i.test(s)) return 0;
  const nums = s.match(/\d+/g);
  if (!nums) return 0;
  return parseInt(nums[nums.length - 1], 10);
}

function parseDir(s) {
  if (!s || s === 'VRB') return null;
  return DIR_TO_DEG[s.trim().toUpperCase()] ?? null;
}

// Military time (24h) — no AM/PM
function fmtTimeLong(isoStr) {
  return new Date(isoStr).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: TIMEZONE,
  });
}

function fmtTimeShort(isoStr) {
  return new Date(isoStr).toLocaleString('en-US', {
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
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
  console.log(`${C.bold}  5152 Lake Grove Road${C.reset}${C.dim}  (eastern shore, West Arm)${C.reset}`);
  console.log(`${C.dim}  ${now}${C.reset}`);
  if (useGust) console.log(`${C.dim}  Speed mode: gust (conservative upper-bound)${C.reset}`);
  console.log();

  process.stdout.write(`${C.dim}  Resolving NWS grid point...${C.reset}`);
  const pointData = await nwsGet(NWS_POINT_URL);
  const { gridId, gridX, gridY, forecastHourly } = pointData.properties;
  console.log(`  ${C.cyan}${gridId} (${gridX},${gridY})${C.reset}`);

  process.stdout.write(`${C.dim}  Fetching 48-hour hourly forecast...${C.reset}`);
  const hourlyData = await nwsGet(forecastHourly);
  const allPeriods = hourlyData.properties.periods;
  console.log(`  ${C.cyan}${allPeriods.length} hours received${C.reset}`);
  console.log();

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

      let windStr = `${mph}mph`;
      if (!useGust && gustSpeed > baseSpeed) windStr += `g${gustSpeed}`;

      if (isVariable) {
        return {
          isVariable: true,
          timeLong:  fmtTimeLong(p.startTime),
          timeShort: fmtTimeShort(p.startTime),
          windStr, dirStr,
          H_ft: null, T_s: null, fetchMi: null, condLabel: null,
        };
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

  // ── Dock window summary ─────────────────────────────────────────────────────
  if (activity === 'dock') {
    const assemblyWindows = findWindows(rows, ASSEMBLY_MAX_FT);
    const jettingWindows  = findWindows(rows, JETTING_MAX_FT);

    console.log(`  ${C.bold}Dock Installation Windows — next 48 hours${C.reset}`);
    console.log(`  ${'─'.repeat(56)}`);

    if (assemblyWindows.length === 0) {
      console.log(`  ${C.red}${C.bold}Assembly OK${C.reset}  ${C.dim}(< ${ASSEMBLY_MAX_FT} ft)${C.reset}  ${C.red}No safe windows in forecast${C.reset}`);
    } else {
      assemblyWindows.forEach((w, i) => {
        const prefix = i === 0
          ? `  ${C.green}${C.bold}Assembly OK${C.reset}  ${C.dim}(< ${ASSEMBLY_MAX_FT} ft, pre-whitecap)${C.reset}  `
          : `  ${' '.repeat(13)}`;
        console.log(`${prefix}${C.green}${w}${C.reset}`);
      });
    }

    if (jettingWindows.length === 0) {
      console.log(`  ${C.yellow}${C.bold}Jetting OK${C.reset}   ${C.dim}(< ${JETTING_MAX_FT} ft)${C.reset}  ${C.red}No safe windows in forecast${C.reset}`);
    } else {
      jettingWindows.forEach((w, i) => {
        const prefix = i === 0
          ? `  ${C.yellow}${C.bold}Jetting OK${C.reset}   ${C.dim}(< ${JETTING_MAX_FT} ft, assembled dock)${C.reset}  `
          : `  ${' '.repeat(13)}`;
        console.log(`${prefix}${C.yellow}${w}${C.reset}`);
      });
    }

    console.log(`  ${'─'.repeat(56)}`);
    console.log(`  ${C.dim}Whitecap onset ~${ASSEMBLY_MAX_FT} ft — do not begin new sections above this threshold${C.reset}`);
    console.log();
  }

  // ── Table ───────────────────────────────────────────────────────────────────
  const W = { time: 22, wind: 9, dir: 5, fetch: 8, ht: 9, per: 8 };
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
      console.log(
        `  ${row.timeLong.padEnd(W.time)}${C.dim}${row.windStr.padEnd(W.wind)}${row.dirStr.padEnd(W.dir)}— variable wind${C.reset}`,
      );
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

  // ── Legend ──────────────────────────────────────────────────────────────────
  console.log();

  if (activity === 'dock') {
    console.log(`  ${C.bold}Dock Installation Status${C.reset}`);
    console.log(`    ${C.green}${C.bold}✓ Assembly OK${C.reset}   < ${ASSEMBLY_MAX_FT} ft   Sections can be placed, connected, and H-frames installed`);
    console.log(`    ${C.yellow}${C.bold}~ Jetting only${C.reset}  ${ASSEMBLY_MAX_FT}–${JETTING_MAX_FT} ft  Dock assembled — safe to jet legs; no new sections`);
    console.log(`    ${C.red}${C.bold}✗ Avoid${C.reset}         > ${JETTING_MAX_FT} ft   Whitecap risk — sections may be knocked apart before jetting`);
  } else {
    console.log(`  ${C.bold}Conditions${C.reset}`);
    console.log(`    ${C.green}${C.bold}Calm${C.reset}           < 0.5 ft    Glassy or light ripple`);
    console.log(`    ${C.yellow}${C.bold}Slight${C.reset}         0.5–1.0 ft  Gentle chop, comfortable for all boats`);
    console.log(`    ${C.orange}${C.bold}Moderate${C.reset}       1.0–2.0 ft  Noticeable chop, okay with care`);
    console.log(`    ${C.red}${C.bold}Rough${C.reset}          2.0–3.0 ft  Short steep waves, small craft caution`);
    console.log(`    ${C.purple}${C.bold}Very Rough${C.reset}     > 3.0 ft    Unsafe for small craft`);
  }

  console.log();
  console.log(`  ${C.dim}Wave model:  CERC/SPM fetch-limited — H_s = 0.00162√(U_A²·F/g)${C.reset}`);
  console.log(`  ${C.dim}             T_p = 0.286·(U_A/g)·(gF/U_A²)^⅓   where U_A = 0.71·U^1.23${C.reset}`);
  console.log(`  ${C.dim}Fetch table: 32-direction ray-cast, lake-grove-road (matches web app)${C.reset}`);
  console.log(`  ${C.dim}Wind source: NWS hourly forecast, ${gridId} office${C.reset}`);
  console.log(`  ${C.dim}Tip: add --gust for worst-case wave heights · --activity=dock for dock view${C.reset}`);
  console.log();
}

main().catch(err => {
  console.error(`\n  ${C.bold}${C.red}Error:${C.reset} ${err.message}\n`);
  process.exit(1);
});
