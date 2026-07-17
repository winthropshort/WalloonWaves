// Shared Open-Meteo daily-forecast/archive fetch and parsing logic. Extracted from
// 1366BoD's BuildingLink/fetch-weather.mjs and scripts/backfill-weather.sh, which had
// independently reimplemented the same URL-building and per-day parsing (wind chill,
// precip classification) for the same Chicago coordinates — the actual "triplicated
// fetch code" this package consolidates. No AWS/location-profile machinery here by
// design: storage stays wherever each consumer already keeps it (SQLite, DynamoDB).

/**
 * 1366 N. Dearborn Parkway, Chicago — used by both 1366BoD consumers of this module.
 * Corrected 2026-07-17: was 41.8879,-87.6298 (a generic downtown-Chicago/Loop point,
 * ~1.3mi south of the actual building) since this constant was introduced. Now matches
 * the building's actual Gold Coast location, same point used for the NWS forecast lookup.
 */
export const CHICAGO_DEARBORN = { lat: '41.9057433', lon: '-87.6338894' } as const;

/** Superset of daily fields either 1366BoD consumer needs; unused columns are harmless. */
export const DAILY_PARAMS = [
  'temperature_2m_max', 'temperature_2m_min', 'temperature_2m_mean',
  'apparent_temperature_max', 'apparent_temperature_min',
  'precipitation_sum', 'rain_sum', 'showers_sum', 'snowfall_sum',
  'precipitation_probability_max',
  'windspeed_10m_max', 'windgusts_10m_max', 'winddirection_10m_dominant',
  'relative_humidity_2m_max',
  'weathercode',
].join(',');

const COMPASS_POINTS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const;

/** Like @walloon/shared's degreesToCompass, but passes through a null/undefined bearing
 * (Open-Meteo's winddirection_10m_dominant can be null on a calm day) instead of throwing. */
export function degToCompassOrNull(deg: number | null | undefined): string | null {
  if (deg === null || deg === undefined) return null;
  return COMPASS_POINTS[Math.round(deg / 22.5) % 16] ?? null;
}

/** NWS wind chill formula — only meaningful for T<=50F and wind>=3mph; outside that
 * range "wind chill" isn't a defined quantity, so return null rather than a bogus number. */
export function windChillF(tempF: number | null, windMph: number | null): number | null {
  if (tempF === null || windMph === null || tempF > 50 || windMph < 3) return null;
  const v16 = Math.pow(windMph, 0.16);
  return Math.round(
    (35.74 + 0.6215 * tempF - 35.75 * v16 + 0.4275 * tempF * v16) * 10
  ) / 10;
}

export type PrecipType = 'mixed' | 'snow' | 'rain' | 'possible' | 'none';

export function classifyPrecip(
  rainIn: number, snowIn: number, probabilityPct: number | null
): PrecipType {
  const RAIN_THRESHOLD = 0.02;
  const SNOW_THRESHOLD = 0.05; // inches of snow (liquid-equiv snowfall_sum is already in inches of snow, not SWE)
  const hasRain = rainIn > RAIN_THRESHOLD;
  const hasSnow = snowIn > SNOW_THRESHOLD;
  if (hasRain && hasSnow) return 'mixed';
  if (hasSnow) return 'snow';
  if (hasRain) return 'rain';
  // A meaningful precip probability with no measurable amount forecast yet (common
  // several days out) still matters for mat pre-staging — flag it as "possible".
  if (probabilityPct !== null && probabilityPct >= 40) return 'possible';
  return 'none';
}

export interface OpenMeteoHourly {
  time: string[];
  pressure_msl: number[];
}

