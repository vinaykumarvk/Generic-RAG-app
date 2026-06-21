"""KG extraction — LangExtract two-pass entity and relationship extraction from document chunks."""

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from difflib import SequenceMatcher

import httpx
import langextract as lx
from langextract.core import data as lx_core_data
from langextract.core import exceptions as lx_exceptions
from langextract.core import types as lx_core_types
from langextract.data import ExampleData as LxExampleData, Extraction as LxExtraction
from langextract.providers.openai import OpenAILanguageModel
from psycopg2.extras import Json, execute_values

from ..config import config
from ..db import get_connection, get_cursor

logger = logging.getLogger(__name__)

CHUNK_BATCH_SIZE = config.KG_CONCURRENCY
MIN_RATE = 100  # Minimum chunks/min threshold for performance warning (FR-009/AC-04)
HIGH_IMPACT_LEGAL_EDGE_TYPES = {
    "outcome_caused_by",
    "supports_acquittal",
    "supports_conviction",
    "lapse_caused_doubt",
    "non_compliance_with",
    "evidence_rejected_because",
}
LEGAL_ASSERTION_EDGE_TYPES = HIGH_IMPACT_LEGAL_EDGE_TYPES | {
    "holding_supported_by",
    "reason_based_on",
    "finding_on",
    "later_treated_as",
}

# ---------------------------------------------------------------------------
# Default ontology — expanded from 8 to ~31 entity types, 7 to ~24 edge types
# Domain-agnostic but rich enough for most knowledge domains.
# ---------------------------------------------------------------------------

DEFAULT_ONTOLOGY = {
    "nodeTypes": [
        # Core / Legal
        {"type": "person", "label": "Person"},
        {"type": "organization", "label": "Organization"},
        {"type": "document", "label": "Document"},
        {"type": "authority", "label": "Authority / Agency"},
        {"type": "legal_instrument", "label": "Legal Instrument (law, regulation, policy)"},
        {"type": "permission", "label": "Permission / License / Approval"},
        {"type": "obligation", "label": "Obligation / Requirement"},
        {"type": "violation", "label": "Violation / Offence"},
        # Actors
        {"type": "role", "label": "Role / Title"},
        {"type": "group", "label": "Group / Team"},
        # Spatial
        {"type": "location", "label": "Location / Address"},
        {"type": "facility", "label": "Facility / Building"},
        {"type": "region", "label": "Region / Jurisdiction"},
        # Temporal
        {"type": "date", "label": "Date"},
        {"type": "event", "label": "Event / Incident"},
        {"type": "period", "label": "Time Period / Duration"},
        # Concepts
        {"type": "concept", "label": "Concept / Topic"},
        {"type": "technology", "label": "Technology / System"},
        {"type": "method", "label": "Method / Process"},
        {"type": "standard", "label": "Standard / Specification"},
        {"type": "metric", "label": "Metric / KPI"},
        {"type": "evidence", "label": "Evidence / Exhibit"},
        {"type": "condition", "label": "Condition / Prerequisite"},
        # Financial
        {"type": "monetary_amount", "label": "Monetary Amount"},
        {"type": "account", "label": "Account / Fund"},
        {"type": "transaction", "label": "Transaction"},
        # Compliance
        {"type": "risk", "label": "Risk / Hazard"},
        {"type": "control", "label": "Control / Safeguard"},
        {"type": "finding", "label": "Finding / Recommendation"},
        {"type": "status", "label": "Status / State"},
        {"type": "reference", "label": "Reference / Citation"},
    ],
    "edgeTypes": [
        {"type": "related_to", "label": "Related To", "directed": True},
        {"type": "part_of", "label": "Part Of", "directed": True},
        {"type": "created_by", "label": "Created By", "directed": True},
        {"type": "located_in", "label": "Located In", "directed": True},
        {"type": "occurred_at", "label": "Occurred At", "directed": True},
        {"type": "uses", "label": "Uses", "directed": True},
        {"type": "references", "label": "References", "directed": True},
        {"type": "regulates", "label": "Regulates / Governs", "directed": True},
        {"type": "grants", "label": "Grants / Authorizes", "directed": True},
        {"type": "requires", "label": "Requires / Mandates", "directed": True},
        {"type": "violates", "label": "Violates / Breaches", "directed": True},
        {"type": "employs", "label": "Employs / Hires", "directed": True},
        {"type": "reports_to", "label": "Reports To", "directed": True},
        {"type": "member_of", "label": "Member Of", "directed": True},
        {"type": "funded_by", "label": "Funded By", "directed": True},
        {"type": "produces", "label": "Produces / Outputs", "directed": True},
        {"type": "depends_on", "label": "Depends On", "directed": True},
        {"type": "supersedes", "label": "Supersedes / Replaces", "directed": True},
        {"type": "mitigates", "label": "Mitigates / Controls", "directed": True},
        {"type": "causes", "label": "Causes / Leads To", "directed": True},
        {"type": "measures", "label": "Measures / Evaluates", "directed": True},
        {"type": "applies_to", "label": "Applies To", "directed": True},
        {"type": "precedes", "label": "Precedes / Before", "directed": True},
        {"type": "contradicts", "label": "Contradicts / Conflicts With", "directed": True},
    ],
}

# Keyword-based type mapping for flexible entity classification
_TYPE_KEYWORDS = {
    "person": ["person", "individual", "man", "woman", "officer", "employee", "manager", "director", "witness"],
    "organization": ["organization", "company", "corporation", "firm", "institution", "agency", "department", "ministry"],
    "authority": ["authority", "government", "regulator", "commission", "board", "council", "tribunal"],
    "legal_instrument": ["law", "act", "regulation", "statute", "ordinance", "policy", "directive", "treaty", "code"],
    "permission": ["permission", "license", "permit", "approval", "authorization", "certificate", "exemption"],
    "obligation": ["obligation", "requirement", "duty", "mandate", "compliance"],
    "violation": ["violation", "offence", "offense", "breach", "infringement", "crime", "misconduct"],
    "role": ["role", "title", "position", "rank", "designation", "occupation"],
    "group": ["group", "team", "committee", "unit", "division", "taskforce"],
    "location": ["location", "address", "place", "city", "town", "village", "street", "road"],
    "facility": ["facility", "building", "office", "warehouse", "plant", "site", "headquarters"],
    "region": ["region", "jurisdiction", "district", "state", "province", "country", "territory", "zone"],
    "date": ["date", "day", "month", "year"],
    "event": ["event", "incident", "meeting", "hearing", "trial", "conference", "ceremony", "occurrence"],
    "period": ["period", "duration", "term", "timeframe", "deadline", "interval"],
    "concept": ["concept", "topic", "idea", "theme", "principle", "theory", "subject"],
    "technology": ["technology", "system", "software", "platform", "tool", "application", "database"],
    "method": ["method", "process", "procedure", "workflow", "protocol", "technique", "approach"],
    "standard": ["standard", "specification", "norm", "guideline", "benchmark", "framework"],
    "metric": ["metric", "kpi", "indicator", "measure", "score", "rate", "percentage"],
    "evidence": ["evidence", "exhibit", "proof", "record", "artifact", "documentation"],
    "condition": ["condition", "prerequisite", "criterion", "threshold", "trigger"],
    "monetary_amount": ["amount", "price", "cost", "fee", "fine", "budget", "salary", "payment", "dollar", "euro"],
    "account": ["account", "fund", "budget", "grant", "allocation"],
    "transaction": ["transaction", "transfer", "payment", "disbursement", "receipt"],
    "risk": ["risk", "hazard", "threat", "vulnerability", "danger", "exposure"],
    "control": ["control", "safeguard", "measure", "mitigation", "countermeasure", "protection"],
    "finding": ["finding", "recommendation", "observation", "conclusion", "opinion", "assessment"],
    "status": ["status", "state", "phase", "stage", "progress", "outcome"],
    "reference": ["reference", "citation", "source", "bibliography", "footnote"],
    "document": ["document", "report", "letter", "memo", "brief", "filing", "submission"],
}


# ---------------------------------------------------------------------------
# Workspace ontology
# ---------------------------------------------------------------------------

