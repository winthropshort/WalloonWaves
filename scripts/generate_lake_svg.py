#!/usr/bin/env python3
"""Render img/walloon_lake.svg from scripts/shoreline_data.json.

All geographic data and polygon topology live in the JSON file.
This script contains no coordinates — it is a pure data→SVG converter.

To adjust the lake shape:
  - Edit shoreline_data.json (basins, polygons, presets, narrows, creeks)
  - Re-run this script
"""

import json
import math
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
data_path  = REPO_ROOT / "scripts" / "shoreline_data.json"
out_path   = REPO_ROOT / "img" / "walloon_lake.svg"
public_path = REPO_ROOT / "packages" / "frontend" / "public" / "walloon_lake.svg"
out_path.parent.mkdir(exist_ok=True)

with open(data_path) as f:
    data = json.load(f)

# --- Projection ---
# Scale longitude by cos(ref_lat) so 1 px represents equal distance E-W and N-S.
REF_LAT = 45.29
COS_LAT = math.cos(math.radians(REF_LAT))

# Bounding box from every lat/lng in the file
all_pts: list[tuple[float, float]] = []

def collect(obj: object) -> None:
    if isinstance(obj, dict):
        if "lat" in obj and "lng" in obj:
            all_pts.append((obj["lat"], obj["lng"]))
        else:
            for v in obj.values():
                collect(v)
    elif isinstance(obj, list):
        for item in obj:
            collect(item)

collect(data)

lats = [p[0] for p in all_pts]
lngs = [p[1] for p in all_pts]
PAD = 0.006   # degrees of padding around the bounding box
min_lat, max_lat = min(lats) - PAD, max(lats) + PAD
min_lng, max_lng = min(lngs) - PAD, max(lngs) + PAD

SVG_W, SVG_H, MARGIN = 820, 960, 55
usable_w = SVG_W - 2 * MARGIN
usable_h = SVG_H - 2 * MARGIN

x0, x1 = min_lng * COS_LAT, max_lng * COS_LAT
y0, y1 = min_lat, max_lat
scale = min(usable_w / (x1 - x0), usable_h / (y1 - y0))

def proj(lat: float, lng: float) -> tuple[float, float]:
    x = MARGIN + (lng * COS_LAT - x0) * scale
    y = SVG_H - MARGIN - (lat - y0) * scale   # north = up
    return round(x, 1), round(y, 1)

# --- Polygon assembly ---

def resolve_ref(ref: str) -> list[dict]:
    """Traverse a dot-separated path into data; return a list of {lat,lng} dicts."""
    node: object = data
    for key in ref.split("."):
        node = node[key]  # type: ignore[index]
    if isinstance(node, list):
        return [pt for pt in node if "lat" in pt and "lng" in pt]
    if isinstance(node, dict) and "lat" in node:
        return [node]
    return []

def build_polygon(poly_def: dict) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for seg in poly_def["segments"]:
        if "ref" in seg:
            items = resolve_ref(seg["ref"])
            if seg.get("reverse"):
                items = list(reversed(items))
        else:
            items = seg["points"]
        pts.extend(proj(pt["lat"], pt["lng"]) for pt in items)
    return pts

def fmt(pts: list[tuple[float, float]]) -> str:
    return " ".join(f"{x},{y}" for x, y in pts)

# --- SVG ---

LAKE      = "#4BA3D4"
LAKE_EDGE = "#2E7BAF"
LAND      = "#dce8c4"
DARK      = "#1a3a5c"
RED       = "#d04f2c"
GREEN     = "#3d7a3d"
SAND      = "#D4AA50"
SAND_EDGE = "#A07828"

svg: list[str] = [
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{SVG_W}" height="{SVG_H}" '
    f'viewBox="0 0 {SVG_W} {SVG_H}">',
    f'  <rect width="{SVG_W}" height="{SVG_H}" fill="{LAND}"/>',
]

# Lake polygons — all read from data["polygons"]
for poly_def in data["polygons"]:
    pts = build_polygon(poly_def)
    svg.append(
        f'  <polygon id="{poly_def["id"]}" points="{fmt(pts)}" '
        f'fill="{LAKE}" stroke="{LAKE_EDGE}" stroke-width="0.8" stroke-linejoin="round"/>'
    )

# Basin labels — position and text from polygon "label" field
LABEL_STYLE = (
    'font-family="Georgia, serif" font-size="12" font-style="italic" fill="white" '
    'stroke="rgba(0,30,60,0.45)" stroke-width="3" paint-order="stroke" text-anchor="middle"'
)
for poly_def in data["polygons"]:
    if "label" not in poly_def:
        continue
    lbl = poly_def["label"]
    x, y = proj(lbl["lat"], lbl["lng"])
    svg.append(f'  <text x="{x}" y="{y}" {LABEL_STYLE}>{lbl["text"]}</text>')

