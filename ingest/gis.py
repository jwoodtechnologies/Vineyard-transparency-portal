"""Vineyard City Public GIS → searchable records.

Reads the city's public ArcGIS feature services (roads, Capital Improvement Plan projects, zoning,
future land use, subdivisions, parks, schools) and writes plain-language records into the archive,
so answers can cover every road, the projects on it and the zoning around it:

  * one record per road (all segments of a named street together): class, right-of-way widths,
    address ranges, year built, every capital project on or along it, zoning and subdivisions it
    passes through
  * one record per capital project: phase, status, budget, funding, schedule, the roads it touches
  * overview records: the full road directory, the whole Capital Improvement Plan, zoning
    districts, future land use, parks and schools

Records link to the portal's own map (/map?focus=...). Run with `python -m ingest gis`.
Re-running is cheap: a record whose text did not change is left alone.
"""
from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from datetime import date
from urllib.parse import quote, urlencode

from shapely.geometry import shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

from .api import PortalApi
from .chunk import chunk_pages
from .extract import Page
from .http import PoliteClient
from .urls import key_for

BASE = "https://services.arcgis.com/QdlehUncXjEmQYtI/arcgis/rest/services/"
SOURCE_ID = "vineyard-gis"
PORTAL = "https://vineyardportal.org"

LAYERS = {
    "roads": ("VNY_PWTR_Roads/FeatureServer/1", "FULLNAME,ROADCLASS,ROW_WIDTH,YearConst,FROMLEFT,TOLEFT,FROMRIGHT,TORIGHT,CULDESAC,ALTROADNAME"),
    "projects": ("Capital_Improvement_Plan_Public_View/FeatureServer/650", "OBJECTID,Project_Name,Department,Project_Phase,Phase_Status,Location,Description,Notes,Start_Date,Finish_Date,Consultant"),
    "zoning": ("Zoning_-_Public_View/FeatureServer/8", "ZONE,District,Description,Ordinance,OrdinanceDate,ACRES"),
    "landuse": ("Vineyard_Future_Land_Use_View/FeatureServer/0", "Land_Use,Acres"),
    "subdivisions": ("VNY_PLPZ_Subdivisions_view/FeatureServer/2", "Subdivision,Development,Public_Private"),
    "parks": ("VNY_PWPR_Park/FeatureServer/7", "NAME,ACRES,TYPE,STATUS"),
    "schools": ("VNY_AD_Schools/FeatureServer/0", "Name,Address"),
}

# ~20 m in degrees at Vineyard's latitude: "on or along" a road.
NEAR = 0.0002


def log(msg: str) -> None:
    print(msg, flush=True)


