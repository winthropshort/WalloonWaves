interface Props {
  windDir_deg:   number | null;
  windDir_label: string;
  size?:         number;
}

export function WindCompass({ windDir_deg, windDir_label, size = 72 }: Props) {
  const cx = 50;
  const cy = 50;
  const r  = 36;

  // Arrow from rim toward center — arrowhead at the rim, tail near center
  const arrowVisible = windDir_deg !== null;
  const θ = ((windDir_deg ?? 0) * Math.PI) / 180;
  // Point on rim where wind comes FROM
  const rx = cx + r * Math.sin(θ);
  const ry = cy - r * Math.cos(θ);
  // Tail (20% from center toward rim)
  const tx = cx + (r * 0.35) * Math.sin(θ + Math.PI);
  const ty = cy - (r * 0.35) * Math.cos(θ + Math.PI);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-label={`Wind from ${windDir_label}`}
    >
      {/* Outer ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#cbd5e1" strokeWidth="1.5" />
      {/* Cardinal labels */}
      <text x="50" y="9"  textAnchor="middle" fontSize="9" fill="#64748b" fontWeight="600">N</text>
      <text x="50" y="97" textAnchor="middle" fontSize="9" fill="#64748b" fontWeight="600">S</text>
      <text x="6"  y="53" textAnchor="middle" fontSize="9" fill="#64748b" fontWeight="600">W</text>
      <text x="94" y="53" textAnchor="middle" fontSize="9" fill="#64748b" fontWeight="600">E</text>
      {/* Tick marks at 45° intervals */}
      {[45, 135, 225, 315].map((deg) => {
        const a = (deg * Math.PI) / 180;
        return (
          <line
            key={deg}
            x1={cx + (r - 4) * Math.sin(a)} y1={cy - (r - 4) * Math.cos(a)}
            x2={cx + r       * Math.sin(a)} y2={cy - r       * Math.cos(a)}
            stroke="#cbd5e1" strokeWidth="1.5"
          />
        );
      })}
      {/* Wind arrow: points FROM bearing toward center */}
      {arrowVisible && (
        <g>
          <defs>
            <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
              <polygon points="0 0, 6 2, 0 4" fill="#1B4F72" />
            </marker>
          </defs>
          <line
            x1={tx} y1={ty}
            x2={rx - (rx - cx) * 0.18}
            y2={ry - (ry - cy) * 0.18}
            stroke="#1B4F72"
            strokeWidth="2.5"
            strokeLinecap="round"
            markerEnd="url(#arrowhead)"
          />
        </g>
      )}
      {/* Center dot */}
      <circle cx={cx} cy={cy} r="3" fill="#1B4F72" opacity={arrowVisible ? 1 : 0.3} />
      {/* VRB label */}
      {!arrowVisible && (
        <text x="50" y="54" textAnchor="middle" fontSize="10" fill="#94a3b8" fontWeight="600">
          VRB
        </text>
      )}
    </svg>
  );
}
