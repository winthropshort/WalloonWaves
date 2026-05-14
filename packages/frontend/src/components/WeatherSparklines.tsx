import {
  LineChart, Line, AreaChart, Area,
  ResponsiveContainer, ReferenceLine, XAxis, YAxis,
} from 'recharts';
import type { WeatherObservation } from '../api.js';

interface Props {
  history:       WeatherObservation[];
  hours?:        48 | 72;
  activeTime?:   number | undefined;
  onTimeSelect?: ((t: number) => void) | undefined;
}

interface RawPoint   { t: number; v: number; }
interface SplitPoint { t: number; v: number; vPast: number | null; vFuture: number | null; }

export function midnightDomain(hours: 48 | 72): [number, number] {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  return [start, start + hours * 3_600_000];
}

function closestToNow<T extends { t: number }>(items: T[]): T | undefined {
  if (!items.length) return undefined;
  const now = Date.now();
  return items.reduce((best, d) =>
    Math.abs(d.t - now) < Math.abs(best.t - now) ? d : best,
  );
}

export function mbToInHg(mb: number): number {
  return Math.round(mb * 0.02953 * 100) / 100;
}

export function skyCoverIcon(pct: number): string {
  if (pct < 13) return '☀️';
  if (pct < 26) return '🌤';
  if (pct < 51) return '⛅';
  if (pct < 88) return '🌥';
  return '☁️';
}

function timeFmt(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function buildSplit(raw: RawPoint[]): SplitPoint[] {
  if (!raw.length) return [];
  const nowMs  = Date.now();
  const nowIdx = raw.reduce(
    (best, d, i) => Math.abs(d.t - nowMs) < Math.abs(raw[best]!.t - nowMs) ? i : best,
    0,
  );
  return raw.map((d, i) => ({
    t:       d.t,
    v:       d.v,
    vPast:   i <= nowIdx ? d.v : null,
    vFuture: i >= nowIdx ? d.v : null,
  }));
}

// ─── Shared chart click handler ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleChartClick(payload: any, onTimeSelect?: (t: number) => void) {
  if (!onTimeSelect || payload?.activeLabel == null) return;
  onTimeSelect(Number(payload.activeLabel));
}

// ─── Direction arrow row ──────────────────────────────────────────────────────

