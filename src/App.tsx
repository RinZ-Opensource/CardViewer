import React from "react";
import { EditorPanel } from "./EditorPanel";
import { exportNodeAsPng } from "./exportPng";
import { applyEdits } from "./cardData";
import { effectiveCardEdits, SHARED_PLAYER_EDITS_KEY } from "./cardEdits";
import { buildFilterConfig, cardMatchesFilters, uniqueOptions } from "./cardFilters";
import { selectedAssetSignature, usesPrimaryImageDataUrl } from "./cardAssets";
import { isSupportedCardRecord } from "./cardSupport";
import { PreviewStage } from "./cards";
import {
  CARD_LIST_OVERSCAN,
  CARD_ROW_HEIGHT,
  CARD_WIDTH,
  DEPLOYMENT_MODE,
  OfficialFontContext,
  TmpFontContext,
  canInvokeTauri,
} from "./constants";
import { useCardEdits, useCardListViewport, useOfficialFonts, useScanResult, useSelectedAssetDataUrls, useSelectedImageDataUrl, useThumbnailLoader } from "./hooks";
import { THUMBNAIL_BUFFER_ROWS } from "./imageLoader";
import { CardRecord, ViewMode } from "./types";

/** Keep the unfinished CardViewer export workflow out of the UI for now. */
const SHOW_CARD_EXPORT = false;

