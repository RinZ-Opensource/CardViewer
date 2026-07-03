import React from "react";

// Light / dark / follow-system theme for the app chrome. The preference is
// persisted; the resolved theme (concrete light|dark) is written to
// <html data-theme> for the CSS. The same logic is mirrored in
// public/theme-init.js to apply it before first paint — keep the two in sync.

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

// Apply the theme with a crossfade: View Transitions API when available, else a
// brief .theme-anim colour transition; instant when reduced-motion is preferred.
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
