# IntelliRAG for Law Enforcement

**A Retrieval-Augmented Knowledge Platform for Police Case Work**

*Prepared: 15 June 2026*

---

## Overview

IntelliRAG is a domain-agnostic Retrieval-Augmented Generation (RAG) and Knowledge Graph
platform whose components were originally built and battle-tested for the **policing-apps**
project. While the engine is general-purpose, a substantial body of its functionality is
purpose-built for law-enforcement case work: FIR and chargesheet ingestion, statutory
citation extraction, court-judgment analytics, multi-tier evidence sensitivity, and
cryptographically auditable evidence export.

The platform ingests police documents (FIRs, chargesheets, forensic reports, witness
statements, court judgments), structures them into a searchable knowledge base backed by
PostgreSQL + pgvector, and lets investigators query across an entire case corpus in natural
language — with citations, access control, and an auditable trail. It supports local LLMs
(Ollama) for air-gapped deployments as well as cloud providers (OpenAI, Claude, Gemini).

---

## Police-Specific Capabilities

### 1. Case-Aware Document Model

Every ingested document carries first-class policing metadata, stored as indexed columns and
auto-populated during ingestion:

- **`case_reference`** — case/crime number (e.g. *Cr. No. 49/2019*)
- **`fir_number`** — First Information Report identifier
- **`station_code`** — originating police station
- **`org_unit_id`** — division/station hierarchy for organizational scoping

These fields drive case-scoped retrieval: an investigator can pin a conversation to a single
case or station, and every answer is restricted to that boundary.
*(`packages/shared/src/intellirag-model/document.ts`, `apps/api/src/migrations/015_access_control_org.sql`,
`apps/api/src/routes/rag-routes.ts`)*

### 2. Police-Oriented LLM Use Cases

The multi-LLM router exposes ten legacy law-enforcement use cases, each independently
routable to a chosen provider/model:

| Use Case | Purpose |
|---|---|
| `NARCOTICS_ANALYSIS` | Drug-related case analysis (NDPS) |
| `INVESTIGATION_SUMMARY` | Summarize an investigation file |
| `CASE_SUMMARY` | Condense a full case file |
| `RISK_NARRATIVE` | Generate risk-assessment narratives |
| `LEGAL_REFERENCES` | Extract and resolve statutory citations |
| `FINAL_SUBMISSION` | Prepare case-submission output |
| `CLASSIFICATION` | Classify documents and cases |
| `TRANSLATION` | Regional-language translation |

*(`packages/api-core/src/llm/llm-provider.ts`)*

### 3. Automated Police Metadata Extraction

During ingestion, an LLM-backed extractor reads each document and structures it into the
policing schema — without manual tagging:

- **Document typing:** FIR, chargesheet, court order, forensic/FSL report, witness statement,
  panchanama, affidavit.
- **Statutory citations:** IPC, CrPC, NDPS, POCSO, BNS sections detected and recorded as
  `legal_sections`.
- **Parties and dates:** key persons, FIR date, seizure date, incident date.
- **Judgment analytics:** court level, bench strength, appeal posture, disposal nature,
  offense categories, accused/charge outcomes, and a **state/police result** flag
  (favourable / adverse / mixed / neutral).
- **Sensitivity suggestion** and **redaction status** (none / pending / redacted / restricted),
  with flags for victim identity, minor identity, and sexual-offence detail.

When extraction confidence is high (≥ 0.7) the case-scoping fields are auto-populated.
*(`apps/worker/src/pipeline/metadata_extractor.py`)*

### 4. Legal Knowledge Graph

Beyond text search, the ingestion pipeline builds a knowledge graph tuned for legal
causation, linking persons, roles, locations, authorities, offenses, evidence, and findings.
Its relationship vocabulary is explicitly forensic:

- `violates`, `non_compliance_with` — statutory breaches
- `supports_conviction`, `supports_acquittal` — legal causation
- `evidence_rejected_because`, `lapse_caused_doubt` — evidentiary and procedural failures

This lets the platform answer *why* a case resolved as it did — e.g. tracing an acquittal back
to a chain-of-custody lapse — rather than merely returning matching passages.
*(`apps/worker/src/pipeline/kg_extractor.py`)*

### 5. Multi-Tier Sensitivity & Access Control