def _get_workspace_ontology(workspace_id: str) -> dict:
    """Fetch KG ontology from workspace settings, falling back to default."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "SELECT settings FROM workspace WHERE workspace_id = %s",
                (workspace_id,),
            )
            row = cur.fetchone()

    if not row or not row.get("settings"):
        return DEFAULT_ONTOLOGY

    settings = row["settings"]
    if isinstance(settings, str):
        try:
            settings = json.loads(settings)
        except json.JSONDecodeError:
            return DEFAULT_ONTOLOGY

    ontology = settings.get("kgOntology")
    if not ontology or not ontology.get("nodeTypes"):
        return DEFAULT_ONTOLOGY

    return ontology


def _get_ontology_version(ontology: dict) -> str | None:
    """Return the ontology version used for extraction metadata."""
    version = ontology.get("version")
    if isinstance(version, str) and version.strip():
        return version.strip()
    return None


def _is_judgment_ontology(ontology: dict) -> bool:
    """Identify judgment workspaces by ontology settings."""
    version = (_get_ontology_version(ontology) or "").lower()
    domain = str(ontology.get("domain") or "").lower()
    return (
        version.startswith("judgment-legal-ontology")
        or "judgment" in domain
        or "phase0EvidenceContract" in ontology
    )


def _is_closed_schema_ontology(ontology: dict) -> bool:
    """Judgment extraction is closed-schema by default."""
    return bool(ontology.get("closedSchema")) or _is_judgment_ontology(ontology)


def _format_ontology_rules(ontology: dict) -> str:
    """Render ontology extraction rules for prompts without overwhelming them."""
    rules = ontology.get("extractionRules") or []
    if not isinstance(rules, list):
        return ""
    rendered = [f"- {rule}" for rule in rules if isinstance(rule, str) and rule.strip()]
    return "\n".join(rendered[:12])


# ---------------------------------------------------------------------------
# Ontology helpers
# ---------------------------------------------------------------------------

def _is_closed_schema_ontology(ontology: dict) -> bool:
    """Whether the workspace ontology forbids out-of-ontology types."""
    return bool(ontology.get("closedSchema"))


def _format_ontology_rules(ontology: dict) -> str:
    """Render ontology extraction rules for prompts without overwhelming them."""
    rules = ontology.get("extractionRules") or []
    if not isinstance(rules, list):
        return ""
    rendered = [f"- {rule}" for rule in rules if isinstance(rule, str) and rule.strip()]
    return "\n".join(rendered[:12])


# ---------------------------------------------------------------------------
# Prompt builders
# ---------------------------------------------------------------------------

def _build_entity_prompt(ontology: dict) -> str:
    """Build the entity-extraction prompt from ontology."""
    type_descriptions = "\n".join(
        f"  - {nt['type']}: {nt.get('label', nt['type'])}" for nt in ontology.get("nodeTypes", [])
    )
    ontology_rules = _format_ontology_rules(ontology)
    additional_rules = f"\nOntology-specific rules:\n{ontology_rules}\n" if ontology_rules else ""
    return (
        "Extract all named entities from the following text. "
        "For each entity, provide its name, type, and a brief description.\n\n"
        f"Entity types:\n{type_descriptions}\n\n"
        "Rules:\n"
        "- Only use the entity types listed above; copy the type identifier exactly\n"
        "- The name must be the concise entity itself, NOT a sentence or description\n"
        "- Normalize entity names (capitalize properly, remove redundancy)\n"
        "- Put any explanation in the description field, not the name\n"
        "- Each entity must have a brief description (1-2 sentences)\n"
        "- Be thorough — extract every meaningful entity mentioned\n"
        f"{additional_rules}"
    )


def _build_relationship_prompt(ontology: dict, entity_names: list[str]) -> str:
    """Build the relationship-extraction prompt, including discovered entity names."""
    edge_descriptions = "\n".join(
        f"  - {et['type']}: {et.get('label', et['type'])}" for et in ontology.get("edgeTypes", [])
    )
    entity_list = ", ".join(entity_names[:config.KG_MAX_ENTITIES_FOR_RELS])
    ontology_rules = _format_ontology_rules(ontology)
    additional_rules = f"\nOntology-specific rules:\n{ontology_rules}\n" if ontology_rules else ""
    if _is_closed_schema_ontology(ontology):
        type_rule = (
            "- Only use the relationship types listed above. Do not introduce new "
            "relationship types; omit relationships when no listed type fits\n"
        )
    else:
        type_rule = "- Prefer the relationship types listed above, but introduce new ones if needed\n"
    return (
        "Extract all relationships between the entities listed below from the text. "
        "For each relationship, the extraction_text must state the relationship as "
        "'<source entity> <relationship> <target entity>', the extraction_class must be "
        "the relationship type identifier (copied exactly from the list below), and the "
        "description must briefly justify it.\n\n"
        f"Known entities: {entity_list}\n\n"
        f"Relationship types:\n{edge_descriptions}\n\n"
        "Rules:\n"
        "- Only create relationships between the entities listed above\n"
        f"{type_rule}"
        "- The relationship type goes in extraction_class, never the words "
        "'source_entity', 'target_entity', or 'description'\n"
        "- Each relationship must have a brief evidence description\n"
        f"{additional_rules}"
    )


# ---------------------------------------------------------------------------
# Few-shot examples for LangExtract
# ---------------------------------------------------------------------------

def _build_legal_entity_examples() -> list:
    """Few-shot examples tuned for judgment extraction."""
    return [
        LxExampleData(
            text=(
                "The Supreme Court held that Section 50 of the NDPS Act was not complied with "
                "because the accused was not informed of the right to be searched before a "
                "gazetted officer or Magistrate. The conviction was set aside."
            ),
            extractions=[
                LxExtraction(
                    extraction_text="Supreme Court",
                    extraction_class="court",
                    description="Court deciding the NDPS appeal",
                ),
                LxExtraction(
                    extraction_text="Section 50 of the NDPS Act",
                    extraction_class="statutory_section",
                    description="Procedural safeguard for personal search under the NDPS Act",
                ),
                LxExtraction(
                    extraction_text="right to be searched before a gazetted officer or Magistrate",
                    extraction_class="procedural_requirement",
                    description="Section 50 option notice requirement discussed by the court",
                ),
                LxExtraction(
                    extraction_text="conviction was set aside",
                    extraction_class="outcome",
                    description="Final appeal outcome adverse to the prosecution",
                ),
            ],
        ),
        LxExampleData(
            text=(
                "The High Court distinguished the precedent because the recovery was from a bag "
                "and not from the person of the accused. The court found the seizure memo and FSL "
                "seal evidence reliable."
            ),
            extractions=[
                LxExtraction(
                    extraction_text="High Court",
                    extraction_class="court",
                    description="Court applying precedent to a search and seizure fact pattern",
                ),
                LxExtraction(
                    extraction_text="recovery was from a bag",
                    extraction_class="legal_issue",
                    description="Fact pattern relevant to whether Section 50 applies",
                ),
                LxExtraction(
                    extraction_text="seizure memo",
                    extraction_class="document_record",
                    description="Document recording seizure of contraband",
                ),
                LxExtraction(
                    extraction_text="FSL seal evidence",
                    extraction_class="evidence",
                    description="Forensic/seal evidence relied on for chain of custody",
                ),
            ],
        ),
        LxExampleData(
            text=(
                "The Sessions Court found that the hostile witness did not support the prosecution, "
                "but the medical officer and FSL report corroborated the injury evidence. Bail was "
                "rejected because the victim was a minor and the accused could influence witnesses. "
                "The accused was sentenced to seven years rigorous imprisonment."
            ),
            extractions=[
                LxExtraction(
                    extraction_text="Sessions Court",
                    extraction_class="court",
                    description="District trial court deciding witness credibility, bail, and sentence",
                ),
                LxExtraction(
                    extraction_text="hostile witness",
                    extraction_class="person",
                    description="Witness whose testimony did not support the prosecution case",
                ),
                LxExtraction(
                    extraction_text="medical officer",
                    extraction_class="person",
                    description="Medical witness whose evidence corroborated injury findings",
                ),
                LxExtraction(
                    extraction_text="FSL report",
                    extraction_class="evidence",
                    description="Forensic report relied on as corroborative evidence",
                ),
                LxExtraction(
                    extraction_text="bail was rejected",
                    extraction_class="outcome",
                    description="Trial-court bail outcome",
                ),
                LxExtraction(
                    extraction_text="seven years rigorous imprisonment",
                    extraction_class="sentence",
                    description="Sentence imposed by the trial court",
                ),
            ],
        ),
    ]


def _build_entity_examples(ontology: dict | None = None) -> list:
    """Few-shot examples for entity extraction."""
    if ontology and _is_judgment_ontology(ontology):
        return _build_legal_entity_examples()
    return [
        LxExampleData(
            text="The Environmental Protection Agency issued regulation EPA-2024-001 on March 15, 2024, "
                 "requiring all manufacturing facilities in the Pacific Northwest to reduce emissions by 30%.",
            extractions=[
                LxExtraction(
                    extraction_text="Environmental Protection Agency",
                    extraction_class="authority",
                    description="Federal agency responsible for environmental regulation",
                ),
                LxExtraction(
                    extraction_text="EPA-2024-001",
                    extraction_class="legal_instrument",
                    description="Regulation issued by the EPA requiring emissions reduction",
                ),
                LxExtraction(
                    extraction_text="March 15, 2024",
                    extraction_class="date",
                    description="Date the regulation was issued",
                ),
                LxExtraction(
                    extraction_text="Pacific Northwest",
                    extraction_class="region",
                    description="Geographic region affected by the regulation",
                ),
            ],
        ),
        LxExampleData(
            text="Dr. Sarah Chen, Director of Research at Nexus Technologies, presented the Q3 risk assessment "
                 "showing a $2.4M budget overrun in the cloud migration project.",
            extractions=[
                LxExtraction(
                    extraction_text="Dr. Sarah Chen",
                    extraction_class="person",
                    description="Director of Research at Nexus Technologies",
                ),
                LxExtraction(
                    extraction_text="Nexus Technologies",
                    extraction_class="organization",
                    description="Technology company where Dr. Chen works",
                ),
                LxExtraction(
                    extraction_text="Director of Research",
                    extraction_class="role",
                    description="Leadership role held by Dr. Sarah Chen",
                ),
                LxExtraction(
                    extraction_text="Q3 risk assessment",
                    extraction_class="finding",
                    description="Quarterly risk assessment report",
                ),
                LxExtraction(
                    extraction_text="$2.4M",
                    extraction_class="monetary_amount",
                    description="Budget overrun amount in the cloud migration project",
                ),
                LxExtraction(
                    extraction_text="cloud migration project",
                    extraction_class="technology",
                    description="IT project experiencing budget overrun",
                ),
            ],
        ),
    ]


def _build_legal_relationship_examples() -> list:
    """Few-shot relationship examples for judgment KG extraction."""
    return [
        LxExampleData(
            text=(
                "The court held that non-compliance with Section 50 of the NDPS Act created "
                "reasonable doubt and the conviction was set aside."
            ),
            extractions=[
                LxExtraction(
                    extraction_text="non-compliance with Section 50 non_compliance_with Section 50 of the NDPS Act",
                    extraction_class="non_compliance_with",
                    description="Court found non-compliance with the Section 50 procedural safeguard",
                ),
                LxExtraction(
                    extraction_text="non-compliance with Section 50 lapse_caused_doubt reasonable doubt",
                    extraction_class="lapse_caused_doubt",
                    description="The procedural lapse created reasonable doubt according to the court",
                ),
                LxExtraction(
                    extraction_text="conviction was set aside outcome_caused_by non-compliance with Section 50",
                    extraction_class="outcome_caused_by",
                    description="The outcome was materially influenced by the Section 50 lapse",
                ),
            ],
        ),
        LxExampleData(
            text=(
                "The High Court followed the Supreme Court precedent but distinguished cases "
                "involving personal search because this recovery was from a bag."
            ),
            extractions=[
                LxExtraction(
                    extraction_text="High Court follows Supreme Court precedent",
                    extraction_class="follows",
                    description="The High Court followed binding Supreme Court authority",
                ),
                LxExtraction(
                    extraction_text="High Court distinguishes personal search cases",
                    extraction_class="distinguishes",
                    description="The court distinguished precedents on personal search",
                ),
                LxExtraction(
                    extraction_text="recovery from bag concerns_issue Section 50 applicability",
                    extraction_class="concerns_issue",
                    description="The bag recovery fact pattern concerns Section 50 applicability",
                ),
            ],
        ),
        LxExampleData(
            text=(
                "The Sessions Court rejected the hostile witness testimony because it contradicted "
                "the section 164 statement. The FSL report supported conviction. Bail was rejected "
                "on witness influence risk, and the accused was sentenced to seven years imprisonment."
            ),
            extractions=[
                LxExtraction(
                    extraction_text="hostile witness testimony evidence_rejected_because contradiction with section 164 statement",
                    extraction_class="evidence_rejected_because",
                    description="The trial court rejected testimony for a credibility contradiction",
                ),
                LxExtraction(
                    extraction_text="FSL report supports_conviction conviction",
                    extraction_class="supports_conviction",
                    description="The forensic report supported conviction according to the court",
                ),
                LxExtraction(
                    extraction_text="bail denied_relief witness influence risk",
                    extraction_class="denies_relief",
                    description="The court rejected bail based on risk of influencing witnesses",
                ),
                LxExtraction(
                    extraction_text="accused sentenced_to seven years imprisonment",
                    extraction_class="sentenced_to",
                    description="The court imposed a sentence of seven years imprisonment",
                ),
            ],
        ),
    ]


def _build_relationship_examples(ontology: dict | None = None) -> list:
    """Few-shot examples for relationship extraction."""
    if ontology and _is_judgment_ontology(ontology):
        return _build_legal_relationship_examples()
    return [
        LxExampleData(
            text="The Environmental Protection Agency issued regulation EPA-2024-001 on March 15, 2024, "
                 "requiring all manufacturing facilities in the Pacific Northwest to reduce emissions by 30%.",
            extractions=[
                LxExtraction(
                    extraction_text="Environmental Protection Agency issued EPA-2024-001",
                    extraction_class="produces",
                    description="The EPA issued regulation EPA-2024-001",
                ),
                LxExtraction(
                    extraction_text="EPA-2024-001 applies to Pacific Northwest",
                    extraction_class="applies_to",
                    description="The regulation applies to the Pacific Northwest region",
                ),
            ],
        ),
        LxExampleData(
            text="Dr. Sarah Chen, Director of Research at Nexus Technologies, presented the Q3 risk assessment "
                 "showing a $2.4M budget overrun in the cloud migration project.",
            extractions=[
                LxExtraction(
                    extraction_text="Dr. Sarah Chen works at Nexus Technologies",
                    extraction_class="member_of",
                    description="Dr. Chen is Director of Research at Nexus Technologies",
                ),
                LxExtraction(
                    extraction_text="Q3 risk assessment measures cloud migration project",
                    extraction_class="measures",
                    description="The risk assessment evaluates the cloud migration project",
                ),
                LxExtraction(
                    extraction_text="$2.4M related to cloud migration project",
                    extraction_class="related_to",
                    description="The $2.4M overrun is associated with the cloud migration project",
                ),
            ],
        ),
    ]


# ---------------------------------------------------------------------------
# LangExtract helpers
# ---------------------------------------------------------------------------

@dataclass
class _FallbackExtraction:
    extraction_text: str
    extraction_class: str
    description: str = ""
    char_interval: None = None


def _get_kg_provider() -> str:
    return (config.KG_LLM_PROVIDER or ("gemini" if config.GEMINI_API_KEY else "openai")).lower()


def _get_kg_model_id() -> str:
    return config.KG_MODEL_ID


def _get_kg_api_key() -> str | None:
    provider = _get_kg_provider()
    if provider == "gemini":
        return config.GEMINI_API_KEY or None
    if provider == "openai":
        return config.OPENAI_API_KEY or None
    return None

def _uses_openai_completion_tokens(model_id: str) -> bool:
    """GPT-5 and OpenAI reasoning models reject chat-completions max_tokens."""
    model_name = (model_id or "").lower()
    return model_name.startswith(("gpt-5", "o1", "o3", "o4"))


def _build_langextract_openai_api_params(
    model_id: str,
    prompt: str,
    normalized_config: dict,
    default_temperature: float | None,
    format_type,
) -> dict:
    """Mirror LangExtract's OpenAI provider, with model-specific token param selection."""
    system_message = ""
    if format_type == lx_core_data.FormatType.JSON:
        system_message = "You are a helpful assistant that responds in JSON format."
    elif format_type == lx_core_data.FormatType.YAML:
        system_message = "You are a helpful assistant that responds in YAML format."

    messages = [{"role": "user", "content": prompt}]
    if system_message:
        messages.insert(0, {"role": "system", "content": system_message})

    api_params = {
        "model": model_id,
        "messages": messages,
        "n": 1,
    }

    temperature = normalized_config.get("temperature", default_temperature)
    if temperature is not None:
        api_params["temperature"] = temperature

    if format_type == lx_core_data.FormatType.JSON:
        api_params.setdefault("response_format", {"type": "json_object"})

    if (value := normalized_config.get("max_output_tokens")) is not None:
        token_key = "max_completion_tokens" if _uses_openai_completion_tokens(model_id) else "max_tokens"
        api_params[token_key] = value

    for key in [
        "frequency_penalty",
        "presence_penalty",
        "seed",
        "stop",
        "logprobs",
        "top_logprobs",
        "top_p",
        "reasoning",
        "response_format",
    ]:
        if (value := normalized_config.get(key)) is not None:
            api_params[key] = value

    return api_params