export function App() {
  const [selectedId, setSelectedId] = React.useState<string>("");
  const [query, setQuery] = React.useState("");
  const [cardFilters, setCardFilters] = React.useState<Record<string, string>>({});
  const [viewMode, setViewMode] = React.useState<ViewMode>("3d");
  const cardCaptureRef = React.useRef<HTMLDivElement | null>(null);
  const [exportingPng, setExportingPng] = React.useState(false);
  const { cardListRef, cardListViewport, updateCardListScroll } = useCardListViewport();
  const { officialFonts, tmpFont } = useOfficialFonts();
  const { edits, updateCardField, updatePlayerField, resetCardEdits, resetPlayerEdits } = useCardEdits();
  const {
    scanResult,
    status,
    source,
    error,
    setError,
    loading,
    retry,
    packageRoot,
    scanPackageRoot,
  } = useScanResult(setSelectedId);
  const [packageRootDraft, setPackageRootDraft] = React.useState(packageRoot);
  const tauriAvailable = canInvokeTauri();

  React.useEffect(() => {
    setPackageRootDraft(packageRoot);
  }, [packageRoot]);

  const cards = scanResult?.cards ?? [];
  const displayCards = React.useMemo(
    () => cards.filter(isSupportedCardRecord),
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
      if (current.game) next.game = current.game;
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
    if (filteredCards.some((card) => card.dataName === selectedId)) return;
    setSelectedId(filteredCards[0]?.dataName ?? "");
    const list = cardListRef.current;
    if (list) {
      list.scrollTop = 0;
      updateCardListScroll();
    }
  }, [cardListRef, filteredCards, selectedId, updateCardListScroll]);
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
  const selectedIndex = selected
    ? filteredCards.findIndex((card) => card.dataName === selected.dataName)
    : -1;
  const selectedOptionId =
    selectedIndex >= virtualStart && selectedIndex < virtualEnd
      ? `card-option-${selectedIndex}`
      : undefined;
  const hasSearchOrFacet =
    query.trim().length > 0 ||
    Object.keys(cardFilters).some((key) => key !== "game" && Boolean(cardFilters[key]));

  React.useEffect(() => {
    const list = cardListRef.current;
    if (!list) return;
    const maxScrollTop = Math.max(0, cardListHeight - list.clientHeight);
    if (list.scrollTop > maxScrollTop) {
      list.scrollTop = 0;
      updateCardListScroll();
    }
  }, [cardListHeight, cardListRef, updateCardListScroll]);

  function selectCardAt(index: number) {
    if (filteredCards.length === 0) return;
    const nextIndex = Math.max(0, Math.min(filteredCards.length - 1, index));
    const card = filteredCards[nextIndex];
    setSelectedId(card.dataName);

    const list = cardListRef.current;
    if (!list) return;
    const rowTop = nextIndex * CARD_ROW_HEIGHT;
    const rowBottom = rowTop + CARD_ROW_HEIGHT;
    if (rowTop < list.scrollTop) {
      list.scrollTop = rowTop;
    } else if (rowBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = rowBottom - list.clientHeight;
    }
    updateCardListScroll();
  }

  function onCardListKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || filteredCards.length === 0) return;
    const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const pageSize = Math.max(1, Math.floor(cardListViewport.height / CARD_ROW_HEIGHT));
    let nextIndex: number | null = null;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = currentIndex + 1;
        break;
      case "ArrowUp":
        nextIndex = currentIndex - 1;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = filteredCards.length - 1;
        break;
      case "PageDown":
        nextIndex = currentIndex + pageSize;
        break;
      case "PageUp":
        nextIndex = currentIndex - pageSize;
        break;
      default:
        return;
    }
    event.preventDefault();
    selectCardAt(nextIndex);
  }

  function clearSearchAndFacets() {
    setQuery("");
    setCardFilters((current) => {
      const next: Record<string, string> = {};
      if (current.game) next.game = current.game;
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
      await exportNodeAsPng(
        target,
        selected.displayName || selected.dataName || "card",
        CARD_WIDTH,
      );
    } catch (err) {
      setError(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExportingPng(false);
    }
  }

  return (
    <OfficialFontContext.Provider value={officialFonts}>
      <TmpFontContext.Provider value={tmpFont}>
      <main className="app-shell">
      <aside className="sidebar" aria-label="Card browser">
        <section className="filters">
          {tauriAvailable ? (
            <form
              className="package-root-form"
              aria-label="Local CardMaker package"
              onSubmit={(event) => {
                event.preventDefault();
                const normalized = packageRootDraft.trim();
                setPackageRootDraft(normalized);
                scanPackageRoot(normalized);
              }}
            >
              <input
                className="path-input"
                value={packageRootDraft}
                onChange={(event) => setPackageRootDraft(event.target.value)}
                placeholder="CardMaker package folder"
                aria-label="CardMaker package folder"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="submit"
                className="primary-button"
                disabled={loading || !packageRootDraft.trim()}
              >
                Scan folder
              </button>
            </form>
          ) : null}
          <div className="search-field">
            <svg
              className="search-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search printed text"
              aria-label="Search cards by printed text"
              className="search-input"
            />
          </div>
          {games.length > 0 ? (
            <div className="segment" role="group" aria-label="Game">
              {games.map((game) => (
                <button
                  key={game.value}
                  type="button"
                  className={(cardFilters.game || games[0]?.value) === game.value ? "active" : ""}
                  aria-pressed={(cardFilters.game || games[0]?.value) === game.value}
                  onClick={() => setCardFilters({ game: game.value })}
                >
                  {game.label}
                </button>
              ))}
            </div>
          ) : null}
          {loading || source === "mock" || source === "error" ? (
            <div
              className={`data-source-status${source === "mock" || source === "error" ? " degraded" : ""}`}
              role="status"
              aria-live="polite"
            >
              <span>{status}</span>
              {source === "mock" || (source === "error" && packageRoot) ? (
                <button type="button" className="ghost-button" onClick={retry} disabled={loading}>
                  {source === "mock" ? "Retry manifest" : "Retry"}
                </button>
              ) : null}
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
          <span className="visually-hidden" role="status" aria-live="polite">
            {filteredCards.length.toLocaleString()} card results
          </span>
        </section>

        <section
          className="card-list"
          role="listbox"
          tabIndex={0}
          aria-label={`Cards, ${filteredCards.length.toLocaleString()} results`}
          aria-activedescendant={selectedOptionId}
          ref={cardListRef}
          onScroll={updateCardListScroll}
          onKeyDown={onCardListKeyDown}
        >
          {filteredCards.length === 0 && !loading ? (
            <div className="card-list-empty" role="status">
              <strong>{displayCards.length === 0 ? "No supported cards available" : "No matching cards"}</strong>
              <span>
                {displayCards.length === 0
                  ? "Retry the online manifest or check the deployment data source."
                  : "Adjust the search or filters to show more results."}
              </span>
              {hasSearchOrFacet ? (
                <button type="button" className="ghost-button" onClick={clearSearchAndFacets}>
                  Clear search and filters
                </button>
              ) : null}
            </div>
          ) : (
            <div className="card-list-spacer" style={{ height: cardListHeight }}>
              <div
                className="card-list-window"
                style={{ transform: `translateY(${virtualStart * CARD_ROW_HEIGHT}px)` }}
              >
              {virtualCards.map((card, windowIndex) => {
                const cardIndex = virtualStart + windowIndex;
                const merged = applyEdits(card, effectiveCardEdits(edits, card));
                const active = selected?.dataName === card.dataName;
                const thumb = thumbCache[card.dataName];
                return (
                  <button
                    key={`${card.game}-${card.dataName}`}
                    id={`card-option-${cardIndex}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={active}
                    aria-posinset={cardIndex + 1}
                    aria-setsize={filteredCards.length}
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
                    {edits[card.dataName] ? <span className="chip-edited">edited</span> : null}
                  </button>
                );
              })}
              </div>
            </div>
          )}
        </section>
      </aside>

      <section className="workspace">
        <div className="preview-toolbar">
          <div>
            <div className="preview-title-row">
              <h2>{selected?.displayName ?? "No card selected"}</h2>
              {loading ? (
                <span className="preview-spinner" role="status" aria-label={status || "Loading"} title={status} />
              ) : null}
            </div>
            <p className="preview-subtitle">
              {selected
                ? `${selected.game} / ${selected.dataName}`
                : loading
                  ? "Loading online card data"
                  : "No card matches the current data and filters"}
            </p>
          </div>
          <div className="preview-actions">
            <div className="segment compact" role="group" aria-label="Preview mode">
              <button
                type="button"
                className={viewMode === "2d" ? "active" : ""}
                aria-pressed={viewMode === "2d"}
                onClick={() => setViewMode("2d")}
              >
                2D
              </button>
              <button
                type="button"
                className={viewMode === "3d" ? "active" : ""}
                aria-pressed={viewMode === "3d"}
                onClick={() => setViewMode("3d")}
              >
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
          {DEPLOYMENT_MODE === "private" ? (
            <EditorPanel
              card={selectedBase}
              edits={selectedEdits}
              onChange={(fieldKey, value) => { if (selected) updateCardField(selected, fieldKey, value); }}
              onPlayerChange={(fieldKey, value) => { if (selected) updatePlayerField(fieldKey, value); }}
              onReset={() => { if (selected) resetCardEdits(selected); }}
              onResetPlayer={resetPlayerEdits}
              canReset={Boolean(selectedCardEdits && Object.keys(selectedCardEdits).length > 0)}
              canResetPlayer={Boolean(
                edits[SHARED_PLAYER_EDITS_KEY] &&
                Object.keys(edits[SHARED_PLAYER_EDITS_KEY]).length > 0
              )}
            />
          ) : (
            <aside
              className="editor-panel empty public-editor-notice"
              aria-label="Card editor"
            >
              Editing is unavailable in the public asset build because that renderer does not
              apply print fields.
            </aside>
          )}
        </div>
      </section>
      {error ? (
        <div className="error-toast" role="alert">
          <span className="error-toast-text">{error}</span>
        </div>
      ) : null}

      {SHOW_CARD_EXPORT && selected ? (
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
