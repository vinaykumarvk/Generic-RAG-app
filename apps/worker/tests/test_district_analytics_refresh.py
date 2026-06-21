import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.district import analytics_refresh  # noqa: E402


class FakeCursor:
    def __init__(self):
        self.executed = []

    def execute(self, sql, params=None):
        self.executed.append((" ".join(sql.split()), params))

    def fetchall(self):
        return [{"refreshed_workspace_id": "ws-1", "inserted_rows": 4, "refreshed_at": "now"}]


class FakeConnection:
    pass


def _ctx(value):
    @contextmanager
    def _inner():
        yield value

    return _inner()


class DistrictAnalyticsRefreshTests(unittest.TestCase):
    def test_refreshes_one_workspace(self):
        cursor = FakeCursor()
        with patch.object(analytics_refresh, "get_connection", return_value=_ctx(FakeConnection())), \
                patch.object(analytics_refresh, "get_cursor", return_value=_ctx(cursor)):
            rows = analytics_refresh.refresh_district_analytics("ws-1")

        self.assertEqual(rows[0]["inserted_rows"], 4)
        self.assertIn("refresh_district_case_fact_daily", cursor.executed[0][0])
        self.assertEqual(cursor.executed[0][1], ("ws-1",))

    def test_refreshes_all_workspaces(self):
        cursor = FakeCursor()
        with patch.object(analytics_refresh, "get_connection", return_value=_ctx(FakeConnection())), \
                patch.object(analytics_refresh, "get_cursor", return_value=_ctx(cursor)):
            analytics_refresh.refresh_district_analytics()

        self.assertIn("NULL::uuid", cursor.executed[0][0])
        self.assertEqual(cursor.executed[0][1], ())


if __name__ == "__main__":
    unittest.main()