def _patch_langextract_openai_provider():
    """Patch LangExtract's OpenAI provider to support GPT-5 chat token semantics."""
    if getattr(OpenAILanguageModel, "_intellirag_completion_tokens_patch", False):
        return

    def _process_single_prompt(self, prompt: str, model_config: dict) -> lx_core_types.ScoredOutput:
        try:
            normalized_config = self._normalize_reasoning_params(model_config)
            api_params = _build_langextract_openai_api_params(
                model_id=self.model_id,
                prompt=prompt,
                normalized_config=normalized_config,
                default_temperature=self.temperature,
                format_type=self.format_type,
            )
            response = self._client.chat.completions.create(**api_params)
            output_text = response.choices[0].message.content
            return lx_core_types.ScoredOutput(score=1.0, output=output_text)
        except Exception as e:
            raise lx_exceptions.InferenceRuntimeError(
                f"OpenAI API error: {str(e)}",
                original=e,
            ) from e

    OpenAILanguageModel._process_single_prompt = _process_single_prompt
    OpenAILanguageModel._intellirag_completion_tokens_patch = True


def _build_fallback_extraction_prompt(prompt: str, examples: list, content: str) -> str:
    """Build a strict JSON prompt for direct OpenAI extraction fallback."""
    example_blocks = []
    for example in examples[:2]:
        example_payload = {
            "extractions": [
                {
                    "extraction_text": extraction.extraction_text,
                    "extraction_class": extraction.extraction_class,
                    "description": extraction.description or "",
                }
                for extraction in example.extractions
            ]
        }
        example_blocks.append(
            "Example text:\n"
            f"{example.text}\n\n"
            "Example JSON:\n"
            f"{json.dumps(example_payload, ensure_ascii=True)}"
        )

    examples_text = "\n\n".join(example_blocks)
    return (
        f"{prompt}\n\n"
        "Return a JSON object with this exact shape:\n"
        '{"extractions":[{"extraction_text":"string","extraction_class":"string","description":"string"}]}\n'
        "Do not return markdown, commentary, or any keys other than 'extractions'.\n"
        "If nothing relevant is present, return {\"extractions\": []}.\n\n"
        f"{examples_text}\n\n"
        "Document text:\n"
        f"{content[:4000]}"
    )


