import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { ActivityMode } from '@walloon/shared';
import { calcWaves } from '@walloon/shared';
import { useLocations } from './hooks/useLocations.js';
import { useWeatherHistory } from './hooks/useWeatherHistory.js';
import { ActivityToggle } from './components/ActivityToggle.js';
import { LocationCard } from './components/LocationCard.js';
import { GeocodeSection } from './components/GeocodeSection.js';
import { WindCompass } from './components/WindCompass.js';
import { WaveSparkline } from './components/WaveSparkline.js';
import { WeatherSparklines } from './components/WeatherSparklines.js';
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

const DOCK_STATUS_STYLES = {
  'ok':           { bg: 'bg-green-50',  text: 'text-green-700',  icon: '✓', label: 'Assembly OK',  note: '< 0.75 ft — assembly safe'   },
  'jetting-only': { bg: 'bg-yellow-50', text: 'text-yellow-700', icon: '~', label: 'Jetting Only', note: '0.75–1.5 ft — no new sections' },
  'avoid':        { bg: 'bg-red-50',    text: 'text-red-700',    icon: '✗', label: 'Avoid',        note: '> 1.5 ft — whitecap risk'     },
};
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
  const [address, setAddress] = useState('5152 Lake Grove Road, Walloon Lake, MI');
  const [result, setResult]   = useState<DockResult | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const windSpeed = currentObs?.windSpeed_mph ?? 0;
  const windDir   = currentObs?.windDir_deg   ?? null;

  function computeForLocation(lat: number, lng: number, label: string, oob: boolean) {
    const preset = nearestPreset(lat, lng);
    const wave   = calcWaves(preset.id, windSpeed, windDir);
    setResult({ wave, presetId: preset.id, label, outOfBounds: oob });
    setNotFound(false);
    setGeoError(null);
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

  // Default: use lake-grove-road conditions from current obs
  const displayWave = result?.wave ?? calcWaves('lake-grove-road', windSpeed, windDir);
  const displayPresetId = result?.presetId ?? 'lake-grove-road';
  const displayLabel = result?.label ?? '5152 Lake Grove Road';

  const dock   = DOCK_STATUS_STYLES[displayWave.dockStatus ?? 'ok']!;
  const htClr  = HT_COLORS[displayWave.conditions] ?? 'text-gray-700';
  const cond   = COND_STYLES[displayWave.conditions] ?? COND_STYLES['calm']!;

  return (
    <div className="max-w-xl mx-auto w-full space-y-4">
      <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
        <strong>Dock Installer View</strong> — Assembly phase requires waves &lt; 0.75 ft (pre-whitecap).
        Jetting phase tolerates up to 1.5 ft once fully assembled.
      </div>

      {/* Address input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Dock address or landmark on Walloon Lake…"
          className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm shadow-sm outline-none focus:border-walloon-blue-400 focus:ring-2 focus:ring-walloon-blue-100"
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
          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-base shadow-sm hover:bg-gray-50 transition-colors"
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
      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 flex flex-col gap-5">

        <div>
          <p className="font-semibold text-walloon-blue-700">{displayLabel}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Conditions modeled from nearest reference point
          </p>
        </div>

        {/* Dock status — most prominent element */}
        <div className={`rounded-xl px-4 py-3 text-base font-bold ${dock.bg} ${dock.text}`}>
          <div className="text-xl">{dock.icon} {dock.label}</div>
          <div className="text-sm font-normal mt-0.5 opacity-80">{dock.note}</div>
        </div>

        {/* Wave height + condition */}
        <div className="flex items-end gap-3">
          <div>
            <span className={`text-5xl font-bold leading-none tabular-nums ${htClr}`}>
              {displayWave.waveHeight_ft.toFixed(2)}
            </span>
            <span className="text-base text-gray-400 ml-1">ft</span>
          </div>
          <span className={`mb-1 rounded-full px-3 py-0.5 text-xs font-semibold uppercase tracking-wide ${cond.bg} ${cond.text}`}>
            {displayWave.conditions.replace('-', ' ')}
          </span>
        </div>

        {/* Wind + compass */}
        <div className="flex items-center gap-4">
          <WindCompass
            windDir_deg={displayWave.windDir_deg}
            windDir_label={degToLabel(displayWave.windDir_deg)}
            size={72}
          />
          <div className="text-sm text-gray-700 space-y-0.5">
            <div>
              <span className="font-medium">{displayWave.windSpeed_mph} mph</span>
              {displayWave.windDir_deg !== null && (
                <span className="text-gray-400 ml-1">from {degToLabel(displayWave.windDir_deg)}</span>
              )}
            </div>
            <div className="text-gray-400 text-xs">
              Period {displayWave.wavePeriod_s}s · Fetch {displayWave.fetchMi} mi
            </div>
          </div>
        </div>

        {/* History sparklines */}
        <div className="space-y-2">
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
          <div>
            <div className="text-xs text-gray-400 mb-1">Wave height</div>
            <WaveSparkline history={history} locationId={displayPresetId} hours={hours} />
          </div>
          <WeatherSparklines history={history} hours={hours} />
        </div>

        {currentObs && (
          <div className="text-xs text-gray-400 pt-1 border-t border-gray-50">
            Wind data from{' '}
            {new Date(currentObs.timestamp).toLocaleTimeString('en-US', {
              hour: 'numeric', minute: '2-digit', hour12: true,
            })}
          </div>
        )}
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

  const { data: locations, isLoading: locsLoading, error: locsError, dataUpdatedAt } = useLocations();
  const { data: history = [] } = useWeatherHistory(hours);

  const currentObs = history.length
    ? [...history].sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0] ?? null
    : null;

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : null;

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F5F5F0' }}>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

        <header className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-walloon-blue-600 tracking-tight">
            Walloon Lake Marine Weather
          </h1>
          <p className="text-sm text-walloon-green-600 font-medium">
            Walloon Lake, Michigan
          </p>
          {lastUpdated && (
            <p className="text-xs text-gray-400">Last checked {lastUpdated}</p>
          )}
        </header>

        <div className="flex justify-center">
          <ActivityToggle value={activity} onChange={setActivity} />
        </div>

        {locsError && (
          <ErrorBanner message="Unable to load wave conditions. Check your connection and try again." />
        )}
        {locations?.some((l) => l.stale) && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 max-w-2xl mx-auto">
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

        <footer className="text-center text-xs text-gray-400 pt-4 border-t border-gray-200 space-y-1">
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
