# Judgment Workspace Contracts

## Workspace Settings

Judgment workspaces are ordinary workspaces with judgment-specific settings:

```json
{
  "workspaceKind": "judgments",
  "kgOntologyVersion": "judgment-legal-ontology-v1",
  "defaultRetrievalProfile": "case_specific",
  "kgOntology": "docs/ontology/judgment-legal-ontology-v1.json"
}
```

Apply the standard judgment ontology to an existing workspace with:

```text
POST /api/v1/workspaces/:wid/judgment-ontology
```

The helper route stores the ontology, retrieval profiles, source identifiers, and Phase 0 evidence contract in `workspace.settings`.

## Retrieval Profiles

- `case_specific`: exact judgment, paragraph, accused, charge, and outcome questions.
- `doctrine`: reviewed synthesis plus source-backed doctrine.
- `pattern_analysis`: aggregate reasoning with corpus validity card.
- `officer_lesson`: reviewed lessons only, with source citations.
- `precedent_trace`: citation graph, authority status, and later treatment.
- `comparison`: court/year/issue/outcome comparisons with denominator disclosure.

## Source Identifiers

Every judgment source used by retrieval or graph extraction should preserve:

- `judgment_id`
- `document_id`
- `chunk_id`
- `paragraph_number`
- `page_start`
- `court_code`
- `decision_date`

## KG Extraction Contract

For judgment workspaces:

- Relationship extraction is closed-schema.
- Out-of-ontology edge types are rejected from the approved graph.
- Ontology extraction rules are injected into entity and relationship prompts.
- Provenance rows include `ontology_version`, `review_status`, and `source_span`.
- Legal assertion types from the ontology are compatible with `kg_assertion.assertion_type`.