# Sandbars — submerged, non-motorized passage only
for sb in data.get("sandbars", []):
    pts = [proj(pt["lat"], pt["lng"]) for pt in sb["points"]]
    svg.append(
        f'  <polygon id="{sb["id"]}" points="{fmt(pts)}" '
        f'fill="{SAND}" stroke="{SAND_EDGE}" stroke-width="1" '
        f'stroke-linejoin="round" opacity="0.85"/>'
    )

# Narrows markers (brown diamonds)
for n in data["narrows"]:
    x, y = proj(n["lat"], n["lng"])
    svg.append(
        f'  <polygon points="{x},{y-5} {x+4},{y} {x},{y+5} {x-4},{y}" '
        f'fill="#8B5E3C" stroke="white" stroke-width="1"/>'
    )

# Fetch arrows — longest wind-driven fetch runs on the lake
FETCH_COLOR = "#C05000"

for run in data.get("fetch_runs", []):
    x1, y1 = proj(run["from"]["lat"], run["from"]["lng"])
    x2, y2 = proj(run["to"]["lat"], run["to"]["lng"])

    dx, dy = x2 - x1, y2 - y1
    length = math.sqrt(dx * dx + dy * dy)
    ux, uy = dx / length, dy / length   # unit vector along travel
    px, py = -uy, ux                    # left-hand perpendicular in SVG space

    AHEAD, AWIDE = 13, 5.5             # arrowhead reach, half-width

    # Dashed shaft (stops short of tip so arrowhead sits cleanly)
    svg.append(
        f'  <line x1="{x1:.1f}" y1="{y1:.1f}" '
        f'x2="{x2 - ux*AHEAD:.1f}" y2="{y2 - uy*AHEAD:.1f}" '
        f'stroke="{FETCH_COLOR}" stroke-width="2.5" stroke-dasharray="9,5" opacity="0.9"/>'
    )

    # Arrowhead polygon
    b1 = (x2 - ux*AHEAD + px*AWIDE, y2 - uy*AHEAD + py*AWIDE)
    b2 = (x2 - ux*AHEAD - px*AWIDE, y2 - uy*AHEAD - py*AWIDE)
    svg.append(
        f'  <polygon points="{x2:.1f},{y2:.1f} {b1[0]:.1f},{b1[1]:.1f} {b2[0]:.1f},{b2[1]:.1f}" '
        f'fill="{FETCH_COLOR}" opacity="0.9"/>'
    )

    # Origin dot at upwind shore
    svg.append(
        f'  <circle cx="{x1:.1f}" cy="{y1:.1f}" r="4" '
        f'fill="{FETCH_COLOR}" stroke="white" stroke-width="1.5" opacity="0.9"/>'
    )

    # Label along the arrow (default midpoint), offset perpendicular
    side = run.get("label_side", 1)
    frac = run.get("label_frac", 0.5)
    OFF = 28
    mx = x1 + (x2 - x1) * frac
    my = y1 + (y2 - y1) * frac
    lx_f = mx + px * side * OFF
    ly_f = my + py * side * OFF

    label = f'{run["wind_from_deg"]:03d}° {run["wind_name"]}  ·  {run["distance_mi"]:.2f} mi'
    HW, HH = 70, 8
    svg.append(
        f'  <rect x="{lx_f - HW:.1f}" y="{ly_f - HH - 1:.1f}" '
        f'width="{HW * 2}" height="{HH * 2 + 2}" rx="3" fill="white" opacity="0.88"/>'
    )
    svg.append(
        f'  <text x="{lx_f:.1f}" y="{ly_f + HH - 3:.1f}" text-anchor="middle" '
        f'font-family="Arial, sans-serif" font-size="9.5" font-weight="bold" fill="{FETCH_COLOR}">'
        f'{label}</text>'
    )

# Preset location markers — optional "labelOffset" field controls label nudge
for preset in data["presets"]:
    x, y = proj(preset["lat"], preset["lng"])
    svg.append(
        f'  <circle cx="{x}" cy="{y}" r="5.5" fill="{RED}" stroke="white" stroke-width="1.5"/>'
    )
    off = preset.get("labelOffset", {"dx": 9, "dy": 4})
    svg.append(
        f'  <text x="{x + off["dx"]}" y="{y + off["dy"]}" '
        f'font-family="Arial, sans-serif" font-size="9.5" font-weight="bold" fill="{DARK}" '
        f'stroke="rgba(220,232,196,0.75)" stroke-width="2.5" paint-order="stroke">'
        f'{preset["name"]}</text>'
    )

