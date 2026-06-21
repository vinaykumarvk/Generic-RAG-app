# Development Plan: Judgment Hybrid Retrieval and Legal Ontology

## Overview

Build a judgment workspace where the LLM wiki, legal knowledge graph, and vector database operate as coordinated retrieval channels. The goal is to produce answers that combine reviewed legal synthesis, graph-structured reasoning, and exact source evidence from judgments.

Plain product goal: a police officer or legal reviewer should be able to ask a practical judgment question and receive an answer that is jurisdiction-aware, current, source-grounded, reviewable, and framed around lawful investigation quality and evidence reliability.

## Assumptions

- The judgment workspace will use a separate physical database or separate database connection as already recommended, while reusing the current application shell and worker pipeline.
- The raw judgment corpus, metadata, chunks, embeddings, and graph remain authoritative over any LLM-written wiki article.
- LLM wiki articles are approved learning and synthesis artifacts, not legal sources of truth.
- The first implementation should target criminal judgments, especially POCSO, IPC/BNS sexual offences, murder, NDPS, and investigation/procedure issues.
- Legal SME review is required before wiki articles become approved officer-facing guidance.
- The MVP should be limited to one offence family and one end-to-end retrieval path until legal normalization and extraction quality are proven.
- Pattern analytics must disclose corpus scope, denominator, missing data, OCR failures, and selection bias.
- POCSO and sexual-offence material requires redaction, role-based access, safe citation display, and audit trails before officer-facing use.

## Codebase Findings

- `apps/api/src/retrieval/pipeline.ts` - Existing 11-step retrieval pipeline already orchestrates cache, query expansion, entity detection, vector search, lexical search, graph lookup, rerank, access filtering, answer generation, cache write, and trace recording.
- `apps/api/src/retrieval/vector-search.ts` - Uses pgvector over `chunk.embedding` and returns source chunks with document metadata.
- `apps/api/src/retrieval/lexical-search.ts` - Uses PostgreSQL FTS over `chunk.fts_vector`; this is important for exact legal terms, sections, citations, and case names.
- `apps/api/src/retrieval/graph-context.ts` - Already performs semantic graph node discovery, entity name matching, BFS expansion, and returns related chunk IDs for reranker boosts.
- `apps/api/src/retrieval/reranker.ts` - Already supports weighted vector, lexical, graph, and metadata scoring. It should be extended to score wiki articles and graph paths as first-class evidence objects.
- `apps/api/src/retrieval/answer-generator.ts` - Already injects raw chunk context and graph context separately into the answer prompt with citation rules.
- `apps/api/src/retrieval/trace-recorder.ts` and `apps/api/src/migrations/020_answer_journeys.sql` - Existing answer journey tracing can record the added wiki-selection, graph-path, and evidence-fusion steps.
- `apps/api/src/routes/rag-routes.ts` - Query route currently supports `hybrid`, `vector_only`, `metadata_only`, and `graph_only`; it needs a richer retrieval profile for judgment work.
- `apps/api/src/routes/graph-routes.ts` - Existing graph browsing, stats, reindex, and node/edge APIs provide a base for legal graph exploration.
- `apps/api/src/routes/workspace-routes.ts` - Workspace settings are already patchable and can store a versioned `kgOntology`.
- `apps/api/src/migrations/008_knowledge_graph.sql` and `apps/api/src/migrations/013_kg_enrichment.sql` - Existing graph tables support nodes, edges, assertions, provenance, confidence, and source chunks.
- `apps/worker/src/pipeline/kg_extractor.py` - KG extractor already reads `workspace.settings.kgOntology`, builds entity and relationship prompts from node and edge types, and stores graph provenance.
- `docs/JUDGMENT_INGESTION_BRIEF.md` - Judgment acquisition spec already identifies source metadata, court/year filters, criminal filters, and rich legal metadata.
- `docs/ontology/judgment-legal-ontology-v1.json` - Draft legal ontology for judgment KG extraction has been added as the starting point.

## Architecture Decisions

