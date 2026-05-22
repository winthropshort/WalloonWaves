import { useState, useEffect } from 'react';
import type { ActivityMode } from '@walloon/shared';

// ── Static data ──────────────────────────────────────────────────────────────
// Source: scripts/shoreline_data.json fetch_runs + CERC/SPM model
// Update fetch_runs by editing scripts/shoreline_data.json and re-running
// scripts/generate_lake_svg.py — the SVG auto-copies to public/walloon_lake.svg

const FETCH_RUNS = [
  {
    basin:   'West Arm',
    wind:    '334° NNW',
    miles:   '3.56',
    from:    'Mud Lake narrows',
    to:      'Tamarack Ln (WA narrows)',
    note:    'Longest clean single-body fetch on the lake',
  },
  {
    basin:   'North Arm → Foot heel',
    wind:    '003° N',
    miles:   '3.77',
    from:    'North Arm north tip',
    to:      'Shadow Trails Rd SW',
    note:    'Passes through NA narrows — wave energy partially attenuated',
  },
  {
    basin:   'Wildwood Basin',
    wind:    '307° NW',
    miles:   '2.40',
    from:    'Camp Sherwood NW shore',
    to:      'Ellis Rd channel entrance',
    note:    'Does not extend into The Foot — Randall Point blocks straight-line water',
  },
  {
    basin:   'The Foot',
    wind:    '295° WNW',
    miles:   '1.85',
    from:    'Indian Garden Rd NW corner',
    to:      'Walloon Village (SE tip)',
    note:    'Separate fetch from Wildwood Basin',
  },
] as const;

// Pre-computed with CERC/SPM: H_s = 0.00162√(U_A²·F/g), F = 3.56 mi (West Arm)
// U_A = 0.71 × U^1.23; T_p = 0.286·(U_A/g)·(gF/U_A²)^⅓
const WAVE_TABLE = [
  { wind: '15 mph',  hs: '~1.0', period: '2.2', note: 'Whitecaps forming; dock assembly borderline (0.75 ft)' },
  { wind: '20 mph',  hs: '~1.4', period: '2.4', note: 'Dock jetting threshold approached (1.5 ft)' },
  { wind: '25 mph',  hs: '~1.8', period: '2.7', note: 'Small-craft advisory territory' },
  { wind: '30 mph',  hs: '~2.2', period: '2.9', note: 'Uncomfortable for most boats' },
  { wind: '40 mph',  hs: '~3.2', period: '3.3', note: 'Dangerous; significant water over bow' },
  { wind: '50 mph',  hs: '~4.2', period: '3.6', note: 'Near-storm; lake hazardous' },
] as const;

// ── Component ─────────────────────────────────────────────────────────────────

interface InfoPanelProps {
  activity:         ActivityMode;
  onActivityChange: (m: ActivityMode) => void;
}

