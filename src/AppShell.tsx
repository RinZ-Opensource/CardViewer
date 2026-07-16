import React from "react";
import { App as CardViewerSurface } from "./App";
import { readLocalStorage, writeLocalStorage } from "./persistence";
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
  const stored = readLocalStorage(SURFACE_STORAGE_KEY);
  return SURFACES.some((surface) => surface.key === stored)
    ? (stored as SurfaceKey)
    : "cards";
}

export function AppShell() {
  const [surface, setSurface] = React.useState<SurfaceKey>(loadSurface);
  const surfacePaneRefs = React.useRef<Record<SurfaceKey, HTMLDivElement | null>>({
    cards: null,
    scorecard: null,
  });
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
  const focusSurface = React.useCallback((nextSurface: SurfaceKey) => {
    window.requestAnimationFrame(() => surfacePaneRefs.current[nextSurface]?.focus());
  }, []);

  React.useEffect(() => {
    mountSurface(surface);
    writeLocalStorage(SURFACE_STORAGE_KEY, surface);
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
        focusSurface(next as SurfaceKey);
      }
    };
    window.addEventListener("hashchange", syncSurfaceFromHistory);
    return () => window.removeEventListener("hashchange", syncSurfaceFromHistory);
  }, [focusSurface, mountSurface]);

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
          <div
            className="surface-pane"
            hidden={surface !== "cards"}
            role="region"
            aria-label="Card Viewer"
            tabIndex={-1}
            ref={(node) => {
              surfacePaneRefs.current.cards = node;
            }}
          >
            <CardViewerSurface />
          </div>
        ) : null}
        {mountedSurfaces.has("scorecard") ? (
          <div
            className="surface-pane"
            hidden={surface !== "scorecard"}
            role="region"
            aria-label="Score Cards"
            tabIndex={-1}
            ref={(node) => {
              surfacePaneRefs.current.scorecard = node;
            }}
          >
            <ScoreCardSurface />
          </div>
        ) : null}
      </div>
    </div>
  );
}
