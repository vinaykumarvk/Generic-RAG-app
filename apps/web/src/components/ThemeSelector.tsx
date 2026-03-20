import { useTheme, CUSTOM_THEMES, type ThemeId } from "@/hooks/useTheme";
import { Palette } from "lucide-react";

type ThemeSelectorProps = {
  /** Render variant: "pill" for login page, "compact" for header */
  variant?: "pill" | "compact";
  className?: string;
};

const groups = ["Light", "Dark", "Accessibility"] as const;

function ThemeOptions() {
  const grouped = groups.map((g) => ({
    label: g,
    themes: CUSTOM_THEMES.filter((t) => t.group === g),
  }));

  return (
    <>
      {grouped.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.themes.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

export function ThemeSelector({ variant = "pill", className = "" }: ThemeSelectorProps) {
  const { theme, setTheme, isDark } = useTheme();

  if (variant === "compact") {
    return (
      <div className={`flex items-center gap-1.5 ${className}`}>
        <Palette size={14} className="text-skin-muted" aria-hidden="true" />
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as ThemeId)}
          aria-label="Select theme"
          className="text-xs bg-transparent border-none text-skin-muted cursor-pointer
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded
            py-0.5 pr-5"
        >
          <ThemeOptions />
        </select>
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <Palette size={14} className="text-skin-muted" aria-hidden="true" />
      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value as ThemeId)}
        aria-label="Select theme"
        className="text-xs cursor-pointer rounded-full px-3 py-1.5 pr-7 transition-colors
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
          bg-surface border border-skin text-skin-base hover:border-primary-300"
      >
        <ThemeOptions />
      </select>
    </div>
  );
}
