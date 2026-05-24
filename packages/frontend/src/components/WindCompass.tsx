interface Props {
  windDir_deg:   number | null;
  windDir_label: string;
  size?:         number;
}

export function WindCompass({ windDir_deg, windDir_label, size = 72 }: Props) {
  const cx = 50;
  const cy = 50;
  const r  = 36;

  const arrowVisible = windDir_deg !== null;
  const θ = ((windDir_deg ?? 0) * Math.PI) / 180;
  const rx = cx + r * Math.sin(θ);
  const ry = cy - r * Math.cos(θ);
  const tx = cx + (r * 0.35) * Math.sin(θ + Math.PI);
  const ty = cy - (r * 0.35) * Math.cos(θ + Math.PI);

  // All 16 compass bearings at 22.5° intervals
  const allBearings = Array.from({ length: 16 }, (_, i) => i * 22.5);
  const cardinals   = new Set([0, 90, 180, 270]);
  const ordinals    = new Set([45, 135, 225, 315]);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-label={`Wind from ${windDir_label}`}
    >
      {/* Outer ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#cbd5e1" strokeWidth="1.5" />

      {/* Tick marks for all 16 points */}
      {allBearings.map((deg) => {
        if (cardinals.has(deg)) return null;
        const a       = (deg * Math.PI) / 180;
        const isOrd   = ordinals.has(deg);
        const inner   = r - (isOrd ? 5 : 3);
        return (
          <line
            key={deg}
            x1={cx + inner * Math.sin(a)} y1={cy - inner * Math.cos(a)}
            x2={cx + r     * Math.sin(a)} y2={cy - r     * Math.cos(a)}
            stroke="#cbd5e1"
            strokeWidth={isOrd ? 1.5 : 1}
          />
        );
      })}

      {/* Cardinal labels: N S E W */}
      <text x="50" y="9"  textAnchor="middle" fontSize="13" fill="#334155" fontWeight="700">N</text>
      <text x="50" y="98" textAnchor="middle" fontSize="13" fill="#334155" fontWeight="700">S</text>
      <text x="5"  y="54" textAnchor="middle" fontSize="13" fill="#334155" fontWeight="700">W</text>
      <text x="95" y="54" textAnchor="middle" fontSize="13" fill="#334155" fontWeight="700">E</text>

      {/* Ordinal labels: NE SE SW NW */}
      {([
        { deg: 45,  label: 'NE' },
        { deg: 135, label: 'SE' },
        { deg: 225, label: 'SW' },
        { deg: 315, label: 'NW' },
      ] as const).map(({ deg, label }) => {
        const a   = (deg * Math.PI) / 180;
        const rL  = r + 12;
        return (
          <text
            key={deg}
            x={cx + rL * Math.sin(a)}
            y={cy - rL * Math.cos(a) + 3}
            textAnchor="middle"
            fontSize="9"
            fill="#64748b"
            fontWeight="600"
          >
            {label}
          </text>
        );
      })}

      {/* Wind arrow: points FROM bearing toward center */}
      {arrowVisible && (
        <g>
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#1d4ed8" className="arrowhead-polygon" />
            </marker>
          </defs>
          <style>{`.dark .arrowhead-polygon { stroke: white; stroke-width: 2; paint-order: stroke fill; }`}</style>
          {/* Shadow/halo for contrast */}
          <line
            x1={tx} y1={ty}
            x2={rx - (rx - cx) * 0.18}
            y2={ry - (ry - cy) * 0.18}
            stroke="white"
            strokeWidth="5"
            strokeLinecap="round"
            opacity="0.6"
          />
          <line
            x1={tx} y1={ty}
            x2={rx - (rx - cx) * 0.18}
            y2={ry - (ry - cy) * 0.18}
            stroke="#1d4ed8"
            strokeWidth="3.5"
            strokeLinecap="round"
            markerEnd="url(#arrowhead)"
          />
        </g>
      )}

      {/* Center dot */}
      <circle cx={cx} cy={cy} r="4" fill="#1d4ed8" opacity={arrowVisible ? 1 : 0.3} />

      {/* VRB label */}
      {!arrowVisible && (
        <text x="50" y="54" textAnchor="middle" fontSize="10" fill="#94a3b8" fontWeight="600">
          VRB
        </text>
      )}
    </svg>
  );
}
