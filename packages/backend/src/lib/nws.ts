/**
 * NWS API client for Walloon Lake area.
 * Fetches hourly wind forecast from APX office (Gaylord, MI), grid (50, 64).
 *
 * NWS requires a User-Agent header; no API key needed.
 * Point URL resolves to the same grid for any coordinate on Walloon Lake.
 */

const NWS_POINT_URL = 'https://api.weather.gov/points/45.3262,-85.0438';
const USER_AGENT    = 'WalloonWaves/1.0 (wshort@gmail.com)';

// NWS compass strings → degrees (direction wind is coming FROM)
const DIR_TO_DEG: Record<string, number> = {
  N:   0,   NNE: 22.5, NE:  45,  ENE: 67.5,
  E:   90,  ESE: 112.5, SE: 135,  SSE: 157.5,
  S:   180, SSW: 202.5, SW: 225,  WSW: 247.5,
  W:   270, WNW: 292.5, NW: 315,  NNW: 337.5,
};

export interface NwsPeriod {
  startTime:     string;   // ISO 8601 with offset, e.g. "2024-05-10T14:00:00-04:00"
  windSpeed_mph: number;
  windGust_mph:  number;
  windDir_deg:   number | null;  // null when direction is variable
  windDir_label: string;         // e.g. "NNW" or "VRB"
  temperature_f: number;
  shortForecast: string;
  pop_pct:       number | null;  // probability of precipitation 0-100
}