- **Triad retrieval, not competing retrieval**: Use wiki, graph, and vector/lexical search as complementary channels. Wiki provides reviewed synthesis, graph provides structured relationships and paths, and vector/lexical search provides raw source evidence.
- **Metadata gates before semantic retrieval**: Court, year, statute, section, outcome, offence category, judge, and document language should narrow the candidate corpus before vector and graph expansion when available.
- **Wiki as high-precision prior**: Approved wiki articles should seed search terms, graph nodes, and source judgment candidates. They should not answer alone unless the user asks for a conceptual overview and the answer still cites source judgments.
- **Graph as reasoning bridge**: Graph paths should connect issues, statutes, evidence, lapses, holdings, outcomes, courts, and cited precedents. Graph nodes and edges should boost related chunks but not replace citations.
- **Vector/lexical as evidence substrate**: Raw chunks remain the final source for source-specific legal claims.
- **Ontology versioning**: Store the legal ontology version in workspace settings and every KG provenance row or extraction job metadata.
- **Claim-level provenance**: Every wiki claim, graph assertion, and generated answer claim should trace to judgment IDs and chunk or paragraph anchors.
- **Query-profile routing**: Different questions should weight the triad differently. Case-specific questions favor raw chunks; doctrine questions favor wiki and graph; pattern questions favor graph aggregates plus representative chunks.
- **Phase 0 before triad fusion**: Legal-grade normalization, authority modeling, temporal validity, per-accused/per-charge outcome modeling, corpus validity, sensitive-data governance, and closed-schema KG extraction are gates before full wiki+graph+vector fusion.
- **Raw text as independent authority**: Wiki and KG may explain and prioritize; they must not corroborate each other without raw judgment text. Every answer claim that matters legally must cite source judgment text.
- **Closed-schema legal extraction**: Judgment KG extraction must not introduce new edge types outside the ontology unless the result is quarantined for review.
- **High-risk causal claims as assertions**: Edges such as `outcome_caused_by`, `supports_acquittal`, `lapse_caused_doubt`, and `non_compliance_with` must carry quote-backed source spans and default to unreviewed status.

## How The Three Retrieval Layers Work Together

1. Query analyzer extracts:
   - intent: `case_specific`, `doctrine`, `pattern_analysis`, `officer_lesson`, `precedent_trace`, `comparison`
   - filters: court, year/date range, statute, section, offence, outcome, judge, parties, language
   - graph seeds: legal issues, statutes, evidence types, investigation lapses, outcomes
2. Wiki selector retrieves approved or pending-review wiki articles by:
   - frontmatter filters
   - article embedding similarity
   - lexical matches on statute/section/issue/outcome
   - optional lightweight LLM selection over hierarchical indexes
3. Graph retriever starts from query entities plus selected wiki article tags and source judgments, then expands:
   - issue -> requirement -> lapse -> outcome
   - statute/section -> legal test -> holding -> precedent
   - evidence -> credibility finding -> outcome
4. Vector and lexical retrievers search raw judgment chunks using:
   - original query
   - query expansion
   - graph-expanded terms
   - wiki-selected source judgments and related sections
5. Evidence fusion builds a candidate set:
   - `raw_chunk`
   - `wiki_article`
   - `graph_node`
   - `graph_edge`
   - `graph_path`
   - `judgment_metadata_facet`
6. Reranker scores candidates by:
   - source channel score
   - exact statute/section/citation match
   - court hierarchy and date relevance
   - graph path confidence
   - wiki review status
   - source chunk citation quality
   - user filters and access controls
7. Answer generator writes structured answers:
   - reviewed doctrine or synthesis
   - graph explanation of relationships
   - direct evidence from judgments with citations
   - policing lessons or investigation-quality implications
   - limits, conflicts, and missing evidence
8. Feedback loop:
   - unanswered queries become wiki coverage gaps
   - weak graph paths become review queue items
   - repeated raw chunks become candidate wiki article sources
   - legal reviewer decisions update wiki status and graph confidence

## Legal Ontology Summary

The ontology in `docs/ontology/judgment-legal-ontology-v1.json` defines judgment-specific graph extraction around these entity families:

- Court structure: judgment, case, court, bench, judge.
- Participants: party, person, agency, counsel, police, victim, accused, witness.
- Legal materials: statute, statutory section, offence, charge, precedent, citation.
- Reasoning: legal issue, legal test, argument, finding, holding, reason.
- Evidence and procedure: evidence, document record, procedural requirement, investigation step, investigation lapse.
- Result: outcome, sentence, relief.
- Context: date and location.

