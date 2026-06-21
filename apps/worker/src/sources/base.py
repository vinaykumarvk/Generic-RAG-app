"""Base contracts for source acquisition adapters."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator


@dataclass(frozen=True)
class SourceRef:
    """Stable reference to a source record before full content is fetched."""

    source_name: str
    source_case_id: str
    cnr: str | None = None
    source_url: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SourceMetadata:
    """Normalized source metadata used by district ingestion."""

    ref: SourceRef
    title: str | None = None
    decision_date: str | None = None
    court_name: str | None = None
    acts_cited: tuple[str, ...] = ()
    sections_cited: tuple[str, ...] = ()
    raw_payload: dict[str, Any] = field(default_factory=dict)


class SourceAdapter(ABC):
    """Common adapter interface for district-court acquisition sources."""

    name: str
    license: str
    license_classification: str

    @abstractmethod
    def list_new(self, since: datetime | None = None) -> Iterator[SourceRef]:
        """Yield source references published or updated after ``since``."""

    @abstractmethod
    def fetch_metadata(self, ref: SourceRef) -> SourceMetadata:
        """Return normalized metadata for one source reference."""

    @abstractmethod
    def fetch_content(self, ref: SourceRef, dest: Path) -> Path | None:
        """Fetch source content when available. Metadata-only sources return ``None``."""

