"""Parcel lines for the city-wide map view (/map, zoom 12 to 15).

Reads Utah County's current parcel polygons (layer 2, parcel number only, never owner names or
mailing addresses) for the Vineyard area and turns them into a small, prebuilt set of lines:

  1. every polygon ring becomes boundary segments on a 0.1 m grid;
  2. a segment two parcels share is kept once (each boundary segment once);
  3. segments are chained into long lines (breaking where three or more lines meet);
  4. each line is simplified (Douglas-Peucker, tolerance in meters per level);
  5. coordinates are rounded to the level's grid and delta encoded as integers.

The result carries no properties at all: geometry only. Two levels are built: "low" for zoom 12
and 13, "mid" for zoom 14 and 15. They are uploaded to the Worker (PUT /api/admin/map/parcel-lines/
<level>), which keeps them in R2 under map/ and serves GET /api/map/parcel-lines?level=low|mid.
From zoom 16 the map uses the full detail parcel tiles instead. Run weekly with `python -m ingest gis`.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import math
from datetime import date
from urllib.parse import urlencode

COUNTY_LAYER = "https://maps200.utahcounty.gov/arcgis/rest/services/Parcels/Parcel_TaxParcelPUMA/MapServer/2/query"
CITY_BOUNDARY = "https://services.arcgis.com/QdlehUncXjEmQYtI/arcgis/rest/services/Vineyard_City_Boundary/FeatureServer/0/query"
# Vineyard's city limits and a margin, [west, south, east, north], used if the boundary cannot be read.
AREA = (-111.775, 40.276, -111.731, 40.335)
# Parcels within this distance of the city limits are drawn (degrees, about 130 m).
MARGIN = 0.0015
PAGE = 2000
MAX_PAGES = 30
FORMAT = "vtp-parcel-lines/1"

# Douglas-Peucker tolerance (meters) and coordinate grid (1 / scale degrees) per level. At Vineyard's
# latitude one screen pixel is about 7.3 m at zoom 13 and 1.8 m at zoom 15, so both stay under a pixel.
LEVELS = {
    "low": {"tolerance_m": 3.0, "scale": 100_000},
    "mid": {"tolerance_m": 0.8, "scale": 1_000_000},
}

SNAP = 10_000_000  # 1e-7 degrees (about 1 cm): shared vertices from the county land on the same point
M_PER_DEG_LAT = 110_540.0


def log(msg: str) -> None:
    print(msg, flush=True)


def county_query_url(page: int, area=AREA) -> str:
    """One page of the county parcel layer inside the area: parcel number only, WGS84, 6 decimals."""
    q = {
        "geometry": ",".join(f"{v:.6f}" for v in area),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "where": "1=1",
        "outFields": "PARCEL_NO",
        "returnGeometry": "true",
        "outSR": "4326",
        "geometryPrecision": "6",
        "orderByFields": "OBJECTID",
        "resultOffset": str(page * PAGE),
        "resultRecordCount": str(PAGE),
        "f": "geojson",
    }
    return f"{COUNTY_LAYER}?{urlencode(q)}"


def fetch_area(client):
    """The city limits plus the margin (a shapely geometry), or the fixed box if the city layer fails."""
    from shapely.geometry import box, shape
    from shapely.ops import unary_union

    try:
        q = urlencode({"where": "1=1", "outFields": "NAME", "returnGeometry": "true", "outSR": "4326", "geometryPrecision": "6", "f": "geojson"})
        data = client.get_json(f"{CITY_BOUNDARY}?{q}")
        shapes = [shape(f["geometry"]) for f in data.get("features") or [] if f.get("geometry")]
        if shapes:
            return unary_union(shapes).buffer(MARGIN)
    except Exception as e:  # noqa: BLE001 - the box still covers the city
        log(f"City boundary unavailable ({e}); using the fixed box.")
    return box(*AREA)


def in_area(features: list[dict], area) -> list[dict]:
    """Parcels touching the area, each distinct shape once (stacked condominium parcels share one)."""
    from shapely.geometry import shape

    seen: set[str] = set()
    out = []
    for f in features:
        try:
            g = shape(f["geometry"])
        except Exception:  # noqa: BLE001 - a broken shape is skipped
            continue
        if g.is_empty or not g.intersects(area):
            continue
        k = json.dumps(f["geometry"]["coordinates"], separators=(",", ":"))
        if k in seen:
            continue
        seen.add(k)
        out.append({"type": "Feature", "geometry": f["geometry"], "properties": {}})
    return out


def fetch_parcels(client, area=AREA) -> list[dict]:
    """Every parcel polygon crossing the box (geometry only is used)."""
    out: list[dict] = []
    for page in range(MAX_PAGES):
        data = client.get_json(county_query_url(page, area), timeout=120)
        if not isinstance(data, dict) or data.get("error") or not isinstance(data.get("features"), list):
            raise RuntimeError(f"County parcel layer returned no features (page {page}).")
        feats = [f for f in data["features"] if isinstance(f, dict) and f.get("geometry")]
        out.extend(feats)
        more = data.get("exceededTransferLimit") or (data.get("properties") or {}).get("exceededTransferLimit")
        if len(data["features"]) < PAGE and not more:
            break
    return out


def _rings(geometry: dict):
    t = geometry.get("type") if isinstance(geometry, dict) else None
    coords = geometry.get("coordinates") if t else None
    if t == "Polygon":
        yield from coords or []
    elif t == "MultiPolygon":
        for poly in coords or []:
            yield from poly or []


def boundary_segments(features: list[dict]) -> set[tuple[tuple[int, int], tuple[int, int]]]:
    """Each boundary segment once (undirected, on the snap grid), however many parcels share it."""
    segs: set[tuple[tuple[int, int], tuple[int, int]]] = set()
    for f in features:
        for ring in _rings(f.get("geometry") or {}):
            pts = [(round(p[0] * SNAP), round(p[1] * SNAP)) for p in ring if isinstance(p, (list, tuple)) and len(p) >= 2]
            for a, b in zip(pts, pts[1:]):
                if a != b:
                    segs.add((a, b) if a < b else (b, a))
    return segs


# A line goes on through a junction when the next edge turns less than about 20 degrees.
STRAIGHT = math.cos(math.radians(20))
LNG_FACTOR = math.cos(math.radians(40.3))  # longitude degrees are this much shorter than latitude here


def chain(segs) -> list[list[tuple[int, int]]]:
    """Segments joined into lines: a line runs on through bends and across junctions it crosses straight,
    and stops at a dead end or where nothing continues it."""
    adj: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for a, b in segs:
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    for v in adj.values():
        v.sort()
    used: set[tuple[tuple[int, int], tuple[int, int]]] = set()
    key = lambda a, b: (a, b) if a < b else (b, a)  # noqa: E731
    lines: list[list[tuple[int, int]]] = []

    def straightest(prev, cur):
        """Where a line goes on through a junction: the free edge closest to straight ahead, if any."""
        free = [n for n in adj[cur] if key(cur, n) not in used]
        if len(adj[cur]) == 2:
            return free[0] if free else None
        dx, dy = (cur[0] - prev[0]) * LNG_FACTOR, cur[1] - prev[1]
        best, best_cos = None, STRAIGHT
        for n in free:
            ex, ey = (n[0] - cur[0]) * LNG_FACTOR, n[1] - cur[1]
            c = (dx * ex + dy * ey) / (math.hypot(dx, dy) * math.hypot(ex, ey) or 1)
            if c > best_cos:
                best, best_cos = n, c
        return best

    def walk(start, nxt):
        line = [start, nxt]
        used.add(key(start, nxt))
        prev, cur = start, nxt
        while cur != start:
            n = straightest(prev, cur)
            if n is None:
                break
            used.add(key(cur, n))
            line.append(n)
            prev, cur = cur, n
        return line

    for node in sorted(adj):
        if len(adj[node]) == 2:
            continue
        for n in adj[node]:
            if key(node, n) not in used:
                lines.append(walk(node, n))
    # Closed loops with no junction (a parcel touching nothing).
    for node in sorted(adj):
        for n in adj[node]:
            if key(node, n) not in used:
                lines.append(walk(node, n))
    return lines


def simplify(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Douglas-Peucker on planar points (meters). Keeps both ends."""
    if len(points) < 3:
        return list(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    tol2 = tolerance * tolerance
    while stack:
        i, j = stack.pop()
        ax, ay = points[i]
        bx, by = points[j]
        dx, dy = bx - ax, by - ay
        d2 = dx * dx + dy * dy
        best, at = -1.0, -1
        for k in range(i + 1, j):
            px, py = points[k]
            if d2 == 0:
                e = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / d2))
                e = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if e > best:
                best, at = e, k
        if at > 0 and best > tol2:
            keep[at] = True
            stack.append((i, at))
            stack.append((at, j))
    return [p for p, k in zip(points, keep) if k]


