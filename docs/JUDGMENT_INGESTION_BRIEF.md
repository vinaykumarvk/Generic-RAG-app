# IntelliRAG — Judgment Ingestion Application Brief

A self-contained spec for building the Indian-court-judgment acquisition layer that feeds the existing IntelliRAG worker pipeline (validator → normalizer/OCR → chunker → embedder → kg_extractor → pgvector).

This document is the only context Claude Code needs. It contains every URL, schema, command, filter criterion, and licensing constraint required to design and build the app end-to-end.

---

## 1.  Goal

Build a multi-source ingestion application that downloads and processes full-text **criminal-law judgments** from the **Supreme Court of India** and **all 25 High Courts**, with a focus on:

- **POCSO Act, 2012** — child sexual offences
- **IPC §§ 354, 354A–D, 363–366, 375, 376 (and sub-sections), 377** — sexual offences, rape, abduction
- **IPC § 302** — murder
- **Bharatiya Nyaya Sanhita, 2023 §§ 63–70, 103** — post-2024 equivalents of the IPC sexual-offence and murder sections
- **NDPS Act, JJ Act** — adjacent criminal statutes where useful for context

Output: clean, chunked, embedded judgments in `pgvector`, with metadata + provenance + citation graph, plus a knowledge graph populated by the existing `kg_extractor`.

The app is **only the acquisition + extraction layer**. Chunking, embedding, KG extraction, and storage are already implemented in `apps/worker/`.

---

## 2.  Primary data source — AWS Open Data

Two public S3 buckets in `ap-south-1`, sponsored by the AWS Open Data programme, maintained by Raghotham Vanga.

| Bucket | Coverage | Approx. size | Update cadence |
|---|---|---|---|
| `s3://indian-supreme-court-judgments/` | Supreme Court of India, 1950 – present, English + regional languages | ~50–100 GB (~35 000+ English judgments + regional versions) | Daily via GitHub Actions |
| `s3://indian-high-court-judgments/` | All 25 High Courts | ~1 TB+ (~16 million judgments) | Daily via GitHub Actions (`court-data-pipeline.yml`) |

**Licence: CC BY 4.0** — fully redistributable with attribution. This is the only source in the Indian-legal-tech ecosystem with a clean licence for embedding into a downstream AI system.

**Access is anonymous** (no AWS account required) using `--no-sign-request`.

### 2.1  Bucket layout (both buckets share this structure)

```
s3://indian-{supreme-court,high-court}-judgments/
├── data/
│   ├── tar/
│   │   └── year=YYYY/
│   │       ├── english/english.tar           (or part-*.tar for >1 GB years)
│   │       └── regional/regional.tar
│   └── pdfs/                                  (HC bucket; individual PDFs)
│       └── year=YYYY/court=XYZ/...pdf
└── metadata/
    ├── tar/year=YYYY/
    │   ├── metadata.tar
    │   └── metadata.index.json
    └── parquet/year=YYYY/
        └── metadata.parquet                   (HC also partitions by court)
```

### 2.2  Parquet metadata schema

Every judgment has a row in `metadata.parquet` with these columns:

```
title              str    — case title
petitioner         str
respondent         str
description        str    — short description; contains act/section keywords
judge              list   — bench
author_judge       str    — judgment author
citation           str    — official citation if any
case_id            str
cnr                str    — Case Number Record (national unique ID)
decision_date      date
disposal_nature    str    — Dismissed / Allowed / Convicted / Acquitted / etc.
court              str    — court code
available_languages list  — e.g. ["english", "hindi"]
raw_html           str    — original HTML metadata as scraped
path               str    — S3 key relative to bucket root
nc_display         str
scraped_at         datetime
year               int
```

### 2.3  Access commands

```bash
# Install AWS CLI v2 first.

# List years
aws s3 ls s3://indian-supreme-court-judgments/data/tar/ --no-sign-request

# Pull all SC parquet metadata (small — a few GB total across all years)
aws s3 sync s3://indian-supreme-court-judgments/metadata/parquet/ ./sc_meta/ --no-sign-request

# Pull HC parquet metadata
aws s3 sync s3://indian-high-court-judgments/metadata/parquet/ ./hc_meta/ --no-sign-request

# Download a year of English SC judgments (one tar)
aws s3 cp s3://indian-supreme-court-judgments/data/tar/year=2023/english/english.tar . --no-sign-request

# Pull HC PDFs for one court, one year (individual PDFs)
aws s3 sync s3://indian-high-court-judgments/data/pdfs/year=2023/court=DELHI/ ./delhi-2023/ --no-sign-request

# Plain HTTPS works too (no AWS CLI needed)
curl -O https://indian-supreme-court-judgments.s3.amazonaws.com/data/tar/year=2023/english/english.tar
```

### 2.4  Filtering metadata for criminal cases

