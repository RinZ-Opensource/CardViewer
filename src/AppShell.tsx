import React from "react";
import { App as CardViewerSurface } from "./App";
import { ScoreCardSurface } from "./scorecard/ScoreCardSurface";
import { ThemeToggle } from "./ThemeToggle";

type SurfaceKey = "cards" | "scorecard";

const SURFACE_STORAGE_KEY = "configarc-card-viewer.surface";

const SURFACES: Array<{ key: SurfaceKey; label: string }> = [
  { key: "cards", label: "Card Viewer" },
  { key: "scorecard", label: "Score Cards" },
];

function loadSurface(): SurfaceKey {
  const fromHash = window.location.hash.replace(/^#/, "");
  if (SURFACES.some((surface) => surface.key === fromHash)) {
    return fromHash as SurfaceKey;
  }
  const stored = localStorage.getItem(SURFACE_STORAGE_KEY);
  return SURFACES.some((surface) => surface.key === stored)
    ? (stored as SurfaceKey)
    : "cards";
}

export function AppShell() {
  const [surface, setSurface] = React.useState<SurfaceKey>(loadSurface);
  const [mountedSurfaces, setMountedSurfaces] = React.useState<Set<SurfaceKey>>(
    () => new Set([surface]),
  );
  const mountSurface = React.useCallback((nextSurface: SurfaceKey) => {
    setMountedSurfaces((current) => {
      if (current.has(nextSurface)) return current;
      const next = new Set(current);
      next.add(nextSurface);
      return next;
    });
  }, []);

  React.useEffect(() => {
    mountSurface(surface);
    localStorage.setItem(SURFACE_STORAGE_KEY, surface);
    const expectedHash = `#${surface}`;
    if (window.location.hash !== expectedHash) {
      window.history.replaceState(null, "", expectedHash);
    }
  }, [mountSurface, surface]);

  React.useEffect(() => {
    const syncSurfaceFromHistory = () => {
      const next = window.location.hash.replace(/^#/, "");
      if (SURFACES.some((entry) => entry.key === next)) {
        mountSurface(next as SurfaceKey);
        setSurface(next as SurfaceKey);
      }
    };
    window.addEventListener("hashchange", syncSurfaceFromHistory);
    return () => window.removeEventListener("hashchange", syncSurfaceFromHistory);
  }, [mountSurface]);

  function selectSurface(next: SurfaceKey) {
    if (next === surface) return;
    mountSurface(next);
    window.location.hash = next;
    setSurface(next);
  }

  return (
    <div className="shell-root">
      <nav className="surface-nav" aria-label="App surfaces">
        <h1 className="surface-brand">ConfigArc CardViewer</h1>
        <div className="surface-actions">
          <div className="segment compact" role="group" aria-label="App surface">
            {SURFACES.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={surface === entry.key ? "active" : ""}
                aria-current={surface === entry.key ? "page" : undefined}
                onClick={() => selectSurface(entry.key)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <ThemeToggle />
        </div>
      </nav>
      <div className="surface-body">
        {mountedSurfaces.has("cards") ? (
          <div className="surface-pane" hidden={surface !== "cards"}>
            <CardViewerSurface />
          </div>
        ) : null}
        {mountedSurfaces.has("scorecard") ? (
          <div className="surface-pane" hidden={surface !== "scorecard"}>
            <ScoreCardSurface />
          </div>
        ) : null}
      </div>
    </div>
  );
}