export function InfoPanel({ activity, onActivityChange }: InfoPanelProps) {
  const [open, setOpen] = useState(false);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [open]);

  // Prevent body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      {/* Hamburger trigger */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Lake info"
        className="flex flex-col justify-center items-center gap-[5px] w-9 h-9 rounded-full border border-gray-200 dark:border-walloon-blue-600 bg-white dark:bg-walloon-blue-700 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-walloon-blue-600 transition-colors shadow-sm"
      >
        <span className="block w-4 h-[1.5px] bg-current rounded" />
        <span className="block w-4 h-[1.5px] bg-current rounded" />
        <span className="block w-4 h-[1.5px] bg-current rounded" />
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer */}
      <div
        className={[
          'fixed top-0 right-0 z-50 h-full w-full max-w-xl',
          'bg-white dark:bg-walloon-blue-900 shadow-2xl',
          'overflow-y-auto transition-transform duration-300 ease-in-out',
          open ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
        aria-hidden={!open}
      >
        {/* Drawer header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 bg-white dark:bg-walloon-blue-900 border-b border-gray-100 dark:border-walloon-blue-700">
          <h2 className="text-base font-semibold text-walloon-blue-700 dark:text-walloon-blue-300">
            Walloon Lake — Fetch &amp; Wave Info
          </h2>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none px-1"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-5 space-y-7">

          {/* ── View toggle ── */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">View</h3>
            <div className="inline-flex rounded-full border border-walloon-blue-200 dark:border-walloon-blue-600 bg-white dark:bg-walloon-blue-800 p-1 shadow-sm">
              {(['dock', 'mariner'] as const).map((mode) => {
                const active = activity === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => { onActivityChange(mode); setOpen(false); }}
                    className={[
                      'rounded-full px-5 py-1.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-walloon-blue-500 text-white shadow-sm'
                        : 'text-walloon-blue-500 dark:text-walloon-blue-300 hover:bg-walloon-blue-50 dark:hover:bg-walloon-blue-700',
                    ].join(' ')}
                  >
                    {mode === 'mariner' ? '⛵ Mariner' : '🔧 Dock Installer'}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Dock installer thresholds ── */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Dock Installer Thresholds</h3>
            <div className="rounded-xl border border-gray-100 dark:border-walloon-blue-700 overflow-hidden text-sm">
              <div className="flex items-start gap-3 px-4 py-3 bg-green-50 dark:bg-green-900/20 border-b border-gray-100 dark:border-walloon-blue-700">
                <span className="font-bold text-green-700 dark:text-green-400 shrink-0">✓</span>
                <div>
                  <span className="font-semibold text-green-700 dark:text-green-400">Assembly OK</span>
                  <span className="text-green-700/70 dark:text-green-400/70 ml-1">&lt; 0.75 ft — pre-whitecap, safe to add sections</span>
                </div>
              </div>
              <div className="flex items-start gap-3 px-4 py-3 bg-yellow-50 dark:bg-yellow-900/20 border-b border-gray-100 dark:border-walloon-blue-700">
                <span className="font-bold text-yellow-700 dark:text-yellow-400 shrink-0">~</span>
                <div>
                  <span className="font-semibold text-yellow-700 dark:text-yellow-400">Jetting Only</span>
                  <span className="text-yellow-700/70 dark:text-yellow-400/70 ml-1">0.75–1.5 ft — jetting tolerated, no new sections</span>
                </div>
              </div>
              <div className="flex items-start gap-3 px-4 py-3 bg-red-50 dark:bg-red-900/20">
                <span className="font-bold text-red-700 dark:text-red-400 shrink-0">✗</span>
                <div>
                  <span className="font-semibold text-red-700 dark:text-red-400">Avoid</span>
                  <span className="text-red-700/70 dark:text-red-400/70 ml-1">&gt; 1.5 ft — whitecap risk</span>
                </div>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-gray-400 leading-snug">
              Card border color mirrors dock status in real time: green · amber · red.
            </p>
          </section>

          {/* ── Lake map ── */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
              Maximum Fetch Runs
            </h3>
            <img
              src="/walloon_lake.svg?v=2"
              alt="Walloon Lake fetch diagram"
              className="w-full rounded-xl border border-gray-200 dark:border-walloon-blue-600 bg-[#dce8c4]"
            />
            <p className="mt-1.5 text-[11px] text-gray-400 leading-snug">
              Orange arrows = longest open-water fetch per basin (CERC/SPM model).
              Diagram generated from <code className="font-mono">scripts/shoreline_data.json</code> — update GPS
              data there and re-run <code className="font-mono">generate_lake_svg.py</code>.
            </p>
          </section>

          {/* ── Fetch runs table ── */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
              Fetch Run Details
            </h3>
            <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-walloon-blue-700">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 dark:bg-walloon-blue-800 text-gray-500 dark:text-gray-400">
                    <th className="text-left px-3 py-2 font-medium">Basin</th>
                    <th className="text-left px-3 py-2 font-medium">Wind from</th>
                    <th className="text-right px-3 py-2 font-medium">Fetch</th>
                    <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">From → To</th>
                  </tr>
                </thead>
                <tbody>
                  {FETCH_RUNS.map((r, i) => (
                    <tr
                      key={i}
                      className="border-t border-gray-100 dark:border-walloon-blue-700 text-gray-700 dark:text-gray-200"
                    >
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{r.basin}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-[#C05000] font-mono">{r.wind}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap">{r.miles} mi</td>
                      <td className="px-3 py-2 text-gray-400 hidden sm:table-cell leading-snug">
                        <span className="block">{r.from}</span>
                        <span className="block">{r.to}</span>
                        <span className="block text-[10px] mt-0.5">{r.note}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Max wave heights ── */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">
              Maximum Wave Heights
            </h3>
            <p className="text-[11px] text-gray-400 mb-2">
              West Arm (3.56 mi fetch, NNW wind) — worst case on the lake.
              Sustained wind needed: ~1.5 h to reach fetch-limited state.
            </p>
            <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-walloon-blue-700">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 dark:bg-walloon-blue-800 text-gray-500 dark:text-gray-400">
                    <th className="text-left  px-3 py-2 font-medium">Wind</th>
                    <th className="text-right px-3 py-2 font-medium">H_s (ft)</th>
                    <th className="text-right px-3 py-2 font-medium">Period (s)</th>
                    <th className="text-left  px-3 py-2 font-medium hidden sm:table-cell">Conditions</th>
                  </tr>
                </thead>
                <tbody>
                  {WAVE_TABLE.map((r, i) => (
                    <tr
                      key={i}
                      className="border-t border-gray-100 dark:border-walloon-blue-700 text-gray-700 dark:text-gray-200"
                    >
                      <td className="px-3 py-2 font-medium tabular-nums">{r.wind}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-walloon-blue-600 dark:text-walloon-blue-300">{r.hs}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-400">{r.period}</td>
                      <td className="px-3 py-2 text-gray-400 hidden sm:table-cell">{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Data sources ── */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
              Data Sources
            </h3>
            <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-walloon-blue-700">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 dark:bg-walloon-blue-800 text-gray-500 dark:text-gray-400">
                    <th className="text-left px-3 py-2 font-medium">Field</th>
                    <th className="text-left px-3 py-2 font-medium">Source</th>
                    <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    { field: 'Wind speed',        source: 'Open-Meteo',        tag: 'om',  note: '10 m anemometer height, mph' },
                    { field: 'Wind gusts',         source: 'Open-Meteo',        tag: 'om',  note: '10 m height, mph' },
                    { field: 'Wind direction',     source: 'Open-Meteo',        tag: 'om',  note: 'Continuous degrees → 16-pt compass (NWS rounds to 8-pt)' },
                    { field: 'Barometric pressure',source: 'Open-Meteo',        tag: 'om',  note: 'Mean sea-level, hPa / inHg' },
                    { field: 'Sky cover',          source: 'NWS gridpoint',     tag: 'nws', note: 'APX/50,64 — percent 0–100' },
                    { field: 'Precipitation',      source: 'NWS gridpoint',     tag: 'nws', note: 'Quantitative, mm → in' },
                    { field: 'Temperature',        source: 'NWS hourly forecast', tag: 'nws', note: 'APX/50,64 hourly periods' },
                    { field: 'Prob. of precip',    source: 'NWS hourly forecast', tag: 'nws', note: '0–100 %' },
                    { field: 'Forecast text',      source: 'NWS hourly forecast', tag: 'nws', note: 'shortForecast string' },
                    { field: 'Wind chill',         source: 'Calculated',        tag: 'calc', note: 'NOAA formula — valid when T ≤ 50 °F and speed ≥ 3 mph' },
                    { field: 'Wave height',        source: 'Calculated',        tag: 'calc', note: 'CERC/SPM 1984, fetch-limited' },
                    { field: 'Wave period',        source: 'Calculated',        tag: 'calc', note: 'CERC/SPM 1984, fetch-limited' },
                    { field: 'Aurora visibility',  source: 'NOAA SWPC',         tag: 'swpc', note: 'Planetary K-index (1-min) → % chance at 45.3°N; clear sky required' },
                  ] as const).map((r, i) => (
                    <tr key={i} className="border-t border-gray-100 dark:border-walloon-blue-700 text-gray-700 dark:text-gray-200">
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{r.field}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={[
                          'inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold',
                          r.tag === 'om'   ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' :
                          r.tag === 'nws'  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
                          r.tag === 'swpc' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' :
                                             'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
                        ].join(' ')}>
                          {r.source}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-400 hidden sm:table-cell">{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[11px] text-gray-400 leading-snug">
              Weather ingested every 4 h by AWS Lambda. Open-Meteo: 7-day horizon. NWS: ~156 h.
              Aurora KP fetched live from NOAA SWPC (1-min cadence, no API key).
            </p>
          </section>

          {/* ── Model notes ── */}
          <section className="rounded-xl bg-gray-50 dark:bg-walloon-blue-800/50 border border-gray-100 dark:border-walloon-blue-700 px-4 py-3 space-y-1.5 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
            <p className="font-semibold text-gray-600 dark:text-gray-300 text-xs">Model — CERC/SPM (Shore Protection Manual, 1984)</p>
            <p className="font-mono">H_s = 0.00162 · √(U_A² · F / g)</p>
            <p className="font-mono">T_p = 0.286 · (U_A/g) · (gF/U_A²)^⅓</p>
            <p className="font-mono">U_A = 0.71 · U^1.23</p>
            <ul className="list-disc list-inside space-y-0.5 mt-1">
              <li>Fetch-limited assumption (conservative / worst-case)</li>
              <li>Periods 2–4 s — short, steep, choppy (unlike ocean swell at 8–14 s)</li>
              <li>Whitecap onset ≈ 0.75 ft (dock assembly threshold)</li>
              <li>Depth limitation irrelevant — Walloon avg depth ~50 ft</li>
              <li>Wave energy attenuated significantly at narrows (WA, NA)</li>
            </ul>
          </section>

        </div>
      </div>
    </>
  );
}
