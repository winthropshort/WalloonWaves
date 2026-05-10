import { useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { geocodeAddress, predictWaves } from '../api.js';
import type { GeocodeResult, WeatherObservation } from '../api.js';
import type { WaveConditions, ActivityMode } from '@walloon/shared';
import { calcWaves, KNOWN_LOCATION_IDS } from '@walloon/shared';
import { WindCompass } from './WindCompass.js';

// Walloon Lake bounding box (mirrors backend)
const BOUNDS = { minLat: 45.055, maxLat: 45.165, minLng: -85.030, maxLng: -84.890 };

function withinBounds(lat: number, lng: number) {
  return lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat
      && lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng;
}

// Find nearest preset location by Haversine distance
function nearestLocationId(lat: number, lng: number): string {
  const locs = [
    { id: 'lake-grove-road',    lat: 45.1050, lng: -84.9435 },
    { id: 'legacy-water-sports', lat: 45.1020, lng: -84.9410 },
    { id: 'bear-cove-marina',   lat: 45.0990, lng: -84.9380 },
  ];
  let nearest = locs[0]!;
  let minDist = Infinity;
  for (const loc of locs) {
    const d = Math.hypot(loc.lat - lat, loc.lng - lng);
    if (d < minDist) { minDist = d; nearest = loc; }
  }
  return nearest.id;
}

interface Props {
  activity: ActivityMode;
  currentObs: WeatherObservation | null;
}

interface Result {
  geocode: GeocodeResult;
  wave:    WaveConditions;
  locId:   string;
}

const DOCK_STYLES: Record<string, { bg: string; text: string; icon: string; label: string }> = {
  'ok':           { bg: 'bg-green-50',  text: 'text-green-700',  icon: '✓', label: 'Assembly OK'  },
  'jetting-only': { bg: 'bg-yellow-50', text: 'text-yellow-700', icon: '~', label: 'Jetting Only' },
  'avoid':        { bg: 'bg-red-50',    text: 'text-red-700',    icon: '✗', label: 'Avoid'        },
};
const CONDITION_COLORS: Record<string, string> = {
  calm: 'text-green-600', slight: 'text-yellow-600', moderate: 'text-orange-500',
  rough: 'text-red-600', 'very-rough': 'text-purple-700',
};

export function GeocodeSection({ activity, currentObs }: Props) {
  const [address, setAddress]     = useState('');
  const [result, setResult]       = useState<Result | null>(null);
  const [geoError, setGeoError]   = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const geocodeMut = useMutation({
    mutationFn: async (addr: string) => {
      const geo = await geocodeAddress(addr);
      if (!geo) return null;

      const locId = nearestLocationId(geo.lat, geo.lng);
      const windSpeed = currentObs?.windSpeed_mph ?? 0;
      const windDir   = currentObs?.windDir_deg   ?? null;
      const wave = calcWaves(locId, windSpeed, windDir);
      return { geocode: geo, wave, locId } satisfies Result;
    },
    onSuccess: (data) => { setResult(data); setGeoError(null); },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (address.trim()) geocodeMut.mutate(address.trim());
  }

  function handleGeolocate() {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError('Geolocation not supported by your browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        if (!withinBounds(lat, lng)) {
          setGeoError('Your location is not on Walloon Lake.');
          setResult(null);
          return;
        }
        const locId = nearestLocationId(lat, lng);
        const windSpeed = currentObs?.windSpeed_mph ?? 0;
        const windDir   = currentObs?.windDir_deg   ?? null;
        const wave = calcWaves(locId, windSpeed, windDir);
        setResult({
          geocode: { lat, lng, displayName: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, withinBounds: true },
          wave,
          locId,
        });
        setAddress('');
      },
      () => setGeoError('Location access denied. Allow location in your browser settings.'),
    );
  }

  const dock  = DOCK_STYLES[result?.wave.dockStatus ?? 'ok']!;
  const htClr = CONDITION_COLORS[result?.wave.conditions ?? 'calm'] ?? 'text-gray-700';

  return (
    <section className="max-w-2xl mx-auto w-full">
      <h2 className="text-sm font-semibold text-walloon-blue-700 uppercase tracking-wide mb-3">
        Check another location
      </h2>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Enter an address on Walloon Lake…"
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

      {geoError && (
        <p className="mt-2 text-sm text-red-600">{geoError}</p>
      )}

      {geocodeMut.isError && (
        <p className="mt-2 text-sm text-red-600">Geocoding failed — try a different address.</p>
      )}

      {result && (
        <div className="mt-4 rounded-2xl bg-white border border-gray-100 shadow-sm p-5">
          {!result.geocode.withinBounds ? (
            <div className="text-sm text-amber-700 bg-amber-50 rounded-lg px-4 py-3">
              <strong>Not on Walloon Lake.</strong> This location ({result.geocode.displayName.slice(0, 80)})
              is outside the lake area.
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-400 mb-3 truncate">{result.geocode.displayName}</p>

              <div className="flex items-end gap-3 mb-4">
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

              {activity === 'dock' && (
                <div className={`rounded-lg px-3 py-2 text-sm font-semibold mb-4 ${dock.bg} ${dock.text}`}>
                  {dock.icon} {dock.label}
                </div>
              )}

              <div className="flex items-center gap-4">
                <WindCompass
                  windDir_deg={result.wave.windDir_deg}
                  windDir_label={result.wave.windDir_deg !== null
                    ? (['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'] as const)[
                        Math.round(((result.wave.windDir_deg % 360 + 360) % 360) / 22.5) % 16
                      ] ?? 'N'
                    : 'VRB'
                  }
                  size={60}
                />
                <div className="text-sm text-gray-600 space-y-0.5">
                  <div><span className="font-medium">{result.wave.windSpeed_mph} mph</span> wind</div>
                  <div className="text-gray-400 text-xs">
                    Period {result.wave.wavePeriod_s}s · Fetch {result.wave.fetchMi} mi
                  </div>
                  <div className="text-gray-400 text-xs">
                    Nearest: {result.locId.replace(/-/g, ' ')}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