function DirRow({
  data, domainStart, domainEnd, activeTime, onTimeSelect,
}: {
  data: { t: number; deg: number | null; label: string }[];
  domainStart:   number;
  domainEnd:     number;
  activeTime?:   number | undefined;
  onTimeSelect?: ((t: number) => void) | undefined;
}) {
  const nowMs   = Date.now();
  const current = closestToNow(data);

  // Only show an arrow when direction label changes from the previous
  const deduped: typeof data = [];
  let prevLabel: string | null = null;
  for (const d of data) {
    if (d.deg === null) continue;
    if (d.label !== prevLabel) {
      deduped.push(d);
      prevLabel = d.label;
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-12 shrink-0">Dir:</span>
      <span className="text-xs font-medium text-blue-400 w-16 shrink-0 tabular-nums">
        {data.length ? (current?.label ?? '—') : '—'}
      </span>
      <div
        className="flex-1 relative h-5 cursor-pointer"
        onClick={(e) => {
          if (!onTimeSelect) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const pct  = (e.clientX - rect.left) / rect.width;
          const t    = domainStart + pct * (domainEnd - domainStart);
          onTimeSelect(Math.round(t));
        }}
      >
        {deduped.map((d, i) => {
          if (d.deg === null) return null;
          const pct    = ((d.t - domainStart) / (domainEnd - domainStart)) * 100;
          if (pct < 0 || pct > 100) return null;
          const isPast = d.t <= nowMs;
          return (
            <div
              key={i}
              className="absolute top-0 h-5 w-4 flex items-center justify-center -translate-x-1/2 text-blue-400"
              style={{ left: `${pct}%`, opacity: isPast ? 0.45 : 1 }}
              title={`${d.label} (${d.deg}°) ${timeFmt(d.t)}`}
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
        {/* Active-time crosshair */}
        {activeTime !== undefined && (() => {
          const pct = ((activeTime - domainStart) / (domainEnd - domainStart)) * 100;
          return pct >= 0 && pct <= 100
            ? <div className="absolute inset-y-0 w-px bg-amber-400 pointer-events-none" style={{ left: `${pct}%` }} />
            : null;
        })()}
      </div>
    </div>
  );
}

// ─── Generic line sparkline row ───────────────────────────────────────────────

function SparkRow({
  raw, color, label, format, noDataMsg,
  domainStart, domainEnd, activeTime, onTimeSelect,
}: {
  raw:           RawPoint[];
  color:         string;
  label:         string;
  format:        (v: number) => string;
  noDataMsg?:    string | undefined;
  domainStart:   number;
  domainEnd:     number;
  activeTime?:   number | undefined;
  onTimeSelect?: ((t: number) => void) | undefined;
}) {
  if (!raw.length) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 w-12 shrink-0">{label}</span>
        <span className="text-xs text-gray-300 italic w-16 shrink-0">{noDataMsg ?? 'no data'}</span>
        <div className="flex-1 h-5" />
      </div>
    );
  }

  const data    = buildSplit(raw);
  const current = closestToNow(raw);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-12 shrink-0">{label}</span>
      <span className="text-xs font-medium tabular-nums w-16 shrink-0" style={{ color }}>
        {current !== undefined ? format(current.v) : '—'}
      </span>
      <div className="flex-1 h-5">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 1, right: 0, left: 0, bottom: 1 }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={(p: any) => handleChartClick(p, onTimeSelect)}
            style={{ cursor: onTimeSelect ? 'pointer' : undefined }}
          >
            <XAxis dataKey="t" type="number" domain={[domainStart, domainEnd]} hide height={0} />
            {/* Past segment — dashed */}
            <Line
              type="monotone"
              dataKey="vPast"
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
              legendType="none"
            />
            {/* Future segment — solid */}
            <Line
              type="monotone"
              dataKey="vFuture"
              stroke={color}
              strokeWidth={1.5}
              dot={false}
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
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Cloud coverage row (area chart) ─────────────────────────────────────────

function CloudRow({
  raw, domainStart, domainEnd, activeTime, onTimeSelect,
}: {
  raw:           RawPoint[];
  domainStart:   number;
  domainEnd:     number;
  activeTime?:   number | undefined;
  onTimeSelect?: ((t: number) => void) | undefined;
}) {
  if (!raw.length) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 w-12 shrink-0">CC:</span>
        <span className="text-xs text-gray-300 italic w-16 shrink-0">updating soon</span>
        <div className="flex-1 h-5" />
      </div>
    );
  }

  const data    = buildSplit(raw);
  const current = closestToNow(raw);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-12 shrink-0">CC:</span>
      <span className="text-xs w-16 shrink-0">
        {current !== undefined ? skyCoverIcon(current.v) : '—'}
      </span>
      <div className="flex-1 h-5">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 1, right: 0, left: 0, bottom: 1 }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={(p: any) => handleChartClick(p, onTimeSelect)}
            style={{ cursor: onTimeSelect ? 'pointer' : undefined }}
          >
            <defs>
              <linearGradient id="grad-sky-past" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#94a3b8" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#94a3b8" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="grad-sky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#94a3b8" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#94a3b8" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis dataKey="t" type="number" domain={[domainStart, domainEnd]} hide height={0} />
            <YAxis domain={[0, 100]} hide width={0} />
            {/* Past — dashed stroke + lighter fill */}
            <Area
              type="monotone"
              dataKey="vPast"
              stroke="#94a3b8"
              strokeWidth={1}
              strokeDasharray="3 3"
              fill="url(#grad-sky-past)"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
              legendType="none"
            />
            {/* Future — solid */}
            <Area
              type="monotone"
              dataKey="vFuture"
              stroke="#94a3b8"
              strokeWidth={1}
              fill="url(#grad-sky)"
              dot={false}
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
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function WeatherSparklines({
  history, hours = 48, activeTime, onTimeSelect,
}: Props) {
  if (!history.length) return null;

  const [domainStart, domainEnd] = midnightDomain(hours);

  const inDomain = history
    .filter((o) => {
      const t = new Date(o.timestamp).getTime();
      return t >= domainStart && t <= domainEnd;
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const windDirData = inDomain.map((o) => ({
    t:     new Date(o.timestamp).getTime(),
    deg:   o.windDir_deg,
    label: o.windDir_label,
  }));

  const windRaw: RawPoint[] = inDomain.map((o) => ({
    t: new Date(o.timestamp).getTime(),
    v: o.windSpeed_mph,
  }));

  const gustRaw: RawPoint[] = inDomain
    .filter((o) => o.windGust_mph > 0)
    .map((o) => ({
      t: new Date(o.timestamp).getTime(),
      v: o.windGust_mph,
    }));

  const tempRaw: RawPoint[] = inDomain
    .filter((o) => o.temperature_f !== undefined)
    .map((o) => ({ t: new Date(o.timestamp).getTime(), v: o.temperature_f! }));

  const chillRaw: RawPoint[] = inDomain
    .filter((o) => o.windChill_f !== undefined && o.windChill_f < (o.temperature_f ?? 99))
    .map((o) => ({ t: new Date(o.timestamp).getTime(), v: o.windChill_f! }));

  const pressureRaw: RawPoint[] = inDomain
    .filter((o) => o.pressure_mb !== undefined)
    .map((o) => ({ t: new Date(o.timestamp).getTime(), v: mbToInHg(o.pressure_mb!) }));

  const popRaw: RawPoint[] = inDomain
    .filter((o) => o.pop_pct !== undefined)
    .map((o) => ({ t: new Date(o.timestamp).getTime(), v: o.pop_pct! }));

  const precipRaw: RawPoint[] = inDomain
    .filter((o) => o.precip_in !== undefined)
    .map((o) => ({ t: new Date(o.timestamp).getTime(), v: o.precip_in! }));

  const skyCoverRaw: RawPoint[] = inDomain
    .filter((o) => o.skyCover_pct !== undefined)
    .map((o) => ({ t: new Date(o.timestamp).getTime(), v: o.skyCover_pct! }));

  const shared = { domainStart, domainEnd, activeTime, onTimeSelect };

  return (
    <>
      <DirRow
        data={windDirData}
        domainStart={domainStart}
        domainEnd={domainEnd}
        activeTime={activeTime}
        onTimeSelect={onTimeSelect}
      />
      <SparkRow raw={windRaw}  color="#3b82f6" label="Speed:" format={(v) => `${v.toFixed(0)} mph`} {...shared} />
      <SparkRow raw={gustRaw}  color="#93c5fd" label="Gust:"  format={(v) => `${v.toFixed(0)} mph`} {...shared} />
      <SparkRow raw={tempRaw}  color="#f97316" label="Air:"   format={(v) => `${v.toFixed(0)}°F`}  noDataMsg="updating soon" {...shared} />
      {chillRaw.length > 0 && (
        <SparkRow raw={chillRaw} color="#06b6d4" label="Chill:" format={(v) => `${v.toFixed(0)}°F`} {...shared} />
      )}
      <SparkRow raw={pressureRaw} color="#8b5cf6" label="P:"   format={(v) => `${v.toFixed(2)}"`} noDataMsg="updating soon" {...shared} />
      <SparkRow raw={popRaw}      color="#60a5fa" label="PoP:" format={(v) => `${v.toFixed(0)}%`}  noDataMsg="updating soon" {...shared} />
      <SparkRow raw={precipRaw}   color="#0ea5e9" label="Amt:" format={(v) => `${v.toFixed(2)}"`}  noDataMsg="updating soon" {...shared} />
      <CloudRow raw={skyCoverRaw} {...shared} />
    </>
  );
}
