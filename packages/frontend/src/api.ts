import type { WaveConditions, Location } from '@walloon/shared';

const BASE = import.meta.env.VITE_API_URL as string;

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const isPost = init?.method === 'POST';
  const res = await fetch(`${BASE}${path}`, {
    ...(isPost ? { headers: { 'Content-Type': 'application/json' } } : {}),
    ...init,
  });
  const json = (await res.json()) as { success: boolean; data: T; error?: string };
  if (!json.success) throw new Error(json.error ?? 'API error');
  return json.data;
}

// ─── Response shapes ──────────────────────────────────────────────────────────

export interface LocationWithWave extends Location {
  currentWave:    WaveConditions;
  weatherUpdated: string | null;
}

export interface WeatherObservation {
  timestamp:     string;
  windSpeed_mph: number;
  windGust_mph:  number;
  windDir_deg:   number | null;
  windDir_label: string;
  shortForecast: string;
}

export interface GeocodeResult {
  lat:          number;
  lng:          number;
  displayName:  string;
  withinBounds: boolean;
}

// ─── API functions ────────────────────────────────────────────────────────────

export function fetchLocations(): Promise<LocationWithWave[]> {
  return apiFetch<LocationWithWave[]>('/weather/locations');
}

export function fetchWeatherHistory(hours = 48): Promise<WeatherObservation[]> {
  return apiFetch<WeatherObservation[]>(`/weather/history?hours=${hours}`);
}

export function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  return apiFetch<GeocodeResult | null>(
    `/weather/geocode?address=${encodeURIComponent(address)}`,
  );
}

export function predictWaves(
  locationId: string,
  windSpeed_mph: number,
  windDir_deg: number | null,
): Promise<WaveConditions> {
  return apiFetch<WaveConditions>('/weather/predict', {
    method: 'POST',
    body: JSON.stringify({ locationId, windSpeed_mph, windDir_deg }),
  });
}