async function nwsGet(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`NWS HTTP ${res.status} for ${url}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Parse "12 mph" or "10 to 15 mph" → upper bound as a number. */
function parseSpeed(s: string | null | undefined): number {
  if (!s || /calm/i.test(s)) return 0;
  const nums = s.match(/\d+/g);
  if (!nums) return 0;
  return parseInt(nums[nums.length - 1]!, 10);
}

function parseDir(s: string | null | undefined): { deg: number | null; label: string } {
  if (!s || s === 'VRB') return { deg: null, label: 'VRB' };
  const upper = s.trim().toUpperCase();
  const deg = DIR_TO_DEG[upper] ?? null;
  return { deg, label: upper };
}

const NWS_GRIDPOINT_URL = 'https://api.weather.gov/gridpoints/APX/50,64';
const OPEN_METEO_URL    = 'https://api.open-meteo.com/v1/forecast?latitude=45.3262&longitude=-85.0438&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl&wind_speed_unit=mph&timezone=UTC&forecast_days=7';

const COMPASS_16 = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'] as const;
/** Convert a bearing in degrees to the nearest 16-point compass label. */
export function degToLabel(deg: number): string {
  return COMPASS_16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16] ?? 'N';
}

function parseDurationHours(duration: string): number {
  const m = duration.match(/PT(\d+)H/);
  return m ? parseInt(m[1]!, 10) : 1;
}

export interface GridpointData {
  pressureMap:  Map<string, number>;  // hPa (mb)       — Open-Meteo
  skyCoverMap:  Map<string, number>;  // percent 0-100  — NWS gridpoint
  precipMap:    Map<string, number>;  // mm             — NWS gridpoint
  windSpeedMap: Map<string, number>;  // mph            — Open-Meteo
  windGustMap:  Map<string, number>;  // mph            — Open-Meteo
  windDirMap:   Map<string, number>;  // degrees 0-360  — Open-Meteo
}

type GridpointValues = Array<{ validTime: string; value: number | null }>;

function buildHourlyMap(values: GridpointValues, scale: number): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of values) {
    if (entry.value === null) continue;
    const parts = entry.validTime.split('/');
    const timePart = parts[0];
    if (!timePart) continue;
    const durationHours = parseDurationHours(parts[1] ?? 'PT1H');
    const startMs = new Date(timePart).getTime();
    const scaled = Math.round(entry.value * scale * 10) / 10;
    for (let h = 0; h < durationHours; h++) {
      const hourKey = new Date(startMs + h * 3_600_000).toISOString().slice(0, 13);
      map.set(hourKey, scaled);
    }
  }
  return map;
}

type OpenMeteoHourly = {
  time:                string[];
  wind_speed_10m:      (number | null)[];
  wind_gusts_10m:      (number | null)[];
  wind_direction_10m:  (number | null)[];
  pressure_msl:        (number | null)[];
};

/**
 * Fetch wind (speed, gusts, direction) and pressure from Open-Meteo.
 * NWS gridpoints for APX/50,64 lack atmosphericPressure and only resolve
 * wind direction to 8-point compass; Open-Meteo provides continuous degrees.
 */
async function fetchOpenMeteoData(): Promise<{
  pressureMap:  Map<string, number>;
  windSpeedMap: Map<string, number>;
  windGustMap:  Map<string, number>;
  windDirMap:   Map<string, number>;
}> {
  const res = await fetch(OPEN_METEO_URL);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const data = (await res.json()) as { hourly: OpenMeteoHourly };
  const { time, wind_speed_10m, wind_gusts_10m, wind_direction_10m, pressure_msl } = data.hourly;

  const pressureMap  = new Map<string, number>();
  const windSpeedMap = new Map<string, number>();
  const windGustMap  = new Map<string, number>();
  const windDirMap   = new Map<string, number>();

  for (let i = 0; i < time.length; i++) {
    const key = time[i]!.slice(0, 13);
    const spd = wind_speed_10m[i], gst = wind_gusts_10m[i],
          dir = wind_direction_10m[i], prs = pressure_msl[i];
    if (spd !== null && spd !== undefined) windSpeedMap.set(key, Math.round(spd * 10) / 10);
    if (gst !== null && gst !== undefined) windGustMap.set(key,  Math.round(gst * 10) / 10);
    if (dir !== null && dir !== undefined) windDirMap.set(key,   Math.round(dir * 10) / 10);
    if (prs !== null && prs !== undefined) pressureMap.set(key,  Math.round(prs * 10) / 10);
  }
  return { pressureMap, windSpeedMap, windGustMap, windDirMap };
}

/**
 * Fetch sky cover and precip from NWS gridpoints; wind and pressure from
 * Open-Meteo (continuous-degree direction, mph units, pressure_msl in hPa).
 */
export async function fetchGridpointData(): Promise<GridpointData> {
  const [nwsData, omData] = await Promise.all([
    nwsGet(NWS_GRIDPOINT_URL) as Promise<{
      properties: {
        skyCover?:                  { uom: string; values: GridpointValues };
        quantitativePrecipitation?: { uom: string; values: GridpointValues };
      };
    }>,
    fetchOpenMeteoData().catch(() => ({
      pressureMap:  new Map<string, number>(),
      windSpeedMap: new Map<string, number>(),
      windGustMap:  new Map<string, number>(),
      windDirMap:   new Map<string, number>(),
    })),
  ]);

  const skyCoverMap = buildHourlyMap(nwsData.properties.skyCover?.values ?? [], 1);
  const precipMap   = buildHourlyMap(nwsData.properties.quantitativePrecipitation?.values ?? [], 1);

  return { skyCoverMap, precipMap, ...omData };
}

/** Fetch and parse all hourly forecast periods from NWS. Returns up to 156 items. */
export async function fetchHourlyForecast(): Promise<NwsPeriod[]> {
  const pointData = (await nwsGet(NWS_POINT_URL)) as { properties: { forecastHourly: string } };
  const hourlyUrl = pointData.properties.forecastHourly;

  const hourlyData = (await nwsGet(hourlyUrl)) as {
    properties: {
      periods: Array<{
        startTime:    string;
        windSpeed:    string;
        windGust:     string | null;
        windDirection: string;
        temperature:  number;
        temperatureUnit: string;
        shortForecast: string;
        probabilityOfPrecipitation: { unitCode: string; value: number | null };
      }>;
    };
  };

  return hourlyData.properties.periods.map((p) => {
    const { deg, label } = parseDir(p.windDirection);
    const temp_f = p.temperatureUnit === 'C'
      ? p.temperature * 9 / 5 + 32
      : p.temperature;
    return {
      startTime:     p.startTime,
      windSpeed_mph: parseSpeed(p.windSpeed),
      windGust_mph:  parseSpeed(p.windGust),
      windDir_deg:   deg,
      windDir_label: label,
      temperature_f: temp_f,
      shortForecast: p.shortForecast,
      pop_pct:       p.probabilityOfPrecipitation?.value ?? null,
    };
  });
}