Filter the Parquet locally with DuckDB (recommended — no Spark cluster needed):

```sql
COPY (
  SELECT cnr, path, court, decision_date, disposal_nature, judge,
         petitioner, respondent, description, title
  FROM 'sc_meta/**/*.parquet'
  WHERE
       description ILIKE '%POCSO%'
    OR description ILIKE '%Protection of Children from Sexual Offences%'
    OR description ~ '\bs(\.|ection)?\s*302\b'        -- murder
    OR description ~ '\bs(\.|ection)?\s*376\b'        -- rape
    OR description ~ '\bs(\.|ection)?\s*375\b'
    OR description ~ '\bs(\.|ection)?\s*354[A-D]?\b'  -- sexual assault
    OR description ~ '\bs(\.|ection)?\s*36[3-6]\b'    -- abduction / kidnapping
    OR description ILIKE '%BNS%63%' OR description ILIKE '%BNS%103%'
    OR title ILIKE '%rape%' OR title ILIKE '%murder%'
    OR title ILIKE '%POCSO%'
) TO 'criminal_targets.csv' (HEADER, DELIMITER ',');
```

Apply the same filter against `hc_meta/**/*.parquet`. Expect roughly **10–20 %** of the total HC corpus to match (rough estimate; actual ratio should be measured in Phase 0).

---

## 3.  Secondary data sources

| Source | URL | Use for | Cost | Licence |
|---|---|---|---|---|
| Indian Kanoon API | `https://api.indiankanoon.org/` | Clean extracted text where PDFs are scanned; daily delta updates; citation graph | ~Rs 0.50/doc, Rs 500 free credit, Rs 10 000/mo free for verified non-commercial use | API ToS: internal RAG OK, no redistribution |
| eCourts portal | `https://judgments.ecourts.gov.in/` | Live delta fallback if AWS bucket lags | Free, CAPTCHA-throttled | GoI; research use |
| `openjustice-in/ecourts` | `https://github.com/openjustice-in/ecourts` | Python scraper for incremental updates against eCourts | Free | MIT (tool) |
| India Code | `https://www.indiacode.nic.in/` | Statute text (POCSO, IPC, BNS, CrPC, BNSS, IEA, BSA, JJ Act) for grounding | Free | GoI |
| IndianBailJudgments-1200 | `https://huggingface.co/datasets/SnehaDeshmukh/IndianBailJudgments-1200` | Annotated POCSO/NDPS/IPC bail orders for evaluation set | Free | CC BY 4.0 |
| BUILD rhetorical roles | `https://github.com/Legal-NLP-EkStep/rhetorical-role-baseline` | Sentence-level role labels to train chunker (Facts/Arguments/Reasoning/Decision) | Free | Open |
| Project 39A | `https://www.project39a.com/` | Gold-standard reference set for death-penalty / murder cases | Free | Cite |

**Do not** ingest content from SCC Online, Manupatra, LexisNexis, Westlaw, AIR, or LawFinder — their subscription contracts explicitly prohibit using their content to train or embed AI/ML/NLP systems.

---

## 4.  PDF vs text — what to expect

The S3 buckets contain **original PDFs**, not pre-extracted clean text. Quality:

- **~80–90 % of post-2010 PDFs** have a real text layer. `pdftotext -layout` or PyMuPDF extracts cleanly.
- **Older PDFs (pre-2010 HC scans especially)** are image-only. They require OCR.
- **Some PDFs are hybrid** — text layer exists but was produced by upstream OCR and is noisy.

Detection strategy:

1. Try `pdftotext -layout` first.
2. If extracted text is empty, < 200 chars, or has > 30 % non-ASCII gibberish ratio, fall back to OCR.
3. Recommended OCR engine: **Tesseract 5 with `eng+hin+ben+tam+tel+kan+mal+guj+mar+ori+pan`** language packs. For higher quality, use **AWS Textract** or **Azure Document Intelligence** (cost: ~$1.50 per 1000 pages, worth it for poorly-scanned older judgments).
4. Optionally cross-check by fetching the same CNR from Indian Kanoon API and comparing — IK has already done extraction.

This logic belongs in the existing `apps/worker/src/pipeline/normalizer.py` stage.

---

## 5.  Application design

### 5.1  New components to build

The existing `apps/worker/` pipeline already covers validator, normalizer/OCR, chunker, embedder, and KG extractor. The new code is the **source-acquisition layer** that feeds PDFs + metadata into the existing `ingestion_job` queue.

Create a new sub-package: `apps/worker/src/sources/` with one module per source:

```
apps/worker/src/sources/
├── __init__.py
├── base.py                  # SourceAdapter ABC: fetch_metadata(), fetch_pdf(cnr), list_new(since)
├── aws_opendata.py          # Primary source — see §2
├── indian_kanoon.py         # Secondary — clean text + citation graph (paid API)
├── ecourts_scraper.py       # Tertiary — delta fallback (wraps openjustice-in/ecourts)
└── india_code.py            # Statute corpus
```

