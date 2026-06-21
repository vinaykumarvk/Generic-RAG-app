# Adversarial Evaluation: LLM Wiki and Graphify for Judgment Exploration

Date: 2026-05-21
Scope: Apply ideas from Karpathy's LLM Wiki pattern, the local `LLM wiki` repository, and `safishamsi/graphify` to the proposed judgment-ingestion workspace.

## Sources Inspected

- `docs/JUDGMENT_INGESTION_BRIEF.md` in this repository.
- `/Users/n15318/LLM wiki/doc/PS_WMS_LLM_WIKI_BRD_FINAL.md`.
- `/Users/n15318/LLM wiki/doc/evaluations/00-consolidated-summary.md`.
- `/Users/n15318/LLM wiki/src/services/*` for compilation, frontmatter validation, citation verification, article selection, and vector fallback.
- `https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f`.
- `https://github.com/safishamsi/graphify`, cloned locally to `/tmp/graphify-eval`.

## Executive Verdict

Use the LLM wiki pattern, but only as a governed doctrine and learning layer above the judgment corpus. Do not make it the primary storage, ingestion, or retrieval substrate for judgments.

The primary system for judgments should remain:

1. Raw judgment source of truth.
2. Normalized legal metadata.
3. Full text, chunks, embeddings, lexical indexes, citation graph, and legal knowledge graph.
4. Court/year/statute/outcome filters.

On top of that, add a curated "Legal Doctrine and Policing Lessons Wiki" that compiles repeatedly observed holdings, failure reasons, evidentiary lessons, procedural pitfalls, and court-specific patterns into reviewable Markdown articles with strict citations back to exact judgments.

Graphify should not be adopted wholesale. Its strongest ideas are confidence-tagged edges, graph/path exploration, community detection, shortest-path queries, and "surprising connection" reports. These should be adapted into the existing judgment knowledge graph and analytics layer, not used as the core ingestion engine.

## What Karpathy's LLM Wiki Adds

The strong idea is knowledge compounding. Instead of forcing the LLM to rediscover the same doctrine from raw chunks on every query, the system maintains a persistent set of structured pages that synthesize what has already been learned.

This is valuable for legal judgments because officers will repeatedly ask recurring questions:

- Why do NDPS searches fail?
- What defects lead to acquittal in POCSO age-proof cases?
- When does delay in FIR matter?
- How do courts treat hostile witnesses?
- What forensic-chain failures matter most?
- When do courts reject police recovery evidence?

For these questions, a curated wiki article can be much more useful than raw vector retrieval, provided every claim cites exact source judgments.

## Local LLM Wiki Assessment

The local `LLM wiki` repository is a useful implementation reference. Its best design features are:

- Filesystem articles as the human-readable wiki layer.
- Database rows as a derived index, not the authoritative text store.
- JSON-schema frontmatter validation on write paths.
- Source citation verification against raw source paths and sections.
- Staging before promotion.
- Human-authored article path.
- Review status, confidence, staleness, deprecation, and supersession.
- Hierarchical indexes once a single index becomes too large.
- Agent/query-specific token budgets.
- Vector fallback when no article is selected.

The repository's own adversarial review already caught issues that matter even more for legal judgments:

- Index token cost is easy to underestimate.
- Filesystem plus DB creates sync risk unless one source is declared authoritative.
- Git writes require serialization.
- Citation verification must be a hard gate.
- Contradiction detection must be bounded or it becomes expensive and noisy.
- Admin/review UI must be phased.

For judgments, these controls should be stricter than in PS-WMS. A legal wiki article is not just a helpful summary. It can influence training, investigation behavior, and litigation strategy. It needs legal-SME review before being marked approved.

## Graphify Assessment

Graphify is strongest as a graph exploration and assistant-memory tool. It builds a persistent `graph.json`, report, and optional wiki from code/docs/PDFs/images/video. It has confidence labels (`EXTRACTED`, `INFERRED`, `AMBIGUOUS`), community detection, "god nodes", surprising connections, shortest paths, query tools, MCP serving, and incremental updates.

The useful ideas for judgments are:

