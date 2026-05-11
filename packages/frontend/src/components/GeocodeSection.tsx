import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { geocodeAddress } from '../api.js';
import type { WeatherObservation } from '../api.js';
import type { WaveConditions, ActivityMode } from '@walloon/shared';
import { calcWaves } from '@walloon/shared';
import { WindCompass } from './WindCompass.js';

// Walloon Lake bounding box (~10 km padding around the lake)
const BOUNDS = { minLat: 45.24, maxLat: 45.38, minLng: -85.10, maxLng: -84.85 };

function withinBounds(lat: number, lng: number) {
  return lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat
      && lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng;
}

const PRESETS = [
  { id: 'lake-grove-road',     lat: 45.30325, lng: -85.01259, name: '5152 Lake Grove Rd'    },
  { id: 'legacy-water-sports', lat: 45.26352, lng: -84.93499, name: 'Walloon Village'        },
  { id: 'bear-cove-marina',    lat: 45.32619, lng: -85.04375, name: 'Bear Cove Marina'       },
  { id: 'jones-landing',       lat: 45.30219, lng: -84.96792, name: 'Jones Landing (N. Arm)' },
];

function nearestPreset(lat: number, lng: number) {
  return PRESETS.reduce((best, loc) => {
    const d = Math.hypot(loc.lat - lat, loc.lng - lng);
    return d < Math.hypot(best.lat - lat, best.lng - lng) ? loc : best;
  });
}

const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'] as const;
function degToLabel(deg: number) {
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16] ?? 'N';
}

const DOCK_STYLES: Record<string, { bg: string; text: string; icon: string; label: string }> = {
  'ok':           { bg: 'bg-green-50',  text: 'text-green-700',  icon: '✓', label: 'Assembly OK'  },
  'jetting-only': { bg: 'bg-yellow-50', text: 'text-yellow-700', icon: '~', label: 'Jetting Only' },
  'avoid':        { bg: 'bg-red-50',    text: 'text-red-700',    icon: '✗', label: 'Avoid'        },
};
const HT_COLORS: Record<string, string> = {
  calm: 'text-green-600', slight: 'text-yellow-600', moderate: 'text-orange-500',
  rough: 'text-red-600', 'very-rough': 'text-purple-700',
};

interface WaveResult {
  wave:         WaveConditions;
  preset:       typeof PRESETS[number];
  label:        string;        // address or "Your location"
  outOfBounds:  boolean;       // true when geocoder put it outside the lake area
}

interface Props {
  activity:   ActivityMode;
  currentObs: WeatherObservation | null;
}

export function GeocodeSection({ activity, currentObs }: Props) {
  const [address, setAddress]   = useState('');
  const [result, setResult]     = useState<WaveResult | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  function computeWave(lat: number, lng: number, label: string, outOfBounds: boolean) {
    const preset     = nearestPreset(lat, lng);
    const windSpeed  = currentObs?.windSpeed_mph ?? 0;
    const windDir    = currentObs?.windDir_deg   ?? null;
    const wave       = calcWaves(preset.id, windSpeed, windDir);
    setResult({ wave, preset, label, outOfBounds });
    setNotFound(false);
    setGeoError(null);
  }

  const geocodeMut = useMutation({
    mutationFn: (addr: string) => geocodeAddress(addr),
    onSuccess: (geo) => {
      if (!geo) {
        setNotFound(true);
        setResult(null);
        return;
      }
      // If the geocoder found an address outside the lake area, still show waves
      // for the nearest preset — just flag it as approximate.
      const oob = !withinBounds(geo.lat, geo.lng);
      computeWave(
        oob ? PRESETS[0]!.lat : geo.lat,
        oob ? PRESETS[0]!.lng : geo.lng,
        geo.displayName.split(',').slice(0, 2).join(',').trim(),
        oob,
      );
    },
    onError: () => {
      setGeoError('Geocoding failed — try a different address or use 📍.');
    },
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
      setGeoError('Geolocation is not supported by your browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        computeWave(lat, lng, 'Your location', false);
      },
      () => setGeoError('Location access denied — allow location in browser settings.'),
    );
  }

  const dock   = DOCK_STYLES[result?.wave.dockStatus ?? 'ok']!;
  const htClr  = HT_COLORS[result?.wave.conditions ?? 'calm'] ?? 'text-gray-700';

  return (
    <section className="max-w-2xl mx-auto w-full">
      <h2 className="text-sm font-semibold text-walloon-blue-700 uppercase tracking-wide mb-3">
        Check another location
      </h2>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Address, marina, or landmark near Walloon Lake…"
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

      {/* Errors and not-found feedback */}
      {notFound && (
        <p className="mt-2 text-sm text-amber-700">
          Address not found in mapping data.{' '}
          <button className="underline" onClick={handleGeolocate}>
            Use 📍 instead
          </button>{' '}
          if you're at the lake.
        </p>
      )}
      {geoError && <p className="mt-2 text-sm text-red-600">{geoError}</p>}

      {/* Result card */}
      {result && (
        <div className="mt-4 rounded-2xl bg-white border border-gray-100 shadow-sm p-5 space-y-4">

          {/* Label + approximate notice */}
          <div>
            <p className="text-sm font-medium text-walloon-blue-700 truncate">{result.label}</p>
            {result.outOfBounds && (
              <p className="text-xs text-amber-600 mt-0.5">
                Exact address not in lake mapping data — showing conditions for{' '}
                <strong>{result.preset.name}</strong> (nearest reference point).
              </p>
            )}
            {!result.outOfBounds && (
              <p className="text-xs text-gray-400 mt-0.5">
                Conditions from <strong>{result.preset.name}</strong> (nearest reference point)
              </p>
            )}
          </div>

          {/* Wave height + condition */}
          <div className="flex items-end gap-3">
            <div>
              <span className={`text-4xl font-bold tabular-nums ${htClr}`}>
                {result.wave.waveHeight_ft.toFixed(2)}
              </span>
              <span className="text-sm text-gray-400 ml-1">ft</span>
            </div>
            <span className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {result.wave.conditions.replace('-', ' ')}
            </span>
          </div>

          {/* Dock status */}
          {activity === 'dock' && (
            <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${dock.bg} ${dock.text}`}>
              {dock.icon} {dock.label}
            </div>
          )}

          {/* Wind compass */}
          <div className="flex items-center gap-4">
            <WindCompass
              windDir_deg={result.wave.windDir_deg}
              windDir_label={result.wave.windDir_deg !== null ? degToLabel(result.wave.windDir_deg) : 'VRB'}
              size={60}
            />
            <div className="text-sm text-gray-600 space-y-0.5">
              <div>
                <span className="font-medium">{result.wave.windSpeed_mph} mph</span>
                {result.wave.windDir_deg !== null && (
                  <span className="text-gray-400 ml-1">from {degToLabel(result.wave.windDir_deg)}</span>
                )}
              </div>
              <div className="text-gray-400 text-xs">
                Period {result.wave.wavePeriod_s}s · Fetch {result.wave.fetchMi} mi
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
