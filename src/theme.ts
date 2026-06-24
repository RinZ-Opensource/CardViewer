import React from "react";

// Light / dark / follow-system theme handling for the app chrome.
//
// The *preference* (light | dark | system) is persisted; the *resolved* theme
// (always a concrete light | dark) is written to <html data-theme>, which the
// CSS in styles.css keys off. Resolving "system" in JS means the stylesheet
// only needs a single :root[data-theme="dark"] block — no duplicated
// prefers-color-scheme media query. The same storage key and resolution logic
// are mirrored, intentionally minimally, in public/theme-init.js so the initial
// theme is applied before first paint (no flash). Keep the two in sync.

export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "cv-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // localStorage can throw in sandboxed / private-mode contexts; fall through.
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(DARK_QUERY).matches
  );
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "system") return systemPrefersDark() ? "dark" : "light";
  return preference;
}

// Write the resolved theme to <html data-theme>, matching the pre-paint script.
export function applyResolvedTheme(preference: ThemePreference): void {
  document.documentElement.dataset.theme = resolveTheme(preference);
}

export function useThemePreference(): [ThemePreference, (next: ThemePreference) => void] {
  const [preference, setPreference] = React.useState<ThemePreference>(readThemePreference);

  React.useEffect(() => {
    applyResolvedTheme(preference);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Persisting is best-effort; the in-memory preference still applies.
    }
  }, [preference]);

  // While following the system, re-resolve when the OS colour scheme flips.
  React.useEffect(() => {
    if (preference !== "system") return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => applyResolvedTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  return [preference, setPreference];
}