Each adapter implements:

```python
class SourceAdapter(ABC):
    name: str
    licence: str

    @abstractmethod
    def list_new(self, since: datetime) -> Iterator[JudgmentRef]:
        """Yield judgments published or modified after `since`."""

    @abstractmethod
    def fetch_metadata(self, ref: JudgmentRef) -> JudgmentMetadata:
        """Return structured metadata for one judgment."""

    @abstractmethod
    def fetch_pdf(self, ref: JudgmentRef, dest: Path) -> Path:
        """Download the PDF (or cleaned text) to `dest`. Return path."""
```

### 5.2  Orchestrator

A new orchestrator service in `apps/worker/src/orchestrator.py`:

1. Reads filter rules from a YAML config (`config/criminal_filters.yaml`) defining acts/sections + court whitelist + date range.
2. For each source adapter, calls `list_new(since=last_run_timestamp)`.
3. Applies filters against returned metadata.
4. For each matching ref, enqueues an `ingestion_job` row pointing at the downloaded PDF + metadata JSON.
5. The existing worker picks up jobs and runs them through validator → normalizer/OCR → chunker → embedder → kg_extractor.
6. Records every fetch in a new `source_fetch_log` table for idempotency and audit.

### 5.3  New database tables

Migration `010_ingestion_sources.sql`:

```sql
CREATE TABLE source_run (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name   TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  status        TEXT NOT NULL CHECK (status IN ('running','success','failed')),
  cursor        JSONB,          -- e.g. {"last_decision_date":"2026-05-01"}
  stats         JSONB           -- {"fetched":1234,"skipped":56,"errors":3}
);

CREATE TABLE source_fetch_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name   TEXT NOT NULL,
  source_url    TEXT NOT NULL,
  cnr           TEXT,
  checksum_sha256 TEXT,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  licence       TEXT NOT NULL,
  ingestion_job_id UUID REFERENCES ingestion_job(id),
  UNIQUE (source_name, source_url, checksum_sha256)
);

CREATE INDEX idx_source_fetch_log_cnr ON source_fetch_log (cnr);
```

### 5.4  Filter config

`apps/worker/config/criminal_filters.yaml`:

```yaml
acts:
  - id: POCSO_2012
    keywords:
      - "POCSO"
      - "Protection of Children from Sexual Offences"
  - id: IPC_302
    sections: [302]
    keywords: ["murder", "Section 302"]
  - id: IPC_376
    sections: [375, 376]
    keywords: ["rape", "Section 376", "Section 375"]
  - id: IPC_354
    sections: [354, "354A", "354B", "354C", "354D"]
  - id: IPC_363_366
    sections: [363, 364, 365, 366]
  - id: BNS_63_70
    keywords: ["BNS 63", "BNS 64", "BNS 65", "BNS 66", "BNS 67",
               "BNS 68", "BNS 69", "BNS 70"]
  - id: BNS_103
    keywords: ["BNS 103"]

courts:
  include: ["SC", "ALL_HC"]    # ALL_HC expands to the 25 HC codes
  exclude: []

date_range:
  from: "1990-01-01"
  to:   "current"
```

### 5.5  Frontend additions

In `apps/web/`, add an **Ingestion Sources** admin page (`/admin/sources`) that shows:

- Per-source last run, next scheduled run, last cursor, fetch count, error count
- A "Run now" button (POST `/api/v1/admin/sources/{name}/run`)
- A filter-config editor (YAML editor + validation)
- A per-source health summary card (green/amber/red)

Reuse the existing TanStack Query + Tailwind components from the workspace page; no new component libraries.

---

## 6.  Build phases

### Phase 0 — Discovery (1–2 days)
1. Run the metadata-only pull (Parquet only, ~few GB total).
2. Apply the criminal filter; produce a `criminal_targets.csv` with CNR + path + court + decision_date for both SC and HC.
3. Print actual counts and bytes by court and year. **This is the only way to commit to real storage sizing.**

### Phase 1 — AWS bulk seed (1 week)
1. Implement `aws_opendata.py` adapter.
2. Stream filtered PDFs into `ingestion_job` queue.
3. Validate that the existing worker pipeline runs end-to-end on a sample of 1 000 judgments.
4. Measure OCR-required ratio.

### Phase 2 — Indian Kanoon enrichment (3–4 days)
1. Implement `indian_kanoon.py` adapter using `ikapi.py` reference client.
2. For each CNR already ingested, fetch IK clean text + citation list.
3. Replace OCR'd text where IK quality is higher (judge call: use a text-similarity check).
4. Persist citation edges in the knowledge graph (existing `008_knowledge_graph.sql` schema).

