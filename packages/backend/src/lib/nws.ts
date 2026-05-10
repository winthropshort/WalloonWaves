/**
 * NWS API client for Walloon Lake area.
 * Fetches hourly wind forecast from APX office (Gaylord, MI), grid (50, 64).
 *
 * NWS requires a User-Agent header; no API key needed.
 * Point URL resolves to the same grid for any coordinate on Walloon Lake.
 */

const NWS_POINT_URL = 'https://api.weather.gov/points/45.1050,-84.9435';
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
  shortForecast: string;
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

/** Fetch and parse all hourly forecast periods from NWS. Returns up to 156 items. */
export async function fetchHourlyForecast(): Promise<NwsPeriod[]> {
  const pointData = (await nwsGet(NWS_POINT_URL)) as { properties: { forecastHourly: string } };
  const hourlyUrl = pointData.properties.forecastHourly;

  const hourlyData = (await nwsGet(hourlyUrl)) as {
    properties: {
      periods: Array<{
        startTime: string;
        windSpeed: string;
        windGust: string | null;
        windDirection: string;
        shortForecast: string;
      }>;
    };
  };

  return hourlyData.properties.periods.map((p) => {
    const { deg, label } = parseDir(p.windDirection);
    return {
      startTime:     p.startTime,
      windSpeed_mph: parseSpeed(p.windSpeed),
      windGust_mph:  parseSpeed(p.windGust),
      windDir_deg:   deg,
      windDir_label: label,
      shortForecast: p.shortForecast,
    };
  });
}
