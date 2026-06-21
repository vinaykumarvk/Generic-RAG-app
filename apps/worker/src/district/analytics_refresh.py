"""Refresh district-court analytics aggregates."""

from __future__ import annotations

import argparse
import logging
from typing import Any

from ..db import get_connection, get_cursor

logger = logging.getLogger(__name__)


def refresh_district_analytics(workspace_id: str | None = None) -> list[dict[str, Any]]:
    """Run the database-side district analytics refresh function."""

    sql = (
        "SELECT refreshed_workspace_id, inserted_rows, refreshed_at "
        "FROM refresh_district_case_fact_daily(%s::uuid)"
    )
    params = (workspace_id,)
    if workspace_id is None:
        sql = (
            "SELECT refreshed_workspace_id, inserted_rows, refreshed_at "
            "FROM refresh_district_case_fact_daily(NULL::uuid)"
        )
        params = ()

    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

    results = [dict(row) for row in rows]
    for row in results:
        logger.info(
            "Refreshed district analytics workspace=%s rows=%s",
            row.get("refreshed_workspace_id"),
            row.get("inserted_rows"),
        )
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh district-court analytics aggregates")
    parser.add_argument("--workspace-id", help="Refresh one workspace. Defaults to all workspaces with district cases.")
    args = parser.parse_args()

    rows = refresh_district_analytics(args.workspace_id)
    for row in rows:
        print(f"{row.get('refreshed_workspace_id')},{row.get('inserted_rows')},{row.get('refreshed_at')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