# Named creek markers
for creek in data["creeks"]:
    if creek["name"] == "Unknown":
        continue
    x, y = proj(creek["lat"], creek["lng"])
    svg.append(
        f'  <circle cx="{x}" cy="{y}" r="3" fill="{GREEN}" stroke="white" stroke-width="1"/>'
    )
    svg.append(
        f'  <text x="{x+6}" y="{y+3}" font-family="Arial, sans-serif" font-size="9" '
        f'fill="{GREEN}" stroke="rgba(220,232,196,0.7)" stroke-width="2" '
        f'paint-order="stroke">{creek["name"]}</text>'
    )

# Title
svg.append(
    f'  <text x="{SVG_W//2}" y="38" text-anchor="middle" '
    f'font-family="Georgia, serif" font-size="22" font-weight="bold" fill="{DARK}">'
    f'Walloon Lake</text>'
)
svg.append(
    f'  <text x="{SVG_W//2}" y="56" text-anchor="middle" '
    f'font-family="Georgia, serif" font-size="11" fill="{DARK}" opacity="0.65">'
    f'Emmet County, Michigan · WGS84</text>'
)

# North arrow
ax, ay = SVG_W - 50, SVG_H - 80
svg.append(
    f'  <polygon points="{ax},{ay} {ax-6},{ay+18} {ax},{ay+12} {ax+6},{ay+18}" fill="{DARK}"/>'
)
svg.append(
    f'  <text x="{ax}" y="{ay-6}" text-anchor="middle" font-family="Arial" '
    f'font-size="13" font-weight="bold" fill="{DARK}">N</text>'
)

# Scale bar — 1 mile
one_mile_px = (1609.34 / 111_320) * scale
bx, by = MARGIN + 5, SVG_H - 22
svg.append(
    f'  <line x1="{bx:.0f}" y1="{by}" x2="{bx+one_mile_px:.0f}" y2="{by}" '
    f'stroke="{DARK}" stroke-width="3"/>'
)
for tick_x in (bx, bx + one_mile_px):
    svg.append(
        f'  <line x1="{tick_x:.0f}" y1="{by-5}" x2="{tick_x:.0f}" y2="{by+5}" '
        f'stroke="{DARK}" stroke-width="2"/>'
    )
svg.append(
    f'  <text x="{bx + one_mile_px/2:.0f}" y="{by-8}" text-anchor="middle" '
    f'font-family="Arial" font-size="10" fill="{DARK}">1 mile</text>'
)

# Legend
lx, ly = MARGIN + 5, SVG_H - 90
svg.append(
    f'  <circle cx="{lx+4}" cy="{ly}" r="4" fill="{RED}" stroke="white" stroke-width="1"/>'
)
svg.append(
    f'  <text x="{lx+12}" y="{ly+4}" font-family="Arial" font-size="9" fill="{DARK}">'
    f'Preset location</text>'
)
svg.append(
    f'  <polygon points="{lx+4},{ly+14} {lx+8},{ly+19} {lx+4},{ly+24} {lx},{ly+19}" '
    f'fill="#8B5E3C" stroke="white" stroke-width="1"/>'
)
svg.append(
    f'  <text x="{lx+12}" y="{ly+23}" font-family="Arial" font-size="9" fill="{DARK}">'
    f'Narrows</text>'
)
# Fetch arrow legend entry
fa_y = ly + 37
svg.append(
    f'  <line x1="{lx}" y1="{fa_y}" x2="{lx+14}" y2="{fa_y}" '
    f'stroke="{FETCH_COLOR}" stroke-width="2" stroke-dasharray="5,3"/>'
)
svg.append(
    f'  <polygon points="{lx+18},{fa_y} {lx+9},{fa_y-4} {lx+9},{fa_y+4}" '
    f'fill="{FETCH_COLOR}"/>'
)
svg.append(
    f'  <text x="{lx+24}" y="{fa_y+4}" font-family="Arial" font-size="9" fill="{DARK}">'
    f'Max fetch run</text>'
)
# Sandbar legend entry
sb_y = fa_y + 16
svg.append(
    f'  <rect x="{lx}" y="{sb_y-5}" width="18" height="10" rx="2" '
    f'fill="{SAND}" stroke="{SAND_EDGE}" stroke-width="1" opacity="0.85"/>'
)
svg.append(
    f'  <text x="{lx+24}" y="{sb_y+4}" font-family="Arial" font-size="9" fill="{DARK}">'
    f'Sandbar (non-motorized only)</text>'
)

svg.append("</svg>")

svg_text = "\n".join(svg)
out_path.write_text(svg_text)
if public_path.parent.exists():
    public_path.write_text(svg_text)
    print(f"Written: {out_path}  +  {public_path}")
else:
    print(f"Written: {out_path}  (public dir not found — skipped)")
print(f"  Canvas: {SVG_W}×{SVG_H} px | scale: {scale:.0f} px/° | 1 mi ≈ {one_mile_px:.1f} px")
