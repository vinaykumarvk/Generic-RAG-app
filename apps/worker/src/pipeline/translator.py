"""District-court translation stage.

The stage preserves source text in prior extraction artifacts and writes English
as a derived TRANSLATED_TEXT artifact with provider and QA metadata.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Any, Protocol

import httpx

from ..config import config
from ..db import get_connection, get_cursor

logger = logging.getLogger(__name__)

LANGUAGE_ALIASES = {
    "eng": "en",
    "english": "en",
    "hin": "hi",
    "hindi": "hi",
    "mar": "mr",
    "marathi": "mr",
    "kan": "kn",
    "kannada": "kn",
    "tam": "ta",
    "tamil": "ta",
    "unknown": "",
    "und": "",
}

SCRIPT_LANGUAGE_HINTS = {
    "latin": "en",
    "devanagari": "hi",
    "kannada": "kn",
    "tamil": "ta",
}


class TranslationProviderNotConfigured(RuntimeError):
    pass


@dataclass(frozen=True)
class LegalGlossary:
    version: str
    target_language: str
    terms: list[dict[str, Any]]

    def matched_terms(self, text: str) -> list[str]:
        matches: list[str] = []
        lower_text = text.lower()
        for term in self.terms:
            source = str(term.get("source") or "").strip()
            if source and source.lower() in lower_text:
                matches.append(source)
        return sorted(set(matches))


@dataclass(frozen=True)
class TranslationOutput:
    text: str
    provider: str
    model_name: str | None = None
    provider_version: str | None = None
    confidence: float | None = None
    cost_units: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class TranslationProvider(Protocol):
    name: str
    model_name: str | None
    provider_version: str | None

    def translate_batch(
        self,
        texts: list[str],
        source_language: str,
        target_language: str,
        glossary: LegalGlossary,
    ) -> list[str]:
        ...


@dataclass
class PassthroughTranslationProvider:
    name: str = "passthrough"
    model_name: str | None = "passthrough"
    provider_version: str | None = "local"

    def translate_batch(
        self,
        texts: list[str],
        source_language: str,
        target_language: str,
        glossary: LegalGlossary,
    ) -> list[str]:
        return list(texts)


@dataclass
class GoogleCloudTranslationProvider:
    project_id: str
    location: str = "global"
    model_name: str | None = None
    provider_version: str | None = None
    name: str = "google_cloud_translation"

    def translate_batch(
        self,
        texts: list[str],
        source_language: str,
        target_language: str,
        glossary: LegalGlossary,
    ) -> list[str]:
        try:
            from google.cloud import translate_v3 as translate
        except Exception as exc:  # pragma: no cover - dependency/runtime guard
            raise TranslationProviderNotConfigured(
                "google-cloud-translate is not installed in the worker image"
            ) from exc

        if not self.project_id:
            raise TranslationProviderNotConfigured("TRANSLATION_PROJECT_ID or GOOGLE_CLOUD_PROJECT is required")

        client = translate.TranslationServiceClient()
        parent = f"projects/{self.project_id}/locations/{self.location or 'global'}"
        request: dict[str, Any] = {
            "parent": parent,
            "contents": texts,
            "mime_type": "text/plain",
            "target_language_code": target_language,
        }
        if source_language:
            request["source_language_code"] = source_language
        if self.model_name:
            request["model"] = self.model_name

        response = client.translate_text(request=request)
        return [translation.translated_text for translation in response.translations]


@dataclass
class IndicTrans2Provider:
    endpoint_url: str
    model_name: str | None = "indictrans2"
    provider_version: str | None = None
    name: str = "indictrans2"

    def translate_batch(
        self,
        texts: list[str],
        source_language: str,
        target_language: str,
        glossary: LegalGlossary,
    ) -> list[str]:
        if not self.endpoint_url:
            raise TranslationProviderNotConfigured("INDICTRANS2_URL is required for IndicTrans2 translation")
        response = httpx.post(
            self.endpoint_url,
            json={
                "texts": texts,
                "source_language": source_language,
                "target_language": target_language,
                "glossary_version": glossary.version,
            },
            timeout=120.0,
        )
        response.raise_for_status()
        payload = response.json()
        translations = payload.get("translations") or payload.get("outputs") or payload
        if not isinstance(translations, list) or len(translations) != len(texts):
            raise ValueError("IndicTrans2 response did not include one translation per input text")
        return [str(item) for item in translations]


@dataclass
class OpenAITranslationProvider:
    api_key: str
    model_name: str | None
    provider_version: str | None = None
    name: str = "openai"
    base_url: str = "https://api.openai.com/v1"

    def translate_batch(
        self,
        texts: list[str],
        source_language: str,
        target_language: str,
        glossary: LegalGlossary,
    ) -> list[str]:
        if not self.api_key:
            raise TranslationProviderNotConfigured(
                "OPENAI_API_KEY or OPEN_AI_API_KEY is required for OpenAI translation"
            )

        return [
            self._translate_one(text, source_language, target_language, glossary)
            for text in texts
        ]

    def _translate_one(
        self,
        text: str,
        source_language: str,
        target_language: str,
        glossary: LegalGlossary,
    ) -> str:
        glossary_terms = [
            term for term in glossary.terms
            if str(term.get("source") or "").strip()
            and str(term.get("source") or "").strip().lower() in text.lower()
        ][:50]
        response = httpx.post(
            f"{self.base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.model_name or config.OPENAI_CHAT_MODEL,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You translate Indian district-court legal text for a document ingestion pipeline. "
                            "Translate faithfully without summarizing, omitting, explaining, or adding commentary. "
                            "Preserve names, dates, CNR and case numbers, statutory citations, section numbers, "
                            "paragraph numbering, and line breaks where practical. Return only valid JSON."
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "source_language": source_language or "und",
                                "target_language": target_language,
                                "glossary_terms": glossary_terms,
                                "text": text,
                                "response_schema": {"translation": "string"},
                            },
                            ensure_ascii=False,
                        ),
                    },
                ],
                "temperature": 0.0,
                "response_format": {"type": "json_object"},
            },
            timeout=120.0,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        payload = json.loads(content)
        translation = payload.get("translation")
        if not isinstance(translation, str) or not translation.strip():
            raise ValueError("OpenAI translation response did not include a translation string")
        return translation


def translate_document(document_id: str, workspace_id: str):
    """Translate latest redacted text into the configured target language."""

    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT er.extraction_id,
                       er.extraction_type,
                       er.content,
                       er.metadata AS extraction_metadata,
                       d.language,
                       d.extracted_metadata,
                       d.metadata AS document_metadata
                FROM extraction_result er
                JOIN document d ON d.document_id = er.document_id
                WHERE er.document_id = %s
                  AND er.extraction_type IN ('REDACTED_TEXT', 'TEXT')
                ORDER BY CASE WHEN er.extraction_type = 'REDACTED_TEXT' THEN 0 ELSE 1 END,
                         er.created_at DESC
                LIMIT 1
                """,
                (document_id,),
            )
            row = cur.fetchone()
            if not row:
                raise ValueError(f"No redacted/text extraction result for document {document_id}")

    source_text = row["content"] or ""
    if not source_text.strip():
        raise ValueError(f"No translatable text for document {document_id}")

    document_metadata = _json_obj(row.get("document_metadata"))
    extracted_metadata = _json_obj(row.get("extracted_metadata"))
    extraction_metadata = _json_obj(row.get("extraction_metadata"))
    source_language = resolve_source_language(row.get("language"), extracted_metadata, document_metadata, extraction_metadata)
    target_language = normalize_language(config.TRANSLATION_TARGET_LANGUAGE) or "en"
    glossary = load_glossary()

    try:
        output = translate_text(
            source_text,
            source_language=source_language,
            target_language=target_language,
            glossary=glossary,
        )
    except TranslationProviderNotConfigured as exc:
        _flag_translation_review(
            workspace_id,
            document_id,
            "Translation provider not configured for non-English district document",
            {
                "source_language": source_language,
                "target_language": target_language,
                "provider": config.TRANSLATION_PROVIDER,
            },
        )
        if config.TRANSLATION_REQUIRED_FOR_NON_ENGLISH:
            raise
        logger.warning("Continuing without translation for document %s: %s", document_id, exc)
        output = TranslationOutput(
            text=source_text,
            provider="untranslated",
            model_name=None,
            provider_version=None,
            confidence=0.0,
            metadata={"provider_not_configured": True},
        )

    translation_meta = build_translation_metadata(
        source_text=source_text,
        translated_text=output.text,
        source_language=source_language,
        target_language=target_language,
        source_extraction_id=str(row["extraction_id"]),
        output=output,
        glossary=glossary,
    )
    qa_status = translation_meta["qa_status"]

    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO extraction_result (document_id, extraction_type, content, metadata, confidence)
                VALUES (%s, 'TRANSLATED_TEXT', %s, %s, %s)
                RETURNING extraction_id
                """,
                (
                    document_id,
                    output.text,
                    json.dumps({"translation": translation_meta}),
                    output.confidence,
                ),
            )
            translated_extraction_id = cur.fetchone()["extraction_id"]
            translation_meta["translated_extraction_id"] = str(translated_extraction_id)

            cur.execute(
                """
                UPDATE extraction_result
                SET metadata = %s
                WHERE extraction_id = %s
                """,
                (json.dumps({"translation": translation_meta}), translated_extraction_id),
            )

            cur.execute(
                """
                INSERT INTO district_translation (
                  workspace_id,
                  document_id,
                  source_extraction_id,
                  translated_extraction_id,
                  source_language,
                  target_language,
                  provider,
                  model_name,
                  provider_version,
                  glossary_version,
                  translation_confidence,
                  qa_status,
                  cost_units,
                  source_hash,
                  translated_hash,
                  character_count,
                  review_sample_required,
                  metadata
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    workspace_id,
                    document_id,
                    row["extraction_id"],
                    translated_extraction_id,
                    source_language or "und",
                    target_language,
                    output.provider,
                    output.model_name,
                    output.provider_version,
                    glossary.version,
                    output.confidence,
                    qa_status,
                    output.cost_units,
                    translation_meta["source_hash"],
                    translation_meta["translated_hash"],
                    len(source_text),
                    source_language != target_language,
                    json.dumps(translation_meta),
                ),
            )

            cur.execute(
                """
                UPDATE document
                SET extracted_metadata = jsonb_set(
                      COALESCE(extracted_metadata, '{}'::jsonb),
                      '{translation}',
                      %s::jsonb,
                      true
                    ),
                    updated_at = now()
                WHERE document_id = %s
                """,
                (json.dumps(translation_meta), document_id),
            )

            if qa_status == "needs_review":
                cur.execute(
                    """
                    INSERT INTO review_queue (
                      workspace_id, entity_type, entity_id, reason, review_category, priority_score, details
                    ) VALUES (%s, 'DISTRICT_TRANSLATION', %s, %s, 'translation_qa', 70, %s)
                    """,
                    (
                        workspace_id,
                        translated_extraction_id,
                        "District-court translation requires QA review",
                        json.dumps(translation_meta),
                    ),
                )

    logger.info(
        "Translation complete for document %s: %s -> %s provider=%s qa=%s",
        document_id,
        source_language or "und",
        target_language,
        output.provider,
        qa_status,
    )