# Capital projects: only the projects in the adopted fiscal 2027 budget. The city's Capital
# Improvement Plan map still lists finished, rolled-over and dropped projects from earlier years,
# so each feature must be named here, tied to its budget line(s). The same table lives in
# worker/lib/capitalPlan.ts (the map reads that one); a test fails if they differ.
# Fund keys: general, impact, rap, transport, wastewater, water, rda.
# BEGIN FY27_PLAN (generated from worker/lib/capitalPlan.ts; tests/worker-capitalplan.test.ts keeps the two in step)
FY27_PLAN = [
    {"id": 1, "gis": "1200 North Bridge", "items": [["general", "Design of the 1200 North overpass bridge", 500000]]},
    {"id": 2, "gis": "1600 N Geneva Road Intersection Widening", "items": [["impact", "1600 North Geneva Road intersection widening", 270000]]},
    {"id": 3, "gis": "300 West Striping & Design (Parking Implementation)", "items": [["transport", "Parking implementation on 300 West: restriping and design", 50000]]},
    {"id": 4, "gis": "400 North & Mill Road Traffic Signal", "items": [["rda", "400 North traffic signal: design and construction", 625000]]},
    {"id": 11, "gis": "Holdaway Fields 400 S Extension", "items": [["impact", "Holdaway Fields 400 South betterment", 500000]]},
    {"id": 12, "gis": "Install Street Lights – 170 South", "items": [["impact", "Install street lights along 170 South", 100000]]},
    {"id": 14, "gis": "Traffic Signal – 600 N & Main", "items": [["impact", "Traffic signal at 600 North and Main Street", 404000]]},
    {"id": 16, "gis": "Vineyard Connector Overpass Bridge", "items": [["rda", "Vineyard Connector promenade overpass (UDOT)", 2200000]]},
    {"id": 18, "gis": "Holdaway Road Complete Street Design & Survey", "items": [["general", "Holdaway Road bike boulevard study", 25000]]},
    {"id": 21, "gis": "Rail Consolidation", "items": [["rda", "Rail spur realignment: design and construction", 3500000]]},
    {"id": 25, "gis": "Public Works Building Expansion & Improvements", "items": [["impact", "Public Works building improvements (25%)", 300000], ["water", "Public Works building improvements", 250000], ["wastewater", "Public Works building improvements", 250000], ["rda", "Public Works building improvements", 400000]]},
    {"id": 28, "gis": "Slide Hill at Grove Park", "items": [["general", "Finish construction of Slide Hill at Grove Park", 64959]]},
    {"id": 29, "gis": "Engineering for Field (Gammon Park / Robin's Property)", "items": [["general", "Master plan design of the Robin’s property", 50000]]},
    {"id": 31, "gis": "Skate Park & Pump Track", "items": [["rap", "Skate park near Vineyard City Hall (RAP tax and UORG grant)", 1420000]]},
    {"id": 38, "gis": "Lift Station 2 Upgrade", "items": [["wastewater", "Lift Station 2 upgrade (carried over from FY25)", 600000]]},
    {"id": 39, "gis": "Storage Building - Lift Station 2", "items": [["wastewater", "Storage building at Lift Station 2", 125000]]},
    {"id": 42, "gis": "Vineyard Beach Park", "items": [["rda", "Vineyard Beach improvements: design (TRCC grant and Flagship rebate)", 3372441]]},
    {"id": 53, "gis": "Dumpster Enclosures Fencing", "items": [["general", "Dumpster enclosures", 40000]]},
    {"id": 75, "gis": "Large Shed – Roadway (1 shed)", "items": [["impact", "One large shed", 43000]]},
    {"id": 76, "gis": "Small Shed – Roadway (1 shed)", "items": [["impact", "One small shed", 20000]]},
    {"id": 77, "gis": "Concrete/Electrical for Sheds", "items": [["impact", "Concrete and electrical for two sheds", 66000]]},
    {"id": 84, "gis": "Utah Lake Shoreline Trail Amenities", "items": [["general", "Design and construct Utah Lake shoreline trail and bike station improvements", 18000]]},
    {"id": 86, "gis": "Water Shares Purchase", "items": [["water", "Water shares", 300000]]},
    {"id": 92, "gis": "Sewer System Improvements (Pipelining)", "items": [["wastewater", "Sewer system improvements", 150000]]},
    {"id": 93, "gis": "Secondary Water Master Plan", "items": [["water", "Secondary water master plan", 100000]]},
    {"id": 94, "gis": "Public Safety Master Plan and Impact Fee Study", "items": [["general", "Public safety master plan and impact fee study", 60000]]},
    {"id": 96, "gis": "Economic Development Strategic Plan", "items": [["rda", "City-wide economic development strategic plan", 35000]]},
]
# END FY27_PLAN

FUND_NAMES = {"general": "General Fund", "impact": "Impact fees", "rap": "RAP tax and grant", "transport": "Transportation", "wastewater": "Wastewater", "water": "Water", "rda": "Redevelopment Agency"}
PLAN_BY_ID = {p["id"]: p for p in FY27_PLAN}
WHERE = {"projects": "OBJECTID IN (" + ",".join(str(p["id"]) for p in FY27_PLAN) + ")"}


def budget_line(oid) -> str | None:
    """The fiscal 2027 budget behind one project, e.g. "$625,000 from the Redevelopment Agency"."""
    try:
        plan = PLAN_BY_ID.get(int(oid))
    except (TypeError, ValueError):
        return None
    if not plan:
        return None
    total = sum(i[2] for i in plan["items"])
    funds = sorted({FUND_NAMES.get(i[0], i[0]) for i in plan["items"]})
    names = "; ".join(f"{i[1]} (${i[2]:,.0f})" for i in plan["items"])
    return f"${total:,.0f} from {' and '.join(funds)}. Budget lines: {names}"


