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

function parseDurationHours(duration: string): number {
  const m = duration.match(/PT(\d+)H/);
  return m ? parseInt(m[1]!, 10) : 1;
}

export interface GridpointData {
  pressureMap: Map<string, number>;  // hPa (mb)
  skyCoverMap: Map<string, number>;  // percent 0-100
  precipMap:   Map<string, number>;  // mm
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

/**
 * Fetch pressure (atmosphericPressure), sky cover, and quantitative precipitation
 * from NWS gridpoints in a single request.
 */
export async function fetchGridpointData(): Promise<GridpointData> {
  const data = (await nwsGet(NWS_GRIDPOINT_URL)) as {
    properties: {
      atmosphericPressure?:       { uom: string; values: GridpointValues };
      skyCover?:                  { uom: string; values: GridpointValues };
      quantitativePrecipitation?: { uom: string; values: GridpointValues };
    };
  };

  const pressureMap = buildHourlyMap(data.properties.atmosphericPressure?.values ?? [], 1 / 100);  // Pa → hPa
  const skyCoverMap = buildHourlyMap(data.properties.skyCover?.values ?? [], 1);                   // already %
  const precipMap   = buildHourlyMap(data.properties.quantitativePrecipitation?.values ?? [], 1);  // mm

  return { pressureMap, skyCoverMap, precipMap };
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
