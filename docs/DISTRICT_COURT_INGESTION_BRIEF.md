# IntelliRAG — District Court Ingestion Brief

A companion spec to `JUDGMENT_INGESTION_BRIEF.md`. This document covers **Phase 6: District Courts** — the practical, scoped strategy for acquiring district-court judgment data for criminal cases (POCSO, IPC 302, 354, 363–366, 375, 376; BNS equivalents).

This brief is intentionally narrower than the SC/HC brief because the district-court data landscape is fundamentally different.

---

## Phase 1 execution decisions

The district-court programme now has explicit source-governance and data-contract artifacts:

- `docs/district-court-data-contract.md` defines the canonical entities, required fields, redaction contract, translation contract, analytics contract, and how district artifacts connect to the existing `document`, `chunk`, and `judgment_metadata` tables.
- `docs/legal/district-court-source-register.md` classifies DDL, eCourts, Indian Kanoon, HLDC, NyayaAnumana, AWS Open Data, and blocked subscription sources.
- `docs/legal/captcha-strategy.md` makes human-in-the-loop CAPTCHA handling the only approved eCourts pilot strategy. Automated CAPTCHA solving remains blocked until legal and operational approval.
- `apps/worker/config/district_filters.yaml` is the canonical machine-readable filter for the initial district-court criminal-law slice.

Approved implementation posture:

1. **Metadata first.** DDL/eCourts metadata loads create district metadata rows, not `document` rows.
2. **CNR spine.** CNR is the primary join key across DDL, eCourts, Indian Kanoon, HLDC, and future sources when available.
3. **Text is targeted.** Only selected criminal-law CNRs proceed to text/PDF acquisition.
4. **Original text is canonical.** OCR, redacted text, and English translation are derived artifacts with independent provenance. Translation uses the approved provider configuration; for the current build this is OpenAI through the existing `OPENAI_API_KEY` / `OPEN_AI_API_KEY` secret with `TRANSLATION_PROVIDER=openai`.
5. **Commercial safety is explicit.** HLDC and other non-commercial sources must remain excluded when `COMMERCIAL_MODE=true`.
6. **Sensitive records are gated.** POCSO, rape, minor, witness, address, school, and sealed-record identifiers require redaction before user-facing retrieval or external translation.
7. **eCourts acquisition is throttled and auditable.** The pilot uses an operator CAPTCHA queue, strict rate limits, and fetch-attempt logs.

---

## 1.  Why district courts need a separate brief

The Supreme Court and 25 High Courts have a clean, automated, CC-BY-4.0 bulk source (the AWS Vanga buckets). **District courts do not.** Three structural facts shape everything below:

1. **No equivalent bulk dataset exists.** No AWS Open Data bucket, no daily-synced HuggingFace dump, no Indian Kanoon equivalent. The AWS buckets stop at High Court level.
2. **Volume is two orders of magnitude larger.** District courts hear ~95 % of India's case load — tens of millions of cases per year vs ~16M cumulative HC judgments. Trying to ingest "all of it" is a multi-year scraping project.
3. **Text quality is rougher.** District orders are short, frequently dictated, often scanned, often in regional languages, often poorly OCR'd by the upstream portal.

**Therefore the goal is not comprehensive ingestion.** The goal is **targeted acquisition of a high-value, tractable criminal-law slice** that complements the SC/HC corpus already built in Phase 1–5.

---

## 2.  Scope decision (must be confirmed with the user before building)

The default scope this brief assumes:

| Dimension | Default scope |
|---|---|
| Acts | POCSO 2012 · IPC §§ 302, 354, 354A-D, 363-366, 375, 376 · BNS 63-70, 103 · NDPS · JJ Act |
| States | UP, Maharashtra, Karnataka, Tamil Nadu, Delhi (top 5 by criminal-case volume; mix of Hindi, Marathi, Kannada, Tamil, English) |
| Court level | Sessions Courts + Magistrate Courts + Family Courts (when handling POCSO) |
| Date window | 2015-01-01 to current (older orders are mostly scanned, much lower OCR yield) |
| Languages | English + Hindi as Phase 6.0; add regional languages in Phase 6.1 |
| Document types | Final judgments + bail orders + framing-of-charges orders (skip routine adjournment orders) |

If a different scope is chosen, the rest of this brief generally holds — the only thing that changes is the state/act filters in `district_filters.yaml`.

---

## 3.  Five-step acquisition strategy

The strategy is built around the principle that **metadata is cheap, text is expensive**. We get all the metadata first, decide which CNRs are worth chasing, then chase only those.