def fetch_layer(client: PoliteClient, key: str) -> list[dict]:
    path, fields = LAYERS[key]
    out: list[dict] = []
    offset = 0
    while True:
        q = urlencode({"where": WHERE.get(key, "1=1"), "outFields": fields, "returnGeometry": "true", "outSR": "4326", "geometryPrecision": "6", "f": "geojson", "resultRecordCount": "2000", "resultOffset": str(offset), "orderByFields": "OBJECTID"})
        data = client.get_json(f"{BASE}{path}/query?{q}")
        feats = [f for f in data.get("features") or [] if f.get("geometry")]
        out.extend(feats)
        if len(feats) < 2000 or not data.get("properties", {}).get("exceededTransferLimit", len(feats) == 2000):
            break
        offset += 2000
    return out


def money(v) -> str | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return f"${x:,.0f}"


def val(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s if s and s.lower() not in ("none", "null", "n/a", "<null>") else None


ROAD_CLASS = {"A": "arterial", "C": "collector", "L": "local", "M": "major collector"}


def road_class(v) -> str | None:
    s = val(v)
    if not s:
        return None
    return ROAD_CLASS.get(s.upper(), s.lower())


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:80] or "record"


DIRS = {"N", "S", "E", "W"}


def street(name: str) -> str:
    """One street across its directional segments: "W 1600 NORTH ST" and "E 1600 NORTH ST" → "1600 North St"."""
    words = re.sub(r"\s+", " ", name.strip()).split(" ")
    if len(words) > 1 and words[0].upper() in DIRS:
        words = words[1:]
    return " ".join(w.upper() if w.upper() in DIRS else w.capitalize() for w in words)


def pretty(name: str) -> str:
    return " ".join(w.upper() if w.upper() in DIRS else w.capitalize() for w in re.sub(r"\s+", " ", name.strip()).split(" "))


class Record:
    def __init__(self, key: str, title: str, doc_type: str, text: str, focus: str):
        self.key = key
        self.title = title
        self.doc_type = doc_type
        self.text = text.strip()
        self.url = f"{PORTAL}/map?focus={quote(focus)}"


