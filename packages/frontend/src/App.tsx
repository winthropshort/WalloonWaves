import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { ActivityMode } from '@walloon/shared';
import { calcWaves } from '@walloon/shared';
import { useLocations } from './hooks/useLocations.js';
import { useWeatherHistory } from './hooks/useWeatherHistory.js';
import { useAurora } from './hooks/useAurora.js';
import { LocationCard } from './components/LocationCard.js';
import { GeocodeSection } from './components/GeocodeSection.js';
import { WindCompass } from './components/WindCompass.js';
import { WaveSparkline } from './components/WaveSparkline.js';
import { WeatherSparklines, midnightDomain, mbToInHg, skyCoverIcon } from './components/WeatherSparklines.js';
import { InfoPanel } from './components/InfoPanel.js';
import { geocodeAddress } from './api.js';
import type { WeatherObservation } from './api.js';
import type { WaveConditions } from '@walloon/shared';

// ─── Dock view ────────────────────────────────────────────────────────────────

const DOCK_PRESETS = [
  { id: 'lake-grove-road',  lat: 45.30325, lng: -85.01259 },
  { id: 'walloon-village',  lat: 45.26352, lng: -84.93499 },
  { id: 'bear-cove-marina', lat: 45.32619, lng: -85.04375 },
  { id: 'camp-michagania',  lat: 45.3215,  lng: -84.9628  },
  { id: 'camp-daggett',     lat: 45.3072,  lng: -84.9720  },
  { id: 'walloon-lake-cc',  lat: 45.2610,  lng: -84.9568  },
  { id: 'jones-landing',    lat: 45.30219, lng: -84.96792 },
];

function nearestPreset(lat: number, lng: number) {
  return DOCK_PRESETS.reduce((best, loc) => {
    const d = Math.hypot(loc.lat - lat, loc.lng - lng);
    return d < Math.hypot(best.lat - lat, best.lng - lng) ? loc : best;
  });
}

const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'] as const;
function degToLabel(deg: number | null) {
  if (deg === null) return 'VRB';
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16] ?? 'N';
}

const HT_COLORS: Record<string, string> = {
  calm: 'text-green-600', slight: 'text-yellow-600', moderate: 'text-orange-500',
  rough: 'text-red-600', 'very-rough': 'text-purple-700',
};
const COND_STYLES: Record<string, { bg: string; text: string }> = {
  calm:         { bg: 'bg-green-100',   text: 'text-green-800'   },
  slight:       { bg: 'bg-yellow-100',  text: 'text-yellow-800'  },
  moderate:     { bg: 'bg-orange-100',  text: 'text-orange-800'  },
  rough:        { bg: 'bg-red-100',     text: 'text-red-800'     },
  'very-rough': { bg: 'bg-purple-100',  text: 'text-purple-800'  },
};
const COND_LABELS: Record<string, string> = {
  calm: 'Calm', slight: 'Slight', moderate: 'Moderate', rough: 'Rough', 'very-rough': 'Very Rough',
};
const DOCK_STATUS_ROW: Record<string, { color: string; label: string }> = {
  'ok':           { color: 'text-green-600',  label: '✓ OK'    },
  'jetting-only': { color: 'text-yellow-600', label: '~ Jet'   },
  'avoid':        { color: 'text-red-600',    label: '✗ Avoid' },
};

interface DockResult {
  wave:      WaveConditions;
  presetId:  string;
  label:     string;
  outOfBounds: boolean;
}

const BOUNDS = { minLat: 45.24, maxLat: 45.38, minLng: -85.10, maxLng: -84.85 };
function withinBounds(lat: number, lng: number) {
  return lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat && lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng;
}

