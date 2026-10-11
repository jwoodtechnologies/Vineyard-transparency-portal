"""Parcel line set for the city-wide map: python -m unittest ingest.tests.test_parcel_lines"""
import json
import math
import unittest

from shapely.geometry import box

from ingest import parcel_lines as pl


def square(x, y, d=0.001, props=None):
    return {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]]}, "properties": props or {}}


def length(lines):
    return sum(math.dist(a, b) for line in lines for a, b in zip(line, line[1:]))


class EdgeDedupe(unittest.TestCase):
    def test_shared_edge_is_kept_once(self):
        a = square(-111.75, 40.30)
        b = square(-111.749, 40.30)  # shares a's east edge
        self.assertEqual(len(pl.boundary_segments([a])), 4)
        self.assertEqual(len(pl.boundary_segments([a, b])), 7)

    def test_chains_cover_every_segment_once(self):
        feats = [square(-111.75 + i * 0.001, 40.30) for i in range(3)]
        segs = pl.boundary_segments(feats)
        lines = pl.chain(segs)
        walked = {tuple(sorted(p)) for line in lines for p in zip(line, line[1:])}
        self.assertEqual(walked, {tuple(sorted(s)) for s in segs})
        self.assertEqual(sum(len(line) - 1 for line in lines), len(segs))

    def test_a_lone_parcel_is_one_closed_line(self):
        lines = pl.chain(pl.boundary_segments([square(-111.75, 40.30)]))
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0][0], lines[0][-1])


class Simplify(unittest.TestCase):
    def test_drops_points_within_tolerance_and_keeps_ends(self):
        pts = [(0.0, 0.0), (10.0, 0.4), (20.0, -0.3), (30.0, 0.0), (30.0, 20.0)]
        self.assertEqual(pl.simplify(pts, 1.0), [(0.0, 0.0), (30.0, 0.0), (30.0, 20.0)])
        self.assertEqual(pl.simplify(pts, 0.1), pts)

    def test_levels_simplify_a_wiggly_edge(self):
        ring = [[-111.75 + i * 0.00001, 40.30 + (0.000003 if i % 2 else 0)] for i in range(101)]
        ring += [[-111.749, 40.301], [-111.75, 40.301], ring[0]]
        f = {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": {}}
        low = pl.build_level([f], "low", (-111.76, 40.29, -111.74, 40.31))
        mid = pl.build_level([f], "mid", (-111.76, 40.29, -111.74, 40.31))
        n = lambda ls: sum(len(x) // 2 for x in ls["lines"])  # noqa: E731
        self.assertLessEqual(n(low), 6)
        self.assertLessEqual(n(low), n(mid))
        self.assertLess(n(mid), 104)


class LineSet(unittest.TestCase):
    AREA = (-111.76, 40.29, -111.74, 40.31)

    def test_geometry_only_no_parcel_data(self):
        feats = [square(-111.75, 40.30, props={"PARCEL_NO": "123", "OWNER_NAME": "PRIVATE PERSON"}), square(-111.749, 40.30, props={"PARCEL_NO": "124"})]
        ls = pl.build_level(feats, "low", self.AREA, built="2026-10-12")
        self.assertEqual(set(ls), {"format", "level", "scale", "origin", "area", "count", "lines", "version", "built"})
        raw = pl.encode(ls).decode()
        for word in ("PARCEL", "OWNER", "PRIVATE", "123", "properties"):
            self.assertNotIn(word, raw)
        self.assertTrue(all(isinstance(v, int) for line in ls["lines"] for v in line))
        self.assertEqual(ls["count"], len(ls["lines"]))
        self.assertRegex(ls["version"], r"^[0-9a-f]{16}$")

    def test_decodes_back_to_the_outlines(self):
        feats = [square(-111.75, 40.30), square(-111.749, 40.30)]
        for level in pl.LEVELS:
            lines = pl.decode(pl.build_level(feats, level, self.AREA))
            # Seven unique edges of 0.001 degrees each.
            self.assertAlmostEqual(length(lines), 0.007, places=6)
            for line in lines:
                for x, y in line:
                    self.assertTrue(-111.7501 <= x <= -111.7479 and 40.2999 <= y <= 40.3011)

    def test_same_input_same_version(self):
        feats = [square(-111.75, 40.30)]
        a = pl.build_level(feats, "mid", self.AREA, built="2026-01-01")
        b = pl.build_level(feats, "mid", self.AREA, built="2026-02-01")
        self.assertEqual(a["version"], b["version"])
        self.assertNotEqual(a["version"], pl.build_level(feats, "low", self.AREA)["version"])

    def test_area_keeps_touching_parcels_once_and_strips_fields(self):
        inside = square(-111.75, 40.30, props={"PARCEL_NO": "1", "OWNER_NAME": "X"})
        twin = square(-111.75, 40.30, props={"PARCEL_NO": "2"})  # stacked condominium unit
        far = square(-111.60, 40.30)
        out = pl.in_area([inside, twin, far], box(*self.AREA))
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["properties"], {})

    def test_county_query_names_only_the_parcel_number(self):
        from urllib.parse import parse_qs, urlsplit

        q = parse_qs(urlsplit(pl.county_query_url(2, self.AREA)).query)
        self.assertEqual(q["outFields"], ["PARCEL_NO"])
        self.assertEqual(q["resultOffset"], ["4000"])
        self.assertTrue(pl.county_query_url(0).startswith("https://maps200.utahcounty.gov/arcgis/rest/services/Parcels/Parcel_TaxParcelPUMA/MapServer/2/query?"))


class Run(unittest.TestCase):
    def test_builds_and_uploads_both_levels(self):
        grid = [square(-111.76 + i * 0.0004, 40.29 + j * 0.0004, 0.0004, {"PARCEL_NO": f"{i}-{j}", "OWNER_NAME": "SECRET"}) for i in range(40) for j in range(40)]
        boundary = {"type": "FeatureCollection", "features": [square(-111.76, 40.29, 0.016)]}

        class Client:
            def get_json(self, url, timeout=60):
                if "Vineyard_City_Boundary" in url:
                    return boundary
                page = int(dict(p.split("=") for p in url.split("?")[1].split("&"))["resultOffset"]) // pl.PAGE
                return {"type": "FeatureCollection", "features": grid[page * pl.PAGE:(page + 1) * pl.PAGE]}

        class Api:
            def __init__(self):
                self.calls = []

            def call(self, method, path, data=None, headers=None):
                self.calls.append((method, path, json.loads(data)))
                return {"ok": True}

        api = Api()
        report = pl.run(api, Client())
        self.assertEqual([c[:2] for c in api.calls], [("PUT", "/map/parcel-lines/low"), ("PUT", "/map/parcel-lines/mid")])
        self.assertEqual(report["parcels"], 1600)
        for _, _, body in api.calls:
            self.assertNotIn("SECRET", json.dumps(body))
            self.assertEqual(body["format"], pl.FORMAT)

    def test_too_few_parcels_keeps_the_current_set(self):
        class Client:
            def get_json(self, url, timeout=60):
                return {"type": "FeatureCollection", "features": [square(-111.75, 40.30)]}

        with self.assertRaises(RuntimeError):
            pl.run(object(), Client())


if __name__ == "__main__":
    unittest.main()
