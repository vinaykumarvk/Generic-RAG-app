import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiPost } from "@/lib/api";
import { Languages, Copy, Check, ChevronDown } from "lucide-react";
import { MarkdownContent } from "./MarkdownContent";

const LANGUAGES = [
  { code: "te", name: "Telugu" },
  { code: "ur", name: "Urdu" },
  { code: "hi", name: "Hindi" },
] as const;

interface TranslationResult {
  translation: {
    translation_id: string;
    translated_content: string;
    model_provider?: string;
    model_id?: string;
  };
  cached: boolean;
}

interface TranslateDropdownProps {
  workspaceId: string;
  sourceType: "message" | "summary";
  sourceId: string;
}

export function TranslateDropdown({ workspaceId, sourceType, sourceId }: TranslateDropdownProps) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [selectedLang, setSelectedLang] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  const translateMutation = useMutation({
    mutationFn: (targetLanguage: string) =>
      apiPost<TranslationResult>(`/api/v1/workspaces/${workspaceId}/translations`, {
        source_type: sourceType,
        source_id: sourceId,
        target_language: targetLanguage,
      }),
    onSuccess: (data) => {
      setResult(data);
    },
  });

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const handleTranslate = (langCode: string) => {
    setSelectedLang(langCode);
    setOpen(false);
    setResult(null);
    translateMutation.mutate(langCode);
  };

  const handleCopy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.translation.translated_content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative inline-block" ref={menuRef}>
      <button type="button" onClick={() => setOpen(!open)} className="p-1 rounded hover:bg-surface text-skin-muted hover:text-skin-base transition-colors" aria-label="Translate" aria-expanded={open} aria-haspopup="menu">
        <Languages size={14} aria-hidden="true" />
      </button>

      {open && (
        <div role="menu" className="absolute bottom-full mb-1 right-0 bg-surface border border-skin rounded-lg shadow-lg py-1 z-20 min-w-[8rem]">
          {LANGUAGES.map((lang) => (
            <button type="button" key={lang.code} role="menuitem" onClick={() => handleTranslate(lang.code)} disabled={translateMutation.isPending} className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-alt text-skin-base disabled:opacity-50 transition-colors">
              {lang.name}
            </button>
          ))}
        </div>
      )}

      {result && selectedLang && (
        <div className="mt-2 border border-skin rounded-lg overflow-hidden">
          <button type="button" onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between px-3 py-1.5 bg-surface-alt text-xs font-medium text-skin-base">
            <span className="flex items-center gap-1.5">
              <Languages size={12} aria-hidden="true" />
              {LANGUAGES.find((l) => l.code === selectedLang)?.name} Translation
              {result.cached && (
                <span className="px-1.5 py-0.5 bg-primary-100 text-primary-700 rounded text-[0.6rem] font-semibold">
                  Cached
                </span>
              )}
            </span>
            <ChevronDown size={12} className={`transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {expanded && (
            <div className="px-3 py-2 text-sm text-skin-base">
              <MarkdownContent content={result.translation.translated_content} />
              <div className="flex justify-end mt-1">
                <button type="button" onClick={handleCopy} className="p-1 rounded hover:bg-surface text-skin-muted hover:text-skin-base transition-colors" aria-label="Copy translation">
                  {copied ? <Check size={12} className="text-success" aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {translateMutation.isPending && (
        <div className="mt-2 px-3 py-2 text-xs text-skin-muted flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          Translating...
        </div>
      )}

      {translateMutation.error && (
        <div className="mt-2 px-3 py-1.5 text-xs text-danger surface-danger-soft rounded">
          Translation failed. Please try again.
        </div>
      )}
    </div>
  );
}