- Confidence labels on graph edges.
- Separation of explicitly extracted relationships from inferred relationships.
- Graph traversal as a retrieval mode.
- Community detection to discover clusters of issue/statute/outcome/failure-factor patterns.
- Path queries such as "what connects Section 50 NDPS to acquittals in Punjab and Haryana High Court?"
- Reports that surface high-degree concepts and unexpected cross-court patterns.
- Token-saving graph summaries for repeated exploration.

The dangerous parts are:

- Generic semantic graph extraction is not legal reasoning.
- A graph edge can look authoritative even when it is an LLM inference.
- "God nodes" may simply reflect corpus bias, not doctrinal importance.
- Community detection can expose useful clusters, but it cannot decide what the law is.
- The Graphify wiki export is exploratory and auto-generated. It lacks legal frontmatter, citation gates, precedential treatment, and review workflow.
- It is designed for project/code corpus exploration, not a 16-million-judgment legal corpus.

## Recommended Architecture

Create three layers for the judgment workspace.

### 1. Judgment Corpus Layer

This is authoritative.

Required tables or entities:

- `judgment_document`
- `judgment_source_file`
- `judgment_metadata`
- `judgment_party`
- `judgment_judge`
- `judgment_statute_section`
- `judgment_issue`
- `judgment_outcome`
- `judgment_citation`
- `judgment_chunk`
- `judgment_ingestion_job`
- `judgment_graph_node`
- `judgment_graph_edge`
- `judgment_source_manifest`

Keep this in the separate judgment database proposed for the new workspace.

### 2. Legal Knowledge Graph Layer

This is derived but queryable.

Core node types:

- Judgment
- Court
- Bench
- Judge
- Statute
- Section
- Legal issue
- Procedural requirement
- Evidence type
- Investigation lapse
- Outcome
- Holding
- Reason
- Cited precedent
- Police action

Core edge types:

- `cites`
- `applies`
- `distinguishes`
- `overrules_or_disapproves`
- `interprets_section`
- `turns_on_issue`
- `outcome_caused_by`
- `investigation_lapse`
- `evidence_rejected_because`
- `state_succeeded_because`
- `state_failed_because`

Every edge must have:

- `confidence`: `EXTRACTED`, `MODEL_INFERRED`, or `REVIEWED`
- `source_judgment_id`
- `source_chunk_id`
- paragraph/page reference where available
- extractor version
- review status

### 3. Legal Doctrine and Policing Lessons Wiki

This is the LLM wiki layer. It should be derived from corpus + graph + metadata, not from blind PDF summarization.

Example articles:

- `ndps_section_50_personal_search_compliance.md`
- `pocso_age_proof_school_records_vs_medical_opinion.md`
- `ipc_376_delay_in_fir_and_victim_testimony.md`
- `hostile_witnesses_effect_on_prosecution_case.md`
- `chain_of_custody_for_seized_contraband.md`
- `section_27_recovery_evidence_police_witnesses.md`
- `state_acquittal_patterns_delhi_hc_2020_2025.md`

Recommended legal frontmatter:

```yaml
title:
article_type: doctrine | issue | failure_factor | court_pattern | precedent | investigation_lesson
jurisdiction: India
court_scope: supreme_court | high_court | court_specific | all
court_codes: []
date_range:
statutes: []
sections: []
offence_categories: []
issue_tags: []
outcome_focus: conviction | acquittal | bail | appeal_allowed | appeal_dismissed | mixed
policing_stage: fir | investigation | search_seizure | arrest | witness | forensic | chargesheet | trial
source_judgments: []
source_chunks: []
precedential_status:
negative_treatment:
confidence:
review_status: draft | pending_legal_review | approved | deprecated
reviewed_by:
last_reviewed_at:
superseded_by:
```

Each material claim in the article body should cite a judgment and paragraph/chunk reference. Articles without sufficient citation coverage should not become approved training material.

## What To Borrow

Borrow from Karpathy:

- Persistent compiled knowledge, not query-time rediscovery only.
- Raw sources remain immutable source of truth.
- Wiki as interlinked Markdown for human and LLM consumption.
- Index first, then drill into selected articles.
- Log of ingests, updates, and query-derived learnings.
- Periodic linting for stale claims, contradictions, orphan pages, and missing topics.

