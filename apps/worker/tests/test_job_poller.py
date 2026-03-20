import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src import job_poller  # noqa: E402


class FakeConnection:
    def __init__(self):
        self.commit_count = 0

    def commit(self):
        self.commit_count += 1


class FakeCursor:
    def __init__(self, fetchone_results=None):
        self.executed = []
        self._fetchone_results = list(fetchone_results or [])

    def execute(self, sql, params=None):
        self.executed.append((" ".join(sql.split()), params))

    def fetchone(self):
        if self._fetchone_results:
            return self._fetchone_results.pop(0)
        return None


def _connection_context(conn):
    @contextmanager
    def _ctx():
        yield conn

    return _ctx()


def _cursor_context(cursor):
    @contextmanager
    def _ctx():
        yield cursor

    return _ctx()


class JobPollerTests(unittest.TestCase):
    def test_chunk_completion_marks_document_chunked_until_embed_starts(self):
        claim_conn = FakeConnection()
        complete_conn = FakeConnection()
        claim_cursor = FakeCursor([
            {
                "job_id": "job-1",
                "document_id": "doc-1",
                "workspace_id": "ws-1",
                "step": "CHUNK",
                "attempt": 0,
                "max_attempts": 3,
                "metadata": {"chunking_strategy": "fixed"},
            }
        ])
        complete_cursor = FakeCursor()

        with patch.object(
            job_poller,
            "get_connection",
            side_effect=[_connection_context(claim_conn), _connection_context(complete_conn)],
        ), patch.object(
            job_poller,
            "get_cursor",
            side_effect=[_cursor_context(claim_cursor), _cursor_context(complete_cursor)],
        ), patch.dict(job_poller.STEP_HANDLERS, {"CHUNK": lambda document_id, workspace_id: None}, clear=False):
            had_work = job_poller.poll_once()

        self.assertTrue(had_work)
        self.assertEqual(claim_conn.commit_count, 1)
        self.assertEqual(complete_conn.commit_count, 1)
        self.assertIn(
            ("UPDATE document SET status = %s, updated_at = now() WHERE document_id = %s", ("CHUNKING", "doc-1")),
            claim_cursor.executed,
        )
        self.assertIn(
            ("UPDATE document SET status = %s, updated_at = now() WHERE document_id = %s", ("CHUNKED", "doc-1")),
            complete_cursor.executed,
        )
        self.assertIn(
            (
                "INSERT INTO ingestion_job (document_id, workspace_id, step, status, metadata) VALUES (%s, %s, %s, 'PENDING', %s)",
                ("doc-1", "ws-1", "EMBED", '{"chunking_strategy": "fixed"}'),
            ),
            complete_cursor.executed,
        )

    def test_embed_completion_keeps_document_searchable_until_kg_job_is_claimed(self):
        claim_conn = FakeConnection()
        complete_conn = FakeConnection()
        claim_cursor = FakeCursor([
            {
                "job_id": "job-2",
                "document_id": "doc-2",
                "workspace_id": "ws-2",
                "step": "EMBED",
                "attempt": 0,
                "max_attempts": 3,
                "metadata": {},
            }
        ])
        complete_cursor = FakeCursor([{"enabled": True}])

        with patch.object(
            job_poller,
            "get_connection",
            side_effect=[_connection_context(claim_conn), _connection_context(complete_conn)],
        ), patch.object(
            job_poller,
            "get_cursor",
            side_effect=[_cursor_context(claim_cursor), _cursor_context(complete_cursor)],
        ), patch.dict(job_poller.STEP_HANDLERS, {"EMBED": lambda document_id, workspace_id: None}, clear=False):
            had_work = job_poller.poll_once()

        self.assertTrue(had_work)
        self.assertIn(
            ("UPDATE document SET status = %s, updated_at = now() WHERE document_id = %s", ("EMBEDDING", "doc-2")),
            claim_cursor.executed,
        )
        self.assertIn(
            ("UPDATE document SET status = %s, updated_at = now() WHERE document_id = %s", ("SEARCHABLE", "doc-2")),
            complete_cursor.executed,
        )
        self.assertIn(
            (
                "INSERT INTO ingestion_job (document_id, workspace_id, step, status, metadata) VALUES (%s, %s, 'KG_EXTRACT', 'PENDING', %s)",
                ("doc-2", "ws-2", "{}"),
            ),
            complete_cursor.executed,
        )
        kg_extracting_updates = [
            params
            for sql, params in complete_cursor.executed
            if sql == "UPDATE document SET status = 'KG_EXTRACTING', updated_at = now() WHERE document_id = %s"
        ]
        self.assertEqual(kg_extracting_updates, [])


if __name__ == "__main__":
    unittest.main()
