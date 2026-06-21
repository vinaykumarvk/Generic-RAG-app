# Evaluation: Judgment Hybrid Retrieval and Legal Ontology

Date: 2026-05-22
Verdict: Approve with major restructuring.

## Recommendation

Chairman synthesis: approve with major restructuring. The triad architecture is conceptually correct, but the plan must not proceed directly to full wiki+graph+vector fusion. The first gate must be legal evidence quality: normalized metadata, source spans, paragraph/page anchors, authority and temporal validity, per-accused/per-charge outcomes, closed-schema KG extraction, sensitive-data governance, and a gold evaluation set. Only after the pilot proves reliable extraction and answer grounding should the system build the full legal wiki and fusion reranker.

Recommendation: proceed, but revise the plan to add Phase 0 and narrow the MVP to one offence family. Implement ontology enforcement and assertion schema compatibility before running KG extraction at scale.

## Where The Council Agrees

- The triad architecture is conceptually correct: wiki for reviewed synthesis, graph for relationships, vector/lexical for source evidence.
- Raw judgment text must remain the independent authority.
- The plan is too broad for immediate full implementation.
- A Phase 0 gate is required before triad fusion.
- The KG extractor must be closed-schema for judgment workspaces.
- Legal SME review is a core safety feature, not optional polish.

## Where The Council Clashes

- The proponent sees the plan as close to implementation-ready because it extends existing IntelliRAG pipeline surfaces.
- The other advisors and peer reviewers argue the retrieval plumbing is not the hard part; legal normalization, evidence fidelity, and authority modeling are the hard part.

## Blind Spots Caught

- Temporal validity across IPC/BNS, CrPC/BNSS, Evidence Act/BSA, amendments, and later precedent treatment.
- Sensitive-data governance for POCSO and sexual-offence judgments.
- Corpus validity cards for pattern answers.
- Assertion type schema mismatch between ontology and existing database constraints.
- The current KG extractor permits new relationship types, which conflicts with legal ontology discipline.

## Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Triad fusion amplifies bad data | Critical | Add Phase 0 evidence contract; raw judgment text must independently support answer claims. |
| Unsupported causal graph edges | Critical | Closed-schema extraction; quote-backed source spans; review status defaults to unreviewed. |
| Authority and temporal validity errors | Critical | Model court hierarchy, bench strength, legal regime, amendment windows, later treatment. |
| POCSO/sexual-offence privacy exposure | Critical | Redaction, role-based access, audit trails, safe citation display, retention/export rules. |
| Multi-accused/multi-charge outcome collapse | High | Per-accused, per-charge, per-section, appeal-posture outcome schema. |
| Generic KG extractor pollutes legal graph | High | Legal few-shots; no arbitrary edge types; assertion schema compatibility tests. |
| Pattern answers overstate corpus validity | High | Corpus cards with denominator, courts, years, OCR failures, missing metadata, selection bias. |
| Plan too broad for MVP | Medium | Pilot one offence family, 100-300 judgments, 5-10 reviewed wiki articles, 25-50 eval questions. |


## First Step

Implement Phase 0 and then ontology enforcement in `kg_extractor.py`; do not start full triad fusion until evidence-contract and extraction-quality gates pass.
