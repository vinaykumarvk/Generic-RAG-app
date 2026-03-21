import { useState, useEffect, useCallback } from "react";

/** Theme identifier — matches [data-theme="..."] selectors in index.css */
export type ThemeId =
  | "default"
  | "tokyo-night"
  | "dracula"
  | "nord"
  | "catppuccin"
  | "solarized-dark"
  | "rolex"
  | "gruvbox"
  | "onedark"
  | "rosepine"
  | "ayu"
  | "github-dark"
  | "sunset"
  | "monokai"
  | "high-contrast";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  group: "Light" | "Dark" | "Accessibility";
  swatch: string; // CSS color for preview dot
}

/** All available themes with display metadata */
export const CUSTOM_THEMES: ThemeMeta[] = [
  { id: "default", label: "Blue (Default)", group: "Light", swatch: "#2563eb" },
  // Dark themes
  { id: "tokyo-night",    label: "Tokyo Night",     group: "Dark",  swatch: "#7aa2f7" },
  { id: "dracula",        label: "Dracula",          group: "Dark",  swatch: "#bd93f9" },
  { id: "nord",           label: "Nord",             group: "Dark",  swatch: "#88c0d0" },
  { id: "catppuccin",     label: "Catppuccin Mocha", group: "Dark",  swatch: "#cba6f7" },
  { id: "solarized-dark", label: "Solarized Dark",   group: "Dark",  swatch: "#268bd2" },
  { id: "rolex",          label: "Rolex",            group: "Dark",  swatch: "#c5a867" },
  { id: "gruvbox",        label: "Gruvbox",          group: "Dark",  swatch: "#fe8019" },
  { id: "onedark",        label: "One Dark",         group: "Dark",  swatch: "#61afef" },
  { id: "rosepine",       label: "Rose Pine",        group: "Dark",  swatch: "#c4a7e7" },
  { id: "ayu",            label: "Ayu",              group: "Dark",  swatch: "#e6b450" },
  { id: "github-dark",    label: "GitHub Dark",      group: "Dark",  swatch: "#58a6ff" },
  { id: "sunset",         label: "Sunset",           group: "Dark",  swatch: "#ff9e64" },
  { id: "monokai",        label: "Monokai",          group: "Dark",  swatch: "#f92672" },
  // Accessibility
  { id: "high-contrast", label: "High Contrast", group: "Accessibility", swatch: "#000000" },
];

/** Human-readable labels keyed by theme id */
export const THEME_LABELS: Record<ThemeId, string> = Object.fromEntries(
  CUSTOM_THEMES.map((t) => [t.id, t.label])
) as Record<ThemeId, string>;

const STORAGE_KEY = "intellirag_theme";
const VALID_THEME_IDS = new Set<ThemeId>(CUSTOM_THEMES.map((theme) => theme.id));
const DARK_THEMES: ReadonlySet<ThemeId> = new Set([
  "tokyo-night", "dracula", "nord", "catppuccin", "solarized-dark",
  "rolex", "gruvbox", "onedark", "rosepine", "ayu", "github-dark", "sunset", "monokai",
]);

function isThemeId(value: string | null): value is ThemeId {
  return !!value && VALID_THEME_IDS.has(value as ThemeId);
}

function applyTheme(themeId: ThemeId) {
  const el = document.documentElement;
  if (themeId === "default") {
    el.removeAttribute("data-theme");
  } else {
    el.setAttribute("data-theme", themeId);
  }
}

/**
 * Theme hook — reads/writes theme preference to localStorage
 * and applies the data-theme attribute on <html>.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isThemeId(saved)) return saved;
    if (saved) localStorage.removeItem(STORAGE_KEY);
    return "default";
  });

  // Apply theme on mount and when it changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((id: ThemeId) => {
    if (id === "default") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, id);
    }
    setThemeState(id);
  }, []);

  const isDark = DARK_THEMES.has(theme);

  return { theme, setTheme, isDark, themes: CUSTOM_THEMES };
}

/**
 * Apply saved theme immediately on page load (before React hydration).
 * Falls back to system preference detection (FR-021/AC-05).
 * Call this once in main.tsx to prevent flash of wrong theme.
 */
export function applyStoredTheme() {
  const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
  if (isThemeId(saved) && saved !== "default") {
    document.documentElement.setAttribute("data-theme", saved);
  } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    // Auto-detect dark mode preference and apply a default dark theme
    document.documentElement.setAttribute("data-theme", "tokyo-night");
  } else if (saved && !isThemeId(saved)) {
    localStorage.removeItem(STORAGE_KEY);
  }
}