def _call_openai_json(prompt: str) -> dict:
    """Call OpenAI chat completions in strict JSON mode."""
    response = httpx.post(
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {config.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": _get_kg_model_id(),
            "messages": [{"role": "user", "content": prompt}],
            "temperature": config.KG_EXTRACTION_TEMPERATURE,
            "response_format": {"type": "json_object"},
            "max_completion_tokens": 4096,
        },
        timeout=60.0,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    return json.loads(content)


def _call_gemini_json(prompt: str) -> dict:
    """Call Gemini generateContent in strict JSON mode."""
    response = httpx.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{_get_kg_model_id()}:generateContent",
        headers={"Content-Type": "application/json"},
        params={"key": config.GEMINI_API_KEY},
        json={
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": config.KG_EXTRACTION_TEMPERATURE,
                "maxOutputTokens": 4096,
                "responseMimeType": "application/json",
                # Structured extraction does not need reasoning; disabling "thinking"
                # cuts gemini-2.5-flash per-call latency dramatically (KG throughput).
                "thinkingConfig": {"thinkingBudget": 0},
            },
        },
        timeout=60.0,
    )
    response.raise_for_status()
    payload = response.json()
    candidates = payload.get("candidates") or []
    content = ((candidates[0] or {}).get("content") or {}) if candidates else {}
    parts = content.get("parts") or []
    text = "".join(str(part.get("text", "")) for part in parts if isinstance(part, dict))
    return json.loads(text or "{}")


def _call_kg_json(prompt: str) -> dict:
    provider = _get_kg_provider()
    if provider == "gemini":
        return _call_gemini_json(prompt)
    return _call_openai_json(prompt)


def _extract_with_direct_json_fallback(content: str, prompt: str, examples: list) -> list:
    """Fallback extractor when LangExtract cannot parse the model response."""
    try:
        payload = _call_kg_json(_build_fallback_extraction_prompt(prompt, examples, content))
        raw_extractions = payload.get("extractions", [])
        if not isinstance(raw_extractions, list):
            return []

        return [
            _FallbackExtraction(
                extraction_text=str(item.get("extraction_text", "")).strip(),
                extraction_class=str(item.get("extraction_class", "")).strip(),
                description=str(item.get("description", "")).strip(),
            )
            for item in raw_extractions
            if isinstance(item, dict) and str(item.get("extraction_text", "")).strip()
        ]
    except Exception as exc:
        logger.warning(f"Direct JSON KG extraction fallback failed: {exc}")
        return []

def _lx_extract(content: str, prompt: str, examples: list) -> list:
    """Run lx.extract() with OpenAI configuration. Returns list of Extraction objects."""
    try:
        provider = _get_kg_provider()
        if provider == "openai":
            _patch_langextract_openai_provider()
        result = lx.extract(
            text_or_documents=content[:4000],
            prompt_description=prompt,
            examples=examples,
            model_id=_get_kg_model_id(),
            api_key=_get_kg_api_key(),
            fence_output=None if provider == "gemini" else True,
            use_schema_constraints=(provider == "gemini"),
            language_model_params={
                "temperature": config.KG_EXTRACTION_TEMPERATURE,
                "max_output_tokens": 4096,
            },
        )
        # langextract 1.x returns AnnotatedDocument; extract the list
        if hasattr(result, "extractions"):
            return result.extractions or []
        if isinstance(result, list):
            return result
        return _extract_with_direct_json_fallback(content, prompt, examples)
    except Exception as e:
        logger.warning(f"LangExtract call failed: {e}")
        return _extract_with_direct_json_fallback(content, prompt, examples)


def _normalize_type_token(value: str) -> str:
    """Normalize a type identifier for tolerant matching.

    Lowercases and strips separators so ontology types declared in any casing
    (e.g. 'LandUseZone', 'land_use_zone', 'Land Use Zone') match the LLM's
    classification regardless of how it cased or punctuated it.
    """
    return "".join(ch for ch in (value or "").lower() if ch.isalnum())


def _build_valid_type_index(valid_types: set) -> dict[str, str]:
    """Map normalized type tokens to their canonical ontology spelling."""
    return {_normalize_type_token(t): t for t in valid_types}


def _map_entity_type(extracted_text: str, classification: str, valid_types: set) -> str:
    """Map an extraction classification to a valid ontology type.

    Matching is tolerant of casing and separators so an ontology type such as
    'LandUseZone' is honored even when the model returns 'land use zone'. If the
    classification cannot be matched, fall back to keyword matching on the text,
    and finally to the first available type (or 'concept').
    """
    type_index = _build_valid_type_index(valid_types)

    # Exact (canonical) match first, then normalized match.
    if classification in valid_types:
        return classification
    canonical = type_index.get(_normalize_type_token(classification))
    if canonical:
        return canonical

    # Try keyword matching against the text + classification
    search_text = f"{extracted_text} {classification}".lower()
    best_type = None
    best_score = 0

    for node_type, keywords in _TYPE_KEYWORDS.items():
        canonical_node = type_index.get(_normalize_type_token(node_type))
        if canonical_node is None:
            continue
        for kw in keywords:
            if kw in search_text:
                score = len(kw)
                if score > best_score:
                    best_score = score
                    best_type = canonical_node

    if best_type:
        return best_type

    # Final fallback: prefer ontology's own 'concept' if present, otherwise the
    # first declared type, otherwise the literal 'concept'.
    return type_index.get("concept") or (sorted(valid_types)[0] if valid_types else "concept")


def _infer_subtype(name: str, node_type: str, ontology: dict) -> str | None:
    """Infer a subtype from ontology subtypes via keyword matching."""
    for nt in ontology.get("nodeTypes", []):
        if nt.get("type") != node_type:
            continue
        subtypes = nt.get("subtypes", [])
        if not subtypes:
            return None
        name_lower = name.lower()
        for st in subtypes:
            if st.lower() in name_lower:
                return st
        return None
    return None


def _compute_extraction_confidence(ext) -> float:
    """Heuristic confidence: base 0.8, +0.1 for description, +0.1 for char span."""
    conf = 0.8
    if ext.description:
        conf += 0.1
    if hasattr(ext, "char_interval") and ext.char_interval is not None:
        conf += 0.1
    return min(conf, 1.0)


def _split_name_and_description(raw_text: str, description: str) -> tuple[str, str]:
    """Separate a concise entity name from a descriptive sentence.

    The model sometimes returns a full descriptive sentence as the entity
    'name'. When the extracted text is sentence-like, keep a concise leading
    phrase as the name and preserve the full text as the description (only if
    no description was already provided), preventing name/description conflation.
    """
    text = (raw_text or "").strip()
    desc = (description or "").strip()
    if not text:
        return text, desc

    # Heuristic: a name should be a short noun phrase, not a sentence.
    word_count = len(text.split())
    sentence_like = text.endswith((".", "!", "?")) or word_count > 8

    if not sentence_like:
        return text, desc

    # Derive a concise name: take the leading clause before sentence/clause
    # punctuation, then cap length.
    candidate = text
    for sep in (". ", "; ", ", ", " — ", " - ", ": "):
        if sep in candidate:
            candidate = candidate.split(sep, 1)[0]
            break
    candidate = candidate.rstrip(".!?").strip()
    # Still too long? fall back to the first few words.
    if len(candidate.split()) > 8:
        candidate = " ".join(candidate.split()[:8])

    if not candidate:
        candidate = text[:120].rstrip()

    # Preserve the original full text as the description when none was given.
    if not desc:
        desc = text

    return candidate, desc

def _source_span_from_extraction(ext, chunk_id: str) -> dict:
    """Build a conservative source span payload for review and citation."""
    span = {
        "chunk_id": chunk_id,
        "anchor_quality": "chunk",
        "quote": (ext.extraction_text or "")[:500],
    }
    if ext.description:
        span["evidence_description"] = ext.description[:500]
    if hasattr(ext, "char_interval") and ext.char_interval is not None:
        span["char_start"] = ext.char_interval.start_pos
        span["char_end"] = ext.char_interval.end_pos
        span["anchor_quality"] = "char_span"
    return span


