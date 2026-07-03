import React from "react";
import { toPng } from "html-to-image";
import { EditorPanel } from "./EditorPanel";
import { ThemeToggle } from "./ThemeToggle";
import { applyEdits } from "./cardData";
import { effectiveCardEdits } from "./cardEdits";
import { buildFilterConfig, cardMatchesFilters, uniqueOptions } from "./cardFilters";
import { PreviewStage, selectedAssetSignature, usesPrimaryImageDataUrl } from "./cards";
import { CARD_LIST_OVERSCAN, CARD_ROW_HEIGHT, CARD_WIDTH, OfficialFontContext, TmpFontContext } from "./constants";
import { useCardEdits, useCardListViewport, useOfficialFonts, useScanResult, useSelectedAssetDataUrls, useSelectedImageDataUrl, useThumbnailLoader } from "./hooks";
import { THUMBNAIL_BUFFER_ROWS } from "./imageLoader";
import { CardRecord, ViewMode } from "./types";

export function App() {
  const [selectedId, setSelectedId] = React.useState<string>("");
  const [query, setQuery] = React.useState("");
  const [cardFilters, setCardFilters] = React.useState<Record<string, string>>({});
  const [viewMode, setViewMode] = React.useState<ViewMode>("3d");
  const cardCaptureRef = React.useRef<HTMLDivElement | null>(null);
  const [exportingPng, setExportingPng] = React.useState(false);
  const { cardListRef, cardListViewport, updateCardListScroll } = useCardListViewport();
  const { officialFonts, tmpFont } = useOfficialFonts();
  const { edits, updateCardField, updatePlayerField, resetCardEdits } = useCardEdits();
  const { scanResult, status, error, setError } = useScanResult(setSelectedId);

  const cards = scanResult?.cards ?? [];
  const displayCards = React.useMemo(
    () => cards.filter((card) => card.recordType === "Card"),
    [cards],
  );
  const games = React.useMemo(
    () => uniqueOptions(displayCards.map((card) => card.game)),
    [displayCards],
  );
  const selectedBase = displayCards.find((card) => card.dataName === selectedId) ?? null;
  const selectedEdits = selectedBase ? effectiveCardEdits(edits, selectedBase) : undefined;
  const selectedCardEdits = selectedBase ? edits[selectedBase.dataName] : undefined;
  const selected = selectedBase
    ? applyEdits(selectedBase, selectedEdits)
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

  // One lowercased haystack per card, so typing only re-runs cheap substring
  // checks; rebuilt only when the cards or their edits change.
  const searchIndex = React.useMemo(() => {
    const index = new Map<string, string>();
    for (const card of displayCards) {
      const merged = applyEdits(card, effectiveCardEdits(edits, card));
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
  const filterConfig = React.useMemo(
    () => buildFilterConfig(displayCards, edits, cardFilters),
    [displayCards, edits, cardFilters],
  );

  React.useEffect(() => {
    setCardFilters((current) => {
      if (games.length === 0) {
        if (!current.game) return current;
        const next = { ...current };
        delete next.game;
        return next;
      }

      const availableGames = new Set(games.map((game) => game.value));
      if (current.game && availableGames.has(current.game)) return current;
      return { ...current, game: games[0]?.value ?? "" };
    });
  }, [games]);

  React.useEffect(() => {
    setCardFilters((current) => {
      let changed = false;
      const next: Record<string, string> = {};
      const availableKeys = new Set(["game", ...filterConfig.map((filter) => filter.key)]);
      for (const filter of filterConfig) {
        const value = current[filter.key];
        if (!value) continue;
        if (filter.options.some((option) => option.value === value)) {
          next[filter.key] = value;
          continue;
        }
        changed = true;
      }
      for (const key of Object.keys(current)) {
        if (!availableKeys.has(key)) changed = true;
      }
      return changed ? next : current;
    });
  }, [filterConfig]);

  const filteredCards = React.useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase();
    return displayCards.filter((card) => {
      if (!cardMatchesFilters(card, effectiveCardEdits(edits, card), cardFilters)) return false;
      if (normalized.length === 0) return true;
      return (searchIndex.get(card.dataName) ?? "").includes(normalized);
    });
  }, [displayCards, edits, cardFilters, deferredQuery, searchIndex]);

  React.useEffect(() => {
    if (filteredCards.length === 0) {
      setSelectedId("");
      return;
    }
    setSelectedId((current) =>
      filteredCards.some((card) => card.dataName === current)
        ? current
        : filteredCards[0]?.dataName ?? "",
    );
  }, [filteredCards]);
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
          {games.length > 0 ? (
            <div className="segment">
              {games.map((game) => (
                <button
                  key={game.value}
                  className={(cardFilters.game || games[0]?.value) === game.value ? "active" : ""}
                  onClick={() => setCardFilters({ game: game.value })}
                >
                  {game.label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="filter-grid" aria-label="Card filters">
            {filterConfig.map((filter) => (
              <label className="filter-control" key={filter.key}>
                <span>{filter.label}</span>
                <select
                  value={cardFilters[filter.key] ?? ""}
                  onChange={(event) =>
                    setCardFilters((current) => {
                      const next = { ...current };
                      if (event.target.value) {
                        next[filter.key] = event.target.value;
                      } else {
                        delete next[filter.key];
                      }
                      return next;
                    })
                  }
                >
                  <option value="">{filter.placeholder}</option>
                  {filter.options.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
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
                const merged = applyEdits(card, effectiveCardEdits(edits, card));
                const active = selected?.dataName === card.dataName;
                const thumb = thumbCache[card.dataName];
                return (
                  <button
                    key={`${card.game}-${card.dataName}`}
                    className={`card-row ${active ? "active" : ""}`}
                    onClick={() => setSelectedId(card.dataName)}
                  >
                    <span className="thumb-slot">
                      {thumb ? <img src={thumb} alt="" decoding="async" /> : <span>{card.game}</span>}
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
            {status ? <p className="preview-status">{status}</p> : null}
          </div>
          <div className="preview-actions">
            <ThemeToggle />
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
            card={selectedBase}
            edits={selectedEdits}
            onChange={(fieldKey, value) => { if (selected) updateCardField(selected, fieldKey, value); }}
            onPlayerChange={(fieldKey, value) => { if (selected) updatePlayerField(fieldKey, value); }}
            onReset={() => { if (selected) resetCardEdits(selected); }}
            canReset={Boolean(selectedCardEdits && Object.keys(selectedCardEdits).length > 0)}
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
