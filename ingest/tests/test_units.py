"""Unit tests for the ingestion pipeline: python -m unittest discover -s ingest/tests -p 'test_*.py'"""
import unittest

from ingest.adapters.civicclerk import body_for, file_url
from ingest.chunk import HARD_MAX, chunk_pages
from ingest.classify import classify_type, clean_title, parse_date, parse_document_number
from ingest.discover import inventory
from ingest.extract import Page, clean
from ingest.sources import categorize
from ingest.urls import canonical_url, url_key


class Urls(unittest.TestCase):
    def test_revize_cache_buster_is_not_part_of_identity(self):
        a = "https://www.vineyardutah.gov/FY 27 Budget 06.23.2026.pdf?t=202606231131570"
        b = "https://vineyardutah.gov/FY%2027%20Budget%2006.23.2026.pdf?t=202609091629510"
        self.assertEqual(url_key(a), url_key(b))
        self.assertEqual(canonical_url(a), "https://vineyardutah.gov/FY%2027%20Budget%2006.23.2026.pdf")


class Classify(unittest.TestCase):
    def test_types_from_real_titles(self):
        self.assertEqual(classify_type("9.15.26 CC Agenda Packet"), "agenda_packet")
        self.assertEqual(classify_type("9.15.26 CC Agenda"), "agenda")
        self.assertEqual(classify_type("FY 27 Budget Amendment #1"), "budget")
        self.assertEqual(classify_type("Independent Audit Report FY23-24"), "audit")
        self.assertEqual(classify_type("01a Vineyard Supplemental Observations and Recommendations Report_Final"), "audit")
        self.assertEqual(classify_type("2025 Consumer Confidence Report"), "study")
        self.assertEqual(classify_type("Something unrelated"), "other")

    def test_dates_only_when_unambiguous(self):
        self.assertEqual(parse_date("FY 27 Budget -updated 6.23.2026.pdf"), "2026-06-23")
        self.assertEqual(parse_date("9.15.26 CC Agenda"), "2026-09-15")
        self.assertEqual(parse_date("Minutes of June 3, 2026"), "2026-06-03")
        self.assertIsNone(parse_date("FY 27 Tentative Budget"))
        self.assertIsNone(parse_date("Resolution 2026-12"))

    def test_document_numbers(self):
        self.assertEqual(parse_document_number("Resolution No. 2026-12 adopting"), "Resolution 2026-12")
        self.assertIsNone(parse_document_number("FY 27 Budget"))

    def test_titles(self):
        self.assertEqual(clean_title("click here", "FY25 Citizens Budget.pdf"), "FY25 Citizens Budget")


class Chunking(unittest.TestCase):
    def test_chunks_keep_pages_and_limits(self):
        long = " ".join(["The council reviewed the item and discussed it at length."] * 200)
        chunks = chunk_pages([Page(1, "SHORT PAGE HEADING\nText."), Page(2, long)])
        self.assertEqual(chunks[0].page_start, 1)
        self.assertTrue(all(c.page_start == c.page_end for c in chunks))
        self.assertTrue(all(len(c.text) <= HARD_MAX for c in chunks))
        self.assertGreater(len([c for c in chunks if c.page_start == 2]), 2)
        self.assertTrue(all(c.text.rstrip().endswith(".") for c in chunks if c.page_start == 2))

    def test_clean_removes_control_characters(self):
        self.assertEqual(clean("a\x00b\x0cc\n\n\n\nd"), "a b c\n\nd")


class Sources(unittest.TestCase):
    def test_categorize_real_links(self):
        self.assertEqual(categorize("https://vineyardut.portal.civicclerk.com/")["sourceId"], "vineyard-civicclerk-meetings")
        self.assertFalse(categorize("https://www.facebook.com/sharer/sharer.php?u=x")["crawlable"])
        self.assertFalse(categorize("https://cms3.revize.com/revize/security/index.jsp")["crawlable"])
        self.assertTrue(categorize("https://www.vineyardutah.gov/government/budget.php")["crawlable"])
        self.assertFalse(categorize("https://www.vineyardutah.gov/calendar.php?view=month")["crawlable"])
        self.assertEqual(categorize("https://www.vineyardutah.gov/Finance/Finance/FY22 Budgets.pdf")["category"], "document")

    def test_inventory_ignores_navigation_menu(self):
        html = '<body><div id="menu-content"><a href="/services/index.php">Services</a></div><main id="main"><div id="entry"><a href="/government/budget.php">BUDGET</a></div></main></body>'
        inv = inventory(html, "https://www.vineyardutah.gov/transparency_portal/index.php")
        main = [l for l in inv if l["inMainContent"]]
        self.assertEqual([l["displayText"] for l in main], ["BUDGET"])

    def test_civicclerk(self):
        self.assertEqual(body_for("Planning Commission"), {"id": "planning-commission", "name": "Planning Commission", "kind": "commission"})
        self.assertEqual(file_url(3340), "https://vineyardut.api.civicclerk.com/v1/Meetings/GetMeetingFileStream(fileId=3340,plainText=false)")


if __name__ == "__main__":
    unittest.main()