```
┌─────────────────────────────────────────────────────────────────┐
│  Step 1 │ DDL Metadata          → Build CNR universe            │
│  Step 2 │ Filter to criminal    → Produce target_cnrs.parquet   │
│  Step 3 │ Indian Kanoon API     → Cheap clean-text fills        │
│  Step 4 │ openjustice-in eCourts scrape → Cover the remainder   │
│  Step 5 │ HLDC ingest           → Free Hindi UP coverage        │
└─────────────────────────────────────────────────────────────────┘
```

### Step 1 — DDL Judicial Data Portal (metadata-only foundation)

The Development Data Lab Judicial Data Portal is the canonical metadata source for Indian district courts.

| Field | Detail |
|---|---|
| URL | https://www.devdatalab.org/judicial-data |
| Coverage | 81.2 million district-court case records, 2010 – 2018 |
| Criminal cases | ~10 million identified by act/section |
| Content | **Metadata only — no judgment text** |
| Format | Per-state CSV/TSV bundles + cleaned Parquet snapshots |
| Licence | **ODbL 1.0 + Database Contents Licence** — open commercial use with attribution |
| Citation | Ash, Asher, Bhowmick, Bhupatiraju, Chen, Devi, Goessmann, Novosad, Siddiqi — used in QJE 2024 in-group-bias paper |

**Schema (per case row):**

```
ddl_case_id            str    — DDL's internal canonical ID
cino                   str    — eCourts CNR (joins to live portal)
state_code             int    — DDL state code (1-37)
district_code          int    — DDL district code
court_no               int    — court number within district
year                   int
case_type              str    — eCourts case-type code (CC, SC, ST, etc.)
filing_date            date
registration_date      date
decision_date          date   — null if pending
disp_name              str    — disposition (Acquitted, Convicted, Dismissed, ...)
purpose_name           str
section                str    — IPC/POCSO/etc. section list (semicolon-separated)
act                    str    — Act name list
female_petitioner      bool   — inferred from name
female_respondent      bool   — inferred from name
female_judge           bool   — inferred from name
judge_position         str    — Sessions Judge, Magistrate, Family Court, ...
bailable               bool
under_trial            bool
```

**Acquisition (one-time, ~30 minutes):**

```bash
# DDL publishes per-year per-state archives; pull the criminal-relevant ones.
# Actual download URLs are listed on the portal page; fetch the index first.
mkdir -p data/ddl && cd data/ddl
curl -L -O https://www.devdatalab.org/_files/ugd/.../judicial_data_index.json
jq -r '.archives[] | select(.years[] | (. >= 2015)) | .url' judicial_data_index.json \
  | xargs -P 4 -n 1 curl -L -O

# Load into Postgres as ddl_raw, or query in place with DuckDB
duckdb ddl.duckdb -c "
CREATE TABLE ddl_cases AS
SELECT * FROM read_parquet('data/ddl/**/*.parquet', union_by_name=true);
CREATE INDEX ix_cino   ON ddl_cases(cino);
CREATE INDEX ix_state  ON ddl_cases(state_code);
CREATE INDEX ix_act    ON ddl_cases(act);
"
```

> **Note on the date window.** DDL stops at 2018. For 2019-present coverage you must scrape `services.ecourts.gov.in` directly (Step 4). DDL is the cheap way to build the historical CNR universe; the live portal handles fresh data.

### Step 2 — Filter to criminal CNRs

Run this DuckDB query against the loaded DDL data to produce the target list:

```sql
COPY (
  SELECT cino, state_code, district_code, court_no, year, case_type,
         decision_date, disp_name, section, act, judge_position,
         bailable, under_trial
  FROM ddl_cases
  WHERE decision_date >= DATE '2015-01-01'
    AND state_code IN (
      -- DDL state codes for UP, Maharashtra, Karnataka, Tamil Nadu, Delhi
      -- confirm against DDL's state_code_map.csv before running
      9, 27, 29, 33, 26
    )
    AND (
         act ILIKE '%POCSO%' OR act ILIKE '%Protection of Children%'
      OR section ~ '\b(302|354|354A|354B|354C|354D|363|364|365|366|375|376)\b'
      OR act  ILIKE '%Bharatiya Nyaya%' AND section ~ '\b(63|64|65|66|67|68|69|70|103)\b'
      OR act  ILIKE '%Narcotic%' OR act ILIKE '%NDPS%'
      OR act  ILIKE '%Juvenile Justice%'
    )
) TO 'target_cnrs.parquet' (FORMAT PARQUET);
```

