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
        self.assertEqual((r["documentType"], r["documentNumber"], r["documentDate"], r["year"]), ("resolution", "1989-01", None, 1989))
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


def test_adoption_date_from_signature_block():
    from ingest.adapters.municode import adoption_date

    t = "RESOLUTION 1989-02 ... PASSED AND ADOPTED by the Town Council this 10th day of May, 1989. Attest"
    assert adoption_date(t, 1989) == "1989-05-10"
    assert adoption_date("approved on June 23, 2026 by the council", 2026) == "2026-06-23"
    # A date in another year, or with no adoption wording, is not taken as the adoption date.
    assert adoption_date("See the plan of March 3, 2019.", 2026) is None
    assert adoption_date("the meeting of March 3, 2026 was noticed", 2026) is None
    assert adoption_date("", 2026) is None


def test_adoption_date_history_note():
    from ingest.adapters.municode import adoption_date

    assert adoption_date("HISTORY\n\nAdopted by Res.\n\n1989-02\n on 5/18/1989\n\nRESOLUTION", 1989) == "1989-05-18"


class CivicClerkAttachmentTests(__import__("unittest").TestCase):
    def test_walk_attachments_skips_confidential_and_links(self):
        from ingest.adapters.civicclerk import walk_attachments

        items = [
            {"agendaObjectItemName": "Business", "attachmentsList": [], "childItems": [
                {"agendaObjectItemName": "Staff report", "attachmentsList": [{"id": 1, "isPublished": True, "pdfVersionFullPath": "https://x/a.pdf"}, {"id": 2, "isPublished": True, "isLink": True, "pdfVersionFullPath": "https://x/b.pdf"}]},
                {"agendaObjectItemName": "Closed", "hasConfidentialAttachment": True, "attachmentsList": [{"id": 3, "isPublished": True, "pdfVersionFullPath": "https://x/c.pdf"}]},
            ]},
        ]
        self.assertEqual([a["id"] for _i, a in walk_attachments(items)], [1])
