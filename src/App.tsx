import React from "react";
import { selectedAssetSignature, usesPrimaryImageDataUrl } from "./cardAssets";
import { buildFilterConfig, cardMatchesFilters, uniqueOptions } from "./cardFilters";
import { isSupportedCardRecord } from "./cardSupport";
import { PreviewStage } from "./cards";
import {
  CARD_LIST_OVERSCAN,
  CARD_ROW_HEIGHT,
  OfficialFontContext,
  TmpFontContext,
} from "./constants";
import {
  useCardListViewport,
  useOfficialFonts,
  useScanResult,
  useSelectedAssetDataUrls,
  useSelectedImageDataUrl,
  useThumbnailLoader,
} from "./hooks";
import { THUMBNAIL_BUFFER_ROWS } from "./imageLoader";
import { CardRecord, ViewMode } from "./types";

export function App() {
  const [selectedId, setSelectedId] = React.useState<string>("");
  const [query, setQuery] = React.useState("");
  const [cardFilters, setCardFilters] = React.useState<Record<string, string>>({});
  const [viewMode, setViewMode] = React.useState<ViewMode>("3d");
  const { cardListRef, cardListViewport, updateCardListScroll } = useCardListViewport();
  const { officialFonts, tmpFont } = useOfficialFonts();
  const { scanResult, status, source, loading, retry } = useScanResult(setSelectedId);

  const cards = scanResult?.cards ?? [];
  const displayCards = React.useMemo(
    () => cards.filter(isSupportedCardRecord),
    [cards],
  );
  const games = React.useMemo(
    () => uniqueOptions(displayCards.map((card) => card.game)),
    [displayCards],
  );
  const selected = displayCards.find((card) => card.dataName === selectedId) ?? null;
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
  // checks; rebuilt only when the manifest cards change.
  const searchIndex = React.useMemo(() => {
    const index = new Map<string, string>();
    for (const card of displayCards) {
      index.set(
        card.dataName,
        [
          card.id,
          card.dataName,
          card.displayName,
          card.characterName,
          card.skillName,
          card.skillText,
          ...card.printFields.map((field) => field.value),
        ]
          .join(" ")
          .toLocaleLowerCase(),
      );
    }
    return index;
  }, [displayCards]);
  // Defer the query so the search input stays responsive while the (possibly
  // large) list re-filters in a non-blocking pass.
  const deferredQuery = React.useDeferredValue(query);
  const filterConfig = React.useMemo(
    () => buildFilterConfig(displayCards, cardFilters),
    [displayCards, cardFilters],
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
      if (!cardMatchesFilters(card, cardFilters)) return false;
      if (normalized.length === 0) return true;
      return (searchIndex.get(card.dataName) ?? "").includes(normalized);
    });
  }, [displayCards, cardFilters, deferredQuery, searchIndex]);

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

  return (
    <OfficialFontContext.Provider value={officialFonts}>
      <TmpFontContext.Provider value={tmpFont}>
        <main className="app-shell">
      <aside className="sidebar" aria-label="Card browser">
        <section className="filters">
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
          {loading || source === "mock" ? (
            <div
              className={`data-source-status${source === "mock" ? " degraded" : ""}`}
              role="status"
              aria-live="polite"
            >
              <span>{status}</span>
              {source === "mock" ? (
                <button type="button" className="ghost-button" onClick={retry} disabled={loading}>
                  Retry manifest
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
                      <strong>{card.displayName}</strong>
                      <small>
                        {card.dataName} / {card.recordType}
                      </small>
                    </span>
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

        <PreviewStage
          card={selected}
          imageDataUrl={imageDataUrl}
          assetDataUrls={assetDataUrls}
          mode={viewMode}
        />
      </section>
        </main>
      </TmpFontContext.Provider>
    </OfficialFontContext.Provider>
  );
}