def translate_text(
    text: str,
    source_language: str,
    target_language: str = "en",
    glossary: LegalGlossary | None = None,
    provider: TranslationProvider | None = None,
) -> TranslationOutput:
    source_language = normalize_language(source_language)
    target_language = normalize_language(target_language) or "en"
    glossary = glossary or load_glossary()

    if not source_language or source_language == target_language:
        return TranslationOutput(
            text=text,
            provider="passthrough",
            model_name="passthrough",
            provider_version="local",
            confidence=1.0,
            metadata={"passthrough": True},
        )

    provider = provider or build_translation_provider()
    if provider is None:
        raise TranslationProviderNotConfigured(
            f"No translation provider configured for {source_language} -> {target_language}"
        )

    segments = split_for_translation(text, max_chars=config.TRANSLATION_MAX_CHARS_PER_SEGMENT)
    translated_segments: list[str] = []
    batch_size = max(1, config.TRANSLATION_BATCH_SIZE)
    for index in range(0, len(segments), batch_size):
        batch = segments[index:index + batch_size]
        translated_batch = provider.translate_batch(batch, source_language, target_language, glossary)
        if len(translated_batch) != len(batch):
            raise ValueError("Translation provider returned the wrong number of translated segments")
        translated_segments.extend(translated_batch)

    confidence = 1.0 if provider.name in {"identity", "passthrough"} else None
    return TranslationOutput(
        text="".join(translated_segments),
        provider=provider.name,
        model_name=provider.model_name,
        provider_version=provider.provider_version,
        confidence=confidence,
        metadata={"segment_count": len(segments), "matched_glossary_terms": glossary.matched_terms(text)},
    )


