import { useState, useRef, useEffect } from "react";
import { Settings, Palette, Monitor, Sun, Moon, Check } from "lucide-react";
import { useTheme, CUSTOM_THEMES } from "@/hooks/useTheme";

const groups = [
  { key: "Light" as const, label: "Light Themes", icon: Sun },
  { key: "Dark" as const, label: "Dark Themes", icon: Moon },
  { key: "Accessibility" as const, label: "Accessibility", icon: Monitor },
];

interface SettingsDropdownProps {
  /** When true, renders just the theme list without the button/popover wrapper (for embedding in another menu). */
  inline?: boolean;
}

function ThemeList({ onSelect }: { onSelect?: () => void }) {
  const { theme, setTheme } = useTheme();

  return (
    <>
      {/* Header */}
      <div className="px-4 py-2 border-b border-border-primary">
        <div className="flex items-center gap-2">
          <Palette size={14} className="text-text-tertiary" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            Theme
          </span>
        </div>
      </div>

      {/* Theme groups */}
      {groups.map((group) => {
        const themes = CUSTOM_THEMES.filter((t) => t.group === group.key);
        if (themes.length === 0) return null;
        const GroupIcon = group.icon;

        return (
          <div key={group.key} className="py-1">
            <div className="px-4 py-1.5 flex items-center gap-2 text-text-tertiary">
              <GroupIcon size={12} aria-hidden="true" />
              <span className="text-[11px] font-medium uppercase tracking-wider">{group.label}</span>
            </div>
            {themes.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setTheme(t.id);
                  onSelect?.();
                }}
                className={`w-full text-left px-4 py-2 text-sm flex items-center gap-3 transition-colors
                  ${theme === t.id
                    ? "bg-primary-50 text-primary-700"
                    : "text-text-secondary hover:bg-surface-secondary"}`}
              >
                <span
                  className="w-4 h-4 rounded-full border-2 flex-shrink-0"
                  style={{
                    backgroundColor: t.swatch,
                    borderColor: theme === t.id ? t.swatch : "var(--color-border-primary, #d1d5db)",
                  }}
                  aria-hidden="true"
                />
                <span className="flex-1">{t.label}</span>
                {theme === t.id && (
                  <Check size={14} className="text-primary-500 flex-shrink-0" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}

export function SettingsDropdown({ inline }: SettingsDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // When inline, just render the theme list directly
  if (inline) {
    return (
      <div className="rounded-lg border border-border-primary bg-surface-secondary overflow-hidden">
        <ThemeList />
      </div>
    );
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Settings"
        aria-expanded={open}
        aria-haspopup="true"
        className="p-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 text-text-tertiary hover:text-text-primary hover:bg-surface-secondary"
      >
        <Settings size={18} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-64 rounded-xl shadow-lg border border-border-primary bg-surface-primary z-50 py-2"
        >
          <ThemeList onSelect={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
