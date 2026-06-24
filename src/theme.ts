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

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Apply the theme with a crossfade: the View Transitions API when available (the
// whole page crossfades between light and dark), otherwise a brief colour
// transition on the chrome via the .theme-anim class. Switches instantly when the
// user prefers reduced motion.
export function applyThemeAnimated(preference: ThemePreference): void {
  if (prefersReducedMotion()) {
    applyResolvedTheme(preference);
    return;
  }

  const start = (
    document as Document & { startViewTransition?: (cb: () => void) => unknown }
  ).startViewTransition;
  if (typeof start === "function") {
    start.call(document, () => applyResolvedTheme(preference));
    return;
  }

  // Fallback for browsers without the View Transitions API: enable colour
  // transitions on the chrome for the duration of this switch only.
  const root = document.documentElement;
  root.classList.add("theme-anim");
  void root.offsetWidth; // register the transition before the values change
  applyResolvedTheme(preference);
  window.setTimeout(() => root.classList.remove("theme-anim"), 300);
}

export function useThemePreference(): [ThemePreference, (next: ThemePreference) => void] {
  const [preference, setPreference] = React.useState<ThemePreference>(readThemePreference);
  const initialApply = React.useRef(true);

  React.useEffect(() => {
    if (initialApply.current) {
      initialApply.current = false;
      applyResolvedTheme(preference); // no crossfade on first mount
    } else {
      applyThemeAnimated(preference); // crossfade on user toggle
    }
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
    const onChange = () => applyThemeAnimated("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  return [preference, setPreference];
}
