"""Rate governance for district acquisition: stop-window + daily cap.

Wires the previously-unused ``should_stop_window()`` into the poller and
enforces ``ECOURTS_DAILY_FETCH_LIMIT``. When the automated eCourts path sees a
CAPTCHA/429 failure spike over the rolling hour, or has spent the daily budget,
the source is paused so the poller skips its rows instead of hammering the
portal (which would trigger blocks and defeat wide coverage).

The decision logic (:func:`decide_ecourts_pause`) is pure and unit-tested; the
DB readers are thin wrappers over ``district_fetch_attempt``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from ..config import config
from ..sources.ecourts_district import should_stop_window

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WindowStats:
    """Rolling-window attempt counts for one source."""

    captcha_total: int = 0
    captcha_failures: int = 0
    total: int = 0
    rate_limited: int = 0

    @property
    def captcha_failure_rate(self) -> float:
        return self.captcha_failures / self.captcha_total if self.captcha_total else 0.0

    @property
    def rate_limit_failure_rate(self) -> float:
        return self.rate_limited / self.total if self.total else 0.0


def decide_ecourts_pause(
    stats: WindowStats, daily_count: int, *, daily_limit: int | None = None
) -> tuple[bool, str | None]:
    """Decide whether eCourts must pause, with a machine-readable reason."""

    limit = config.ECOURTS_DAILY_FETCH_LIMIT if daily_limit is None else daily_limit
    if limit and daily_count >= limit:
        return True, "daily_fetch_limit_reached"
    if should_stop_window(stats.captcha_failure_rate, stats.rate_limit_failure_rate):
        return True, "stop_window_triggered"
    return False, None


def _ecourts_window_stats(cur) -> WindowStats:
    cur.execute(
        """
        SELECT
          count(*) FILTER (WHERE outcome IN ('captcha_required','captcha_failed','hit','miss')) AS captcha_total,
          count(*) FILTER (WHERE outcome = 'captcha_failed') AS captcha_failures,
          count(*) FILTER (WHERE outcome = 'rate_limited') AS rate_limited,
          count(*) AS total
        FROM district_fetch_attempt
        WHERE source_name = 'ecourts' AND attempted_at >= now() - interval '1 hour'
        """
    )
    row = cur.fetchone() or {}
    return WindowStats(
        captcha_total=int(row.get("captcha_total") or 0),
        captcha_failures=int(row.get("captcha_failures") or 0),
        total=int(row.get("total") or 0),
        rate_limited=int(row.get("rate_limited") or 0),
    )


def _ecourts_daily_count(cur) -> int:
    cur.execute(
        """
        SELECT count(*) AS c FROM district_fetch_attempt
        WHERE source_name = 'ecourts' AND attempted_at >= date_trunc('day', now())
        """
    )
    row = cur.fetchone() or {}
    return int(row.get("c") or 0)


def paused_sources(cur) -> set[str]:
    """Return source names the poller must skip this tick."""

    paused: set[str] = set()
    pause, reason = decide_ecourts_pause(_ecourts_window_stats(cur), _ecourts_daily_count(cur))
    if pause:
        logger.warning("Pausing eCourts acquisition this tick: %s", reason)
        paused.add("ecourts")
    return paused