def build_level(features: list[dict], level: str, area=AREA, built: str | None = None) -> dict:
    """The line set for one level: geometry only, delta encoded integers on the level's grid."""
    cfg = LEVELS[level]
    scale = cfg["scale"]
    lat0 = (area[1] + area[3]) / 2
    mx = 111_320.0 * math.cos(math.radians(lat0))  # meters per degree of longitude here
    ox, oy = round(area[0] * scale), round(area[1] * scale)
    out: list[list[int]] = []
    for line in chain(boundary_segments(features)):
        pts = [(x / SNAP * mx, y / SNAP * M_PER_DEG_LAT) for x, y in line]
        simple = simplify(pts, cfg["tolerance_m"])
        q: list[tuple[int, int]] = []
        for x, y in simple:
            p = (round(x / mx * scale) - ox, round(y / M_PER_DEG_LAT * scale) - oy)
            if not q or q[-1] != p:
                q.append(p)
        if len(q) < 2:
            continue
        flat = [q[0][0], q[0][1]]
        for (ax, ay), (bx, by) in zip(q, q[1:]):
            flat += [bx - ax, by - ay]
        out.append(flat)
    body = {"format": FORMAT, "level": level, "scale": scale, "origin": [ox, oy], "area": list(area), "count": len(out), "lines": out}
    version = hashlib.sha256(json.dumps(body, separators=(",", ":")).encode()).hexdigest()[:16]
    return {**body, "version": version, "built": built or date.today().isoformat()}


