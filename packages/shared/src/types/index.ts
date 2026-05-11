export type ActivityMode = 'mariner' | 'dock';

export interface WaveConditions {
  waveHeight_ft: number;
  wavePeriod_s: number;
  fetchMi: number;
  windSpeed_mph: number;
  windDir_deg: number;
  conditions: 'calm' | 'slight' | 'moderate' | 'rough' | 'very-rough';
  dockStatus?: 'ok' | 'jetting-only' | 'avoid';
}

export interface WeatherObservation {
  PK: string;
  SK: string;
  timestamp: string;
  windSpeed_mph: number;
  windGust_mph: number;
  windDir_deg: number;
  windDir_label: string;
  shortForecast: string;
  ttl: number;
}

export interface Location {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
}

export const PRESET_LOCATIONS: Location[] = [
  {
    id: 'lake-grove-road',
    name: '5152 Lake Grove Road',
    lat: 45.30325,
    lng: -85.01259,
    address: '5152 Lake Grove Road, Walloon Lake, MI',
  },
  {
    id: 'bear-cove-marina',
    name: 'Bear Cove Marina',
    lat: 45.32619,
    lng: -85.04375,
    address: 'Bear Cove Marina, Walloon Lake, MI',
  },
  {
    id: 'legacy-water-sports',
    name: 'Walloon Village',
    lat: 45.26352,
    lng: -84.93499,
    address: 'Walloon Village, Walloon Lake, MI',
  },
  {
    id: 'jones-landing',
    name: 'Jones Landing (N. Arm)',
    lat: 45.30219,
    lng: -84.96792,
    address: '5186 Jones Landing, Walloon Lake, MI',
  },
];