def build(client: PoliteClient) -> list[Record]:
    layers = {k: fetch_layer(client, k) for k in LAYERS}
    log("GIS: " + ", ".join(f"{k} {len(v)}" for k, v in layers.items()))
    geoms = {k: [shape(f["geometry"]) for f in v] for k, v in layers.items()}
    trees = {k: STRtree(g) for k, g in geoms.items() if g}

    def near(kind: str, geom, dist: float = NEAR) -> list[int]:
        if kind not in trees:
            return []
        zone = geom.buffer(dist)
        return [int(i) for i in trees[kind].query(zone) if geoms[kind][int(i)].intersects(zone)]

    today = date.today().isoformat()
    records: list[Record] = []

    # --- Capital projects -------------------------------------------------------------------
    projects = layers["projects"]
    project_roads: dict[int, set[str]] = defaultdict(set)
    road_segments: dict[str, list[int]] = defaultdict(list)
    for i, f in enumerate(layers["roads"]):
        name = val(f["properties"].get("FULLNAME"))
        if name:
            road_segments[street(name)].append(i)
    for pi, pg in enumerate(geoms["projects"]):
        for ri in near("roads", pg):
            name = val(layers["roads"][ri]["properties"].get("FULLNAME"))
            if name:
                project_roads[pi].add(street(name))

    def project_line(p: dict) -> str:
        bits = [val(p.get("Project_Name")) or "Unnamed project"]
        phase = val(p.get("Project_Phase"))
        status = val(p.get("Phase_Status"))
        if phase:
            bits.append(f"phase: {phase}" + (f" ({status} complete)" if status else ""))
        b = budget_line(p.get("OBJECTID"))
        if b:
            bits.append(f"fiscal 2027 budget {b.split('. Budget lines')[0]}")
        return "; ".join(bits)

    for pi, f in enumerate(projects):
        p = f["properties"]
        name = val(p.get("Project_Name")) or f"Capital project {pi + 1}"
        roads = sorted(project_roads.get(pi, []))
        zones = sorted({val(layers["zoning"][z]["properties"].get("ZONE")) or "" for z in near("zoning", geoms["projects"][pi], 0)} - {""})
        lines = [
            f"{name} is a capital improvement project in Vineyard City's adopted fiscal year 2027 budget (July 2026 to June 2027), also shown in the city's public Capital Improvement Plan map.",
            f"Department: {val(p.get('Department'))}." if val(p.get("Department")) else "",
            f"Project phase: {val(p.get('Project_Phase'))}" + (f", {val(p.get('Phase_Status'))} complete." if val(p.get("Phase_Status")) else ".") if val(p.get("Project_Phase")) else "",
            f"Fiscal year 2027 budget: {budget_line(p.get('OBJECTID'))}." if budget_line(p.get("OBJECTID")) else "",
            "The budget amount is this year's line item; a project can cost more over several years. Phase and schedule come from the city's project list, which gives years only and can lag behind.",
            f"Schedule: starts {val(p.get('Start_Date'))}, finishes {val(p.get('Finish_Date'))}." if val(p.get("Start_Date")) or val(p.get("Finish_Date")) else "",
            f"Location: {val(p.get('Location'))}." if val(p.get("Location")) and val(p.get("Location")) != name else "",
            f"Description: {val(p.get('Description'))}" if val(p.get("Description")) else "",
            f"Notes: {val(p.get('Notes'))}" if val(p.get("Notes")) else "",
            f"Consultant: {val(p.get('Consultant'))}." if val(p.get("Consultant")) else "",
            f"Roads on or along this project: {', '.join(roads)}." if roads else "",
            f"Zoning where this project is located: {', '.join(zones)}." if zones else "",
            f"Source: Vineyard City Public GIS, Capital Improvement Plan layer, read {today}.",
        ]
        records.append(Record(f"gis:project:{slug(name)}:{pi}", f"Capital project: {name}", "plan", "\n".join(l for l in lines if l), f"project:{name}"))

    # --- Roads --------------------------------------------------------------------------------
    for name, idx in sorted(road_segments.items()):
        props = [layers["roads"][i]["properties"] for i in idx]
        classes = sorted({c for c in (road_class(p.get("ROADCLASS")) for p in props) if c})
        widths = sorted({int(float(p["ROW_WIDTH"])) for p in props if val(p.get("ROW_WIDTH")) and re.fullmatch(r"[\d.]+", str(p["ROW_WIDTH"]))})
        years = sorted({int(float(p["YearConst"])) for p in props if val(p.get("YearConst")) and re.fullmatch(r"[\d.]+", str(p["YearConst"])) and 1900 < float(p["YearConst"]) < 2100})
        nums = [int(float(p[k])) for p in props for k in ("FROMLEFT", "TOLEFT", "FROMRIGHT", "TORIGHT") if val(p.get(k)) and re.fullmatch(r"[\d.]+", str(p[k])) and float(p[k]) > 0]
        full = [val(p.get("FULLNAME")) for p in props if val(p.get("FULLNAME"))]
        parts = sorted({pretty(f) for f in full} - {name})
        alt = sorted({pretty(val(p.get("ALTROADNAME"))) for p in props if val(p.get("ALTROADNAME"))} - {name})
        culdesac = any(str(p.get("CULDESAC") or "").upper() in ("Y", "YES", "1", "TRUE") for p in props)
        geom = unary_union([geoms["roads"][i] for i in idx])
        on_projects = sorted({pi for pi in near("projects", geom)})
        zones = sorted({val(layers["zoning"][z]["properties"].get("ZONE")) or "" for z in near("zoning", geom)} - {""})
        subs = sorted({val(layers["subdivisions"][s]["properties"].get("Subdivision")) or "" for s in near("subdivisions", geom)} - {""})
        parks = sorted({val(layers["parks"][s]["properties"].get("NAME")) or "" for s in near("parks", geom, 0.0006)} - {""})
        schools = sorted({val(layers["schools"][s]["properties"].get("Name")) or "" for s in near("schools", geom, 0.0008)} - {""})
        length_m = sum(_length_m(geoms["roads"][i]) for i in idx)
        lines = [
            f"{name} is a street in Vineyard, Utah, in the city's public road layer ({len(idx)} mapped segment{'s' if len(idx) != 1 else ''}, about {length_m / 1609.34:.2f} miles).",
            f"Mapped as: {', '.join(parts)}." if parts else "",
            f"Also known as: {', '.join(alt)}." if alt else "",
            f"Road class: {', '.join(classes)}." if classes else "",
            f"Right-of-way width: {', '.join(str(w) for w in widths)} feet." if widths else "",
            f"Address numbers along it run from {min(nums)} to {max(nums)}." if nums else "",
            f"Year built: {', '.join(str(y) for y in years)}." if years else "",
            "Includes a cul-de-sac." if culdesac else "",
            ("Capital improvement projects on or along " + name + ": " + " | ".join(project_line(projects[pi]["properties"]) for pi in on_projects) + ".") if on_projects else f"No capital improvement project in the city's current Capital Improvement Plan map is on or along {name}.",
            f"Zoning along {name}: {', '.join(zones)}." if zones else "",
            f"Subdivisions along {name}: {', '.join(subs)}." if subs else "",
            f"Parks near {name}: {', '.join(parks)}." if parks else "",
            f"Schools near {name}: {', '.join(schools)}." if schools else "",
            f"Source: Vineyard City Public GIS, roads layer, read {today}.",
        ]
        records.append(Record(f"gis:road:{slug(name)}", f"Road: {name}", "map", "\n".join(l for l in lines if l), f"road:{name}"))

    # --- Overviews ----------------------------------------------------------------------------
    by_class: dict[str, list[str]] = defaultdict(list)
    for name, idx in road_segments.items():
        c = next((road_class(layers["roads"][i]["properties"].get("ROADCLASS")) for i in idx if road_class(layers["roads"][i]["properties"].get("ROADCLASS"))), None) or "unclassified"
        by_class[c].append(name)
    lines = [f"Vineyard, Utah has {len(road_segments)} named streets in the city's public road layer."]
    for c in sorted(by_class):
        lines.append(f"{c.capitalize()} roads ({len(by_class[c])}): {', '.join(sorted(by_class[c]))}.")
    lines.append(f"Source: Vineyard City Public GIS, roads layer, read {today}.")
    records.append(Record("gis:overview:roads", "Vineyard road directory: every street in the city", "map", "\n".join(lines), "layer:roads"))

    total = sum(sum(i[2] for i in PLAN_BY_ID[int(f["properties"]["OBJECTID"])]["items"]) for f in projects if f["properties"].get("OBJECTID") in PLAN_BY_ID)
    by_phase: dict[str, list[str]] = defaultdict(list)
    for f in projects:
        by_phase[val(f["properties"].get("Project_Phase")) or "Unspecified"].append(project_line(f["properties"]))
    lines = [f"Vineyard City's adopted fiscal year 2027 budget (July 2026 to June 2027) funds {len(projects)} projects that also appear on the city's public Capital Improvement Plan map, with {money(total)} budgeted this year for them. Other capital projects in the budget have no mapped location; the portal's Budget page lists all of them. The city's older Capital Improvement Plan map still holds projects from earlier years (such as Fire Station 35, a water tank and booster station, and Orem wastewater plant upgrades) that are finished, rolled over or not funded in fiscal 2027, and a new City Hall is not planned; none of those are current projects."]
    for ph in sorted(by_phase):
        lines.append(f"{ph} ({len(by_phase[ph])}): " + " | ".join(sorted(by_phase[ph])) + ".")
    lines.append(f"Source: adopted FY 27 budget slides and Vineyard City Public GIS, Capital Improvement Plan layer, read {today}.")
    records.append(Record("gis:overview:projects", "Vineyard capital projects in the fiscal year 2027 budget", "plan", "\n".join(lines), "layer:projects"))

    zmap: dict[str, dict] = {}
    for f in layers["zoning"]:
        p = f["properties"]
        z = val(p.get("ZONE")) or "Unzoned"
        e = zmap.setdefault(z, {"acres": 0.0, "district": val(p.get("District")), "desc": val(p.get("Description")), "ords": set()})
        e["acres"] += float(p.get("ACRES") or 0)
        if val(p.get("Ordinance")):
            e["ords"].add(val(p.get("Ordinance")))
    lines = [f"Vineyard's public zoning map has {len(zmap)} zoning designations."]
    for z, e in sorted(zmap.items()):
        lines.append(f"{z}" + (f" ({e['district']})" if e["district"] and e["district"] != z else "") + f": about {e['acres']:,.0f} acres" + (f"; {e['desc']}" if e["desc"] else "") + (f"; ordinance {', '.join(sorted(e['ords']))}" if e["ords"] else "") + ".")
    lines.append(f"Source: Vineyard City Public GIS, zoning layer, read {today}.")
    records.append(Record("gis:overview:zoning", "Vineyard zoning districts", "map", "\n".join(lines), "layer:zoning"))

    lu: dict[str, float] = defaultdict(float)
    for f in layers["landuse"]:
        lu[val(f["properties"].get("Land_Use")) or "Unspecified"] += float(f["properties"].get("Acres") or 0)
    lines = ["Vineyard's Future Land Use map (general plan) designates land as follows."] + [f"{k}: about {v:,.0f} acres." for k, v in sorted(lu.items())] + [f"Source: Vineyard City Public GIS, future land use layer, read {today}."]
    records.append(Record("gis:overview:landuse", "Vineyard future land use map", "plan", "\n".join(lines), "layer:landuse"))

    lines = ["Parks in Vineyard, Utah (city park layer):"]
    for f in layers["parks"]:
        p = f["properties"]
        lines.append(f"{val(p.get('NAME')) or 'Park'}" + (f", {float(p['ACRES']):.1f} acres" if val(p.get("ACRES")) else "") + (f", {val(p.get('TYPE'))}" if val(p.get("TYPE")) else "") + (f", status {val(p.get('STATUS'))}" if val(p.get("STATUS")) else "") + ".")
    lines.append("Schools in Vineyard: " + "; ".join(f"{val(f['properties'].get('Name'))} ({val(f['properties'].get('Address')) or 'address not listed'})" for f in layers["schools"]) + ".")
    lines.append(f"Source: Vineyard City Public GIS, parks and schools layers, read {today}.")
    records.append(Record("gis:overview:places", "Vineyard parks and schools", "map", "\n".join(lines), "layer:parks"))
    return records


