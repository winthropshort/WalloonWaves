import { useState, useEffect } from 'react';

const SWPC_KP_URL = 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json';

// Probability of visible aurora from Walloon Lake, MI (~45.3°N geographic / ~56°N geomagnetic).
// Derived from NOAA's KP-to-aurora-oval equatorward boundary:
//   KP 5 → oval edge ~60°N geomagnetic → visible low on northern horizon
//   KP 7 → oval edge ~55°N → overhead viewing begins
//   KP 9 → oval edge ~50°N → overhead from Walloon
const KP_PROB: [kp: number, pct: number][] = [
  [0, 1], [3, 5], [4, 12], [5, 25], [6, 45], [7, 65], [8, 82], [9, 95],
];

function kpToProbability(kp: number): number {
  const last = KP_PROB[KP_PROB.length - 1]!;
  if (kp <= KP_PROB[0]![0]) return KP_PROB[0]![1];
  if (kp >= last[0]) return last[1];
  for (let i = 0; i < KP_PROB.length - 1; i++) {
    const [k0, p0] = KP_PROB[i]!;
    const [k1, p1] = KP_PROB[i + 1]!;
    if (kp >= k0 && kp <= k1) {
      const t = (kp - k0) / (k1 - k0);
      return Math.round(p0 + t * (p1 - p0));
    }
  }
  return 1;
}

export interface AuroraInfo {
  kp:          number;
  probability: number;  // % geophysical chance, clear-sky
  updatedAt:   string;
}

export function useAurora() {
  const [data,    setData]    = useState<AuroraInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  async function load() {
    try {
      setError(false);
      const res = await fetch(SWPC_KP_URL);
      if (!res.ok) throw new Error('SWPC unavailable');
      // Each row: { time_tag, kp_index, estimated_kp, kp }
      const rows: { time_tag: string; kp_index: number; estimated_kp: number; kp: string }[] =
        await res.json();
      const recent = [...rows].reverse().find(r => r.estimated_kp != null);
      if (!recent) throw new Error('No KP data');
      const kp = recent.estimated_kp;
      setData({ kp, probability: kpToProbability(kp), updatedAt: recent.time_tag });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  return { data, loading, error };
}
