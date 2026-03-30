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
from psycopg2.extras import execute_values

from ..config import config
from ..db import get_connection, get_cursor

logger = logging.getLogger(__name__)

CHUNK_BATCH_SIZE = config.KG_CONCURRENCY
MIN_RATE = 100  # Minimum chunks/min threshold for performance warning (FR-009/AC-04)

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


# ---------------------------------------------------------------------------
# Prompt builders
# ---------------------------------------------------------------------------

def _build_entity_prompt(ontology: dict) -> str:
    """Build the entity-extraction prompt from ontology."""
    type_descriptions = "\n".join(
        f"  - {nt['type']}: {nt.get('label', nt['type'])}" for nt in ontology.get("nodeTypes", [])
    )
    return (
        "Extract all named entities from the following text. "
        "For each entity, provide its name, type, and a brief description.\n\n"
        f"Entity types:\n{type_descriptions}\n\n"
        "Rules:\n"
        "- Only use the entity types listed above\n"
        "- Normalize entity names (capitalize properly, remove redundancy)\n"
        "- Each entity must have a brief description (1-2 sentences)\n"
        "- Be thorough — extract every meaningful entity mentioned\n"
    )


def _build_relationship_prompt(ontology: dict, entity_names: list[str]) -> str:
    """Build the relationship-extraction prompt, including discovered entity names."""
    edge_descriptions = "\n".join(
        f"  - {et['type']}: {et.get('label', et['type'])}" for et in ontology.get("edgeTypes", [])
    )
    entity_list = ", ".join(entity_names[:config.KG_MAX_ENTITIES_FOR_RELS])
    return (
        "Extract all relationships between the entities listed below from the text. "
        "For each relationship, provide the source entity, target entity, relationship type, "
        "and a brief description of the relationship.\n\n"
        f"Known entities: {entity_list}\n\n"
        f"Relationship types:\n{edge_descriptions}\n\n"
        "Rules:\n"
        "- Only create relationships between the entities listed above\n"
        "- Prefer the relationship types listed above, but introduce new ones if needed\n"
        "- Each relationship must have a brief evidence description\n"
    )


# ---------------------------------------------------------------------------
# Few-shot examples for LangExtract
# ---------------------------------------------------------------------------

def _build_entity_examples() -> list:
    """Few-shot examples for entity extraction."""
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


def _build_relationship_examples() -> list:
    """Few-shot examples for relationship extraction."""
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


def _map_entity_type(extracted_text: str, classification: str, valid_types: set) -> str:
    """Map an extraction classification to a valid ontology type.

    If the classification is already valid, use it directly.
    Otherwise, use keyword matching on the extracted text and classification
    to find the best ontology type. Falls back to 'concept'.
    """
    if classification in valid_types:
        return classification

    # Try keyword matching against the text + classification
    search_text = f"{extracted_text} {classification}".lower()
    best_type = "concept"
    best_score = 0

    for node_type, keywords in _TYPE_KEYWORDS.items():
        if node_type not in valid_types:
            continue
        for kw in keywords:
            if kw in search_text:
                score = len(kw)
                if score > best_score:
                    best_score = score
                    best_type = node_type

    return best_type


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


def _convert_extractions_to_nodes(
    extractions: list, chunk_id: str, valid_types: set, ontology: dict | None = None,
) -> list[dict]:
    """Convert LangExtract Extraction objects into node dicts."""
    ont = ontology or {}
    nodes = []
    for ext in extractions:
        name = ext.extraction_text.strip()
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
            "description": ext.description or "",
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


def _convert_extractions_to_edges(extractions: list, chunk_id: str, entity_names: list[str]) -> list[dict]:
    """Convert LangExtract relationship Extraction objects into edge dicts.

    The extracted_text for relationships is expected to contain source and target
    entity names (e.g. "Entity A produces Entity B"). We split on the classification
    keyword and fuzzy-match to known entities.
    """
    edges = []
    for ext in extractions:
        text = ext.extraction_text.strip()
        edge_type = ext.extraction_class or "related_to"
        description = ext.description or ""

        # Try to split the extracted text to find source and target entities
        source_name, target_name = _parse_relationship_text(text, edge_type, entity_names)

        if source_name and target_name:
            edges.append({
                "source": source_name,
                "target": target_name,
                "type": edge_type,
                "description": description,
                "chunk_id": chunk_id,
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
                stored.append({
                    "name": node_meta[i]["name"],
                    "node_id": ret_row[0],
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
        upsert_rows.append((
            workspace_id, str(src_id), str(tgt_id),
            edge.get("type", "related_to"),
            edge.get("chunk_id"), document_id,
        ))
        edge_meta.append({"chunk_id": edge.get("chunk_id")})

    if not upsert_rows:
        return []

    stored: list[dict] = []
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            returned = execute_values(
                cur,
                """INSERT INTO graph_edge
                     (workspace_id, source_node_id, target_node_id, edge_type,
                      evidence_chunk_id, document_id)
                   VALUES %s
                   ON CONFLICT (workspace_id, source_node_id, target_node_id, edge_type)
                   DO UPDATE SET weight = LEAST(graph_edge.weight + 0.1, 1.0),
                                 document_id = EXCLUDED.document_id
                   RETURNING edge_id""",
                upsert_rows,
                template="(%s, %s::uuid, %s::uuid, %s, %s, %s)",
                page_size=500,
                fetch=True,
            )
            for i, ret_row in enumerate(returned or []):
                stored.append({"edge_id": ret_row[0], "chunk_id": edge_meta[i]["chunk_id"]})

    return stored


def _store_provenance(
    workspace_id: str,
    document_id: str,
    stored_nodes: list[dict],
    stored_edges: list[dict],
):
    """Write provenance records for extracted nodes and edges (batch INSERT)."""
    model_name = _get_kg_model_id()
    rows = [
        (workspace_id, "NODE", sn["node_id"], sn.get("chunk_id"), document_id, model_name, 1.0)
        for sn in stored_nodes
    ] + [
        (workspace_id, "EDGE", se["edge_id"], se.get("chunk_id"), document_id, model_name, 1.0)
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
                          extraction_model, confidence)
                       VALUES %s""",
                    rows,
                    page_size=500,
                )
    except Exception as e:
        logger.warning(f"Failed to store provenance records: {e}")


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
        chunk_edges = _convert_extractions_to_edges(rel_extractions, chunk_id, entity_names)

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
    entity_prompt = _build_entity_prompt(ontology)
    entity_examples = _build_entity_examples()
    rel_examples = _build_relationship_examples()

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
                    valid_types, ontology,
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

    # Write provenance records
    _store_provenance(workspace_id, document_id, stored_nodes, stored_edges)

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
