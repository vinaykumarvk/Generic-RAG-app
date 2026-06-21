#!/usr/bin/env python3
"""Stream a Cloud Storage object to stdout.

This is intentionally tiny so Cloud Run jobs can pipe large staged archives
into standard Unix extraction tools without downloading the full object to
local disk first.
"""

from __future__ import annotations

import argparse
import sys
from urllib.parse import urlparse

from google.cloud import storage


def parse_gs_uri(uri: str) -> tuple[str, str]:
    parsed = urlparse(uri)
    if parsed.scheme != "gs" or not parsed.netloc or not parsed.path:
        raise ValueError(f"Expected gs://bucket/object URI, got: {uri}")
    return parsed.netloc, parsed.path.lstrip("/")


def main() -> int:
    parser = argparse.ArgumentParser(description="Stream a GCS object to stdout.")
    parser.add_argument("uri", help="Cloud Storage object URI, e.g. gs://bucket/path/file.zip")
    parser.add_argument("--chunk-size", type=int, default=8 * 1024 * 1024)
    args = parser.parse_args()

    bucket_name, object_name = parse_gs_uri(args.uri)
    client = storage.Client()
    blob = client.bucket(bucket_name).blob(object_name)
    with blob.open("rb", chunk_size=args.chunk_size) as handle:
        while True:
            chunk = handle.read(args.chunk_size)
            if not chunk:
                break
            sys.stdout.buffer.write(chunk)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