def _convert_extractions_to_nodes(
    extractions: list, chunk_id: str, valid_types: set, ontology: dict | None = None,
) -> list[dict]:
    """Convert LangExtract Extraction objects into node dicts."""
    ont = ontology or {}
    nodes = []
    for ext in extractions:
        raw_name = ext.extraction_text.strip()
        if not raw_name:
            continue
        name, description = _split_name_and_description(raw_name, ext.description or "")
        if not name:
            continue
        node_type = _map_entity_type(name, ext.extraction_class or "", valid_types)
        subtype = _infer_subtype(name, node_type, ont)
        confidence = _compute_extraction_confidence(ext)
        node = {
            "name": name,
            "type": node_type,
            "subtype": subtype,
            "confidence": confidence,
            "description": description,
            "chunk_id": chunk_id,
            "properties": {},
        }
        if hasattr(ext, "char_interval") and ext.char_interval is not None:
            node["properties"]["char_start"] = ext.char_interval.start_pos
            node["properties"]["char_end"] = ext.char_interval.end_pos
        nodes.append(node)
    return nodes


def _match_entity_name(name_fragment: str, entity_names: list[str]) -> str | None:
    """Fuzzy-match a name fragment to the closest known entity name."""
    name_lower = name_fragment.lower().strip()
    best_name = None
    best_ratio = 0.0

    for ename in entity_names:
        ratio = SequenceMatcher(None, name_lower, ename.lower()).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_name = ename
        # Also check substring containment
        if name_lower in ename.lower() or ename.lower() in name_lower:
            if ratio > 0.5:
                best_ratio = max(best_ratio, 0.85)
                best_name = ename

    return best_name if best_ratio >= 0.6 else None


# Field names the model sometimes leaks as a relationship "type" when it
# flattens the requested {source_entity, target_entity, relationship_type,
# description} shape into separate extractions. These are never valid edge types.
_NON_EDGE_TYPE_TOKENS = {
    "source_entity", "target_entity", "source", "target",
    "relationship_type", "relationship", "type", "description", "evidence",
}


def _normalize_edge_type(
    edge_type: str,
    valid_edge_types: set | None,
    closed_schema: bool,
    chunk_id: str,
) -> str | None:
    """Validate/normalize a relationship type against the ontology.

    - Rejects leaked field-name tokens (source_entity/target_entity/description).
    - Matches ontology edge types tolerant of casing/separators.
    - In closed-schema ontologies, drops out-of-ontology types; otherwise maps
      them to 'related_to' when that type exists, else keeps the raw type.
    Returns the canonical edge type, or None if the edge should be dropped.
    """
    raw = (edge_type or "").strip()
    if not raw or _normalize_type_token(raw) in {_normalize_type_token(t) for t in _NON_EDGE_TYPE_TOKENS}:
        logger.warning("Dropped malformed relationship type '%s' for chunk %s", edge_type, chunk_id)
        return None

    if not valid_edge_types:
        return raw

    edge_index = _build_valid_type_index(valid_edge_types)
    canonical = edge_index.get(_normalize_type_token(raw))
    if canonical:
        return canonical

    # Not in the ontology.
    if closed_schema:
        logger.warning("Rejected out-of-ontology edge type '%s' for chunk %s", edge_type, chunk_id)
        return None
    return edge_index.get(_normalize_type_token("related_to")) or raw


def _convert_extractions_to_edges(
    extractions: list,
    chunk_id: str,
    entity_names: list[str],
    valid_edge_types: set | None = None,
    closed_schema: bool = False,
) -> list[dict]:
    """Convert LangExtract relationship Extraction objects into edge dicts.

    The extracted_text for relationships is expected to contain source and target
    entity names (e.g. "Entity A produces Entity B"). We split on the classification
    keyword and fuzzy-match to known entities. The relationship type comes from the
    extraction class and is validated/normalized against the ontology.
    """
    edges = []
    for ext in extractions:
        text = ext.extraction_text.strip()
        description = ext.description or ""

        edge_type = _normalize_edge_type(
            ext.extraction_class or "related_to", valid_edge_types, closed_schema, chunk_id,
        )
        if edge_type is None:
            continue

        # Try to split the extracted text to find source and target entities
        source_name, target_name = _parse_relationship_text(text, edge_type, entity_names)

        if source_name and target_name:
            confidence = _compute_extraction_confidence(ext)
            high_impact = edge_type in HIGH_IMPACT_LEGAL_EDGE_TYPES
            source_span = _source_span_from_extraction(ext, chunk_id)
            review_status = "needs_review" if high_impact else "unreviewed"
            edges.append({
                "source": source_name,
                "target": target_name,
                "type": edge_type,
                "description": description,
                "chunk_id": chunk_id,
                "confidence": confidence,
                "high_impact": high_impact,
                "review_status": review_status,
                "source_span": source_span,
            })
    return edges


def _parse_relationship_text(text: str, edge_type: str, entity_names: list[str]) -> tuple[str | None, str | None]:
    """Parse relationship extracted_text to identify source and target entities.

    Tries multiple strategies:
    1. Split on edge_type keyword (e.g. "EPA produces regulation" → "EPA", "regulation")
    2. Split on common relationship verbs
    3. Match first and last entity names found in the text
    """
    # Strategy 1: split on edge_type (with underscores replaced by spaces)
    separator = edge_type.replace("_", " ")
    if separator in text.lower():
        parts = text.lower().split(separator, 1)
        source = _match_entity_name(parts[0].strip(), entity_names)
        target = _match_entity_name(parts[1].strip(), entity_names)
        if source and target and source != target:
            return source, target

    # Strategy 2: split on common verbs
    for verb in ["issued", "works at", "related to", "applies to", "measures",
                 "produces", "requires", "regulates", "depends on", "causes",
                 "member of", "part of", "located in", "reports to", "funded by"]:
        if verb in text.lower():
            parts = text.lower().split(verb, 1)
            source = _match_entity_name(parts[0].strip(), entity_names)
            target = _match_entity_name(parts[1].strip(), entity_names)
            if source and target and source != target:
                return source, target

    # Strategy 3: find all entity names present in the text
    found = []
    text_lower = text.lower()
    for ename in entity_names:
        if ename.lower() in text_lower:
            found.append(ename)
    if len(found) >= 2:
        return found[0], found[1]

    return None, None


# ---------------------------------------------------------------------------
# Cross-document consolidation
# ---------------------------------------------------------------------------

def _trigrams(s: str) -> set[str]:
    """Generate character trigrams for a string."""
    s = f"  {s} "
    return {s[i:i + 3] for i in range(len(s) - 2)}


def _consolidate_nodes(nodes: list[dict], workspace_id: str) -> list[dict]:
    """Deduplicate nodes against existing workspace nodes and within the batch.

    Uses exact-match dict lookup as fast path, then trigram pre-filtering to narrow
    candidates before running SequenceMatcher. Near-duplicates get their name
    remapped to the existing node's name so the SQL ON CONFLICT upsert merges naturally.
    """
    threshold = config.KG_SIMILARITY_THRESHOLD

    # Fetch existing node names from the workspace
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "SELECT DISTINCT name FROM graph_node WHERE workspace_id = %s",
                (workspace_id,),
            )
            existing_names = [row["name"] for row in cur.fetchall()]

    # Exact-match index (case-insensitive) for O(1) lookup
    exact_index: dict[str, str] = {n.lower().strip(): n for n in existing_names}

    # Trigram index: lowered name -> (original name, trigram set)
    trigram_index: list[tuple[str, str, set[str]]] = [
        (n, n.lower().strip(), _trigrams(n.lower().strip())) for n in existing_names
    ]

    consolidated = []

    for node in nodes:
        name = node["name"]
        name_lower = name.lower().strip()

        # Fast path: exact match
        if name_lower in exact_index:
            node["name"] = exact_index[name_lower]
            consolidated.append(node)
            continue

        # Trigram pre-filter: only compare candidates sharing enough trigrams
        matched = _find_similar_name_trigram(name_lower, trigram_index, threshold)

        if matched:
            node["name"] = matched
        else:
            # Add to indexes for subsequent nodes in this batch
            exact_index[name_lower] = name
            trigram_index.append((name, name_lower, _trigrams(name_lower)))

        consolidated.append(node)

    return consolidated


