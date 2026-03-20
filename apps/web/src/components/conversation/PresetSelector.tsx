import { Zap, BookOpen } from "lucide-react";

interface PresetSelectorProps {
  value: "concise" | "balanced" | "detailed";
  onChange: (preset: "concise" | "balanced" | "detailed") => void;
}

/**
 * FR-019/AC-01: Simplified 2-way Brief|Detailed toggle.
 * Maps Brief → "concise" preset, Detailed → "detailed" preset.
 */
export function PresetSelector({ value, onChange }: PresetSelectorProps) {
  const isBrief = value === "concise";

  return (
    <div className="flex items-center" role="radiogroup" aria-label="Answer detail level">
      <button
        type="button"
        role="radio"
        aria-checked={isBrief}
        onClick={() => onChange("concise")}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-l-md text-xs font-medium transition-colors border ${
          isBrief
            ? "bg-primary-100 text-primary-700 border-primary-300"
            : "text-skin-muted hover:bg-surface-alt border-skin"
        }`}
      >
        <Zap size={12} aria-hidden="true" />
        Brief
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={!isBrief}
        onClick={() => onChange("detailed")}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-r-md text-xs font-medium transition-colors border border-l-0 ${
          !isBrief
            ? "bg-primary-100 text-primary-700 border-primary-300"
            : "text-skin-muted hover:bg-surface-alt border-skin"
        }`}
      >
        <BookOpen size={12} aria-hidden="true" />
        Detailed
      </button>
    </div>
  );
}
