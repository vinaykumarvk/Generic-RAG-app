import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.sources.ecourts_browser import html_to_text, select_disposal_onclick  # noqa: E402

# Mirrors the real casetype_list order rows seen in the PoC (MHAU010000012020):
# the disposal/judgment entry has the exact 'Disposed' flag; daily rows use 'DisposedP'.
CASETYPE_HTML = """
<table class="order_table">
  <tr><td><a onclick="viewBusiness('4','19','','MHAU010000012020','1','Disposed','26-05-2023','3','MHAU01','cnr','0')">Final order</a></td></tr>
  <tr><td><a onclick="viewBusiness('4','19','20230526','MHAU010000012020','1','DisposedP','25-05-2023','3','MHAU01','cnr')">25-05-2023</a></td></tr>
  <tr><td><a onclick="viewBusiness('4','19','20230525','MHAU010000012020','1','DisposedP','18-05-2023','3','MHAU01','cnr')">18-05-2023</a></td></tr>
</table>
"""


class SelectDisposalTests(unittest.TestCase):
    def test_picks_exact_disposed_flag_not_disposedp(self):
        onclick = select_disposal_onclick(CASETYPE_HTML)
        self.assertIsNotNone(onclick)
        self.assertIn("'Disposed'", onclick)
        self.assertIn("26-05-2023", onclick)
        self.assertNotIn("DisposedP", onclick)

    def test_falls_back_to_first_viewbusiness_when_no_disposal(self):
        html = "<a onclick=\"viewBusiness('4','19','x','CNR','1','DisposedP','01-01-2020','3','E','cnr')\">o</a>"
        onclick = select_disposal_onclick(html)
        self.assertIsNotNone(onclick)
        self.assertIn("viewBusiness", onclick)

    def test_none_when_no_orders(self):
        self.assertIsNone(select_disposal_onclick("<div>no orders here</div>"))


class HtmlToTextTests(unittest.TestCase):
    def test_flattens_order_html(self):
        html = "<center><span><b>CNR Number&nbsp;</b>:MHAU010000012020</span></center>\n<h1>Daily Status</h1><p>Order text&amp; more</p>"
        text = html_to_text(html)
        self.assertIn("CNR Number", text)
        self.assertIn("MHAU010000012020", text)
        self.assertIn("Order text& more", text)
        self.assertNotIn("<", text)

    def test_empty(self):
        self.assertEqual(html_to_text(""), "")


if __name__ == "__main__":
    unittest.main()