def build_translation_provider() -> TranslationProvider | None:
    provider = config.TRANSLATION_PROVIDER
    if provider in {"", "disabled", "none", "off"}:
        return None
    if provider in {"identity", "noop"}:
        return PassthroughTranslationProvider(name="identity", model_name="identity-test", provider_version="local")
    if provider in {"google", "google_cloud", "gcp"}:
        return GoogleCloudTranslationProvider(
            project_id=config.TRANSLATION_PROJECT_ID,
            location=config.TRANSLATION_LOCATION,
            model_name=config.TRANSLATION_MODEL or None,
            provider_version=config.TRANSLATION_PROVIDER_VERSION or None,
        )
    if provider in {"openai", "chatgpt", "gpt"}:
        return OpenAITranslationProvider(
            api_key=config.OPENAI_API_KEY,
            model_name=config.TRANSLATION_OPENAI_MODEL or config.OPENAI_CHAT_MODEL,
            provider_version=config.TRANSLATION_PROVIDER_VERSION or None,
        )
    if provider in {"indictrans2", "indictrans"}:
        return IndicTrans2Provider(
            endpoint_url=config.INDICTRANS2_URL,
            provider_version=config.TRANSLATION_PROVIDER_VERSION or None,
        )
    raise TranslationProviderNotConfigured(f"Unsupported TRANSLATION_PROVIDER: {config.TRANSLATION_PROVIDER}")


