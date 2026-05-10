import { AreaChart, Area, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { calcWaves } from '@walloon/shared';
import type { WeatherObservation } from '../api.js';

interface Props {
  history:    WeatherObservation[];
  locationId: string;
}

interface DataPoint {
  t:    number;   // unix ms
  h:    number;   // wave height ft
}

function conditionColor(h: number): string {
  if (h < 0.5) return '#22c55e';  // green
  if (h < 1.0) return '#eab308';  // yellow
  if (h < 2.0) return '#f97316';  // orange
  if (h < 3.0) return '#ef4444';  // red
  return '#a855f7';               // purple
}

export function WaveSparkline({ history, locationId }: Props) {
  if (!history.length) {
    return (
      <div className="h-14 flex items-center justify-center text-xs text-gray-400">
        No history yet
      </div>
    );
  }

  const data: DataPoint[] = history
    .filter((obs) => obs.windDir_deg !== null || obs.windSpeed_mph === 0)
    .map((obs) => ({
      t: new Date(obs.timestamp).getTime(),
      h: calcWaves(locationId, obs.windSpeed_mph, obs.windDir_deg).waveHeight_ft,
    }))
    .sort((a, b) => a.t - b.t);

  const maxH   = Math.max(...data.map((d) => d.h), 0.5);
  const latest = data[data.length - 1]?.h ?? 0;
  const color  = conditionColor(latest);

  return (
    <div className="h-14">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`grad-${locationId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={color} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          {/* Reference lines at condition thresholds */}
          {maxH >= 0.75 && (
            <ReferenceLine y={0.75} stroke="#94a3b8" strokeDasharray="3 3" strokeWidth={1} />
          )}
          {maxH >= 1.5 && (
            <ReferenceLine y={1.5}  stroke="#94a3b8" strokeDasharray="3 3" strokeWidth={1} />
          )}
          <Area
            type="monotone"
            dataKey="h"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#grad-${locationId})`}
            dot={false}
            isAnimationActive={false}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]!.payload as DataPoint;
              return (
                <div className="rounded bg-white/90 border border-gray-200 px-2 py-1 text-xs shadow">
                  <div className="font-medium">{(d.h).toFixed(2)} ft</div>
                  <div className="text-gray-500">
                    {new Date(d.t).toLocaleTimeString('en-US', {
                      hour: 'numeric', minute: '2-digit', hour12: true,
                    })}
                  </div>
                </div>
              );
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