Expect somewhere in the range of **300 000 – 1 500 000 rows** depending on the exact section filter and state choice. That is the working universe.

### Step 3 — Indian Kanoon API (cheap clean-text first)

Indian Kanoon has uneven district-court coverage — much better for recent orders from larger cities, much worse for small-town magistrate courts — but where IK has the text, it is already cleaned and citation-resolved, so it is by far the cheapest path.

| Field | Detail |
|---|---|
| URL | https://api.indiankanoon.org/ |
| Docs | https://api.indiankanoon.org/documentation/ |
| Reference client | https://github.com/sushant354/IKAPI (`ikapi.py`) |
| Pricing | ~Rs 0.50/document, Rs 0.20/search · Rs 500 signup credit · Rs 10 000/month free quota for verified non-commercial use |
| Search filters | `doctypes:`, `court:`, `cites:`, date range, free text, party, judge |
| Output | JSON with title, court, date, judges, parties, full body HTML, cited cases |
| Licence | API ToS: internal RAG OK, no bulk redistribution of raw judgments to end users |

**Strategy.** For each CNR in `target_cnrs.parquet`:

1. Query IK by CNR or by a party-name + date heuristic.
2. If a match is found, store the cleaned text + IK citation list in `chunk_source = 'indian-kanoon'`.
3. If no match (typical for smaller district courts), mark the CNR `text_status = 'needs_scrape'` for Step 4.

**Budget guidance.** At Rs 0.50/document, a 500 000-CNR run is ~Rs 2.5 lakh ($3 000). Apply for the non-commercial Rs 10 000/month quota first — if approved, the run is effectively free (just rate-limited). Even at full price, prefer IK over scraping wherever IK has coverage; the OCR + cleanup labour saved is worth far more than the API cost.

### Step 4 — Scrape `services.ecourts.gov.in` (the remainder)

This is the only path for district-court orders not on IK. The official portal exposes a CNR-lookup endpoint that returns the order PDF directly — much more reliable than the search interface.

| Field | Detail |
|---|---|
| URL | https://services.ecourts.gov.in/ecourtindia_v6/ |
| CNR direct lookup | `/?p=cnr_status/searchByCNR` (POST) |
| Order PDF endpoint | `/?p=orderonly/show_order&...` (returns PDF) |
| Authentication | None |
| Rate limit | CAPTCHA on every page; ~1 request per 2-4 seconds per IP in practice |
| Format | PDF (mostly scanned for older orders, text-layer for newer) |
| Languages | English + state regional language depending on court |
| Licence | GoI; § 52(1)(q) Copyright Act 1957 permits reproduction of court orders |
| Recommended client | https://github.com/openjustice-in/ecourts |

**Recommended approach — extend `openjustice-in/ecourts`.** The library is the most respectful, well-engineered scraper for eCourts. It currently focuses on High Courts but the underlying HTTP mechanics are identical for district courts. The library's `Court` abstraction maps cleanly onto `(state_code, district_code, court_complex_code, establishment_code)`. Contribute a `DistrictCourt` subclass back upstream when stable.

**CAPTCHA strategy options, in order of preference:**

1. **Per-CNR direct fetch.** If you already have the CNR (which you do, from DDL), use the CNR-lookup endpoint. It still requires a CAPTCHA but only one per case — no nested state→district→complex drilling.
2. **Manual operator queue.** For sensitive cases or low volume, route CAPTCHAs to a human operator via a queue UI. 200-500 captchas/hour is sustainable for one person.
3. **2Captcha / Anti-Captcha integration.** Costs ~$1 per 1000 solves. Legal grey area; many courts' ToS forbid automated CAPTCHA bypass. **Do not use without explicit legal sign-off.**
4. **Local OCR-based solver (Tesseract).** Works on simple eCourts CAPTCHAs ~60-70 % of the time. Free; same legal grey area as commercial solvers.

**Operational guidance.** Run on a single residential-grade IP at ~1 request per 3 seconds with exponential backoff on 429/503. Plan for ~25 000 PDFs/day at this rate from a single worker; horizontal-scale by IP pool if needed (no more than 5-10 parallel workers — eCourts has DDoS protection).

**PDF processing.** Same as Phase 1:

