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
    lat: 45.1050,
    lng: -84.9435,
    address: '5152 Lake Grove Road, Walloon Lake, MI',
  },
  {
    id: 'bear-cove-marina',
    name: 'Bear Cove Marina',
    lat: 45.0990,
    lng: -84.9380,
    address: 'Bear Cove Marina, Walloon Lake, MI',
  },
  {
    id: 'legacy-water-sports',
    name: 'Legacy Water Sports Marina',
    lat: 45.1020,
    lng: -84.9410,
    address: 'Legacy Water Sports Marina, Walloon Lake, MI',
  },
];
