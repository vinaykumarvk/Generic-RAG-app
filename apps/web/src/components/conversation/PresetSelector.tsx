import { Zap, Scale, BookOpen } from "lucide-react";

const PRESETS = [
  { value: "concise" as const, label: "Concise", icon: Zap, description: "Fast, brief answers" },
  { value: "balanced" as const, label: "Balanced", icon: Scale, description: "Default depth" },
  { value: "detailed" as const, label: "Detailed", icon: BookOpen, description: "Deep analysis" },
];

interface PresetSelectorProps {
  value: "concise" | "balanced" | "detailed";
  onChange: (preset: "concise" | "balanced" | "detailed") => void;
}

export function PresetSelector({ value, onChange }: PresetSelectorProps) {
  return (
    <div className="flex gap-1">
      {PRESETS.map(({ value: v, label, icon: Icon, description }) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          title={description}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
            value === v
              ? "bg-primary-100 text-primary-700"
              : "text-gray-500 hover:bg-gray-100"
          }`}
        >
          <Icon size={12} />
          {label}
        </button>
      ))}
    </div>
  );
}