function windowLabel(hours: 48 | 72): string {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endDate  = new Date(midnight.getTime() + hours * 3_600_000 - 60_000);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(midnight)} 00:00 – ${fmt(endDate)} 23:59`;
}

function DockView({
  currentObs,
  history,
  hours,
  onHoursChange,
}: {
  currentObs:    WeatherObservation | null;
  history:       WeatherObservation[];
  hours:         48 | 72;
  onHoursChange: (h: 48 | 72) => void;
}) {
  const [address,    setAddress]    = useState('5152 Lake Grove Road, Walloon Lake, MI');
  const [result,     setResult]     = useState<DockResult | null>(null);
  const [geoError,   setGeoError]   = useState<string | null>(null);
  const [notFound,   setNotFound]   = useState(false);
  const [activeTime, setActiveTime] = useState<number | null>(null);
  const [expanded,   setExpanded]   = useState(false);

  const { data: auroraData } = useAurora();

  const windSpeed = currentObs?.windSpeed_mph ?? 0;
  const windDir   = currentObs?.windDir_deg   ?? null;

  function computeForLocation(lat: number, lng: number, label: string, oob: boolean) {
    const preset = nearestPreset(lat, lng);
    const wave   = calcWaves(preset.id, windSpeed, windDir);
    setResult({ wave, presetId: preset.id, label, outOfBounds: oob });
    setNotFound(false);
    setGeoError(null);
    setActiveTime(null);
  }

  const geocodeMut = useMutation({
    mutationFn: (addr: string) => geocodeAddress(addr),
    onSuccess: (geo) => {
      if (!geo) { setNotFound(true); setResult(null); return; }
      const oob = !withinBounds(geo.lat, geo.lng);
      computeForLocation(
        oob ? DOCK_PRESETS[0]!.lat : geo.lat,
        oob ? DOCK_PRESETS[0]!.lng : geo.lng,
        geo.displayName.split(',').slice(0, 2).join(',').trim(),
        oob,
      );
    },
    onError: () => setGeoError('Geocoding failed — try a different address or use 📍.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const addr = address.trim();
    if (!addr) return;
    setNotFound(false);
    setResult(null);
    geocodeMut.mutate(addr);
  }

  function handleGeolocate() {
    setGeoError(null);
    setNotFound(false);
    if (!navigator.geolocation) {
      setGeoError('Geolocation not supported by this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => computeForLocation(pos.coords.latitude, pos.coords.longitude, 'Your location', false),
      () => setGeoError('Location access denied — allow location in browser settings.'),
    );
  }

  const displayWave    = result?.wave ?? calcWaves('lake-grove-road', windSpeed, windDir);
  const displayPresetId = result?.presetId ?? 'lake-grove-road';
  const displayLabel   = result?.label ?? '5152 Lake Grove Road';

  // Resolve observation + wave for the selected or current time
  const lookupTime = activeTime ?? Date.now();
  const activeObs: WeatherObservation | null = history.length > 0
    ? history.reduce((best, o) => {
        const t     = new Date(o.timestamp).getTime();
        const bestT = new Date(best.timestamp).getTime();
        return Math.abs(t - lookupTime) < Math.abs(bestT - lookupTime) ? o : best;
      })
    : null;

  const activeWave: WaveConditions = activeObs
    ? calcWaves(displayPresetId, activeObs.windSpeed_mph, activeObs.windDir_deg)
    : displayWave;

  const cardBorderColor =
    activeWave.dockStatus === 'ok'           ? 'border-green-400 dark:border-green-600' :
    activeWave.dockStatus === 'jetting-only' ? 'border-amber-400 dark:border-amber-500' :
                                               'border-red-400 dark:border-red-600';
  const htClr     = HT_COLORS[activeWave.conditions]    ?? 'text-gray-700';
  const cond      = COND_STYLES[activeWave.conditions]   ?? COND_STYLES['calm']!;
  const condLabel = COND_LABELS[activeWave.conditions]   ?? activeWave.conditions;

  const whitecapNote =
    activeWave.waveHeight_ft >= 1.5 ? 'whitecaps' :
    activeWave.waveHeight_ft >= 0.75 ? 'whitecap risk' :
    null;

  const activeGust = activeObs?.windGust_mph ?? 0;
  const activeDir  = degToLabel(activeObs?.windDir_deg ?? activeWave.windDir_deg ?? null);

  // ── Detail table rows: future-only, every 2 hours ──────────────────────────
  const [domainStart, domainEnd] = midnightDomain(hours);
  const nowMs = Date.now();
  const nowPct = Math.max(0, Math.min(100,
    ((nowMs - domainStart) / (domainEnd - domainStart)) * 100,
  ));

  const detailRows = history
    .filter((o) => {
      const t = new Date(o.timestamp).getTime();
      return t >= nowMs - 1_800_000 && t >= domainStart && t <= domainEnd;
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .filter((_, i) => i % 2 === 0)
    .map((o) => {
      const tMs   = new Date(o.timestamp).getTime();
      const waves = o.windDir_deg !== null && o.windSpeed_mph > 0
        ? calcWaves(displayPresetId, o.windSpeed_mph, o.windDir_deg)
        : { waveHeight_ft: 0, wavePeriod_s: 0, fetchMi: 0, conditions: 'calm' as const, dockStatus: 'ok' as const, windSpeed_mph: 0, windDir_deg: 0 };
      const d         = new Date(tMs);
      const timeStr   = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      const dayStr    = d.toLocaleDateString('en-US', { weekday: 'short' });
      const htColor   = HT_COLORS[waves.conditions] ?? 'text-gray-700';
      const dockStyle = DOCK_STATUS_ROW[waves.dockStatus ?? 'ok'] ?? DOCK_STATUS_ROW['ok']!;
      return {
        timeStr: `${dayStr} ${timeStr}`,
        tMs,
        windSpeed:  o.windSpeed_mph,
        gustSpeed:  o.windGust_mph,
        dirLabel:   o.windDir_label || '—',
        fetchMi:    waves.fetchMi,
        waveHt:     waves.waveHeight_ft,
        period:     waves.wavePeriod_s,
        htColor,
        dockStyle,
        temp:       o.temperature_f,
        pop:        o.pop_pct,
      };
    });

  const activeTimeFmt = activeTime
    ? (() => {
        const d = new Date(activeTime);
        return d.toLocaleString('en-US', {
          weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
        });
      })()
    : null;

  return (
    <div className="max-w-xl mx-auto w-full space-y-4">
      {/* Address input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Dock address or landmark on Walloon Lake…"
          className="flex-1 rounded-xl border border-gray-200 dark:border-walloon-blue-600 bg-white dark:bg-walloon-blue-700 dark:text-gray-100 dark:placeholder-gray-400 px-4 py-2.5 text-sm shadow-sm outline-none focus:border-walloon-blue-400 focus:ring-2 focus:ring-walloon-blue-100 dark:focus:ring-walloon-blue-700"
        />
        <button
          type="submit"
          disabled={!address.trim() || geocodeMut.isPending}
          className="rounded-xl bg-walloon-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-walloon-blue-600 disabled:opacity-50 transition-colors"
        >
          {geocodeMut.isPending ? '…' : 'Search'}
        </button>
        <button
          type="button"
          onClick={handleGeolocate}
          title="Use my location"
          className="rounded-xl border border-gray-200 dark:border-walloon-blue-600 bg-white dark:bg-walloon-blue-700 px-3 py-2.5 text-base shadow-sm hover:bg-gray-50 dark:hover:bg-walloon-blue-600 transition-colors"
        >
          📍
        </button>
      </form>

      {notFound && (
        <p className="text-sm text-amber-700">
          Address not found.{' '}
          <button className="underline" onClick={handleGeolocate}>Use 📍</button>{' '}
          if you're at the lake.
        </p>
      )}
      {geoError && <p className="text-sm text-red-600">{geoError}</p>}
      {result?.outOfBounds && (
        <p className="text-xs text-amber-600">
          Address outside lake area — showing conditions for nearest reference point.
        </p>
      )}

      {/* Main dock card */}
      <div className={`rounded-2xl bg-white dark:bg-walloon-blue-800 border-2 ${cardBorderColor} shadow-sm p-6 flex flex-col gap-4`}>

        {/* Time indicator */}
        {activeTimeFmt ? (
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-amber-600">⏱ {activeTimeFmt}</span>
            <button
              className="text-xs text-walloon-blue-500 hover:text-walloon-blue-700"
              onClick={() => setActiveTime(null)}
            >
              ← Now
            </button>
          </div>
        ) : (
          <div className="text-xs text-gray-400">Current conditions</div>
        )}

        {/* Wave height + condition */}
        <div className="flex items-center gap-3">
          <div>
            <span className={`text-5xl font-bold leading-none tabular-nums ${htClr}`}>
              {activeWave.waveHeight_ft.toFixed(2)}
            </span>
            <span className="text-base text-gray-400 ml-1">ft</span>
          </div>
          <div className="space-y-0.5">
            <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${cond.bg} ${cond.text}`}>
              {condLabel}
            </span>
            {whitecapNote && (
              <div className="text-xs text-red-500 font-medium">{whitecapNote}</div>
            )}
          </div>
        </div>

        {/* Compass + wind speed/dir/gust + period/fetch */}
        <div className="flex items-center gap-4">
          <WindCompass
            windDir_deg={activeObs?.windDir_deg ?? activeWave.windDir_deg ?? null}
            windDir_label={activeDir}
            size={84}
          />
          <div className="text-[15px] text-gray-700 dark:text-gray-200 space-y-0.5">
            <div>
              <span className="font-medium">
                {activeObs?.windSpeed_mph ?? activeWave.windSpeed_mph} mph
              </span>
              <span className="text-gray-400 ml-1">from {activeDir}</span>
              <span className="text-gray-400">
                {' '}gusts to{' '}
                {activeGust > 0 ? `${activeGust}mph` : '—'}
              </span>
            </div>
            <div className="text-xs text-gray-400">
              Period {activeWave.wavePeriod_s}s · Fetch {activeWave.fetchMi}mi
            </div>
          </div>
        </div>

        {/* Weather metrics grid */}
        <div className="text-[15px] text-gray-600 dark:text-gray-300 space-y-0.5 pl-1">
          {activeObs?.temperature_f !== undefined && (
            <div>
              Air{' '}
              <span className="font-medium text-orange-500">{activeObs.temperature_f.toFixed(0)}°F</span>
              {activeObs.windChill_f !== undefined &&
               activeObs.windChill_f < activeObs.temperature_f && (
                <>
                  {' '}Chill{' '}
                  <span className="font-medium text-cyan-500">{activeObs.windChill_f.toFixed(0)}°F</span>
                </>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span>
              Pressure{' '}
              <span className="font-medium text-violet-600 dark:text-violet-400">
                {activeObs?.pressure_mb !== undefined ? `${mbToInHg(activeObs.pressure_mb)}"` : '—'}
              </span>
            </span>
            {activeObs?.pop_pct !== undefined && (
              <span>PoP <span className="font-medium text-blue-500">{activeObs.pop_pct.toFixed(0)}%</span></span>
            )}
            {activeObs?.precip_in !== undefined && (
              <span>Amount <span className="font-medium text-sky-500">{activeObs.precip_in.toFixed(2)}"</span></span>
            )}
          </div>
          {activeObs?.skyCover_pct !== undefined && (
            <div>
              Cloud Coverage {skyCoverIcon(activeObs.skyCover_pct)}
            </div>
          )}
          <div>
            Aurora{' '}
            {auroraData ? (
              <>
                <span className={`font-medium ${
                  auroraData.probability >= 60 ? 'text-purple-500 dark:text-purple-400' :
                  auroraData.probability >= 30 ? 'text-violet-500 dark:text-violet-400' :
                  auroraData.probability >= 10 ? 'text-indigo-500 dark:text-indigo-400' :
                  'text-gray-400 dark:text-gray-500'
                }`}>
                  {auroraData.probability}%
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">
                  KP {auroraData.kp.toFixed(1)}
                  {activeObs?.skyCover_pct !== undefined && activeObs.skyCover_pct >= 75 && (
                    <span className="ml-1 italic">· overcast</span>
                  )}
                </span>
              </>
            ) : (
              <span className="font-medium text-gray-400 dark:text-gray-500">—</span>
            )}
          </div>
        </div>

        {/* Sparklines */}
        <div className="relative space-y-1 pt-1 border-t border-gray-50 dark:border-walloon-blue-700">
          {/* Now marker */}
          <div
            className="absolute inset-y-0 w-px bg-gray-300 pointer-events-none z-10"
            style={{ left: `calc(8rem + ${nowPct / 100} * (100% - 8rem))` }}
          />
          {/* Wave height row */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 w-12 shrink-0">λ:</span>
            <span className={`text-xs font-medium tabular-nums w-16 shrink-0 ${htClr}`}>
              {activeWave.waveHeight_ft.toFixed(2)} ft
            </span>
            <div className="flex-1 h-12">
              <WaveSparkline
                history={history}
                locationId={displayPresetId}
                hours={hours}
                activeTime={activeTime ?? undefined}
                onTimeSelect={setActiveTime}
              />
            </div>
          </div>
          <WeatherSparklines
            history={history}
            hours={hours}
            activeTime={activeTime ?? undefined}
            onTimeSelect={setActiveTime}
          />
        </div>

        {/* Detail table toggle */}
        <div className="border-t border-gray-50 dark:border-walloon-blue-700 pt-1">
          <button
            className="flex items-center justify-between w-full text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 py-1"
            onClick={() => setExpanded(!expanded)}
          >
            <span>Hourly forecast (2h intervals)</span>
            <span>{expanded ? '▲' : '▼'}</span>
          </button>

          {expanded && detailRows.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100 dark:border-walloon-blue-700">
                    <th className="text-left py-1 pr-2 font-normal">Time</th>
                    <th className="text-right py-1 pr-1 font-normal">Wind</th>
                    <th className="text-right py-1 pr-2 font-normal">Gust</th>
                    <th className="text-left  py-1 pr-2 font-normal">Dir</th>
                    <th className="text-right py-1 pr-2 font-normal">Fetch</th>
                    <th className="text-right py-1 pr-2 font-normal">Wave</th>
                    <th className="text-right py-1 pr-2 font-normal">Per</th>
                    <th className="text-right py-1 pr-2 font-normal">Air</th>
                    <th className="text-right py-1 pr-2 font-normal">PoP</th>
                    <th className="text-right py-1 font-normal">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {detailRows.map((row, i) => (
                    <tr
                      key={i}
                      className={`border-b border-gray-50 dark:border-walloon-blue-700 hover:bg-gray-50 dark:hover:bg-walloon-blue-700 cursor-pointer text-gray-700 dark:text-gray-200 ${
                        activeTime !== null && Math.abs(row.tMs - activeTime) < 3_600_000
                          ? 'bg-amber-50 dark:bg-amber-900/20'
                          : ''
                      }`}
                      onClick={() => setActiveTime(row.tMs)}
                    >
                      <td className="py-1 pr-2 tabular-nums whitespace-nowrap">{row.timeStr}</td>
                      <td className="text-right py-1 pr-1 tabular-nums">{row.windSpeed}</td>
                      <td className="text-right py-1 pr-2 tabular-nums text-gray-400">
                        {row.gustSpeed > 0 ? row.gustSpeed : '—'}
                      </td>
                      <td className="py-1 pr-2">{row.dirLabel}</td>
                      <td className="text-right py-1 pr-2 tabular-nums text-gray-400">
                        {row.fetchMi.toFixed(1)}
                      </td>
                      <td className={`text-right py-1 pr-2 tabular-nums font-semibold ${row.htColor}`}>
                        {row.waveHt.toFixed(2)}
                      </td>
                      <td className="text-right py-1 pr-2 tabular-nums text-gray-400">
                        {row.period > 0 ? row.period : '—'}
                      </td>
                      <td className="text-right py-1 pr-2 tabular-nums">
                        {row.temp !== undefined ? `${row.temp.toFixed(0)}°` : '—'}
                      </td>
                      <td className="text-right py-1 pr-2 tabular-nums text-gray-400">
                        {row.pop !== undefined ? `${row.pop.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right py-1 tabular-nums font-medium ${row.dockStyle.color}`}>
                        {row.dockStyle.label}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {expanded && detailRows.length === 0 && (
            <p className="text-xs text-gray-400 py-2">No forecast data available yet.</p>
          )}
        </div>

        {/* Footer */}
        <div className="pt-1 border-t border-gray-50 dark:border-walloon-blue-700 space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">{windowLabel(hours)}</span>
            <label className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hours === 72}
                onChange={(e) => onHoursChange(e.target.checked ? 72 : 48)}
                className="h-3 w-3 rounded"
              />
              72h
            </label>
          </div>
          {currentObs && (
            <div className="text-xs text-gray-400">
              Data from{' '}
              {new Date(currentObs.timestamp).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', hour12: false,
              })}
              {' · '}
              <span className="italic">see ☰ for dock thresholds</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Shared skeletons / errors ────────────────────────────────────────────────

function LoadingSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5 space-y-4 animate-pulse">
          <div className="h-4 bg-gray-100 rounded w-3/4" />
          <div className="h-12 bg-gray-100 rounded w-1/2" />
          <div className="h-4 bg-gray-100 rounded w-1/3" />
          <div className="h-14 bg-gray-50 rounded" />
        </div>
      ))}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────

export default function App() {
  const [activity, setActivity] = useState<ActivityMode>('dock');
  const [hours, setHours]       = useState<48 | 72>(48);
  const [isDark, setIsDark]     = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('theme');
    if (stored === 'dark')  return true;
    if (stored === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const { data: locations, isLoading: locsLoading, error: locsError, dataUpdatedAt } = useLocations();
  const { data: history = [] } = useWeatherHistory(hours);

  const nowMs = Date.now();
  const currentObs = history.length
    ? history.reduce((best, o) =>
        Math.abs(new Date(o.timestamp).getTime() - nowMs) <
        Math.abs(new Date(best.timestamp).getTime() - nowMs) ? o : best,
      )
    : null;

  return (
    <div className="min-h-screen bg-walloon-white dark:bg-walloon-blue-900">
      <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">

        <header className="flex items-center justify-between gap-2">
          <h1 className="text-base font-bold text-walloon-blue-600 dark:text-walloon-blue-300 tracking-tight leading-tight">
            Walloon Lake Marine Weather
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setIsDark(!isDark)}
              className="text-xs px-3 py-1.5 rounded-full border border-gray-200 dark:border-walloon-blue-600 bg-white dark:bg-walloon-blue-700 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-walloon-blue-600 transition-colors shadow-sm"
            >
              {isDark ? 'Light' : 'Dark'}
            </button>
            <InfoPanel activity={activity} onActivityChange={setActivity} />
          </div>
        </header>

        {locsError && (
          <ErrorBanner message="Unable to load wave conditions. Check your connection and try again." />
        )}
        {locations?.some((l) => l.stale) && (
          <div className="rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 px-4 py-3 text-sm text-amber-800 dark:text-amber-200 max-w-2xl mx-auto">
            Weather data is more than 8 hours old — conditions shown may not reflect current state.
          </div>
        )}

        {activity === 'dock' && (
          locsLoading
            ? <LoadingSkeleton count={1} />
            : <DockView currentObs={currentObs} history={history} hours={hours} onHoursChange={setHours} />
        )}

        {activity === 'mariner' && (
          <>
            {locsLoading && <LoadingSkeleton count={7} />}
            {locations && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {locations.map((loc) => (
                  <LocationCard
                    key={loc.id}
                    location={loc}
                    activity={activity}
                    history={history}
                    hours={hours}
                    onHoursChange={setHours}
                  />
                ))}
              </div>
            )}
            <GeocodeSection activity={activity} currentObs={currentObs} />
          </>
        )}

        <footer className="text-center text-xs text-gray-400 pt-4 border-t border-gray-200 dark:border-walloon-blue-700 space-y-1">
          <p>
            Wave model: CERC/SPM fetch-limited —{' '}
            <span className="font-mono">H_s = 0.00162√(U_A²·F/g)</span>
          </p>
          <p>
            Powered by{' '}
            <a href="https://www.weather.gov" target="_blank" rel="noopener noreferrer"
               className="underline hover:text-gray-600">NWS hourly forecast</a>
            {' · '}
            <a href="https://walloon.org" target="_blank" rel="noopener noreferrer"
               className="underline hover:text-gray-600">walloon.org</a>
          </p>
        </footer>

      </div>
    </div>
  );
}