### Phase 3 — Live delta sync (2–3 days)
1. Implement `ecourts_scraper.py` adapter wrapping `openjustice-in/ecourts`.
2. Schedule nightly cron: pull AWS deltas → fetch any missing-from-AWS new judgments from eCourts/IK.
3. Surface health metrics on `/admin/sources`.

### Phase 4 — Statute grounding (2 days)
1. Implement `india_code.py` adapter for POCSO / IPC / BNS / CrPC / BNSS / IEA / BSA / JJ Act / NDPS.
2. Ingest as a separate `document_type = 'statute'` corpus.
3. Cross-link judgment chunks to statute chunks by act/section metadata.

### Phase 5 — Evaluation set (1 day)
1. Load IndianBailJudgments-1200 (CC BY 4.0) as gold set.
2. Use Project 39A's 306 trial-court death-sentence judgments as murder-sentencing eval set.
3. Add eval harness to compare retrieval quality before/after each pipeline change.

---

## 7.  Acceptance criteria

The application is considered complete when:

1. A single `npm run ingest:bootstrap` command pulls all criminal-law metadata from both AWS buckets, filters it, and produces a count report.
2. A single `npm run ingest:run` command processes all filtered judgments through the existing pipeline and lands them in `pgvector` with provenance, ready for retrieval.
3. The nightly cron runs without manual intervention and surfaces health metrics on `/admin/sources`.
4. Every chunk in `pgvector` has populated `source_name`, `source_url`, `licence`, `fetched_at`, `checksum_sha256`, `cnr`, `court`, `decision_date`, `disposal_nature`, `acts_cited` fields.
5. End-to-end retrieval on the test query *"What are the recent Supreme Court interpretations of consent under Section 376 IPC?"* returns at least 5 relevant judgments with citations.
6. Lint passes (`npm run lint`) — no new violations beyond baseline.
7. All new code follows the coding standards in `CLAUDE.md` (parameterized queries, Zod validation, `unknown` instead of `any`, no `console.log`, structured logger, etc.).

---

## 8.  Licensing & compliance — required fields on every chunk

```
source_name            e.g. "aws-opendata-sc", "indian-kanoon", "india-code"
source_url             original URL
licence                "CC-BY-4.0" | "ODbL" | "GoI-Section-52" | "IK-API-TOS"
retrieval_timestamp    ISO-8601
checksum_sha256        of source PDF
court                  court code
case_no / cnr
decision_date
judges
acts_cited             list
disposal_nature        criminal vs civil filter source
rhetorical_role        Facts / Arguments / Reasoning / Decision (from BUILD model)
```

Indian judgments are subject to **§ 52(1)(q) of the Copyright Act, 1957**, which permits reproduction of any court order/judgment. Editorial headnotes by publishers (SCC, AIR, Manupatra, Lexis) are **separately copyrightable** — never embed those. Subscription ToS for paid databases explicitly forbid training/embedding (cf. Manupatra clause: *"data shall not be utilized for the training of large language models, machine learning models, natural language processing models, or any similar technology"*).

---

## 9.  Key file/folder additions checklist

```
apps/worker/src/sources/
  __init__.py
  base.py
  aws_opendata.py
  indian_kanoon.py
  ecourts_scraper.py
  india_code.py
apps/worker/src/orchestrator.py
apps/worker/config/criminal_filters.yaml
apps/api/src/migrations/010_ingestion_sources.sql
apps/api/src/routes/admin/sources.ts        (CRUD + run-now)
apps/web/src/pages/admin/Sources.tsx
apps/web/src/pages/admin/SourceDetail.tsx
e2e/tests/sources.spec.ts                   (Playwright smoke)
packages/shared/src/intellirag-model/source.ts  (Zod schemas)
```

---

## 10.  Quick links

- AWS Registry — Supreme Court: <https://registry.opendata.aws/indian-supreme-court-judgments/>
- AWS Registry — High Court: <https://registry.opendata.aws/indian-high-court-judgments/>
- GitHub — vanga/indian-supreme-court-judgments: <https://github.com/vanga/indian-supreme-court-judgments>
- GitHub — vanga/indian-high-court-judgments: <https://github.com/vanga/indian-high-court-judgments>
- Indian Kanoon API docs: <https://api.indiankanoon.org/documentation/>
- IKAPI client: <https://github.com/sushant354/IKAPI>
- openjustice-in/ecourts: <https://github.com/openjustice-in/ecourts>
- BUILD rhetorical-roles: <https://github.com/Legal-NLP-EkStep/rhetorical-role-baseline>
- IndianBailJudgments-1200: <https://huggingface.co/datasets/SnehaDeshmukh/IndianBailJudgments-1200>
- Project 39A: <https://www.project39a.com/>
- eCourts judgments portal: <https://judgments.ecourts.gov.in/>
- India Code: <https://www.indiacode.nic.in/>

End of brief.
