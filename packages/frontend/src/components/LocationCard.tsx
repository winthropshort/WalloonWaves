import type { ActivityMode } from '@walloon/shared';
import type { LocationWithWave, WeatherObservation } from '../api.js';
import { WindCompass } from './WindCompass.js';
import { WaveSparkline } from './WaveSparkline.js';
import { WeatherSparklines } from './WeatherSparklines.js';

interface Props {
  location:      LocationWithWave;
  activity:      ActivityMode;
  history:       WeatherObservation[];
  hours:         48 | 72;
  onHoursChange: (h: 48 | 72) => void;
}

function windowLabel(hours: 48 | 72): string {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endDate  = new Date(midnight.getTime() + hours * 3_600_000 - 60_000);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(midnight)} 00:00 – ${fmt(endDate)} 23:59`;
}

const CONDITION_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  calm:       { bg: 'bg-green-100',   text: 'text-green-800',   label: 'Calm'      },
  slight:     { bg: 'bg-yellow-100',  text: 'text-yellow-800',  label: 'Slight'    },
  moderate:   { bg: 'bg-orange-100',  text: 'text-orange-800',  label: 'Moderate'  },
  rough:      { bg: 'bg-red-100',     text: 'text-red-800',     label: 'Rough'     },
  'very-rough': { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Very Rough' },
};

const DOCK_STYLES: Record<string, { bg: string; text: string; icon: string; label: string }> = {
  'ok':           { bg: 'bg-green-50',  text: 'text-green-700',  icon: '✓', label: 'Assembly OK'  },
  'jetting-only': { bg: 'bg-yellow-50', text: 'text-yellow-700', icon: '~', label: 'Jetting Only' },
  'avoid':        { bg: 'bg-red-50',    text: 'text-red-700',    icon: '✗', label: 'Avoid'        },
};

const WAVE_HEIGHT_COLORS: Record<string, string> = {
  calm:       'text-green-600',
  slight:     'text-yellow-600',
  moderate:   'text-orange-500',
  rough:      'text-red-600',
  'very-rough': 'text-purple-700',
};

function ageLabel(isoTs: string | null): string {
  if (!isoTs) return 'no data';
  const diff = Math.floor((Date.now() - new Date(isoTs).getTime()) / 1000);
  if (diff < 90)    return `${diff}s ago`;
  if (diff < 7200)  return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}

export function LocationCard({ location, activity, history, hours, onHoursChange }: Props) {
  const wave = location.currentWave;
  const cond = CONDITION_STYLES[wave.conditions] ?? CONDITION_STYLES['calm']!;
  const dock = DOCK_STYLES[wave.dockStatus ?? 'ok']!;
  const htColor = WAVE_HEIGHT_COLORS[wave.conditions] ?? 'text-gray-700';

  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5 flex flex-col gap-4">

      {/* Header */}
      <div>
        <h2 className="font-semibold text-walloon-blue-700 text-sm leading-tight">
          {location.name}
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">{location.address}</p>
      </div>

      {/* Wave height + condition badge */}
      <div className="flex items-end gap-3">
        <div>
          <span className={`text-5xl font-bold leading-none tabular-nums ${htColor}`}>
            {wave.waveHeight_ft.toFixed(2)}
          </span>
          <span className="text-base text-gray-400 ml-1">ft</span>
        </div>
        <span className={`mb-1 rounded-full px-3 py-0.5 text-xs font-semibold uppercase tracking-wide ${cond.bg} ${cond.text}`}>
          {cond.label}
        </span>
      </div>

      {/* Dock status (dock mode) */}
      {activity === 'dock' && (
        <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${dock.bg} ${dock.text}`}>
          {dock.icon} {dock.label}
          <span className="ml-2 font-normal text-xs opacity-70">
            {wave.dockStatus === 'ok' && '< 0.75 ft — assembly safe'}
            {wave.dockStatus === 'jetting-only' && '0.75–1.5 ft — no new sections'}
            {wave.dockStatus === 'avoid' && '> 1.5 ft — whitecap risk'}
          </span>
        </div>
      )}

      {/* Wind + compass */}
      <div className="flex items-center gap-4">
        <WindCompass
          windDir_deg={wave.windDir_deg}
          windDir_label={
            wave.windDir_deg !== null
              ? (['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'] as const)[
                  Math.round(((wave.windDir_deg % 360 + 360) % 360) / 22.5) % 16
                ] ?? 'N'
              : 'VRB'
          }
          size={68}
        />
        <div className="text-sm text-gray-700 space-y-0.5">
          <div>
            <span className="font-medium">{wave.windSpeed_mph} mph</span>
            {wave.windDir_deg !== null && (
              <span className="text-gray-400 ml-1">
                from {(['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'] as const)[
                  Math.round(((wave.windDir_deg % 360 + 360) % 360) / 22.5) % 16
                ] ?? 'N'}
              </span>
            )}
            {wave.windDir_deg === null && <span className="text-gray-400 ml-1">variable</span>}
          </div>
          <div className="text-gray-400 text-xs">
            Period {wave.wavePeriod_s}s · Fetch {wave.fetchMi} mi
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
          <WaveSparkline history={history} locationId={location.id} hours={hours} />
        </div>
        <WeatherSparklines history={history} hours={hours} />
      </div>

      {/* Footer */}
      <div className="text-xs text-gray-400 pt-1 border-t border-gray-50">
        Updated {ageLabel(location.weatherUpdated)}
      </div>
    </div>
  );
}