/** Mean of the hourly pressure_msl readings whose local-time date matches `date`. */
export function meanPressureForDate(hourly: OpenMeteoHourly | null | undefined, date: string): number | null {
  if (!hourly) return null;
  const values: number[] = [];
  for (let i = 0; i < hourly.time.length; i++) {
    if (hourly.time[i]!.slice(0, 10) === date) values.push(hourly.pressure_msl[i]!);
  }
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

export interface OpenMeteoDaily {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  temperature_2m_mean?: number[];
  apparent_temperature_max: number[];
  apparent_temperature_min: number[];
  rain_sum?: number[];
  showers_sum?: number[];
  snowfall_sum?: number[];
  precipitation_probability_max?: (number | null)[];
  windspeed_10m_max: number[];
  windgusts_10m_max?: number[];
  winddirection_10m_dominant?: (number | null)[];
  relative_humidity_2m_max?: (number | null)[];
  weathercode?: number[];
}

export interface DailyWeatherFields {
  temp_high_f: number;
  temp_low_f: number;
  feels_like_high_f: number;
  feels_like_low_f: number;
  wind_chill_f: number | null;
  wind_speed_mph: number;
  wind_gust_mph: number | null;
  wind_direction_deg: number | null;
  wind_direction_compass: string | null;
  humidity_high_pct: number | null;
  pressure_mb: number | null;
  precip_type: PrecipType;
  precip_amount_in: number;
  snowfall_in: number;
  precip_probability_pct: number | null;
  weather_code: number | null;
  source: string;
  fetched_at: string;
}

/** Parse one day (index `i`) of an Open-Meteo `daily` block into the full per-day
 * record shape used by BuildingLink's mat-placement forecasting. */
export function dailyToFields(
  daily: OpenMeteoDaily, hourly: OpenMeteoHourly | null | undefined, i: number,
  source: string, fetchedAt: string
): DailyWeatherFields {
  const tempLow = daily.temperature_2m_min[i]!;
  const windMax = daily.windspeed_10m_max[i]!;
  const rainIn = (daily.rain_sum?.[i] ?? 0) + (daily.showers_sum?.[i] ?? 0);
  const snowIn = daily.snowfall_sum?.[i] ?? 0;
  const probability = daily.precipitation_probability_max?.[i] ?? null;
  const windDirDeg = daily.winddirection_10m_dominant?.[i] ?? null;
  return {
    temp_high_f: daily.temperature_2m_max[i]!,
    temp_low_f: tempLow,
    feels_like_high_f: daily.apparent_temperature_max[i]!,
    feels_like_low_f: daily.apparent_temperature_min[i]!,
    wind_chill_f: windChillF(tempLow, windMax),
    wind_speed_mph: windMax,
    wind_gust_mph: daily.windgusts_10m_max?.[i] ?? null,
    wind_direction_deg: windDirDeg,
    wind_direction_compass: degToCompassOrNull(windDirDeg),
    humidity_high_pct: daily.relative_humidity_2m_max?.[i] ?? null,
    pressure_mb: hourly ? meanPressureForDate(hourly, daily.time[i]!) : null,
    precip_type: classifyPrecip(rainIn, snowIn, probability),
    precip_amount_in: Math.round(rainIn * 100) / 100,
    snowfall_in: Math.round(snowIn * 100) / 100,
    precip_probability_pct: probability,
    weather_code: daily.weathercode?.[i] ?? null,
    source,
    fetched_at: fetchedAt,
  };
}

export interface OpenMeteoDailyQuery {
  lat: string;
  lon: string;
  dailyParams?: string;
  hourlyParams?: string; // e.g. 'pressure_msl'
  timezone?: string; // default America/Chicago
}

const DEFAULT_TIMEZONE = 'America/Chicago';

function baseParams(q: OpenMeteoDailyQuery): string {
  const params = new URLSearchParams({
    latitude: q.lat,
    longitude: q.lon,
    daily: q.dailyParams ?? DAILY_PARAMS,
    temperature_unit: 'fahrenheit',
    windspeed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: q.timezone ?? DEFAULT_TIMEZONE,
  });
  if (q.hourlyParams) params.set('hourly', q.hourlyParams);
  return params.toString();
}

/** Forward-looking forecast URL (today + `forecastDays` - 1 more days). */
export function buildForecastUrl(q: OpenMeteoDailyQuery & { forecastDays: number }): string {
  return `https://api.open-meteo.com/v1/forecast?${baseParams(q)}&forecast_days=${q.forecastDays}`;
}

/** Historical/finalized-reanalysis archive URL for a closed date range. */
export function buildArchiveUrl(q: OpenMeteoDailyQuery & { startDate: string; endDate: string }): string {
  return `https://archive-api.open-meteo.com/v1/archive?${baseParams(q)}&start_date=${q.startDate}&end_date=${q.endDate}`;
}

export async function fetchOpenMeteoJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}
