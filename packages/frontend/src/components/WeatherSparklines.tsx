import { LineChart, Line, AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { WeatherObservation } from '../api.js';

interface Props {
  history: WeatherObservation[];
  hours?:  48 | 72;
}

interface Point {
  t: number;
  v: number;
}

export function midnightDomain(hours: 48 | 72): [number, number] {
  const now = new Date();
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

function mbToInHg(mb: number): number {
  return Math.round(mb * 0.02953 * 100) / 100;
}

function skyCoverIcon(pct: number): string {
  if (pct < 13) return '☀️';
  if (pct < 26) return '🌤';
  if (pct < 51) return '⛅';
  if (pct < 88) return '🌥';
  return '☁️';
}

function timeFmt(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ─── Direction arrow row ────────────────────────────────────────────────────────

function DirRow({
  data, domainStart, domainEnd,
}: {
  data: { t: number; deg: number | null; label: string }[];
  domainStart: number;
  domainEnd:   number;
}) {
  const current = closestToNow(data);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-12 shrink-0">Dir:</span>
      <span className="text-xs font-medium text-blue-400 w-16 shrink-0 tabular-nums">
        {data.length ? (current?.label ?? '—') : <span className="text-gray-300 italic text-xs">—</span>}
      </span>
      <div className="flex-1 relative h-5">
        {data.map((d, i) => {
          if (d.deg === null) return null;
          const pct = ((d.t - domainStart) / (domainEnd - domainStart)) * 100;
          if (pct < 0 || pct > 100) return null;
          return (
            <div
              key={i}
              className="absolute top-0 h-5 w-4 flex items-center justify-center -translate-x-1/2 text-blue-400"
              style={{ left: `${pct}%` }}
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
      </div>
    </div>
  );
}

// ─── Generic line sparkline row ─────────────────────────────────────────────────

function SparkRow({
  data, color, label, format, noDataMsg, domainStart, domainEnd,
}: {
  data:        Point[];
  color:       string;
  label:       string;
  format:      (v: number) => string;
  noDataMsg?:  string;
  domainStart: number;
  domainEnd:   number;
}) {
  if (!data.length) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 w-12 shrink-0">{label}</span>
        <span className="text-xs text-gray-300 italic w-16 shrink-0">{noDataMsg ?? 'no data'}</span>
        <div className="flex-1 h-5" />
      </div>
    );
  }
  const current = closestToNow(data);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-12 shrink-0">{label}</span>
      <span className="text-xs font-medium tabular-nums w-16 shrink-0" style={{ color }}>
        {current !== undefined ? format(current.v) : '—'}
      </span>
      <div className="flex-1 h-5">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 1, right: 0, left: 0, bottom: 1 }}>
            <XAxis dataKey="t" type="number" domain={[domainStart, domainEnd]} hide height={0} />
            <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]!.payload as Point;
                return (
                  <div className="rounded bg-white/90 border border-gray-200 px-1.5 py-0.5 text-xs shadow">
                    <span className="font-medium">{format(d.v)}</span>{' '}
                    <span className="text-gray-400">{timeFmt(d.t)}</span>
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

// ─── Cloud coverage row (area chart + icon) ──────────────────────────────────────

function CloudRow({
  data, domainStart, domainEnd,
}: {
  data:        Point[];
  domainStart: number;
  domainEnd:   number;
}) {
  if (!data.length) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 w-12 shrink-0">CC:</span>
        <span className="text-xs text-gray-300 italic w-16 shrink-0">updating soon</span>
        <div className="flex-1 h-5" />
      </div>
    );
  }
  const current = closestToNow(data);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-12 shrink-0">CC:</span>
      <span className="text-xs w-16 shrink-0">
        {current !== undefined ? skyCoverIcon(current.v) : '—'}
      </span>
      <div className="flex-1 h-5">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 1, right: 0, left: 0, bottom: 1 }}>
            <defs>
              <linearGradient id="grad-sky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#94a3b8" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#94a3b8" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis dataKey="t" type="number" domain={[domainStart, domainEnd]} hide height={0} />
            <YAxis domain={[0, 100]} hide width={0} />
            <Area type="monotone" dataKey="v" stroke="#94a3b8" strokeWidth={1} fill="url(#grad-sky)" dot={false} isAnimationActive={false} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]!.payload as Point;
                return (
                  <div className="rounded bg-white/90 border border-gray-200 px-1.5 py-0.5 text-xs shadow">
                    <span className="font-medium">{skyCoverIcon(d.v)} {d.v.toFixed(0)}%</span>{' '}
                    <span className="text-gray-400">{timeFmt(d.t)}</span>
                  </div>
                );
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────────