Police material is rarely uniformly shareable. IntelliRAG enforces a four-level
classification — **PUBLIC, INTERNAL, RESTRICTED, SEALED** — at the *chunk* level, so a single
document can expose general facts while withholding sealed passages.

- Role-based access (Admin / Member / Viewer) combined with per-user clearance.
- Time-bound access grants for temporary operational elevation.
- Sensitivity filtering applied **inside the retrieval pipeline**, before answer generation,
  so an under-cleared user's answer never draws on restricted chunks.
- Cache segregation by access signature prevents cross-clearance leakage.

*(`apps/api/src/middleware/sensitivity-guard.ts`, `apps/api/src/migrations/015_access_control_org.sql`)*

### 6. Regional-Language Legal Translation

A curated glossary preserves the integrity of legal terminology across Telugu, Urdu, and
Hindi. Statutory shorthand (FIR, CNR, IPC, BNS, CrPC, NDPS, POCSO) is preserved untranslated,
while procedural terms (*accused, prosecutrix, charge sheet, cognizance, acquittal,
conviction, hostile witness*) are translated consistently.
*(`apps/worker/config/legal_translation_glossary.yaml`)*

### 7. Auditable Evidence Packaging & Export

For disclosure and court submission, the platform exports case evidence as cryptographically
verifiable packages:

- ZIP archive with a `manifest.json` recording case ID, exporter identity, and timestamp.
- **SHA-256 hash per file** plus a manifest hash and `SHA256SUMS.txt` for integrity
  verification — establishing a defensible chain of custody.
- Conversation exports (JSON/CSV) apply **sensitivity-based masking** for the exporting user's
  clearance, log the exporter, warn on stale/superseded citations, and watermark for
  confidentiality.

*(`packages/api-integrations/src/evidence/evidence-packager.ts`, `apps/api/src/routes/export-routes.ts`)*

### 8. Configurable Policing Ontology

Workspaces carry a customizable ontology — node types, edge types, extraction rules, and
controlled vocabularies (offense categories, outcomes) — with an explicit `domain` of
*police* or *judicial*. This lets a deployment tailor entity and relationship taxonomies to a
jurisdiction's specific case types without code changes.
*(`packages/shared/src/intellirag-model/workspace.ts`)*

---

## Deployment for Policing

A dedicated deployment target ships the platform as a **police case knowledge base** on Google
Cloud Run — `police-cases-kb-api`, `police-cases-kb-web`, and `police-cases-kb-worker` under
the `policing-apps` project. The deployment wires in Document AI OCR for scanned case files, a
regional-language translation pipeline, and multi-provider LLM routing.
*(`scripts/deploy-police-cases-kb-cloudrun.sh`)*

The system has been exercised against real criminal case corpora — murder, rape/POCSO, and
narcotics files comprising FIRs, chargesheets, FSL forensic reports, panchanamas, witness
statements, and court judgments (acquittals and convictions).

---

## Why It Matters for Investigators

| Investigator Need | IntelliRAG Capability |
|---|---|
| Find everything on one case, fast | Case-/FIR-/station-scoped natural-language search with citations |
| Understand *why* a case succeeded or failed | Legal knowledge graph with conviction/acquittal causation |
| Surface the statutes in play | Automatic IPC / CrPC / NDPS / POCSO section extraction |
| Protect sealed and victim-sensitive material | Chunk-level four-tier clearance + redaction flags |
| Work across regional languages | Legal-term-preserving Telugu / Urdu / Hindi translation |
| Submit defensible evidence | SHA-256 verified evidence packages with chain-of-custody manifest |
| Keep an audit trail | Exporter logging, masking, watermarking, stale-citation warnings |

---

## Summary

IntelliRAG combines a modern RAG engine (vector + lexical + graph + metadata retrieval) with a
law-enforcement domain layer carried over from the policing-apps project. Its differentiators
for police work are not bolt-ons but built into the data model, the ingestion pipeline, and the
access-control core: case-aware documents, statutory extraction, a forensic knowledge graph,
multi-tier sensitivity, regional-language legal translation, and cryptographically auditable
evidence export. The result is a knowledge platform an investigations unit can deploy —
on-premises or in the cloud — to turn a case file backlog into an instantly queryable, access-
controlled, court-defensible knowledge base.
