import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.sources.captcha_solver import (  # noqa: E402
    CaptchaSolution,
    CaptchaUnavailableError,
    DisabledSolver,
    get_captcha_solver,
)
from src.sources.ecourts_district import ECourtsClient  # noqa: E402
from src.sources.ecourts_parser import (  # noqa: E402
    extract_hidden_inputs,
    is_invalid_captcha,
    parse_order_links,
    select_judgement,
)

CASE_HISTORY_HTML = """
<html><body>
<form>
  <input type="hidden" name="app_token" value="tok123" />
  <input type="hidden" name="state_code" value="9" />
</form>
<table class="order_table">
  <tr><td>01-02-2019</td><td><a href="/?p=cnr_status/viewOrder&filename=a.pdf">Order</a></td></tr>
  <tr><td>15-08-2020</td><td><a href="#" onclick="displayPdf('viewOrder&filename=final.pdf')">Final Judgement</a></td></tr>
  <tr><td>03-03-2018</td><td><a href="/some/page">Notice</a></td></tr>
</table>
</body></html>
"""


class ECourtsParserTests(unittest.TestCase):
    def test_extract_hidden_inputs(self):
        tokens = extract_hidden_inputs(CASE_HISTORY_HTML)
        self.assertEqual(tokens["app_token"], "tok123")
        self.assertEqual(tokens["state_code"], "9")

    def test_parse_order_links_picks_up_href_and_onclick(self):
        orders = parse_order_links(CASE_HISTORY_HTML)
        refs = {o.pdf_ref for o in orders}
        self.assertIn("/?p=cnr_status/viewOrder&filename=a.pdf", refs)
        self.assertIn("viewOrder&filename=final.pdf", refs)
        # The plain /some/page anchor is not a PDF reference.
        self.assertEqual(len(orders), 2)

    def test_select_judgement_prefers_labeled_then_latest(self):
        judgement = select_judgement(parse_order_links(CASE_HISTORY_HTML))
        self.assertIsNotNone(judgement)
        self.assertTrue(judgement.is_judgement)
        self.assertEqual(judgement.order_date, "15-08-2020")

    def test_select_judgement_empty(self):
        self.assertIsNone(select_judgement([]))

    def test_is_invalid_captcha(self):
        self.assertTrue(is_invalid_captcha("Error: Invalid Captcha"))
        self.assertFalse(is_invalid_captcha("<table>case history</table>"))


class CaptchaSolverGatingTests(unittest.TestCase):
    def test_disabled_solver_raises(self):
        with self.assertRaises(CaptchaUnavailableError):
            DisabledSolver().solve(b"image")

    def test_get_captcha_solver_disabled_by_default(self):
        # Feature flag defaults to off, so the resolver must refuse automation.
        self.assertIsInstance(get_captcha_solver(), DisabledSolver)


class ECourtsClientRoutingTests(unittest.TestCase):
    def test_manual_fallback_when_nothing_configured(self):
        client = ECourtsClient(direct_fetch_enabled=False, direct_pdf_url_template="", portal_fetch_enabled=False)
        result = client.fetch_case({"cnr": "UPLU010001232018"})
        self.assertEqual(result.outcome, "captcha_required")
        self.assertEqual(result.metadata["policy"], "manual_operator_queue_required")

    def test_missing_cnr_is_a_miss(self):
        client = ECourtsClient(portal_fetch_enabled=False)
        self.assertEqual(client.fetch_case({}).outcome, "miss")

    def test_resolve_pdf_url_variants(self):
        client = ECourtsClient(portal_fetch_enabled=False)
        self.assertEqual(client._resolve_pdf_url("https://x/y.pdf"), "https://x/y.pdf")
        self.assertEqual(client._resolve_pdf_url("/?p=cnr_status/viewOrder&filename=a.pdf"), "/?p=cnr_status/viewOrder&filename=a.pdf")
        self.assertTrue(client._resolve_pdf_url("viewOrder&filename=a.pdf").endswith("&viewOrder&filename=a.pdf"))

    def test_injected_solver_is_used(self):
        sentinel = DisabledSolver()
        client = ECourtsClient(portal_fetch_enabled=False, captcha_solver=sentinel)
        self.assertIs(client.captcha_solver, sentinel)


if __name__ == "__main__":
    unittest.main()