Key edge families:

- Court/case structure: `decided_by`, `heard_by`, `authored_by`, `party_to`, `appeal_from`.
- Precedent: `cites`, `follows`, `distinguishes`, `overrules_or_disapproves`.
- Statutory reasoning: `interprets`, `applies`, `charges_under`, `convicted_under`, `acquitted_of`.
- Issue/reasoning: `concerns_issue`, `issue_decided_by`, `holding_supported_by`, `reason_based_on`, `finding_on`.
- Outcome causality: `outcome_of`, `outcome_caused_by`, `supports_conviction`, `supports_acquittal`.
- Evidence: `evidence_relied_on`, `evidence_rejected_because`, `evidence_contradicts`, `witness_testified_to`.
- Policing/procedure: `procedural_requirement_for`, `complied_with`, `non_compliance_with`, `investigation_lapse_in`, `lapse_caused_doubt`.
- Recovery/custody: `seized_from`, `recovered_from`, `chain_of_custody_for`.

## Dependency Graph

```text
Phase 0 --> Phase 1 --> Phase 2 --> Phase 3 --\
                                               --> Phase 5 --> Phase 6 --> Phase 7
                         Phase 4 -------------/
```

## Conventions

- Store all judgment-specific KG ontology changes as versioned JSON under `docs/ontology/` and load them into `workspace.settings.kgOntology`.
- Treat every LLM-generated wiki article and graph assertion as derived until reviewed.
- Use exact judgment IDs, document IDs, chunk IDs, and paragraph/page anchors wherever possible.
- Keep query orchestration inside `apps/api/src/retrieval/pipeline.ts` and related retrieval modules.
- Extend answer journey traces rather than adding separate logging.
- Keep review UI and legal quality gates part of the feature, not an afterthought.

---

## Phase 0: Legal Evidence Contract and Pilot Gate

**Dependencies:** none

**Description:**
Define the legal-grade evidence contract that every later retrieval layer must satisfy. This phase prevents the wiki, graph, and vector layers from reinforcing bad metadata, weak OCR, unsupported causal claims, or unsafe sensitive-data exposure.

**Tasks:**
1. Select the first pilot domain, preferably NDPS Section 50/search and seizure or POCSO age proof.
2. Define the judgment evidence contract:
   - canonical judgment ID
   - court and bench strength
   - appeal posture
   - decision date and incident/offence date where available
   - applicable legal regime and statute version
   - paragraph/page anchors
   - source quality and OCR confidence
   - per-accused, per-charge, per-section outcome
   - outcome reason and supporting source span
3. Add authority and temporal validity requirements:
   - court hierarchy
   - binding/persuasive value
   - later treatment
   - overruled, distinguished, followed, per incuriam, unknown
   - IPC/BNS, CrPC/BNSS, Evidence Act/BSA transition handling
   - law applicable on offence date vs judgment date
4. Define sensitive-data governance for POCSO and sexual-offence cases:
   - victim/minor identity redaction
   - safe citation display rules
   - role-based access
   - audit trail for sensitive views
   - retention and export restrictions
5. Define corpus validity reporting:
   - courts included
   - years included
   - source buckets and licences
   - OCR failure rate
   - missing metadata rate
   - reported/unreported coverage caveats
   - selection criteria and denominator
6. Build a gold evaluation set of 25-50 pilot questions with expected source citations, legal issue labels, and acceptable answer traits.
7. Define extraction quality gates before Phase 3:
   - no out-of-ontology edges in approved graph
   - high-risk causal assertions require quoted source spans
   - reviewer approval required for officer-facing policing lessons

**Files to create/modify:**
- `docs/judgment-evidence-contract.md` - Legal evidence contract and source quality gates.
- `docs/ontology/judgment-legal-ontology-v1.json` - Add authority, temporal validity, and sensitive-data fields where needed.
- `docs/evaluations/judgment-pilot-eval-set.md` - Gold pilot questions and expected evidence.
- `apps/api/src/migrations/025_judgment_metadata.sql` - Include evidence-contract fields in Phase 2 implementation.

**Acceptance criteria:**
- Pilot scope is explicit and small enough to validate manually.
- Every legally material answer claim has a required path back to raw judgment text.
- Pattern-analysis outputs must include a corpus card.
- Sensitive-data handling rules are defined before POCSO or sexual-offence answers are exposed.
- Triad fusion is not implemented until evidence-contract and extraction benchmark gates pass.

