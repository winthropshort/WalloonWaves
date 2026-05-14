import { AreaChart, Area, ResponsiveContainer, ReferenceLine, XAxis } from 'recharts';
import { calcWaves } from '@walloon/shared';
import type { WeatherObservation } from '../api.js';

interface Props {
  history:       WeatherObservation[];
  locationId:    string;
  hours?:        48 | 72;
  activeTime?:   number | undefined;
  onTimeSelect?: ((t: number) => void) | undefined;
}

interface RawPoint  { t: number; h: number; }
interface DataPoint { t: number; h: number; hPast: number | null; hFuture: number | null; }

function conditionColor(h: number): string {
  if (h < 0.5) return '#22c55e';
  if (h < 1.0) return '#eab308';
  if (h < 2.0) return '#f97316';
  if (h < 3.0) return '#ef4444';
  return '#a855f7';
}

function midnightDomain(hours: 48 | 72): [number, number] {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  return [start, start + hours * 3_600_000];
}

export function WaveSparkline({ history, locationId, hours = 48, activeTime, onTimeSelect }: Props) {
  if (!history.length) {
    return (
      <div className="h-14 flex items-center justify-center text-xs text-gray-400">
        No history yet
      </div>
    );
  }

  const [domainStart, domainEnd] = midnightDomain(hours);
  const nowMs = Date.now();

  const rawData: RawPoint[] = history
    .filter((obs) => {
      const t = new Date(obs.timestamp).getTime();
      return (obs.windDir_deg !== null || obs.windSpeed_mph === 0)
        && t >= domainStart
        && t <= domainEnd;
    })
    .map((obs) => ({
      t: new Date(obs.timestamp).getTime(),
      h: calcWaves(locationId, obs.windSpeed_mph, obs.windDir_deg).waveHeight_ft,
    }))
    .sort((a, b) => a.t - b.t);

  if (!rawData.length) {
    return <div className="h-14" />;
  }

  const nowIdx = rawData.reduce(
    (best, d, i) => Math.abs(d.t - nowMs) < Math.abs(rawData[best]!.t - nowMs) ? i : best,
    0,
  );

  const data: DataPoint[] = rawData.map((d, i) => ({
    ...d,
    hPast:   i <= nowIdx ? d.h : null,
    hFuture: i >= nowIdx ? d.h : null,
  }));

  const closest = rawData.reduce((best, d) =>
    Math.abs(d.t - nowMs) < Math.abs(best.t - nowMs) ? d : best,
  );
  const maxH  = Math.max(...rawData.map((d) => d.h), 0.5);
  const color = conditionColor(closest.h);

  return (
    <div
      className="h-14"
      style={{ WebkitTapHighlightColor: 'transparent' }}
      onTouchMove={(e) => {
        if (!onTimeSelect) return;
        const touch = e.touches[0];
        if (!touch) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct  = (touch.clientX - rect.left) / rect.width;
        const t    = domainStart + pct * (domainEnd - domainStart);
        if (pct >= 0 && pct <= 1) onTimeSelect(Math.round(t));
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 2, right: 0, left: 0, bottom: 0 }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onClick={(p: any) => {
            if (onTimeSelect && p?.activeLabel != null) onTimeSelect(Number(p.activeLabel));
          }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onMouseMove={(p: any) => {
            if (onTimeSelect && p?.activeLabel != null) onTimeSelect(Number(p.activeLabel));
          }}
          style={{ cursor: onTimeSelect ? 'pointer' : undefined }}
        >
          <defs>
            <linearGradient id={`grad-${locationId}-past`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={0.18} />
              <stop offset="95%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id={`grad-${locationId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={color} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <XAxis dataKey="t" type="number" domain={[domainStart, domainEnd]} hide height={0} />
          {maxH >= 0.75 && (
            <ReferenceLine y={0.75} stroke="#94a3b8" strokeDasharray="3 3" strokeWidth={1} />
          )}
          {maxH >= 1.5 && (
            <ReferenceLine y={1.5} stroke="#94a3b8" strokeDasharray="3 3" strokeWidth={1} />
          )}
          {/* Past — dashed + lighter fill */}
          <Area
            type="monotone"
            dataKey="hPast"
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="3 3"
            fill={`url(#grad-${locationId}-past)`}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            connectNulls={false}
            legendType="none"
          />
          {/* Future — solid */}
          <Area
            type="monotone"
            dataKey="hFuture"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#grad-${locationId})`}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            connectNulls={false}
            legendType="none"
          />
          {activeTime !== undefined && (
            <ReferenceLine
              x={activeTime}
              stroke="#f59e0b"
              strokeWidth={1.5}
              strokeDasharray="3 2"
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
