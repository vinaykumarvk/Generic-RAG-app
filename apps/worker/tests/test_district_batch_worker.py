import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.district.batch_worker import dispatch_batch_job  # noqa: E402


class DispatchBatchJobTests(unittest.TestCase):
    def test_dispatch_seed_wraps_count(self):
        calls = {}

        def fake_seed(workspace_id, cfg, *, limit, state_code=None, year=None):
            calls["args"] = (workspace_id, limit, state_code, year)
            return 7

        row = {"job_type": "seed", "workspace_id": "ws-1", "params": {"limit": 50, "state_code": 9, "year": 2019}}
        result = dispatch_batch_job(row, {"seed": fake_seed})

        self.assertEqual(result, {"queued": 7})
        self.assertEqual(calls["args"], ("ws-1", 50, 9, 2019))

    def test_dispatch_discover_passes_params(self):
        captured = {}

        def fake_discover(workspace_id, **kwargs):
            captured["workspace_id"] = workspace_id
            captured["kwargs"] = kwargs
            return {"probed": 3, "found": 1, "inserted": 1}

        row = {
            "job_type": "discover",
            "workspace_id": "ws-1",
            "params": {"state": "UP", "establishment": "LU", "court_code": "1", "year": "2018", "count": "5"},
        }
        result = dispatch_batch_job(row, {"discover": fake_discover})

        self.assertEqual(result["found"], 1)
        self.assertEqual(captured["workspace_id"], "ws-1")
        self.assertEqual(captured["kwargs"]["state"], "UP")
        self.assertEqual(captured["kwargs"]["court_code"], 1)
        self.assertEqual(captured["kwargs"]["year"], 2018)
        self.assertEqual(captured["kwargs"]["count"], 5)
        self.assertEqual(captured["kwargs"]["start"], 1)

    def test_dispatch_process_passes_limit(self):
        calls = {}

        def fake_process(workspace_id, *, limit):
            calls["args"] = (workspace_id, limit)
            return {"selected": 5, "processed": 5, "errors": 0}

        row = {"job_type": "process", "workspace_id": "ws-1", "params": {"limit": 25}}
        result = dispatch_batch_job(row, {"process": fake_process})

        self.assertEqual(result["processed"], 5)
        self.assertEqual(calls["args"], ("ws-1", 25))

    def test_dispatch_unsupported_type_raises(self):
        with self.assertRaises(ValueError):
            dispatch_batch_job({"job_type": "nuke", "workspace_id": "ws-1", "params": {}}, {})


if __name__ == "__main__":
    unittest.main()