---

## Phase 1: Contracts, Workspace Settings, and Ontology Loading

**Dependencies:** Phase 0

**Description:**
Establish the contracts for judgment workspaces, legal ontology versioning, and retrieval profile configuration.

**Tasks:**
1. Add a judgment workspace convention in workspace settings, for example `{ "workspaceKind": "judgments", "kgOntologyVersion": "judgment-legal-ontology-v1" }`.
2. Add a loader or seed path that can apply `docs/ontology/judgment-legal-ontology-v1.json` to `workspace.settings.kgOntology`.
3. Define retrieval profiles for judgment queries: `case_specific`, `doctrine`, `pattern_analysis`, `officer_lesson`, `precedent_trace`, `comparison`.
4. Document expected source identifiers: `judgment_id`, `document_id`, `chunk_id`, `paragraph_number`, `page_start`, `court_code`, `decision_date`.
5. Add tests that confirm the KG extractor receives the legal ontology from workspace settings.
6. Enforce closed-schema extraction for judgment workspaces; new edge types should be rejected or quarantined for review.
7. Resolve the assertion schema mismatch between ontology `assertionTypes` and `kg_assertion.assertion_type`.
8. Add `ontology_version`, `review_status`, and `source_span` to legal KG provenance design.

**Files to create/modify:**
- `docs/ontology/judgment-legal-ontology-v1.json` - Starting ontology.
- `apps/api/src/routes/workspace-routes.ts` - Optional helper for applying ontology settings.
- `apps/worker/src/pipeline/kg_extractor.py` - Ensure ontology version and legal node/edge types are logged into extraction metadata.
- `apps/worker/tests/test_kg_extractor.py` - Coverage for judgment ontology loading.

**Acceptance criteria:**
- A judgment workspace can be configured with the legal ontology without code changes.
- KG extraction prompts include judgment-specific node and edge types.
- Extraction logs or provenance include ontology version.
- The relationship prompt no longer permits arbitrary new edge types for judgment workspaces.
- Legal assertion types are compatible with database constraints.

---

## Phase 2: Judgment Metadata and Provenance Schema

**Dependencies:** Phase 1

**Description:**
Add judgment-specific metadata and provenance so vector, graph, and wiki retrieval can filter and cite accurately.

**Tasks:**
1. Create judgment metadata tables or JSON schema for court, year, decision date, citation, CNR, parties, judges, author judge, disposal nature, statutes, sections, and source path.
2. Add optional paragraph/section anchors to chunk metadata when available.
3. Add legal extraction provenance fields for `ontology_version`, `claim_type`, `source_span`, and `review_status`.
4. Add indexes for high-value filters: court, decision date, statute, section, offence category, outcome, judge, citation, CNR.
5. Ensure document/chunk access controls still apply to judgment corpus data.
6. Model per-accused, per-charge, per-section outcomes rather than document-level outcome only.
7. Model legal temporal applicability and statutory transition fields.
8. Add source-quality fields for OCR confidence, paragraph-anchor confidence, metadata confidence, and correction status.
9. Add sensitive-data flags and redaction status for victim/minor-identifying content.

**Files to create/modify:**
- `apps/api/src/migrations/025_judgment_metadata.sql` - New judgment metadata, indexes, and provenance fields.
- `apps/api/src/retrieval/vector-search.ts` - Support judgment filters.
- `apps/api/src/retrieval/lexical-search.ts` - Support judgment filters and exact statute/citation terms.
- `apps/worker/src/pipeline/metadata_extractor.py` - Populate judgment metadata from source metadata and extracted text.

**Acceptance criteria:**
- Queries can hard-filter by court, year/date range, statute, section, outcome, and source judgment.
- Every retrieved chunk can expose source judgment metadata in citations.
- Provenance records can identify which ontology version generated graph data.
- Outcome queries can distinguish accused, charge, section, appeal posture, and reason.
- Legal regime/date filters can prevent stale or inapplicable law from being presented as current.

---

## Phase 3: Legal KG Extraction and Graph Quality Controls

**Dependencies:** Phase 2