def _find_similar_name_trigram(
    name_lower: str,
    trigram_index: list[tuple[str, str, set[str]]],
    threshold: float,
) -> str | None:
    """Find a similar canonical name using trigram pre-filtering + SequenceMatcher."""
    if not trigram_index:
        return None

    name_trigrams = _trigrams(name_lower)
    # Trigram similarity threshold — candidates with < 30% trigram overlap are skipped
    trigram_cutoff = 0.3
    best_match = None
    best_ratio = 0.0

    for orig_name, cname_lower, cname_trigrams in trigram_index:
        # Trigram Jaccard similarity as cheap pre-filter
        union_len = len(name_trigrams | cname_trigrams)
        if union_len == 0:
            continue
        jaccard = len(name_trigrams & cname_trigrams) / union_len
        if jaccard < trigram_cutoff:
            continue

        ratio = SequenceMatcher(None, name_lower, cname_lower).ratio()

        # Substring boost
        if name_lower in cname_lower or cname_lower in name_lower:
            ratio = max(ratio, 0.85)

        if ratio > best_ratio:
            best_ratio = ratio
            best_match = orig_name

    return best_match if best_ratio >= threshold else None


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

def _store_nodes(workspace_id: str, document_id: str, nodes: list) -> list[dict]:
    """Store nodes with deduplication by normalized name + type. Returns list of {name, node_id, chunk_id}."""
    rows = []
    node_meta = []  # parallel list to track chunk_id per row
    for node in nodes:
        name = node.get("name", "").strip()
        if not name:
            continue
        rows.append((
            workspace_id,
            name,
            name.lower().strip(),
            node.get("type", "concept"),
            node.get("subtype"),
            node.get("confidence", 1.0),
            node.get("description", ""),
            json.dumps(node.get("properties", {})),
        ))
        node_meta.append({"name": name, "chunk_id": node.get("chunk_id")})

    if not rows:
        _embed_node_descriptions(workspace_id)
        return []

    # Deduplicate rows by (normalized_name, node_type) to avoid
    # "ON CONFLICT DO UPDATE cannot affect row a second time" error.
    seen: dict[tuple, int] = {}  # (normalized_name, node_type) -> index in deduped lists
    deduped_rows = []
    deduped_meta = []
    for i, row in enumerate(rows):
        key = (row[2], row[3])  # (normalized_name, node_type)
        if key in seen:
            # Keep entry with longer description
            existing_idx = seen[key]
            if len(row[6]) > len(deduped_rows[existing_idx][6]):
                deduped_rows[existing_idx] = row
        else:
            seen[key] = len(deduped_rows)
            deduped_rows.append(row)
            deduped_meta.append(node_meta[i])
    rows = deduped_rows
    node_meta = deduped_meta

    stored: list[dict] = []
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            returned = execute_values(
                cur,
                """INSERT INTO graph_node
                     (workspace_id, name, normalized_name, node_type, subtype, confidence, description, properties)
                   VALUES %s
                   ON CONFLICT (workspace_id, normalized_name, node_type)
                   DO UPDATE SET source_count = graph_node.source_count + 1,
                                 subtype = COALESCE(EXCLUDED.subtype, graph_node.subtype),
                                 confidence = GREATEST(EXCLUDED.confidence, graph_node.confidence),
                                 description = CASE
                                   WHEN length(EXCLUDED.description) > length(COALESCE(graph_node.description, ''))
                                   THEN EXCLUDED.description
                                   ELSE graph_node.description
                                 END,
                                 properties = COALESCE(graph_node.properties, '{}'::jsonb) || EXCLUDED.properties,
                                 updated_at = now()
                   RETURNING node_id""",
                rows,
                template="(%s, %s, %s, %s, %s, %s, %s, %s::jsonb)",
                page_size=500,
                fetch=True,
            )
            for i, ret_row in enumerate(returned or []):
                # execute_values + RealDictCursor returns dicts; plain cursor returns tuples
                node_id = ret_row["node_id"] if isinstance(ret_row, dict) else ret_row[0]
                stored.append({
                    "name": node_meta[i]["name"],
                    "node_id": node_id,
                    "chunk_id": node_meta[i]["chunk_id"],
                })

    _embed_node_descriptions(workspace_id)
    return stored