1. `pdftotext -layout` first.
2. If empty / < 200 chars / > 30 % gibberish, fall back to Tesseract OCR with `eng+hin` (and the state's regional pack).
3. Tag every chunk with `source_name = 'ecourts-scrape'`, `source_url = <PDF URL>`, `licence = 'GoI-Section-52'`.

### Step 5 — HLDC for Hindi UP coverage (free, immediate)

The Hindi Legal Documents Corpus is the only district-court resource that ships full text in bulk. Treat it as a parallel ingestion stream that doesn't depend on Steps 1-4.

| Field | Detail |
|---|---|
| URL | https://github.com/Exploration-Lab/HLDC |
| Paper | https://aclanthology.org/2022.findings-acl.278/ |
| Coverage | 912 568 Hindi legal documents from Uttar Pradesh district courts |
| Content | Full text + header/body segmentation + bail prediction labels |
| Format | JSON files, per-document |
| Licence | **CC-BY-NC** — research / non-commercial only |
| Use case | High-volume Hindi-language POCSO/IPC coverage for UP |

**Acquisition (one command):**

```bash
git clone --depth 1 https://github.com/Exploration-Lab/HLDC.git data/hldc
# Dataset is split across release tarballs — see README for current URLs.
```

**Caveat.** CC-BY-NC means you **cannot use HLDC text in a commercial product or commercial-grade RAG service.** Keep it in a separate `chunk_corpus = 'hldc'` partition, gated by a runtime flag (`COMMERCIAL_MODE`), so the system can serve only commercial-safe corpora when needed.

---

## 4.  Application design

The district-court layer extends — does not replace — the structure laid out in `JUDGMENT_INGESTION_BRIEF.md` § 5.

### 4.1  New source adapters

Add to `apps/worker/src/sources/`:

```
apps/worker/src/sources/
├── ddl_metadata.py          # Step 1 — load DDL Parquet + filter
├── indian_kanoon_district.py# Step 3 — extends indian_kanoon.py with district-court-tuned CNR resolution
├── ecourts_district.py      # Step 4 — extends ecourts_scraper.py with district endpoints
└── hldc.py                  # Step 5 — read HLDC JSON, normalize to JudgmentMetadata
```

Each implements the same `SourceAdapter` ABC defined in the parent brief.

### 4.2  New orchestrator phase

Extend `apps/worker/src/orchestrator.py` with a district pipeline that runs:

```
ddl_metadata.list_new()
  → criminal_filter (acts + states + dates + court_level)
  → produces target_cnrs table

For each target_cnr:
    try indian_kanoon_district.fetch_pdf_or_text()
    if not found:
        enqueue ecourts_district.fetch_pdf() to scrape worker
        (scrape worker rate-limits across all targets)

parallel: hldc.list_new() → enqueues HLDC documents on the commercial-safe partition
```

### 4.3  New database tables

Migration `011_district_courts.sql`:

```sql
-- The target list derived from DDL after filtering.
CREATE TABLE district_target_cnr (
  cnr               TEXT PRIMARY KEY,
  state_code        INT  NOT NULL,
  district_code     INT  NOT NULL,
  court_no          INT,
  case_type         TEXT,
  decision_date     DATE,
  disposition       TEXT,
  acts_cited        TEXT[],          -- normalized act tags
  sections_cited    TEXT[],          -- normalized section tags
  judge_position    TEXT,
  bailable          BOOLEAN,
  source_of_metadata TEXT NOT NULL,  -- 'ddl' | 'ecourts-live'
  added_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  text_status       TEXT NOT NULL DEFAULT 'pending'
                    CHECK (text_status IN
                      ('pending','ik-fetched','scrape-queued','scraped','ocr-failed','dead')),
  text_last_attempt TIMESTAMPTZ,
  text_attempt_count INT NOT NULL DEFAULT 0,
  ingestion_job_id  UUID REFERENCES ingestion_job(id)
);

CREATE INDEX ix_dtc_status     ON district_target_cnr(text_status);
CREATE INDEX ix_dtc_state_date ON district_target_cnr(state_code, decision_date);
CREATE INDEX ix_dtc_acts_gin   ON district_target_cnr USING GIN (acts_cited);

-- Per-CNR provenance + scrape attempts for audit.
CREATE TABLE district_fetch_attempt (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cnr             TEXT NOT NULL REFERENCES district_target_cnr(cnr),
  source          TEXT NOT NULL CHECK (source IN ('indian-kanoon','ecourts','hldc')),
  attempted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  outcome         TEXT NOT NULL CHECK (outcome IN
                    ('hit','miss','captcha-fail','rate-limited','ocr-failed','http-error')),
  http_status     INT,
  bytes           BIGINT,
  notes           TEXT
);

CREATE INDEX ix_dfa_cnr ON district_fetch_attempt(cnr);
```

### 4.4  Filter config

`apps/worker/config/district_filters.yaml`:

```yaml
acts:
  - id: POCSO_2012
    keywords: ["POCSO", "Protection of Children from Sexual Offences"]
  - id: IPC_302
    sections: ["302"]
  - id: IPC_376
    sections: ["375", "376"]
  - id: IPC_354
    sections: ["354", "354A", "354B", "354C", "354D"]
  - id: IPC_363_366
    sections: ["363", "364", "365", "366"]
  - id: BNS_63_70
    keywords: ["BNS 63", "BNS 64", "BNS 65", "BNS 66",
               "BNS 67", "BNS 68", "BNS 69", "BNS 70"]
  - id: BNS_103
    keywords: ["BNS 103"]
  - id: NDPS
    keywords: ["NDPS", "Narcotic Drugs and Psychotropic Substances"]
  - id: JJ_Act
    keywords: ["Juvenile Justice"]

states:
  include:
    - { code: 9,  name: "Uttar Pradesh" }
    - { code: 27, name: "Maharashtra" }
    - { code: 29, name: "Karnataka" }
    - { code: 33, name: "Tamil Nadu" }
    - { code: 26, name: "Delhi" }
  exclude: []

date_range:
  from: "2015-01-01"
  to:   "current"

court_levels:
  include: ["Sessions", "Magistrate", "Family Court"]
  exclude: []

document_types:
  include: ["judgment", "bail_order", "framing_of_charges"]
  exclude: ["adjournment", "cause_list"]

# Commercial-safety partition for the HLDC corpus
commercial_safe_only:
  hldc: false      # default: include HLDC (non-commercial only)
                   # flip to true to exclude HLDC entirely
```

### 4.5  Admin UI additions

In `apps/web/src/pages/admin/Sources.tsx`, add a "District Courts" panel showing:

- DDL load status (rows loaded, last refresh)
- `district_target_cnr` counts by `text_status`
- IK quota remaining (queried live)
- eCourts scrape worker — last 24h hit/miss/captcha-fail stats per state
- HLDC corpus status

Add a card on the workspace home that flags **"District-court chunks are CC-BY-NC if sourced from HLDC; commercial-mode hides them"** so end users understand provenance.

---

## 5.  Build phases (within Phase 6)

| Sub-phase | Duration | Description |
|---|---|---|
| **6.0  Foundation** | 2 days | DDL download, DuckDB load, run criminal filter, produce `target_cnrs.parquet`, manually inspect 100 rows for filter quality |
| **6.1  IK enrichment** | 3 days | Implement `indian_kanoon_district.py`, run against full target list, record hits in `district_target_cnr` |
| **6.2  eCourts scraper** | 1 week | Extend `openjustice-in/ecourts` for district endpoints, build CAPTCHA queue, test against 1 000 CNRs from one district |
| **6.3  Scale-up** | 2 weeks | Scale scrape to all 5 states; tune rate limits; monitor `district_fetch_attempt` outcomes |
| **6.4  HLDC ingest** | 2 days | Parallel: ingest HLDC into commercial-safe partition |
| **6.5  Eval** | 2 days | Retrieval-quality eval on district-court criminal queries; tune chunker for short-order format |

Total: roughly **4 weeks of focused work** for the first defensible district-court layer covering five states.

---

## 6.  Acceptance criteria

The district-court layer is complete when:

1. `npm run ingest:district:bootstrap` downloads DDL, runs the criminal filter, and loads `district_target_cnr` with ≥ 300 000 rows.
2. `npm run ingest:district:run` processes the target list end-to-end: IK first, eCourts fallback, ingestion-job enqueue, pipeline run.
3. **Coverage**: ≥ 70 % of `district_target_cnr` rows reach `text_status IN ('ik-fetched','scraped')` within 30 days of continuous ingestion.
4. **Provenance**: Every district chunk has `source_name`, `source_url`, `licence`, `cnr`, `state_code`, `district_code`, `court_no`, `decision_date`, `disposition`, `acts_cited`, `sections_cited` populated.
5. **HLDC partition is gated**: When `COMMERCIAL_MODE=true` is set, no HLDC chunks appear in retrieval results.
6. **Retrieval quality**: An eval set of 50 district-court criminal queries returns ≥ 5 relevant judgments per query with citations.
7. **Operational safety**: Scraper respects rate limits (no IP-bans during a 7-day test run); CAPTCHA strategy has explicit legal sign-off documented in `/docs/legal/captcha-strategy.md`.
8. **Lint passes** (`npm run lint`) with no new violations beyond baseline.

---

## 7.  Risks and what to do about them

| Risk | Mitigation |
|---|---|
| DDL stops in 2018; 2019+ has no comparable metadata | Use eCourts CNR-by-date listing (state → district → year) to harvest CNRs incrementally for post-2018; run as a continuous job |
| eCourts CAPTCHA bypass legal ambiguity | Default to human-in-the-loop CAPTCHA queue; require sign-off + ToS audit before any automated solver |
| Indian Kanoon district coverage is uneven; rural courts may have ~5 % IK hit-rate | Plan for eCourts to be the dominant path; budget scraper capacity accordingly |
| OCR quality on scanned district orders is poor | Use AWS Textract or Azure Document Intelligence for the bottom 10 % by `pdftotext` confidence; cost ~$1.50/1000 pages |
| HLDC CC-BY-NC licence contaminates commercial product | Strict partition + runtime flag; surface in admin UI |
| Privacy concerns — district orders frequently name victims, especially in POCSO | Implement PII-redaction stage in the worker before embedding (existing normalizer can be extended); review with counsel |
| eCourts portal schema changes | Pin `openjustice-in/ecourts` to a known-good commit; CI smoke test against a fixture set of 10 CNRs per state |

---

## 8.  Realistic expectations

After 4 weeks of Phase 6 work, you should reasonably expect:

- **300 000 – 800 000 district court chunks** in `pgvector`, depending on filter strictness
- **~60-70 % coverage** of the DDL-derived target list (IK hits + successful scrapes)
- **~5-10 % failure rate** — CNRs that exist in DDL but where the order PDF cannot be retrieved (court hasn't uploaded; CAPTCHA failures; deleted records)
- **Daily incremental growth** of a few hundred to a few thousand new orders as eCourts publishes them
- **A separate, commercial-safe partition** containing the SC + HC corpus (built in Phases 1-5) and any non-HLDC district content, for productisation

This is enough volume to make district-court retrieval genuinely useful for criminal-law queries, without committing to the multi-year project of scraping every district court in India.

---

## 9.  Privacy note (mandatory reading before launch)

District-court POCSO and rape judgments frequently disclose the name, address, school, and other identifying details of the victim — sometimes in violation of § 228A IPC and § 33(7) POCSO. **Before any district-court chunk is exposed in retrieval, the pipeline must apply PII redaction.**

Recommended approach:

1. **Named-entity recognition** with `Legal-NLP-EkStep/legal_NER` to extract person names, addresses, dates of birth.
2. **Pattern redaction** for phone numbers, Aadhaar IDs (12-digit), PAN, school IDs.
3. **Role-based filtering** — preserve judge, accused (where convicted on the merits and public-record), counsel; redact victim (always for POCSO) and witness (where the court ordered confidentiality).
4. **Audit log** — every redaction recorded in a `chunk_redaction_log` table with rule ID and pre/post hash, so the policy can be re-applied as it evolves.

This is non-negotiable for a production system. Skipping it creates serious legal and ethical exposure.

---

## 10.  Quick links

- DDL Judicial Data Portal: <https://www.devdatalab.org/judicial-data>
- DDL primer (Medium): <https://devdatalab.medium.com/big-data-for-justice-f53e0e14c9c9>
- eCourts Services portal: <https://services.ecourts.gov.in/ecourtindia_v6/>
- openjustice-in/ecourts (Python scraper): <https://github.com/openjustice-in/ecourts>
- Open Justice India initiative: <https://openjustice-in.github.io/>
- Indian Kanoon API: <https://api.indiankanoon.org/>
- Indian Kanoon API docs: <https://api.indiankanoon.org/documentation/>
- IKAPI reference client: <https://github.com/sushant354/IKAPI>
- HLDC dataset: <https://github.com/Exploration-Lab/HLDC>
- HLDC paper: <https://aclanthology.org/2022.findings-acl.278/>
- NyayaAnumana (includes district court slice): <https://huggingface.co/collections/L-NLProc/nyayaanumana-and-inlegalllama-dataset-67558fa9405ec5d08a891a9a>
- Legal-NLP-EkStep NER: <https://github.com/Legal-NLP-EkStep/legal_NER>
- National Judicial Data Grid: <https://njdg.ecourts.gov.in/>

End of brief.
