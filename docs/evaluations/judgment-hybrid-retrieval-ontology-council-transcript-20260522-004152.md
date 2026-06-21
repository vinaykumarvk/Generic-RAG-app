# Council Transcript: Judgment Hybrid Retrieval and Legal Ontology

Date: 2026-05-22
Question: Evaluate whether to proceed with the plan combining LLM wiki, legal knowledge graph, and vector/lexical database for Indian judgment exploration in IntelliRAG.

## Context Reviewed

- `docs/plan-judgment-hybrid-retrieval-ontology.md`
- `docs/ontology/judgment-legal-ontology-v1.json`
- `docs/evaluations/judgment-llm-wiki-evaluation-20260521-224108.md`
- `docs/JUDGMENT_INGESTION_BRIEF.md`
- Existing retrieval/KG implementation in `apps/api/src/retrieval/pipeline.ts` and `apps/worker/src/pipeline/kg_extractor.py`
- Karpathy LLM Wiki gist and Graphify public repository

## Advisor Responses

### Advisor 1: Proponent

The plan is sound and unusually implementation-ready because it does not propose a new retrieval architecture from scratch; it extends the existing IntelliRAG spine. `pipeline.ts` already has the right control points: query expansion, entity detection, vector search, lexical search, graph lookup, reranking, answer generation, and trace recording. The plan’s triad model maps cleanly onto that: wiki as reviewed synthesis, KG as relationship reasoning, and vector/lexical DB as source-grounded evidence. That division is strategically strong because legal judgment exploration needs all three: exact statutory/citation recall, precedent and reasoning paths, and distilled officer-facing lessons.

The ontology is also directionally strong. It captures the core legal objects: courts, benches, judges, parties, statutes, sections, offences, charges, issues, tests, evidence, procedural requirements, investigation lapses, findings, holdings, reasons, outcomes, sentencing, precedent, and citations. Most importantly, it encodes distinctions that generic KGs usually miss: allegation vs argument vs finding vs holding vs outcome. That is essential for legal reliability. The extraction rules also correctly prevent turning defence submissions or prosecution claims into court findings.

The biggest advantage is compounding quality. Wiki articles can seed graph and raw search; graph paths can reveal why outcomes occurred; vector/lexical retrieval can verify every claim against source chunks. This should materially outperform any single channel for questions like “why did NDPS acquittals happen in Punjab and Haryana High Court in 2022?”

Concrete strengthening changes: add a dedicated legal_query_planner; add court hierarchy and precedent treatment fields; make high-risk graph edges claim-backed assertions; add a golden evaluation set; fix ontology polish before seeding.

### Advisor 2: Contrarian

The fatal flaw is that the plan treats “triad retrieval fusion” as the hard problem, but the real hard problem is legal-grade normalization and validation before retrieval. Without that, the LLM wiki, KG, and vector DB will simply reinforce each other’s errors with more persuasive explanations.

The current ontology is a good draft, but it is too flat for Indian judgment reasoning. It lacks explicit authority modeling: court hierarchy, bench strength, binding vs persuasive value, later treatment, overruled-by, per incuriam, statutory amendment period, and IPC/BNS/CrPC/BNSS transition validity. It also under-models multi-accused and multi-charge outcomes. “Conviction set aside” or “acquittal” must be tied to accused, charge, section, court level, appeal posture, and reason.

Data quality is the second major risk. Indian judgments often have inconsistent metadata, OCR noise, missing paragraph numbers, multilingual text, messy citations, and party-name ambiguity. The KG extractor is not yet implementation-ready for legal claims: generic few-shot examples, content truncation, new relationship types, fuzzy matching, and heuristic confidence are dangerous for causal legal edges.

Retrieval fusion also risks circularity. Wiki articles seed graph and vector search; graph boosts chunks; chunks validate wiki. If one layer is wrong, it may bias the others. Make it bulletproof by adding a Phase 0: legal citation/metadata normalization, authority model, per-accused/per-charge outcome schema, gold evaluation set, and extraction quality gates before triad fusion.

### Advisor 3: First Principles Thinker

The real problem is not “how do we combine wiki, KG, and vectors?” It is: can a police officer or legal reviewer ask a legally consequential question and receive an answer that is accurate, source-grounded, current, jurisdiction-aware, and usable for improving investigation quality without overstating what the cases prove?

