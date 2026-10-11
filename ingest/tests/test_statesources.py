import json
import os
import re
import unittest
from datetime import date

from ingest import statesources as ss

FIX = os.path.join(os.path.dirname(__file__), "fixtures")


def fixture(name: str) -> str:
    with open(os.path.join(FIX, name), encoding="utf-8", errors="replace") as f:
        return f.read()


class FakeClient:
    """Serves saved pages by URL; records every request."""

    def __init__(self, pages: dict[str, str]):
        self.pages = pages
        self.seen: list[str] = []

    def get_text(self, url):
        self.seen.append(url)
        for k, v in self.pages.items():
            if k in url:
                return v, url
        return "<html>no table</html>", url

    def get_json(self, url):
        self.seen.append(url)
        for k, v in self.pages.items():
            if k in url:
                return json.loads(v)
        return {"features": []}


class TaxRateTests(unittest.TestCase):
    def test_years_and_districts(self):
        form = fixture("utco_taxrates_form.html")
        years = ss.parse_tax_years(form)
        self.assertEqual(years[:3], [2027, 2026, 2025])
        self.assertEqual(ss.parse_vineyard_districts(form), [(95, "VINEYARD CITY"), (96, "VINEYARD CITY / WITH WATER")])
        # Results pages list the newer improvement districts too.
        ids = [d for d, _ in ss.parse_vineyard_districts(fixture("utco_taxrates_2026_95.html"))]
        self.assertIn(539, ids)
        self.assertIn(548, ids)

    def test_rate_table(self):
        t = ss.parse_tax_rates(fixture("utco_taxrates_2026_95.html"))
        self.assertEqual((t["district"], t["year"], t["total"]), (95, 2026, "0.0107810"))
        self.assertIn(("VINE", "VINEYARD", "0.0034600"), t["lines"])
        self.assertIn(("CNTY", "UTAH COUNTY", "0.0008910"), t["lines"])
        self.assertEqual(len(t["lines"]), 6)
        t96 = ss.parse_tax_rates(fixture("utco_taxrates_2026_96.html"))
        self.assertIn(("NUCW", "NORTH UTAH COUNTY WATER DIST", "0.0000110"), t96["lines"])
        self.assertIsNone(ss.parse_tax_rates("<html><body>Search</body></html>"))

    def test_record(self):
        client = FakeClient({
            "TaxRates.asp": fixture("utco_taxrates_form.html"),
            "serialform-year=2026&serialform-district=95": fixture("utco_taxrates_2026_95.html"),
            "serialform-year=2026&serialform-district=96": fixture("utco_taxrates_2026_96.html"),
        })
        recs = ss.build_tax_records(client, today=date(2026, 10, 11))
        self.assertEqual([r["year"] for r in recs], [2026])
        r = recs[0]
        self.assertEqual(r["title"], "Utah County tax rates 2026, Vineyard tax areas")
        self.assertEqual((r["docType"], r["key"]), ("tax_rate", "utah-county-tax-rates:2026"))
        self.assertIn("Vineyard City rate (tax unit VINE), tax areas 95, 96: 0.003460", r["text"])
        self.assertIn("Tax area 96, VINEYARD CITY / WITH WATER", r["text"])
        self.assertIn("Total tax rate: 0.0107920", r["text"])
        self.assertNotRegex(r["text"], "[–—]")
        # The answer code reads the Vineyard rate from the first line naming Vineyard City with a rate.
        m = re.search(r"\bvineyard\s+(?:city|town)\b[^\n]{0,80}?(?:^|[\s:$])(0?\.\d{4,6})\b", r["text"], re.I)
        self.assertEqual(m.group(1), "0.003460")
        # Two newest years for every Vineyard tax area plus one older year for areas 95 and 96: a small, fixed number of requests.
        self.assertLessEqual(len(client.seen), 1 + 2 * 12 + 2)

    def test_six_places(self):
        self.assertEqual(ss.six_places("0.0037960"), "0.003796")
        self.assertEqual(ss.six_places("0.0037961"), "0.0037961")


class UdotTests(unittest.TestCase):
    def test_projects(self):
        feats = json.loads(fixture("udot_projects.json"))["features"]
        projects = ss.udot_projects(feats)
        pins = [p["pin"] for p in projects]
        self.assertEqual(pins, sorted(set(pins)))
        self.assertNotIn(12156, pins)  # abandoned
        self.assertIn(19890, pins)
        p = next(p for p in projects if p["pin"] == 19890)
        self.assertEqual(ss.udot_title(p), "UDOT project: Vineyard Connector Overpass (PIN 19890)")
        text = ss.udot_record_text(p, "2026-10-11")
        self.assertIn("Status: Under Construction", text)
        self.assertIn("Project value: $7,000,000", text)
        self.assertIn("PIN 19890, read 2026-10-11", text)

    def test_query(self):
        url = ss.udot_query_url()
        self.assertIn("Projects_as_Lines/FeatureServer/0/query", url)
        self.assertIn("returnGeometry=false", url)
        self.assertNotIn("pub_ctc", url)

    def test_where_matches_worker(self):
        here = os.path.dirname(__file__)
        with open(os.path.join(here, "..", "..", "worker", "lib", "mapLayers.ts"), encoding="utf-8") as f:
            ts = f.read()
        m = re.search(r"UDOT_KEYWORDS = \[([^\]]*)\]", ts)
        self.assertIsNotNone(m)
        self.assertEqual(tuple(re.findall(r"'([^']*)'", m.group(1))), ss.UDOT_KEYWORDS)

    def test_news(self):
        news = ss.udot_news_items(json.loads(fixture("udot_wp_search_vineyard.json")))
        self.assertEqual(len(news), 1)
        self.assertEqual(news[0]["date"], "2023-02-10")
        self.assertIn("Vineyard Connector", news[0]["title"])


class AuditorTests(unittest.TestCase):
    def test_items(self):
        data = json.loads(fixture("tu_search_reports_vineyard.json"))
        items = ss.auditor_items(data["results"])
        self.assertEqual(len(items), 6)  # the other entity is left out
        first = items[0]
        self.assertEqual(first["title"], "Approved Budget 2026, Vineyard City (filed with the State Auditor)")
        self.assertEqual(first["metadata"]["documentType"], "budget")
        self.assertEqual(first["metadata"]["documentDate"], "2025-07-17")
        self.assertTrue(first["url"].startswith("https://storage.googleapis.com/"))
        types = {i["metadata"]["documentType"] for i in items}
        self.assertTrue(types <= {"budget", "audit", "financial_report", "other"})

    def test_types(self):
        self.assertEqual(ss.auditor_doc_type("Amended Budget"), "budget")
        self.assertEqual(ss.auditor_doc_type("Management Letter"), "audit")
        self.assertEqual(ss.auditor_doc_type("Financial Report"), "financial_report")
        self.assertEqual(ss.auditor_doc_type("Fraud Risk Assessment"), "other")

    def test_search_url(self):
        u = ss.auditor_search_url(2)
        self.assertIn("function=searchReports", u)
        self.assertIn("%22page%22%3A2", u)


if __name__ == "__main__":
    unittest.main()
