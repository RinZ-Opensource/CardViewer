import React from "react";
import { toPng } from "html-to-image";
import { invoke } from "@tauri-apps/api/core";
import { EditorPanel } from "./EditorPanel";
import { applyEdits, maiLinkedPrintEdits } from "./cardData";
import { PreviewStage, selectedAssetSignature, usesPrimaryImageDataUrl } from "./cards";
import { CARD_LIST_OVERSCAN, CARD_ROW_HEIGHT, CARD_WIDTH, DEFAULT_PACKAGE_ROOT, EDIT_STORAGE_KEY, OfficialFontContext, TmpFontContext, canInvokeTauri } from "./constants";
import { useCardListViewport, useOfficialFonts, useSelectedAssetDataUrls, useSelectedImageDataUrl, useThumbnailLoader } from "./hooks";
import { THUMBNAIL_BUFFER_ROWS } from "./imageLoader";
import { loadStaticScanResult } from "./manifest";
import { mockScanResult } from "./mockData";
import { CardEdits, CardRecord, PrintFieldValue, ScanResult, ScanStats, ViewMode } from "./types";

export function App() {
  const [packageRoot, setPackageRoot] = React.useState(DEFAULT_PACKAGE_ROOT);
  const [scanResult, setScanResult] = React.useState<ScanResult | null>(null);
  const [selectedId, setSelectedId] = React.useState<string>("");
  const [query, setQuery] = React.useState("");
  const [gameFilter, setGameFilter] = React.useState("ALL");
  const [viewMode, setViewMode] = React.useState<ViewMode>("3d");
  const autoLoadStartedRef = React.useRef(false);
  const loadSequenceRef = React.useRef(0);
  const cardCaptureRef = React.useRef<HTMLDivElement | null>(null);
  const [exportingPng, setExportingPng] = React.useState(false);
  const { cardListRef, cardListViewport, updateCardListScroll } = useCardListViewport();
  const { officialFonts, tmpFont } = useOfficialFonts();
  const [savedEditPath, setSavedEditPath] = React.useState("");
  const [edits, setEdits] = React.useState<Record<string, CardEdits>>(() => {
    const raw = localStorage.getItem(EDIT_STORAGE_KEY);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, CardEdits>;
    } catch {
      return {};
    }
  });
  const [status, setStatus] = React.useState("Ready");
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    localStorage.setItem(EDIT_STORAGE_KEY, JSON.stringify(edits));
  }, [edits]);

  React.useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  React.useEffect(() => {
    if (autoLoadStartedRef.current) return;
    autoLoadStartedRef.current = true;
    void scanPackage();
  }, []);

  const cards = scanResult?.cards ?? [];
  const displayCards = React.useMemo(
    () => cards.filter((card) => card.recordType === "Card"),
    [cards],
  );
  const selectedBase =
    displayCards.find((card) => card.dataName === selectedId) ?? displayCards[0] ?? null;
  const selected = selectedBase
    ? applyEdits(selectedBase, edits[selectedBase.dataName])
    : null;
  const selectedImagePath =
    selected && usesPrimaryImageDataUrl(selected)
      ? selected.imagePath ?? selected.thumbnailPath ?? ""
      : "";
  const selectedAssetsSignature = React.useMemo(
    () => selectedAssetSignature(selected, scanResult?.streamingAssets),
    [scanResult?.streamingAssets, selected],
  );
  const imageDataUrl = useSelectedImageDataUrl(selected, selectedImagePath);
  const assetDataUrls = useSelectedAssetDataUrls(
    selected,
    selectedAssetsSignature,
    scanResult?.streamingAssets,
  );

  // Precompute one lowercased haystack per card so typing only re-runs cheap
  // substring checks instead of rebuilding+lowercasing every card's fields on
  // each keystroke. Rebuilt only when the cards or their edits change.
  const searchIndex = React.useMemo(() => {
    const index = new Map<string, string>();
    for (const card of displayCards) {
      const merged = applyEdits(card, edits[card.dataName]);
      index.set(
        card.dataName,
        [
          merged.id,
          merged.dataName,
          merged.displayName,
          merged.characterName,
          merged.skillName,
          merged.skillText,
          ...merged.printFields.map((field) => field.value),
        ]
          .join(" ")
          .toLocaleLowerCase(),
      );
    }
    return index;
  }, [displayCards, edits]);
  // Defer the query so the search input stays responsive while the (possibly
  // large) list re-filters in a non-blocking pass.
  const deferredQuery = React.useDeferredValue(query);
  const filteredCards = React.useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase();
    return displayCards.filter((card) => {
      const gameMatches = gameFilter === "ALL" || card.game === gameFilter;
      if (!gameMatches) return false;
      if (normalized.length === 0) return true;
      return (searchIndex.get(card.dataName) ?? "").includes(normalized);
    });
  }, [displayCards, gameFilter, deferredQuery, searchIndex]);
  const virtualStart = Math.max(
    0,
    Math.floor(cardListViewport.scrollTop / CARD_ROW_HEIGHT) - CARD_LIST_OVERSCAN,
  );
  const virtualCount =
    Math.ceil((cardListViewport.height || 1) / CARD_ROW_HEIGHT) + CARD_LIST_OVERSCAN * 2;
  const virtualEnd = Math.min(filteredCards.length, virtualStart + virtualCount);
  const virtualCards = React.useMemo(
    () => filteredCards.slice(virtualStart, virtualEnd),
    [filteredCards, virtualEnd, virtualStart],
  );
  const visibleStart = Math.max(0, Math.floor(cardListViewport.scrollTop / CARD_ROW_HEIGHT));
  const visibleCount = Math.ceil((cardListViewport.height || 1) / CARD_ROW_HEIGHT);
  const visibleEnd = Math.min(filteredCards.length, visibleStart + visibleCount);
  const thumbnailCards = React.useMemo(() => {
    const queued = new Set<string>();
    const result: CardRecord[] = [];
    const addRange = (start: number, end: number) => {
      for (let index = Math.max(0, start); index < Math.min(filteredCards.length, end); index += 1) {
        const card = filteredCards[index];
        if (queued.has(card.dataName)) continue;
        queued.add(card.dataName);
        result.push(card);
      }
    };

    addRange(visibleStart, visibleEnd);
    addRange(visibleEnd, visibleEnd + THUMBNAIL_BUFFER_ROWS);
    addRange(visibleStart - THUMBNAIL_BUFFER_ROWS, visibleStart);
    return result;
  }, [filteredCards, visibleEnd, visibleStart]);
  const cardListHeight = filteredCards.length * CARD_ROW_HEIGHT;
  const thumbCache = useThumbnailLoader(thumbnailCards);

  async function scanPackage() {
    setError("");
    const tauriAvailable = canInvokeTauri();
    const loadId = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadId;
    const isCurrentLoad = () => loadSequenceRef.current === loadId;
    const applyScanResult = (result: ScanResult) => {
      const nextDisplayCards = result.cards.filter((card) => card.recordType === "Card");
      setScanResult(result);
      setPackageRoot(result.packageRoot || packageRoot);
      setSelectedId((current) =>
        nextDisplayCards.some((card) => card.dataName === current)
          ? current
          : nextDisplayCards[0]?.dataName ?? "",
      );
    };

    try {
      setStatus("Loading exported manifest");
      try {
        const result = await loadStaticScanResult((partial, loadedCards, totalCards) => {
          if (!isCurrentLoad()) return;
          applyScanResult(partial);
          setStatus(
            `Loaded ${loadedCards.toLocaleString()} of ${totalCards.toLocaleString()} exported records`,
          );
        });
        if (!isCurrentLoad()) return;
        applyScanResult(result);
        setStatus(`Loaded ${result.cards.length.toLocaleString()} exported records`);
        return;
      } catch {
        if (!tauriAvailable) {
          const result = mockScanResult(packageRoot);
          if (!isCurrentLoad()) return;
          applyScanResult(result);
          setStatus("Browser preview data loaded");
          return;
        }
        setStatus("Manifest unavailable; scanning package");
      }

      const result = await invoke<ScanResult>("scan_package", { packageRoot });
      if (!isCurrentLoad()) return;
      applyScanResult(result);
      setStatus(`Loaded ${result.cards.length.toLocaleString()} records`);
    } catch (err) {
      if (!isCurrentLoad()) return;
      setError(String(err));
      setStatus("Scan failed");
    }
  }

  async function saveEdits() {
    setError("");
    const editCount = Object.keys(edits).length;
    if (editCount === 0) {
      setStatus("No print edits to save");
      return;
    }

    if (!canInvokeTauri()) {
      const blob = new Blob([JSON.stringify({ packageRoot, edits }, null, 2)], {
        type: "application/json",
      });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "cardviewer-print-edits.json";
      anchor.click();
      URL.revokeObjectURL(href);
      setStatus(`Exported ${editCount} edited records`);
      return;
    }

    try {
      const path = await invoke<string>("save_edit_session", {
        packageRoot: scanResult?.packageRoot ?? packageRoot,
        editsJson: JSON.stringify(edits, null, 2),
      });
      setSavedEditPath(path);
      setStatus(`Saved ${editCount} edited print records`);
    } catch (err) {
      setError(String(err));
      setStatus("Save failed");
    }
  }

  function updateSelected(fieldKey: string, value: PrintFieldValue) {
    if (!selected) return;
    setEdits((prev) => ({
      ...prev,
      [selected.dataName]: {
        ...prev[selected.dataName],
        ...maiLinkedPrintEdits(selected, fieldKey, value),
      },
    }));
  }

  function resetSelectedEdits() {
    if (!selected) return;
    setEdits((prev) => {
      const next = { ...prev };
      delete next[selected.dataName];
      return next;
    });
  }

  async function exportCardPng() {
    // Capture .card-face (not just .official-card) so the holo is included for
    // every game: MU3 paints it inside the card, MAI overlays it on top.
    const target = cardCaptureRef.current;
    if (!target || !selected) return;
    try {
      setExportingPng(true);
      // Let the button repaint to its "Exporting…" state before the heavy,
      // main-thread rasterization below briefly blocks the UI.
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
      );
      const width = target.offsetWidth || CARD_WIDTH;
      const pixelRatio = Math.min(4, Math.max(1, CARD_WIDTH / width));
      const dataUrl = await toPng(target, {
        pixelRatio,
        // Keep the card art + holo overlay, drop the soft edge-light glow.
        filter: (node) =>
          !(node instanceof HTMLElement && node.classList.contains("edge-light")),
      });
      const baseName =
        (selected.displayName || selected.dataName || "card")
          .replace(/[\\/:*?"<>|]/g, "_")
          .replace(/[.\s]+$/, "")
          .trim() || "card";
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = `${baseName}.png`;
      anchor.click();
    } catch (err) {
      setError(`Export failed: ${String(err)}`);
    } finally {
      setExportingPng(false);
    }
  }

  const games = React.useMemo(
    () => ["ALL", ...Array.from(new Set(displayCards.map((card) => card.game))).sort()],
    [displayCards],
  );

  return (
    <OfficialFontContext.Provider value={officialFonts}>
      <TmpFontContext.Provider value={tmpFont}>
      <main className="app-shell">
      <aside className="sidebar">
        <section className="filters">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search printed text"
            className="search-input"
          />
          <div className="segment">
            {games.map((game) => (
              <button
                key={game}
                className={gameFilter === game ? "active" : ""}
                onClick={() => setGameFilter(game)}
              >
                {game}
              </button>
            ))}
          </div>
        </section>

        <section
          className="card-list"
          aria-label="cards"
          ref={cardListRef}
          onScroll={updateCardListScroll}
        >
          <div className="card-list-spacer" style={{ height: cardListHeight }}>
            <div
              className="card-list-window"
              style={{ transform: `translateY(${virtualStart * CARD_ROW_HEIGHT}px)` }}
            >
              {virtualCards.map((card) => {
                const merged = applyEdits(card, edits[card.dataName]);
                const active = selected?.dataName === card.dataName;
                const thumb = thumbCache[card.dataName];
                return (
                  <button
                    key={`${card.game}-${card.dataName}`}
                    className={`card-row ${active ? "active" : ""}`}
                    onClick={() => setSelectedId(card.dataName)}
                  >
                    <span className="thumb-slot">
                      {thumb ? <img src={thumb} alt="" /> : <span>{card.game}</span>}
                    </span>
                    <span className="row-main">
                      <strong>{merged.displayName}</strong>
                      <small>
                        {card.dataName} / {card.recordType}
                      </small>
                    </span>
                    {edits[card.dataName] ? <span className="edited-dot" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </aside>

      <section className="workspace">
        <div className="preview-toolbar">
          <div>
            <h2>{selected?.displayName ?? "No card selected"}</h2>
            <p>{selected ? `${selected.game} / ${selected.dataName}` : "Scan a package"}</p>
          </div>
          <div className="preview-actions">
            <div className="segment compact">
              <button className={viewMode === "2d" ? "active" : ""} onClick={() => setViewMode("2d")}>
                2D
              </button>
              <button className={viewMode === "3d" ? "active" : ""} onClick={() => setViewMode("3d")}>
                3D
              </button>
            </div>
          </div>
        </div>

        <div className="preview-and-editor">
          <PreviewStage
            card={selected}
            imageDataUrl={imageDataUrl}
            assetDataUrls={assetDataUrls}
            mode={viewMode}
            captureRef={cardCaptureRef}
          />
          <EditorPanel
            card={selected}
            edits={selected ? edits[selected.dataName] : undefined}
            onChange={updateSelected}
            onReset={resetSelectedEdits}
          />
        </div>
      </section>
      {error ? (
        <div className="error-toast" role="alert">
          <span className="error-toast-text">{error}</span>
        </div>
      ) : null}

      {selected ? (
        <button
          type="button"
          className="export-fab"
          onClick={exportCardPng}
          disabled={exportingPng}
          title="Export current card as PNG"
          aria-label="Export current card as PNG"
        >
          <svg
            className="export-fab-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>{exportingPng ? "Exporting…" : "Export"}</span>
        </button>
      ) : null}
      </main>
      </TmpFontContext.Provider>
    </OfficialFontContext.Provider>
  );
}

export function StatsStrip({ stats }: { stats: ScanStats }) {
  return (
    <div className="stats-grid">
      <Stat label="CHU" value={stats.chuCards} />
      <Stat label="MAI Cards" value={stats.maiCards} />
      <Stat label="MAI Types" value={stats.maiCardTypes} />
      <Stat label="MU3 Cards" value={stats.mu3AssetCards} />
      <Stat label="PNG" value={stats.pngAssets} />
      <Stat label="UnityFS" value={stats.unityBundles} />
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <strong>{value.toLocaleString()}</strong>
      <span>{label}</span>
    </div>
  );
}