def encode(lineset: dict) -> bytes:
    return json.dumps(lineset, separators=(",", ":")).encode()


def decode(lineset: dict) -> list[list[tuple[float, float]]]:
    """Back to [lng, lat] lines (tests and measurement)."""
    s = lineset["scale"]
    ox, oy = lineset["origin"]
    lines = []
    for flat in lineset["lines"]:
        x, y = flat[0], flat[1]
        pts = [((x + ox) / s, (y + oy) / s)]
        for i in range(2, len(flat), 2):
            x += flat[i]
            y += flat[i + 1]
            pts.append(((x + ox) / s, (y + oy) / s))
        lines.append(pts)
    return lines


def run(api, client) -> dict:
    """Weekly: fetch, build both levels, upload. Returns sizes for the job log."""
    area = fetch_area(client)
    bbox = tuple(round(v, 6) for v in area.bounds)
    feats = in_area(fetch_parcels(client, bbox), area)
    if len(feats) < 1000:
        raise RuntimeError(f"Only {len(feats)} parcels came back from the county; keeping the current line set.")
    report: dict = {"parcels": len(feats)}
    for level in LEVELS:
        ls = build_level(feats, level, bbox)
        raw = encode(ls)
        res = api.call("PUT", f"/map/parcel-lines/{level}", data=raw, headers={"Content-Type": "application/json"})
        report[level] = {"lines": ls["count"], "bytes": len(raw), "gzip": len(gzip.compress(raw, 9)), "version": ls["version"], "stored": res.get("ok", False)}
    log(f"Parcel lines: {report}")
    return report