def _length_m(geom) -> float:
    # Equirectangular approximation, plenty for street lengths at 40°N.
    import math

    total = 0.0
    lines = getattr(geom, "geoms", [geom])
    for ln in lines:
        c = list(getattr(ln, "coords", []))
        for (x1, y1), (x2, y2) in zip(c, c[1:]):
            dx = (x2 - x1) * math.cos(math.radians((y1 + y2) / 2)) * 111320
            dy = (y2 - y1) * 110540
            total += math.hypot(dx, dy)
    return total


def run(api: PortalApi, client: PoliteClient) -> dict:
    records = build(client)
    counts = {"records": len(records), "new_or_changed": 0, "unchanged": 0}
    kept_projects: list[str] = []
    for r in records:
        sha = hashlib.sha256(r.text.encode()).hexdigest()
        res = api.post(
            "/documents",
            {
                "document": {
                    "title": r.title[:300],
                    "documentType": r.doc_type,
                    # Current map data, not an event: no record date (the text says "read <date>").
                    "documentDate": None,
                    "year": None,
                    "currency": "current",
                    "governmentBodyName": "Vineyard City",
                    "mimeType": "text/plain",
                    "fileName": f"{slug(r.title)}.txt",
                    "fileSize": len(r.text.encode()),
                    "pageCount": None,
                    "sha256": sha,
                    "textStatus": "extracted",
                    "ocrStatus": "not_required",
                    "archiveStatus": "not_archived",
                },
                "source": {"canonicalKey": key_for(r.key), "sourceId": SOURCE_ID, "url": r.url, "parentUrl": "https://experience.arcgis.com/experience/5d675261cad649ffb85deee52dcbe1cb", "linkText": r.title, "retrievedAt": date.today().isoformat() + "T00:00:00Z", "httpStatus": 200},
                "relationships": [],
            },
        )
        if r.key.startswith("gis:project:") and res.get("documentId"):
            kept_projects.append(res["documentId"])
        if res.get("needsChunks"):
            chunks = chunk_pages([Page(number=None, text=r.text)])
            api.post(f"/documents/{res['documentId']}/chunks", {"chunks": [{"id": f"{res['documentId']}:c{c.index:05d}", "pageStart": None, "pageEnd": None, "sectionTitle": r.title[:200], "text": c.text, "ocr": False} for c in chunks], "append": False, "offset": 0})
            counts["new_or_changed"] += 1
        else:
            counts["unchanged"] += 1
    # Project records from earlier runs that are no longer in the budget (the old list was far larger).
    if len(kept_projects) >= 10:
        try:
            counts["pruned"] = api.post("/gis/prune", {"keep": kept_projects, "titlePrefix": "Capital project:"}).get("removed", 0)
        except Exception as e:  # never fail the run over cleanup; the next run tries again
            log(f"GIS prune skipped: {e}")
    log(f"GIS records: {counts}")
    return counts