def _embed_node_descriptions(workspace_id: str):
    """Embed descriptions for nodes that don't have embeddings yet."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("""
                SELECT node_id, name, description FROM graph_node
                WHERE workspace_id = %s AND description_embedding IS NULL AND description IS NOT NULL AND description != ''
                LIMIT 50
            """, (workspace_id,))
            nodes = cur.fetchall()

    if not nodes:
        return

    texts = [f"{n['name']}: {n['description']}" for n in nodes]
    node_ids = [n["node_id"] for n in nodes]

    try:
        from .embedder import _get_embeddings
        embeddings = _get_embeddings(texts)

        update_rows = [
            (str(node_id), "[" + ",".join(str(v) for v in emb) + "]")
            for node_id, emb in zip(node_ids, embeddings)
        ]
        with get_connection() as conn:
            with get_cursor(conn) as cur:
                execute_values(
                    cur,
                    """UPDATE graph_node AS gn
                       SET description_embedding = v.vec::vector
                       FROM (VALUES %s) AS v(id, vec)
                       WHERE gn.node_id = v.id::uuid""",
                    update_rows,
                    page_size=500,
                )
    except Exception as e:
        logger.warning(f"Failed to embed node descriptions: {e}")


def _store_edges(workspace_id: str, document_id: str, edges: list) -> list[dict]:
    """Store edges between existing nodes. Returns list of {edge_id, chunk_id}.

    Pre-fetches all needed node_ids in a single query, then batch-upserts edges.
    """
    if not edges:
        return []

    # Collect all unique normalized names needed for edge endpoints
    all_names: set[str] = set()
    for edge in edges:
        src = edge.get("source", "").strip().lower()
        tgt = edge.get("target", "").strip().lower()
        if src:
            all_names.add(src)
        if tgt:
            all_names.add(tgt)

    if not all_names:
        return []

    # Single query to fetch all needed node_ids
    name_to_node_id: dict[str, str] = {}
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("""
                SELECT DISTINCT ON (normalized_name) normalized_name, node_id
                FROM graph_node
                WHERE workspace_id = %s AND normalized_name = ANY(%s)
            """, (workspace_id, list(all_names)))
            for row in cur.fetchall():
                name_to_node_id[row["normalized_name"]] = row["node_id"]

    # Build rows for batch upsert — skip edges where either endpoint is missing
    upsert_rows = []
    edge_meta = []
    for edge in edges:
        source_name = edge.get("source", "").strip().lower()
        target_name = edge.get("target", "").strip().lower()
        if not source_name or not target_name:
            continue
        src_id = name_to_node_id.get(source_name)
        tgt_id = name_to_node_id.get(target_name)
        if not src_id or not tgt_id:
            continue
        properties = {
            "description": edge.get("description", ""),
            "high_impact": bool(edge.get("high_impact", False)),
        }
        upsert_rows.append((
            workspace_id, str(src_id), str(tgt_id),
            edge.get("type", "related_to"),
            edge.get("description") or None,
            json.dumps(properties, default=str),
            edge.get("chunk_id"), document_id,
            edge.get("confidence", 1.0),
            edge.get("review_status", "unreviewed"),
            Json(edge.get("source_span", {})),
            bool(edge.get("high_impact", False)),
        ))
        edge_meta.append({
            "chunk_id": edge.get("chunk_id"),
            "edge_type": edge.get("type", "related_to"),
            "confidence": edge.get("confidence", 1.0),
            "review_status": edge.get("review_status", "unreviewed"),
            "source_span": edge.get("source_span", {}),
            "high_impact": bool(edge.get("high_impact", False)),
            "description": edge.get("description", ""),
            "source_node_id": str(src_id),
            "target_node_id": str(tgt_id),
        })

    if not upsert_rows:
        return []

    # Deduplicate by (source_node_id, target_node_id, edge_type)
    seen_edges: dict[tuple, int] = {}
    deduped_rows = []
    deduped_meta = []
    for i, row in enumerate(upsert_rows):
        key = (row[1], row[2], row[3])  # (src_id, tgt_id, edge_type)
        if key not in seen_edges:
            seen_edges[key] = len(deduped_rows)
            deduped_rows.append(row)
            deduped_meta.append(edge_meta[i])
    upsert_rows = deduped_rows
    edge_meta = deduped_meta

    stored: list[dict] = []
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            returned = execute_values(
                cur,
                """INSERT INTO graph_edge
                     (workspace_id, source_node_id, target_node_id, edge_type,
                      label, properties, evidence_chunk_id, document_id,
                      confidence, review_status, source_span, high_impact)
                   VALUES %s
                   ON CONFLICT (workspace_id, source_node_id, target_node_id, edge_type)
                   DO UPDATE SET weight = LEAST(graph_edge.weight + 0.1, 1.0),
                                 document_id = EXCLUDED.document_id,
                                 label = COALESCE(EXCLUDED.label, graph_edge.label),
                                 properties = COALESCE(graph_edge.properties, '{}'::jsonb) || EXCLUDED.properties,
                                 confidence = GREATEST(graph_edge.confidence, EXCLUDED.confidence),
                                 review_status = CASE
                                   WHEN graph_edge.review_status = 'approved' THEN graph_edge.review_status
                                   ELSE EXCLUDED.review_status
                                 END,
                                 source_span = CASE
                                   WHEN graph_edge.source_span = '{}'::jsonb THEN EXCLUDED.source_span
                                   ELSE graph_edge.source_span
                                 END,
                                 high_impact = graph_edge.high_impact OR EXCLUDED.high_impact
                   RETURNING edge_id""",
                upsert_rows,
                template="(%s, %s::uuid, %s::uuid, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s)",
                page_size=500,
                fetch=True,
            )
            for i, ret_row in enumerate(returned or []):
                edge_id = ret_row["edge_id"] if isinstance(ret_row, dict) else ret_row[0]
                stored.append({"edge_id": edge_id, **edge_meta[i]})

    return stored


def _store_provenance(
    workspace_id: str,
    document_id: str,
    stored_nodes: list[dict],
    stored_edges: list[dict],
    ontology_version: str | None = None,
):
    """Write provenance records for extracted nodes and edges (batch INSERT)."""
    model_name = _get_kg_model_id()
    review_status = "unreviewed"
    rows = [
        (
            workspace_id,
            "NODE",
            sn["node_id"],
            sn.get("chunk_id"),
            document_id,
            model_name,
            1.0,
            ontology_version,
            None,
            review_status,
            Json({"chunk_id": sn.get("chunk_id"), "anchor_quality": "chunk"}),
        )
        for sn in stored_nodes
    ] + [
        (
            workspace_id,
            "EDGE",
            se["edge_id"],
            se.get("chunk_id"),
            document_id,
            model_name,
            se.get("confidence", 1.0),
            ontology_version,
            se.get("edge_type"),
            se.get("review_status", review_status),
            Json(se.get("source_span") or {"chunk_id": se.get("chunk_id"), "anchor_quality": "chunk"}),
        )
        for se in stored_edges
    ]
    if not rows:
        return
    try:
        with get_connection() as conn:
            with get_cursor(conn) as cur:
                execute_values(
                    cur,
                    """INSERT INTO kg_provenance
                         (workspace_id, entity_type, entity_id, source_chunk_id, document_id,
                          extraction_model, confidence, ontology_version, claim_type, review_status, source_span)
                       VALUES %s""",
                    rows,
                    page_size=500,
                )
    except Exception as e:
        logger.warning(f"Failed to store provenance records: {e}")


def _assertion_type_for_edge(edge_type: str) -> str:
    if edge_type in {"outcome_caused_by", "supports_acquittal", "supports_conviction", "lapse_caused_doubt"}:
        return "outcome_reason"
    if edge_type in {"non_compliance_with", "evidence_rejected_because"}:
        return "procedural_defect"
    if edge_type in {"later_treated_as"}:
        return "authority_treatment"
    return "finding_of_law"


def _store_legal_edge_assertions(
    workspace_id: str,
    document_id: str,
    stored_edges: list[dict],
    ontology_version: str | None,
):
    """Create claim-level assertions for high-impact legal edges."""
    assertion_edges = [edge for edge in stored_edges if edge.get("edge_type") in LEGAL_ASSERTION_EDGE_TYPES]
    if not assertion_edges:
        return

    rows = []
    for edge in assertion_edges:
        rows.append((
            workspace_id,
            _assertion_type_for_edge(edge.get("edge_type", "")),
            edge.get("source_node_id"),
            edge.get("edge_type"),
            edge.get("target_node_id"),
            edge.get("description") or "",
            edge.get("confidence", 1.0),
            edge.get("edge_id"),
            edge.get("chunk_id"),
            document_id,
            Json({
                "edge_type": edge.get("edge_type"),
                "high_impact": edge.get("high_impact", False),
            }),
            ontology_version,
            edge.get("edge_type"),
            edge.get("review_status", "unreviewed"),
            Json(edge.get("source_span") or {}),
        ))

    try:
        with get_connection() as conn:
            with get_cursor(conn) as cur:
                execute_values(
                    cur,
                    """INSERT INTO kg_assertion (
                         workspace_id, assertion_type, subject_node_id, predicate, object_node_id,
                         object_value, confidence, evidence_edge_id, source_chunk_id, document_id,
                         properties, ontology_version, claim_type, review_status, source_span
                       )
                       VALUES %s""",
                    rows,
                    template="(%s, %s, %s::uuid, %s, %s::uuid, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    page_size=500,
                )
    except Exception as e:
        logger.warning(f"Failed to store legal edge assertions: {e}")


def _flag_legal_edges_for_review(
    workspace_id: str,
    document_id: str,
    stored_edges: list[dict],
    ontology_version: str | None,
):
    """Create review queue items for high-impact or weak legal inferences."""
    review_edges = [
        edge for edge in stored_edges
        if edge.get("high_impact") or edge.get("confidence", 1.0) < 0.85
    ]
    if not review_edges:
        return

    try:
        with get_connection() as conn:
            with get_cursor(conn) as cur:
                for edge in review_edges:
                    reasons = []
                    if edge.get("high_impact"):
                        reasons.append(f"High-impact legal edge '{edge.get('edge_type')}' requires review")
                    if edge.get("confidence", 1.0) < 0.85:
                        reasons.append(f"Low-confidence legal edge: {edge.get('confidence', 0):.2f}")
                    source_span = edge.get("source_span") or {}
                    if edge.get("high_impact") and not source_span.get("quote"):
                        reasons.append("Missing quoted source span")

                    cur.execute("""
                        INSERT INTO review_queue (
                          workspace_id, entity_type, entity_id, reason, details,
                          review_category, priority_score, ontology_version
                        )
                        VALUES (%s, 'GRAPH_EDGE', %s, %s, %s::jsonb, %s, %s, %s)
                    """, (
                        workspace_id,
                        edge["edge_id"],
                        "; ".join(reasons),
                        json.dumps({
                            "domain": "legal_kg",
                            "document_id": document_id,
                            "edge_type": edge.get("edge_type"),
                            "source_span": source_span,
                        }, default=str),
                        "legal_kg_high_impact",
                        90 if edge.get("high_impact") else 50,
                        ontology_version,
                    ))
    except Exception as e:
        logger.warning(f"Failed to flag legal edges for review: {e}")


def _write_graph_quality_report(workspace_id: str, document_id: str, ontology_version: str | None):
    """Write a per-document graph QA report for judgment extraction."""
    try:
        with get_connection() as conn:
            with get_cursor(conn) as cur:
                cur.execute("""
                    SELECT
                      count(*)::int as total_edges,
                      count(*) FILTER (WHERE edge_type = 'related_to')::int as related_to_edges,
                      count(*) FILTER (WHERE high_impact = true AND review_status != 'approved')::int as high_impact_unreviewed_edges,
                      count(*) FILTER (WHERE confidence < 0.85)::int as low_confidence_edges,
                      count(*) FILTER (
                        WHERE high_impact = true
                          AND COALESCE(source_span->>'quote', '') = ''
                      )::int as ungrounded_high_impact_edges
                    FROM graph_edge
                    WHERE workspace_id = %s AND document_id = %s
                """, (workspace_id, document_id))
                edge_row = cur.fetchone() or {}

                cur.execute("""
                    SELECT count(*)::int as dangling_nodes
                    FROM graph_node gn
                    JOIN kg_provenance kp ON kp.entity_id = gn.node_id AND kp.entity_type = 'NODE'
                    WHERE kp.workspace_id = %s
                      AND kp.document_id = %s
                      AND NOT EXISTS (
                        SELECT 1 FROM graph_edge ge
                        WHERE ge.workspace_id = %s
                          AND (ge.source_node_id = gn.node_id OR ge.target_node_id = gn.node_id)
                      )
                """, (workspace_id, document_id, workspace_id))
                node_row = cur.fetchone() or {}

                total_edges = edge_row.get("total_edges") or 0
                related_to_edges = edge_row.get("related_to_edges") or 0
                related_to_ratio = related_to_edges / total_edges if total_edges else 0
                details = {
                    "related_to_threshold": 0.25,
                    "requires_review": (
                        related_to_ratio > 0.25
                        or (edge_row.get("high_impact_unreviewed_edges") or 0) > 0
                        or (edge_row.get("ungrounded_high_impact_edges") or 0) > 0
                    ),
                }

                cur.execute("""
                    INSERT INTO judgment_kg_quality_report (
                      workspace_id, document_id, ontology_version, total_edges, related_to_edges,
                      related_to_ratio, high_impact_unreviewed_edges, low_confidence_edges,
                      ungrounded_high_impact_edges, dangling_nodes, details
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    RETURNING report_id
                """, (
                    workspace_id,
                    document_id,
                    ontology_version,
                    total_edges,
                    related_to_edges,
                    related_to_ratio,
                    edge_row.get("high_impact_unreviewed_edges") or 0,
                    edge_row.get("low_confidence_edges") or 0,
                    edge_row.get("ungrounded_high_impact_edges") or 0,
                    node_row.get("dangling_nodes") or 0,
                    json.dumps(details),
                ))
                report = cur.fetchone()

                if report and details["requires_review"]:
                    cur.execute("""
                        INSERT INTO review_queue (
                          workspace_id, entity_type, entity_id, reason, details,
                          review_category, priority_score, ontology_version
                        )
                        VALUES (%s, 'KG_QUALITY_REPORT', %s, %s, %s::jsonb, %s, %s, %s)
                    """, (
                        workspace_id,
                        report["report_id"],
                        "Judgment KG quality report requires legal review",
                        json.dumps({
                            "domain": "legal_kg",
                            "document_id": document_id,
                            "metrics": {
                                "total_edges": total_edges,
                                "related_to_ratio": related_to_ratio,
                                "high_impact_unreviewed_edges": edge_row.get("high_impact_unreviewed_edges") or 0,
                                "ungrounded_high_impact_edges": edge_row.get("ungrounded_high_impact_edges") or 0,
                            },
                        }, default=str),
                        "legal_kg_quality",
                        80,
                        ontology_version,
                    ))
    except Exception as e:
        logger.warning(f"Failed to write graph quality report: {e}")


def _flag_conflicts_for_review(workspace_id: str, document_id: str, nodes: list):
    """FR-012: Flag potential duplicate/conflicting nodes for review queue."""
    try:
        with get_connection() as conn:
            with get_cursor(conn) as cur:
                # Find nodes that were merged (name was remapped during consolidation)
                seen_names = set()
                for node in nodes:
                    name = node.get("name", "")
                    if name in seen_names:
                        continue
                    seen_names.add(name)

                    # Check if this node has multiple source documents (potential conflict)
                    cur.execute("""
                        SELECT count(DISTINCT kp.document_id) as doc_count
                        FROM graph_node gn
                        JOIN kg_provenance kp ON kp.entity_id = gn.node_id AND kp.entity_type = 'NODE'
                        WHERE gn.workspace_id = %s AND gn.normalized_name = %s
                    """, (workspace_id, name.lower().strip()))
                    row = cur.fetchone()
                    if row and row["doc_count"] > 2:
                        # Multi-source node — flag for review
                        cur.execute("""
                            SELECT node_id FROM graph_node
                            WHERE workspace_id = %s AND normalized_name = %s LIMIT 1
                        """, (workspace_id, name.lower().strip()))
                        node_row = cur.fetchone()
                        if node_row:
                            cur.execute("""
                                INSERT INTO review_queue (workspace_id, entity_type, entity_id, reason, details)
                                VALUES (%s, 'GRAPH_NODE', %s, %s, %s)
                                ON CONFLICT DO NOTHING
                            """, (
                                workspace_id, node_row["node_id"],
                                f"Node '{name}' referenced by {row['doc_count']} documents — verify consistency",
                                json.dumps({"node_name": name, "source_documents": row["doc_count"],
                                            "triggered_by": document_id})
                            ))
    except Exception as e:
        logger.warning(f"Failed to flag conflicts for review: {e}")


def _update_document_status(document_id: str, status: str):
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("UPDATE document SET status = %s, updated_at = now() WHERE document_id = %s",
                       (status, document_id))


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def _extract_chunk_kg(
    chunk: dict,
    entity_prompt: str,
    entity_examples: list,
    rel_examples: list,
    valid_types: set,
    valid_edge_types: set,
    closed_schema: bool,
    ontology: dict,
) -> tuple[list[dict], list[dict]]:
    """Extract KG nodes and edges from a single chunk. Stateless + thread-safe."""
    content = chunk["content"]
    chunk_id = chunk["chunk_id"]

    # Pass 1: Entity extraction
    entity_extractions = _lx_extract(content, entity_prompt, entity_examples)
    chunk_nodes = _convert_extractions_to_nodes(entity_extractions, chunk_id, valid_types, ontology)
    chunk_nodes = [n for n in chunk_nodes if n.get("confidence", 0) >= config.KG_CONFIDENCE_THRESHOLD]

    # Pass 2: Relationship extraction (only if >= 2 entities found)
    chunk_edges: list[dict] = []
    entity_names = [n["name"] for n in chunk_nodes]
    if len(entity_names) >= 2:
        rel_prompt = _build_relationship_prompt(ontology, entity_names)
        rel_extractions = _lx_extract(content, rel_prompt, rel_examples)
        chunk_edges = _convert_extractions_to_edges(
            rel_extractions, chunk_id, entity_names, valid_edge_types, closed_schema,
        )

    return chunk_nodes, chunk_edges


def extract_kg(document_id: str, workspace_id: str):
    """Extract knowledge graph entities and relationships from document chunks.

    Two-pass extraction using LangExtract with concurrent chunk processing:
      Pass 1: Extract entities from each chunk
      Pass 2: Extract relationships using discovered entity names
    """
    ontology = _get_workspace_ontology(workspace_id)

    logger.info(
        f"Using ontology with {len(ontology.get('nodeTypes', []))} node types, "
        f"{len(ontology.get('edgeTypes', []))} edge types for workspace {workspace_id}"
    )

    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("""
                SELECT chunk_id, content, chunk_index FROM chunk
                WHERE document_id = %s
                ORDER BY chunk_index
            """, (document_id,))
            chunks = cur.fetchall()

    if not chunks:
        logger.info(f"No chunks to extract KG from for document {document_id}")
        _update_document_status(document_id, "ACTIVE")
        return

    total = len(chunks)
    logger.info(f"Extracting KG from {total} chunks for document {document_id}")

    valid_types = {nt["type"] for nt in ontology.get("nodeTypes", [])}
    valid_edge_types = {et["type"] for et in ontology.get("edgeTypes", [])}
    closed_schema = _is_closed_schema_ontology(ontology)
    entity_prompt = _build_entity_prompt(ontology)
    entity_examples = _build_entity_examples(ontology)
    rel_examples = _build_relationship_examples(ontology)

    logger.info(
        "KG ontology version=%s closed_schema=%s assertion_types=%d",
        _get_ontology_version(ontology) or "default",
        closed_schema,
        len(ontology.get("assertionTypes", []) or []),
    )

    all_nodes: list[dict] = []
    all_edges: list[dict] = []
    _extract_start = time.time()
    concurrency = config.KG_CONCURRENCY

    for i in range(0, total, CHUNK_BATCH_SIZE):
        batch = chunks[i:i + CHUNK_BATCH_SIZE]

        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = {
                executor.submit(
                    _extract_chunk_kg, chunk,
                    entity_prompt, entity_examples, rel_examples,
                    valid_types, valid_edge_types, closed_schema, ontology,
                ): chunk
                for chunk in batch
            }
            for future in as_completed(futures):
                chunk = futures[future]
                try:
                    chunk_nodes, chunk_edges = future.result()
                    all_nodes.extend(chunk_nodes)
                    all_edges.extend(chunk_edges)
                except Exception as e:
                    logger.warning(f"KG extraction failed for chunk {chunk['chunk_id']}: {e}")

        batch_num = i // CHUNK_BATCH_SIZE + 1
        total_batches = (total + CHUNK_BATCH_SIZE - 1) // CHUNK_BATCH_SIZE
        elapsed = time.time() - _extract_start
        rate = (i + len(batch)) / elapsed if elapsed > 0 else 0
        rate_per_min = rate * 60
        logger.info(f"Extracted batch {batch_num}/{total_batches} ({rate:.1f} chunks/sec)")
        if rate_per_min < MIN_RATE:
            logger.warning(f"KG extraction rate {rate_per_min:.0f} chunks/min below threshold {MIN_RATE} chunks/min")

    # Cross-document consolidation
    all_nodes = _consolidate_nodes(all_nodes, workspace_id)

    # Store nodes (with dedup via upsert)
    stored_nodes = _store_nodes(workspace_id, document_id, all_nodes)

    # Store edges
    stored_edges = _store_edges(workspace_id, document_id, all_edges)
    ontology_version = _get_ontology_version(ontology)

    # Write provenance records
    _store_provenance(workspace_id, document_id, stored_nodes, stored_edges, ontology_version)

    # Legal claim-level assertions and review gates
    if _is_judgment_ontology(ontology):
        _store_legal_edge_assertions(workspace_id, document_id, stored_edges, ontology_version)
        _flag_legal_edges_for_review(workspace_id, document_id, stored_edges, ontology_version)
        _write_graph_quality_report(workspace_id, document_id, ontology_version)

    # FR-012: Create review_queue entries for potential conflicts/duplicates
    _flag_conflicts_for_review(workspace_id, document_id, all_nodes)

    # Store extraction_prompt_hash for reproducibility (FR-011)
    import hashlib
    prompt_hash = hashlib.sha256(entity_prompt.encode()).hexdigest()[:16]
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("""
                UPDATE ingestion_job SET metadata = jsonb_set(
                    COALESCE(metadata, '{}'::jsonb), '{extraction_prompt_hash}', %s::jsonb
                )
                WHERE document_id = %s AND step = 'KG_EXTRACT' AND status = 'PROCESSING'
            """, (json.dumps(prompt_hash), document_id))

    # Update document status to ACTIVE
    _update_document_status(document_id, "ACTIVE")

    logger.info(f"Document {document_id} KG extraction complete: {len(stored_nodes)} nodes, {len(stored_edges)} edges")
