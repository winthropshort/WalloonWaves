import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, ReferenceLine } from 'recharts';
import type { WeatherObservation } from '../api.js';

interface Props {
  history: WeatherObservation[];
  hours?:  48 | 72;
}

interface Point {
  t: number;
  v: number;
}

function midnightDomain(hours: 48 | 72): [number, number] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  return [start, start + hours * 3_600_000];
}

function WindDirectionRow({
  data,
  domainStart,
  domainEnd,
}: {
  data: { t: number; deg: number | null; label: string }[];
  domainStart: number;
  domainEnd:   number;
}) {
  const nowMs  = Date.now();
  const nowPct = Math.max(0, Math.min(100,
    ((nowMs - domainStart) / (domainEnd - domainStart)) * 100,
  ));
  const latest = data.filter((d) => d.t <= nowMs).at(-1);

  if (!data.length) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 w-16 shrink-0">Wind dir</span>
        <span className="text-xs text-gray-300 italic">no data</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-16 shrink-0">Wind dir</span>
      <span className="text-xs font-medium text-blue-400 tabular-nums">
        {latest?.label ?? '—'}
      </span>
      <div className="flex-1 relative h-6">
        {/* Now marker */}
        <div
          className="absolute inset-y-0 w-px bg-gray-300 pointer-events-none z-10"
          style={{ left: `${nowPct}%` }}
        />
        {/* Direction arrows — rotate(deg) points arrow toward wind's origin (FROM direction) */}
        {data.map((d, i) => {
          if (d.deg === null) return null;
          const pct = ((d.t - domainStart) / (domainEnd - domainStart)) * 100;
          if (pct < 0 || pct > 100) return null;
          return (
            <div
              key={i}
              className="absolute top-0 h-6 w-4 flex items-center justify-center -translate-x-1/2 text-blue-400"
              style={{ left: `${pct}%` }}
              title={`${d.label} (${d.deg}°)`}
            >
              <span
                className="text-xs leading-none select-none"
                style={{ display: 'inline-block', transform: `rotate(${d.deg}deg)` }}
              >
                ↑
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniSparkline({
  data,
  color,
  label,
  unit,
  noDataLabel,
  domainStart,
  domainEnd,
}: {
  data:         Point[];
  color:        string;
  label:        string;
  unit:         string;
  noDataLabel?: string;
  domainStart:  number;
  domainEnd:    number;
}) {
  if (!data.length) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 w-16 shrink-0">{label}</span>
        <span className="text-xs text-gray-300 italic">{noDataLabel ?? 'no data'}</span>
      </div>
    );
  }
  const nowMs  = Date.now();
  const latest = data.filter((d) => d.t <= nowMs).at(-1) ?? data[data.length - 1]!;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-16 shrink-0">{label}</span>
      <span className="text-xs font-medium tabular-nums" style={{ color }}>
        {latest.v.toFixed(0)}{unit}
      </span>
      <div className="flex-1 h-6">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 1, right: 0, left: 0, bottom: 1 }}>
            <XAxis
              dataKey="t"
              type="number"
              domain={[domainStart, domainEnd]}
              hide
            />
            <ReferenceLine x={nowMs} stroke="#e5e7eb" strokeWidth={1} />
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

export function WeatherSparklines({ history, hours = 48 }: Props) {
  if (!history.length) return null;

  const [domainStart, domainEnd] = midnightDomain(hours);
  const sorted = [...history].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const windDirData = sorted.map((o) => ({
    t:     new Date(o.timestamp).getTime(),
    deg:   o.windDir_deg,
    label: o.windDir_label,
  }));

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

  const pressureData: Point[] = sorted
    .filter((o) => o.pressure_mb !== undefined)
    .map((o) => ({ t: new Date(o.timestamp).getTime(), v: o.pressure_mb! }));

  return (
    <div className="space-y-1 pt-1 border-t border-gray-50">
      <WindDirectionRow data={windDirData} domainStart={domainStart} domainEnd={domainEnd} />
      <MiniSparkline data={windData}     color="#3b82f6" label="Wind"       unit=" mph" domainStart={domainStart} domainEnd={domainEnd} />
      <MiniSparkline data={tempData}     color="#f97316" label="Air temp"   unit="°F"   noDataLabel="updating soon" domainStart={domainStart} domainEnd={domainEnd} />
      {chillData.length > 0 && (
        <MiniSparkline data={chillData}  color="#06b6d4" label="Wind chill" unit="°F"   domainStart={domainStart} domainEnd={domainEnd} />
      )}
      <MiniSparkline data={pressureData} color="#8b5cf6" label="Pressure"   unit=" mb"  noDataLabel="updating soon" domainStart={domainStart} domainEnd={domainEnd} />
    </div>
  );
}
