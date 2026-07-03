import React from "react";
import { App as CardViewerSurface } from "./App";
import { ScoreCardSurface } from "./scorecard/ScoreCardSurface";

type SurfaceKey = "cards" | "scorecard";

const SURFACE_STORAGE_KEY = "configarc-card-viewer.surface";

const SURFACES: Array<{ key: SurfaceKey; label: string }> = [
  { key: "cards", label: "Card Viewer" },
  { key: "scorecard", label: "Score Cards" },
];

function loadSurface(): SurfaceKey {
  const stored = localStorage.getItem(SURFACE_STORAGE_KEY);
  return SURFACES.some((surface) => surface.key === stored)
    ? (stored as SurfaceKey)
    : "cards";
}

export function AppShell() {
  const [surface, setSurface] = React.useState<SurfaceKey>(loadSurface);

  React.useEffect(() => {
    localStorage.setItem(SURFACE_STORAGE_KEY, surface);
  }, [surface]);

  return (
    <div className="shell-root">
      <nav className="surface-nav" aria-label="App surfaces">
        <span className="surface-brand">ConfigArc CardViewer</span>
        <div className="segment compact">
          {SURFACES.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={surface === entry.key ? "active" : ""}
              onClick={() => setSurface(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </nav>
      <div className="surface-body">
        {surface === "cards" ? <CardViewerSurface /> : <ScoreCardSurface />}
      </div>
    </div>
  );
}
