import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';
import type { WeatherObservation } from '../api.js';

interface Props {
  history: WeatherObservation[];
}

interface Point {
  t: number;
  v: number;
}

function MiniSparkline({
  data,
  color,
  label,
  unit,
  noDataLabel,
}: {
  data:         Point[];
  color:        string;
  label:        string;
  unit:         string;
  noDataLabel?: string;
}) {
  if (!data.length) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 w-16 shrink-0">{label}</span>
        <span className="text-xs text-gray-300 italic">{noDataLabel ?? 'no data'}</span>
      </div>
    );
  }
  const latest = data[data.length - 1]?.v ?? 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-16 shrink-0">{label}</span>
      <span className="text-xs font-medium tabular-nums" style={{ color }}>
        {latest.toFixed(0)}{unit}
      </span>
      <div className="flex-1 h-6">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 1, right: 0, left: 0, bottom: 1 }}>
            <Line
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]!.payload as Point;
                return (
                  <div className="rounded bg-white/90 border border-gray-200 px-1.5 py-0.5 text-xs shadow">
                    <span className="font-medium">{d.v.toFixed(0)}{unit}</span>
                    {' '}
                    <span className="text-gray-400">
                      {new Date(d.t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                    </span>
                  </div>
                );
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function WeatherSparklines({ history }: Props) {
  if (!history.length) return null;

  const sorted = [...history].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const windData: Point[] = sorted.map((o) => ({
    t: new Date(o.timestamp).getTime(),
    v: o.windSpeed_mph,
  }));

  const tempData: Point[] = sorted
    .filter((o) => o.temperature_f !== undefined)
    .map((o) => ({ t: new Date(o.timestamp).getTime(), v: o.temperature_f! }));

  const chillData: Point[] = sorted
    .filter((o) => o.windChill_f !== undefined && o.windChill_f < (o.temperature_f ?? 99))
    .map((o) => ({ t: new Date(o.timestamp).getTime(), v: o.windChill_f! }));

  return (
    <div className="space-y-1 pt-1 border-t border-gray-50">
      <MiniSparkline data={windData}  color="#3b82f6" label="Wind"     unit=" mph" />
      <MiniSparkline data={tempData}  color="#f97316" label="Air temp" unit="°F"
        noDataLabel="updating soon" />
      {chillData.length > 0 && (
        <MiniSparkline data={chillData} color="#06b6d4" label="Wind chill" unit="°F" />
      )}
    </div>
  );
}
