import unittest

from bs4 import BeautifulSoup

from ingest import people


class FakeResp:
    def __init__(self, text):
        self.text = text
        self.status_code = 200


class FakeClient:
    def __init__(self, pages):
        self.pages = pages

    def request(self, method, url, headers=None, timeout=60):
        return FakeResp(self.pages.get(url, ""))


COUNCIL = "<main>City Council C Council Member Chip Price TERM 2026 THROUGH DECEMBER 31, 2027 Read More chipp@vineyardutah.gov Council Member Jacob Wood TERM 2026 THROUGH DECEMBER 31, 2029 Read More jacobw@vineyardutah.gov Follow us: M Mayor Zack Stratton TERM 2026 THROUGH DECEMBER 31, 2029 Read More mayor@vineyardutah.gov Follow us:</main>"
STAFF = """<article><div class="rz-business-block"><div class="row"><div class="col-md-3"><ul class="category-list"><li>Officials &amp; Executive Staff</li></ul></div>
<div class="col-md-5" style="background:url('bus-directory/David Kyle.jpg?t=1')"><h2>David Kyle Herring</h2><span class="rz-business-desc">Deputy Mayor</span></div>
<div class="col-md-4"><div class="rz-business-links"><a href="tel:3854807807">385-480-7807</a> <a href="mailto:davidk@vineyardutah.gov">Email</a></div></div></div></div>
<div class="rz-business-block"><div class="row"><ul class="category-list"><li>Finance</li></ul><h2>EVAN SMITH</h2><span class="rz-business-desc">Finance Director</span><a href="mailto:evans@vineyardutah.gov">x</a></div></div></article>"""


class PeopleTests(unittest.TestCase):
    def test_build(self):
        client = FakeClient({people.PAGES["council"]: COUNCIL, people.PAGES["staff"]: STAFF})
        recs = {k: (t, txt) for k, t, _u, txt in people.build(client, "2026-10-01")}
        title, text = recs["people:officials"]
        self.assertEqual(title, "Mayor and City Council (current)")
        self.assertIn("Mayor: Zack Stratton. Term 2026 through December 31, 2029", text)
        self.assertIn("City Council Member: Jacob Wood", text)
        self.assertIn("as of 2026-10-01", text)
        staff = recs["people:staff"][1]
        self.assertIn("David Kyle Herring, Deputy Mayor; email davidk@vineyardutah.gov; phone 385-480-7807.", staff)
        self.assertIn("Evan Smith, Finance Director", staff)
        people_out = []
        people.build(client, "2026-10-01", people_out)
        by = {p["slug"]: p for p in people_out}
        self.assertEqual(by["zack-stratton"]["kind"], "elected")
        self.assertEqual(by["zack-stratton"]["term"], "2026 through December 31, 2029")
        self.assertEqual(by["david-kyle-herring"]["photoUrl"], "https://www.vineyardutah.gov/bus-directory/David%20Kyle.jpg?t=1")
        self.assertEqual(by["david-kyle-herring"]["role"], "Deputy Mayor")
        lead = recs["people:leadership"][1]
        self.assertIn("Deputy Mayor: David Kyle Herring", lead)
        self.assertIn("Finance Director: Evan Smith", lead)


if __name__ == "__main__":
    unittest.main()


class PhotoUrlTests(__import__("unittest").TestCase):
    def test_parentheses_in_photo_name(self):
        from bs4 import BeautifulSoup

        from ingest.people import _cards

        html = """<div class="rz-business-block"><div style="background: url('bus-directory/Christopher Chip Price (1).png?t=2') center center / cover no-repeat;"></div><h2>Council Member Chip Price</h2><a class="rz-bus-readmore" href="x.php">Read More</a></div>"""
        cards = _cards(BeautifulSoup(html, "html.parser"))
        self.assertEqual(cards[0]["photo"], "https://www.vineyardutah.gov/bus-directory/Christopher%20Chip%20Price%20(1).png?t=2")