**Description:**
Adapt KG extraction from generic entity extraction to legal-case extraction using the judgment ontology.

**Tasks:**
1. Add legal few-shot examples for holdings, issues, evidence, outcomes, investigation lapses, and precedent treatment.
2. Enforce extraction rules that distinguish allegation, argument, finding, holding, and final outcome.
3. Store confidence and review status on high-impact legal edges such as `outcome_caused_by`, `supports_acquittal`, `non_compliance_with`, and `evidence_rejected_because`.
4. Add graph assertions for claim-level legal statements where a simple edge is insufficient.
5. Add review queue rules for ambiguous or high-impact inferences.
6. Add graph QA reports for dangling nodes, overused `related_to`, low-confidence outcome edges, and ungrounded investigation-lapse claims.

**Files to create/modify:**
- `apps/worker/src/pipeline/kg_extractor.py` - Legal prompt builder, legal few-shots, confidence handling.
- `apps/api/src/migrations/026_judgment_kg_quality.sql` - Optional legal graph QA tables or fields.
- `apps/api/src/routes/review-queue-routes.ts` - Legal KG review queue filters.
- `apps/worker/tests/test_kg_extractor.py` - Legal extraction fixtures and assertions.

**Acceptance criteria:**
- The graph can answer path questions such as issue -> lapse -> outcome -> source judgment.
- High-impact inferred legal relationships are reviewable.
- Generic `related_to` edges are below an agreed threshold in legal extraction output.
- Causal outcome relationships include quoted source spans and default to unreviewed until approved.
- Generic few-shot examples are replaced by legal pilot examples before extraction is run on the corpus.

---

## Phase 4: Legal Doctrine Wiki Layer

**Dependencies:** Phase 2

**Description:**
Create a governed wiki layer for reviewed doctrine, recurring failure factors, and officer learning.

**Tasks:**
1. Define legal wiki frontmatter for court scope, statutes, sections, issue tags, outcome focus, policing stage, source judgments, source chunks, confidence, review status, and supersession.
2. Add wiki article storage and index tables for judgment workspaces.
3. Add article embeddings and FTS so wiki articles can be retrieved without reading a giant index on every query.
4. Add citation verification requiring every material wiki claim to cite a judgment chunk or paragraph.
5. Add legal review workflow: draft -> pending legal review -> approved -> deprecated.
6. Add coverage-gap logging when queries find strong raw evidence but no matching approved wiki article.
7. Require wiki articles to declare corpus scope, legal validity window, court scope, and review status.

**Files to create/modify:**
- `apps/api/src/migrations/027_legal_wiki.sql` - Legal wiki articles, source links, embeddings, review status.
- `apps/api/src/retrieval/wiki-selector.ts` - New wiki retrieval channel.
- `apps/api/src/routes/review-queue-routes.ts` - Article review workflow.
- `apps/api/src/routes/rag-routes.ts` - Expose wiki-aware retrieval profile options.
- `docs/evaluations/judgment-llm-wiki-evaluation-20260521-224108.md` - Keep as background architecture note.

**Acceptance criteria:**
- Approved wiki articles can be selected by query, filters, embeddings, and frontmatter.
- Wiki article claims fail approval when citation coverage is insufficient.
- The system can report wiki coverage gaps by issue/statute/court/outcome.
- Wiki articles cannot be used as officer-facing guidance until legal review is complete.

---

## Phase 5: Triad Retrieval Orchestration and Fusion

**Dependencies:** Phase 3, Phase 4

**Description:**
Modify the query pipeline so wiki, graph, vector, lexical, and metadata all influence each other rather than running as isolated channels.

**Tasks:**
1. Add a query planner that classifies query intent and selects a retrieval profile.
2. Run wiki selection, graph lookup, vector search, and lexical search in parallel where possible.
3. Use selected wiki articles to seed graph nodes, source judgments, and vector query expansions.
4. Use graph paths and related chunk IDs to boost raw judgment chunks.
5. Use vector/lexical top chunks to validate or supplement wiki and graph context.
6. Extend reranker to score `wiki_article`, `graph_path`, and `raw_chunk` candidates with query-profile-specific weights.
7. Extend answer journey traces with `wiki_selection`, `graph_path_extraction`, and `evidence_fusion` steps.
8. Add anti-circularity rules: wiki and KG can prioritize retrieval, but raw judgment text must independently support legally material answer claims.