def build_translation_metadata(
    source_text: str,
    translated_text: str,
    source_language: str,
    target_language: str,
    source_extraction_id: str,
    output: TranslationOutput,
    glossary: LegalGlossary,
) -> dict[str, Any]:
    confidence = output.confidence
    passthrough = source_language == target_language or output.provider in {"passthrough", "identity"}
    if passthrough:
        qa_status = "approved"
    elif confidence is not None and confidence < config.TRANSLATION_MIN_CONFIDENCE:
        qa_status = "needs_review"
    elif config.TRANSLATION_AUTO_APPROVE:
        qa_status = "approved"
    else:
        qa_status = "pending"

    return {
        "source_language": source_language or "und",
        "target_language": target_language,
        "provider": output.provider,
        "model_name": output.model_name,
        "provider_version": output.provider_version,
        "glossary_version": glossary.version,
        "translation_confidence": confidence,
        "qa_status": qa_status,
        "translation_status": qa_status,
        "passthrough": passthrough,
        "source_extraction_id": source_extraction_id,
        "source_hash": _hash_text(source_text),
        "translated_hash": _hash_text(translated_text),
        "character_count": len(source_text),
        "matched_glossary_terms": glossary.matched_terms(source_text),
        **output.metadata,
    }


def load_glossary(path: str | None = None) -> LegalGlossary:
    glossary_path = Path(path or config.TRANSLATION_GLOSSARY_PATH)
    if not glossary_path.exists():
        fallback = Path(__file__).resolve().parents[2] / "config" / "legal_translation_glossary.yaml"
        glossary_path = fallback if fallback.exists() else glossary_path

    if glossary_path.exists():
        try:
            import yaml

            payload = yaml.safe_load(glossary_path.read_text(encoding="utf-8")) or {}
        except Exception as exc:
            logger.warning("Failed to load translation glossary %s: %s", glossary_path, exc)
            payload = {}
    else:
        payload = {}

    return LegalGlossary(
        version=str(payload.get("version") or config.TRANSLATION_GLOSSARY_VERSION),
        target_language=normalize_language(str(payload.get("target_language") or config.TRANSLATION_TARGET_LANGUAGE)) or "en",
        terms=list(payload.get("terms") or []),
    )


def resolve_source_language(*payloads: Any) -> str:
    for payload in payloads:
        language = _find_first(payload, "language")
        normalized = normalize_language(language)
        if normalized:
            script = _find_first(payload, "script")
            script_hint = SCRIPT_LANGUAGE_HINTS.get(str(script or "").lower())
            if normalized == "en" and script_hint and script_hint != "en":
                return script_hint
            return normalized

    for payload in payloads:
        script = _find_first(payload, "script")
        script_hint = SCRIPT_LANGUAGE_HINTS.get(str(script or "").lower())
        if script_hint:
            return script_hint
    return "en"


def normalize_language(language: Any) -> str:
    text = str(language or "").strip().lower().replace("_", "-")
    if not text:
        return ""
    text = text.split("-", 1)[0]
    return LANGUAGE_ALIASES.get(text, text)


def split_for_translation(text: str, max_chars: int = 24000) -> list[str]:
    if len(text) <= max_chars:
        return [text]

    parts = re.split(r"(\n{2,}|\f)", text)
    segments: list[str] = []
    current = ""

    for part in parts:
        if not part:
            continue
        if len(part) > max_chars:
            if current:
                segments.append(current)
                current = ""
            for index in range(0, len(part), max_chars):
                segments.append(part[index:index + max_chars])
            continue
        if current and len(current) + len(part) > max_chars:
            segments.append(current)
            current = part
        else:
            current += part

    if current:
        segments.append(current)
    return segments


def _flag_translation_review(workspace_id: str, document_id: str, reason: str, details: dict[str, Any]):
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO review_queue (
                  workspace_id, entity_type, entity_id, reason, review_category, priority_score, details
                ) VALUES (%s, 'DOCUMENT', %s, %s, 'translation_qa', 80, %s)
                """,
                (workspace_id, document_id, reason, json.dumps(details)),
            )
            cur.execute(
                "UPDATE document SET review_required = true, updated_at = now() WHERE document_id = %s",
                (document_id,),
            )


def _json_obj(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            payload = json.loads(value)
            return payload if isinstance(payload, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _find_first(value: Any, key: str) -> Any:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return None
    if isinstance(value, dict):
        if key in value and value[key] not in (None, ""):
            return value[key]
        for child in value.values():
            found = _find_first(child, key)
            if found not in (None, ""):
                return found
    return None


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