export function WeatherSparklines({ history, hours = 48 }: Props) {
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

  const windData: Point[] = inDomain.map((o) => ({
    t: new Date(o.timestamp).getTime(),
    v: o.windSpeed_mph,
  }));

  const tempData: Point[] = inDomain
    .filter((o) => o.temperature_f !== undefined)
    .map((o) => ({ t: new Date(o.timestamp).getTime(), v: o.temperature_f! }));

  const chillData: Point[] = inDomain
    .filter((o) => o.windChill_f !== undefined && o.windChill_f < (o.temperature_f ?? 99))
    .map((o) => ({ t: new Date(o.timestamp).getTime(), v: o.windChill_f! }));

  const pressureData: Point[] = inDomain
    .filter((o) => o.pressure_mb !== undefined)
    .map((o) => ({ t: new Date(o.timestamp).getTime(), v: mbToInHg(o.pressure_mb!) }));

  const popData: Point[] = inDomain
    .filter((o) => o.pop_pct !== undefined)
    .map((o) => ({ t: new Date(o.timestamp).getTime(), v: o.pop_pct! }));

  const precipData: Point[] = inDomain
    .filter((o) => o.precip_in !== undefined)
    .map((o) => ({ t: new Date(o.timestamp).getTime(), v: o.precip_in! }));

  const skyCoverData: Point[] = inDomain
    .filter((o) => o.skyCover_pct !== undefined)
    .map((o) => ({ t: new Date(o.timestamp).getTime(), v: o.skyCover_pct! }));

  return (
    <>
      <DirRow data={windDirData} domainStart={domainStart} domainEnd={domainEnd} />
      <SparkRow
        data={windData} color="#3b82f6" label="Speed:"
        format={(v) => `${v.toFixed(0)} mph`}
        domainStart={domainStart} domainEnd={domainEnd}
      />
      <SparkRow
        data={tempData} color="#f97316" label="Air:"
        format={(v) => `${v.toFixed(0)}°F`}
        noDataMsg="updating soon"
        domainStart={domainStart} domainEnd={domainEnd}
      />
      {chillData.length > 0 && (
        <SparkRow
          data={chillData} color="#06b6d4" label="Chill:"
          format={(v) => `${v.toFixed(0)}°F`}
          domainStart={domainStart} domainEnd={domainEnd}
        />
      )}
      <SparkRow
        data={pressureData} color="#8b5cf6" label="P:"
        format={(v) => `${v.toFixed(2)}"`}
        noDataMsg="updating soon"
        domainStart={domainStart} domainEnd={domainEnd}
      />
      <SparkRow
        data={popData} color="#60a5fa" label="PoP:"
        format={(v) => `${v.toFixed(0)}%`}
        noDataMsg="updating soon"
        domainStart={domainStart} domainEnd={domainEnd}
      />
      <SparkRow
        data={precipData} color="#0ea5e9" label="Amt:"
        format={(v) => `${v.toFixed(2)}"`}
        noDataMsg="updating soon"
        domainStart={domainStart} domainEnd={domainEnd}
      />
      <CloudRow data={skyCoverData} domainStart={domainStart} domainEnd={domainEnd} />
    </>
  );
}
