import unittest

from ingest.adapters.municode import content_url, entry_metadata, meeting_date
from ingest.pipeline import _mco_text


class MunicodeTests(unittest.TestCase):
    def test_minutes_entry(self):
        m = entry_metadata("minutes", ["City/Town Council", "Town Council 1989-1999", "Town Council 1989"], "May 11, 1989")
        self.assertEqual(m["documentType"], "minutes")
        self.assertEqual(m["documentDate"], "1989-05-11")
        self.assertEqual(m["governmentBodyId"], "city-council")
        self.assertEqual(m["governmentBodyName"], "Town Council")
        self.assertTrue(m["dedupeMeeting"])
        self.assertIn("Town Council meeting minutes, May 11, 1989", m["title"])

    def test_planning_and_city(self):
        self.assertEqual(entry_metadata("minutes", ["Planning Commission", "2001"], "June 3, 2001")["governmentBodyId"], "planning-commission")
        self.assertEqual(entry_metadata("minutes", ["City/Town Council", "City Council 2020-2029", "2021"], "March 10, 2021")["governmentBodyName"], "City Council")

    def test_resolution_and_ordinance(self):
        r = entry_metadata("resolutions", ["City Resolutions", "1989 Resolutions"], "1989-01 Town Birthday")
        self.assertEqual((r["documentType"], r["documentNumber"], r["documentDate"]), ("resolution", "1989-01", "1989-01-01"))
        o = entry_metadata("orddoc", ["1989-1999", "1989"], "ORD 1989-01 Elected Officials Duties, Etc.")
        self.assertEqual((o["documentType"], o["documentNumber"]), ("ordinance", "1989-01"))
        self.assertTrue(o["title"].startswith("Ordinance 1989-01"))
        rda = entry_metadata("resolutions", ["RDA Resolutions", "2016"], "2016-02 Budget")
        self.assertEqual(rda["governmentBodyId"], "redevelopment-agency")

    def test_code_section(self):
        c = entry_metadata("zoning", ["15.04 Interpretation Of Requirements"], "15.04.010 Purpose")
        self.assertEqual(c["documentType"], "municipal_code")
        self.assertEqual(c["title"], "Zoning Code: 15.04.010 Purpose")

    def test_text_and_files(self):
        html = "<div><div class='phx-name '><a href='#name_May_11,_1989'>May 11, 1989</a></div></div><p>Pre-Town Meeting</p><ol><li>Fiscal year July 1.</li></ol><a href='https://s3-us-west-2.amazonaws.com/municipalcodeonline.com-new/vineyard/minutes/documents/1_May 11 1989.pdf'>Town Council Meeting Minutes</a>"
        text, files = _mco_text(html)
        self.assertNotIn("May 11, 1989\n", text[:15])
        self.assertIn("Fiscal year July 1.", text)
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0][1], "Town Council Meeting Minutes")

    def test_helpers(self):
        self.assertEqual(meeting_date("Special Meeting - Sept. 4, 2003"), "2003-09-04")
        self.assertEqual(meeting_date("12/10/2025"), "2025-12-10")
        self.assertEqual(meeting_date("6.23.26 Budget"), "2026-06-23")
        self.assertIn("name=May_11%2C_1989", content_url("minutes", "May_11,_1989"))


if __name__ == "__main__":
    unittest.main()