The plan is directionally sound but not yet implementation-ready. The conceptual split is right, but triad retrieval can become three noisy systems voting together unless every legal conclusion resolves to exact judgment text, every causal claim distinguishes court holding from party argument, and every policing lesson is reviewed.

The ontology is a strong first draft, especially its distinction between allegation, argument, finding, holding, reason, evidence, lapse, and outcome. But legal causality is the hard part. Edges like `outcome_caused_by`, `supports_acquittal`, and `lapse_caused_doubt` require paragraph-level legal reasoning extraction with evidence spans and review queues.

Proceed, but reorder the plan: first build a narrow judgment evidence contract and ontology extraction benchmark for one domain, such as NDPS Section 50 or POCSO age proof. Only after the system can reliably extract issue -> evidence -> finding -> outcome from 100 judgments should wiki generation and triad fusion become central.

### Advisor 4: Outsider

The plan is directionally credible, but it assumes the reader already believes “LLM wiki + graph + vector” is the right answer. The goal should be stated plainly: officers should ask practical judgment questions and receive answers backed by reviewed summaries, relationship paths, and exact source citations.

The strongest part is the insistence that raw judgments remain authoritative while wiki and graph outputs are derived and reviewable. The biggest usability problem is complexity. The plan needs a visible user journey: search, answer, citations, graph explanation, feedback, reviewer correction, improved future answer.

The review process is underdefined. Legal SME review must specify who reviews what, at what threshold, with what queue priority, and how conflicting legal interpretations are resolved. The ontology is useful but too broad for a first version. High-risk causal edges require quoted support and reviewer approval by default.

The current KG extractor prompt says it may introduce new relationship types if needed. That undermines ontology discipline. For this domain, extraction should be closed-schema or strictly review-gated.

### Advisor 5: Executor

Feasible, but too broad unless the MVP is tightened around one offence family and one end-to-end retrieval path. The sequencing is mostly right: ontology -> metadata/provenance -> legal KG -> wiki -> fusion. The main correction is that Phase 2 must include the schema contract for all three layers, not just judgment metadata.

First: load `judgment-legal-ontology-v1.json` into `workspace.settings.kgOntology`, then fix `kg_extractor.py` so the ontology is actually enforced. Today it loads workspace ontology, but the relationship prompt still says “introduce new ones if needed,” and the few-shots are generic. First implementation task should be legal few-shots, no out-of-ontology edge types, extractionRules included in prompts, and tests proving legal node/edge types appear.

Big schema risk: ontology `assertionTypes` are lowercase legal categories, but `kg_assertion.assertion_type` currently allows uppercase generic values only. Add `ontology_version`, `review_status`, and `source_span` early. MVP should cover one domain, maybe NDPS Section 50/search seizure, with 100-300 judgments, 5-10 reviewed wiki articles, and 25 evaluation questions.

## Anonymous Peer Review Summary

All five peer reviewers selected Response C as strongest or most decision-relevant, with Response D as the closest actionable runner-up. They consistently judged Response B too optimistic because existing IntelliRAG retrieval plumbing does not solve legal validity. Peer review added three blind spots not fully covered in the advisor round: temporal legal applicability across IPC/BNS, CrPC/BNSS, Evidence Act/BSA and amendments; sensitive-data governance for POCSO and sexual-offence judgments; and corpus validity cards for pattern claims, including denominator, selection bias, OCR failures, missing data, courts, years, and appeal posture.

## Chairman Synthesis

Chairman synthesis: approve with major restructuring. The triad architecture is conceptually correct, but the plan must not proceed directly to full wiki+graph+vector fusion. The first gate must be legal evidence quality: normalized metadata, source spans, paragraph/page anchors, authority and temporal validity, per-accused/per-charge outcomes, closed-schema KG extraction, sensitive-data governance, and a gold evaluation set. Only after the pilot proves reliable extraction and answer grounding should the system build the full legal wiki and fusion reranker.

Recommendation: proceed, but revise the plan to add Phase 0 and narrow the MVP to one offence family. Implement ontology enforcement and assertion schema compatibility before running KG extraction at scale.

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


## One Thing To Do First

Create and implement the Phase 0 legal evidence contract: pilot scope, canonical metadata, paragraph/source-span requirements, authority and temporal validity model, per-accused/per-charge outcome schema, sensitive-data governance, corpus card, and gold evaluation set.
