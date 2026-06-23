import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.district.rate_governor import WindowStats, decide_ecourts_pause  # noqa: E402
from src.district.seeding import format_cnr, generate_cnr_candidates  # noqa: E402


class RateGovernorTests(unittest.TestCase):
    def test_window_stats_rates(self):
        stats = WindowStats(captcha_total=10, captcha_failures=3, total=20, rate_limited=4)
        self.assertAlmostEqual(stats.captcha_failure_rate, 0.30)
        self.assertAlmostEqual(stats.rate_limit_failure_rate, 0.20)

    def test_window_stats_zero_safe(self):
        stats = WindowStats()
        self.assertEqual(stats.captcha_failure_rate, 0.0)
        self.assertEqual(stats.rate_limit_failure_rate, 0.0)

    def test_pause_on_daily_limit(self):
        paused, reason = decide_ecourts_pause(WindowStats(), daily_count=25000, daily_limit=25000)
        self.assertTrue(paused)
        self.assertEqual(reason, "daily_fetch_limit_reached")

    def test_pause_on_stop_window(self):
        stats = WindowStats(captcha_total=10, captcha_failures=3, total=10, rate_limited=0)
        paused, reason = decide_ecourts_pause(stats, daily_count=0, daily_limit=25000)
        self.assertTrue(paused)
        self.assertEqual(reason, "stop_window_triggered")

    def test_no_pause_when_healthy(self):
        stats = WindowStats(captcha_total=100, captcha_failures=5, total=100, rate_limited=2)
        paused, reason = decide_ecourts_pause(stats, daily_count=10, daily_limit=25000)
        self.assertFalse(paused)
        self.assertIsNone(reason)


class CnrEnumerationTests(unittest.TestCase):
    def test_format_cnr_matches_fixture_shape(self):
        cnr = format_cnr("UP", "LU", court_code=1, sequence=123, year=2018)
        self.assertEqual(cnr, "UPLU010001232018")
        self.assertEqual(len(cnr), 16)

    def test_format_cnr_validates_codes(self):
        with self.assertRaises(ValueError):
            format_cnr("U", "LU", 1, 1, 2018)
        with self.assertRaises(ValueError):
            format_cnr("UP", "LU", 100, 1, 2018)

    def test_generate_cnr_candidates_block(self):
        candidates = generate_cnr_candidates("UP", "LU", 1, 2018, start=1, count=5)
        self.assertEqual(len(candidates), 5)
        self.assertEqual(candidates[0], "UPLU010000012018")
        self.assertEqual(candidates[-1], "UPLU010000052018")
        self.assertTrue(all(len(c) == 16 for c in candidates))

    def test_generate_cnr_candidates_rejects_bad_args(self):
        with self.assertRaises(ValueError):
            generate_cnr_candidates("UP", "LU", 1, 2018, start=0, count=5)


if __name__ == "__main__":
    unittest.main()
