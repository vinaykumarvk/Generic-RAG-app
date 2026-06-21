#!/usr/bin/env bash
set -euo pipefail

: "${DDL_ZIP_GCS_URI:?DDL_ZIP_GCS_URI is required}"
: "${WORKSPACE_ID:?WORKSPACE_ID is required}"

DATASET_VERSION="${DATASET_VERSION:-ddl-ecourts-2015-2018-v1}"
YEARS="${YEARS:-2015,2016,2017,2018}"
STATE_CODES="${STATE_CODES:-01,03,10,13,26}"
BATCH_SIZE="${BATCH_SIZE:-5000}"
REPORT_PATH="${REPORT_PATH:-/tmp/district-metadata-cloud-sync.json}"

echo "district_metadata_ingest_start dataset=${DATASET_VERSION} years=${YEARS} state_codes=${STATE_CODES}"

python scripts/ingest_district_metadata.py \
  --ddl-cases-tar <(python scripts/gcs_cat.py "${DDL_ZIP_GCS_URI}" | bsdtar -xOf - csv/cases/cases.tar.gz) \
  --ddl-acts-tar <(python scripts/gcs_cat.py "${DDL_ZIP_GCS_URI}" | bsdtar -xOf - csv/acts_sections.tar.gz) \
  --key-dir data/ddl/keys \
  --dataset-version "${DATASET_VERSION}" \
  --years "${YEARS}" \
  --state-codes "${STATE_CODES}" \
  --criminal-only \
  --workspace-id "${WORKSPACE_ID}" \
  --batch-size "${BATCH_SIZE}" \
  --report "${REPORT_PATH}"

echo "district_metadata_ingest_report_path=${REPORT_PATH}"