Borrow from the local LLM wiki:

- Frontmatter schema gate.
- Citation verification gate.
- Review status and human approval.
- Staging before promotion.
- DB-derived index.
- Hierarchical index.
- Token-budget-aware article selection.
- Vector fallback and coverage-gap logging.
- Human-authored article endpoint.
- Staleness and supersession workflow.

Borrow from Graphify:

- Confidence-tagged graph edges.
- Graph traversal queries.
- Shortest-path explanations.
- Community detection for issue clusters.
- High-degree node reports.
- Surprising-connection reports.
- MCP-style graph query surface if agents will explore the corpus interactively.

## What Not To Borrow

Do not use a plain Markdown wiki as the authoritative legal store. Raw judgments and normalized metadata must remain authoritative.

Do not allow LLM-written articles to become training guidance without legal review.

Do not collapse dissent, minority reasoning, court-specific variation, or later negative treatment into one simplified article.

Do not rely on vector search alone for legal research. Use hybrid retrieval: metadata filters, lexical search, citations, graph traversal, and vector similarity.

Do not apply Graphify's generic graph extraction directly to all judgments. Legal extraction needs a domain schema and paragraph-level provenance.

Do not make "police success rate" optimization the product framing. The safer framing is: improve investigation quality, procedural compliance, evidence reliability, and court-readiness while respecting due process.

## Risk Register

| Risk | Severity | Why it matters | Mitigation |
|---|---:|---|---|
| Generated article misstates law | Critical | Officers may learn the wrong rule | Legal review, citation gates, exact paragraph references |
| Corpus scale overwhelms wiki | Critical | 16M HC judgments cannot become one wiki | Build topic/court/year scoped wikis and hierarchical indexes |
| Metadata filters miss cases | High | Criminal/civil classification may be noisy | Use metadata plus text classifiers plus statute extraction |
| Graph edges appear authoritative | High | Inferred links may be over-trusted | Edge confidence, provenance, review status, UI warnings |
| Court-specific doctrine is flattened | High | High Courts may diverge | Court scope, date range, precedential status, negative treatment |
| Officer advice becomes biased | High | The system may optimize convictions over fairness | Focus on lawful evidence quality and procedural compliance |
| Citation drift | Medium | Source paths or chunk IDs can change | Stable judgment IDs, content hashes, paragraph anchors |
| Token and cost underestimation | Medium | Wiki index selection can become expensive | Hierarchical indexes, cached selectors, precomputed article embeddings |

## Recommended First Pilot

Do not start with all courts and all criminal law. Start narrow.

Pilot scope:

- One issue family: NDPS search and seizure compliance, or POCSO age proof.
- Supreme Court plus two High Courts.
- Five years of judgments.
- Target 500 to 2,000 judgments after metadata and text filtering.

Pilot deliverables:

- Judgment-specific DB schema and source manifest.
- Metadata-first downloader with court/year/statute/outcome filters.
- Paragraph-aware chunking where possible.
- Legal KG extraction for issue/outcome/failure-factor edges.
- 30 to 50 reviewed wiki articles.
- Citation verification with hard approval threshold.
- Officer-facing queries:
  - "Why did the prosecution fail in cases like this?"
  - "Which investigation defects recur in this court?"
  - "What evidence did courts accept in successful prosecutions?"
  - "What procedural safeguards were decisive?"

Success criteria:

- Every approved wiki claim traces to a judgment and paragraph/chunk.
- The same query answered through raw RAG and through wiki+graph shows better consistency in wiki+graph.
- Legal reviewers reject fewer than 10 percent of generated article claims after prompt/schema iteration.
- Coverage-gap logs identify the next 20 articles to compile.

## Final Recommendation

Adopt the LLM wiki idea as a governed legal synthesis layer and adopt selected Graphify ideas as graph exploration features. Keep the judgment ingestion pipeline, metadata store, vector store, citation graph, and legal knowledge graph as the core system.

The best version of this application is not "RAG over PDFs" and not "an LLM-written wiki." It is a legally governed judgment intelligence system where raw judgments, metadata, graph reasoning, and reviewed doctrine pages reinforce each other.