**Files to create/modify:**
- `apps/api/src/retrieval/pipeline.ts` - Add wiki and graph-path orchestration.
- `apps/api/src/retrieval/wiki-selector.ts` - New wiki article selector.
- `apps/api/src/retrieval/graph-context.ts` - Return paths/assertions, not only nodes/edges/chunk IDs.
- `apps/api/src/retrieval/reranker.ts` - Add candidate-type scoring and profile weights.
- `apps/api/src/retrieval/trace-recorder.ts` - Include wiki and graph path metrics.
- `apps/api/src/__tests__/retrieval/pipeline.test.ts` - Hybrid triad pipeline coverage.

**Acceptance criteria:**
- A doctrine query can retrieve reviewed wiki synthesis, supporting graph paths, and source chunks.
- A case-specific query prioritizes raw chunks while still using graph/wiki context for framing.
- A pattern query can summarize recurring outcome reasons and cite representative judgments.
- Answer journey shows which parts came from wiki, graph, vector, and lexical search.
- Fusion outputs disclose corpus scope and source-quality warnings for pattern answers.

---

## Phase 6: Answer Composition, UI, and Officer-Facing Reviewability

**Dependencies:** Phase 5

**Description:**
Expose the triad retrieval result in a way that officers and reviewers can inspect.

**Tasks:**
1. Update answer generation to produce sections such as `Reviewed position`, `What courts relied on`, `Why the State/police succeeded or failed`, `Source judgments`, and `Limits`.
2. Show wiki article references separately from raw judgment citations.
3. Show graph paths used in the answer, including confidence and review status.
4. Extend answer journey UI to display wiki, graph, vector, lexical, and reranker contributions.
5. Add reviewer actions for wrong graph edge, weak wiki claim, missing citation, and useful answer.
6. Add sensitive citation display rules for POCSO and sexual-offence cases.

**Files to create/modify:**
- `apps/api/src/retrieval/answer-generator.ts` - Triad-aware answer prompt and output structure.
- `apps/web/src/components/conversation/AnswerJourneyPanel.tsx` - New triad steps.
- `apps/web/src/components/conversation/ReferencesSection.tsx` - Separate wiki, graph, and raw judgment evidence.
- `apps/web/src/pages/GraphExplorerPage.tsx` - Legal graph path display improvements.
- `apps/web/src/pages/FeedbackDashboardPage.tsx` - Legal quality feedback categories.

**Acceptance criteria:**
- Users can inspect why an answer was produced and which retrieval layer contributed each piece.
- Answers do not present unreviewed wiki or inferred graph claims as final legal conclusions.
- Feedback can target the specific failed layer: wiki, graph, vector chunk, metadata filter, or answer synthesis.
- Officer-facing answers frame recommendations as lawful investigation quality and evidence reliability, not conviction optimization.

---

## Phase 7: Pilot Evaluation and Release Verification

**Dependencies:** Phase 6

**Description:**
Validate the combined system on a narrow legal pilot before scaling to all courts and issues.

**Tasks:**
1. Select one pilot domain: NDPS search/seizure compliance or POCSO age proof.
2. Ingest Supreme Court plus two High Courts for five years.
3. Create 30 to 50 reviewed wiki articles.
4. Build an evaluation set of 50 to 100 officer-style questions.
5. Compare raw vector-only, graph-only, wiki-only, and triad retrieval answers.
6. Measure citation correctness, legal reviewer acceptance, coverage gaps, latency, and answer usefulness.
7. Run API, worker, and web tests plus local smoke verification.

**Files to create/modify:**
- `docs/evaluations/judgment-triad-pilot-results.md` - Pilot results and decision record.
- `apps/api/src/__tests__/retrieval/*` - Retrieval regression tests.
- `apps/worker/tests/*` - Metadata and KG extraction tests.
- `e2e/tests/*` - Officer query and answer journey checks.

**Acceptance criteria:**
- Triad retrieval outperforms vector-only and graph-only baselines on reviewer-rated answer quality.
- Approved wiki claims have verified judgment citations.
- High-impact graph edges have provenance and review status.
- Common query failures create actionable wiki or graph coverage-gap records.
- Local build, migration, worker, API, and UI smoke checks pass.
