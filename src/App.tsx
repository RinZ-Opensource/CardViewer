import React from "react";
import { toPng } from "html-to-image";
import { invoke } from "@tauri-apps/api/core";
import { EditorPanel } from "./EditorPanel";
import { ThemeToggle } from "./ThemeToggle";
import { applyEdits, fieldString, maiLinkedPrintEdits, mu3RarityKind } from "./cardData";
import { PreviewStage, selectedAssetSignature, usesPrimaryImageDataUrl } from "./cards";
import { CARD_LIST_OVERSCAN, CARD_ROW_HEIGHT, CARD_WIDTH, DEFAULT_PACKAGE_ROOT, EDIT_STORAGE_KEY, OfficialFontContext, TmpFontContext, canInvokeTauri } from "./constants";
import { useCardListViewport, useOfficialFonts, useSelectedAssetDataUrls, useSelectedImageDataUrl, useThumbnailLoader } from "./hooks";
import { THUMBNAIL_BUFFER_ROWS } from "./imageLoader";
import { loadStaticScanResult } from "./manifest";
import { mockScanResult } from "./mockData";
import { CardEdits, CardRecord, PrintFieldValue, ScanResult, ScanStats, ViewMode } from "./types";

type FilterOption = {
  value: string;
  label: string;
};

type CardFilterConfig = {
  key: string;
  label: string;
  placeholder: string;
  options: FilterOption[];
};

const SHARED_PLAYER_EDITS_KEY = "__playerData";
const PLAYER_EDIT_KEYS = new Set(["userName", "rating", "friendCode"]);

function sharedPlayerEdits(edits: Record<string, CardEdits>) {
  return edits[SHARED_PLAYER_EDITS_KEY] ?? {};
}

function effectiveCardEdits(edits: Record<string, CardEdits>, card: CardRecord) {
  return {
    ...(edits[card.dataName] ?? {}),
    ...sharedPlayerEdits(edits),
  };
}

function buildFilterConfig(
  cards: CardRecord[],
  edits: Record<string, CardEdits>,
  activeFilters: Record<string, string>,
): CardFilterConfig[] {
  const games = uniqueOptions(cards.map((card) => card.game));
  const filters: CardFilterConfig[] = [];
  const selectedGame = activeFilters.game || (games[0]?.value ?? "");

  if (selectedGame === "MAI") {
    const maiCards = cards.filter((card) => card.game === "MAI");
    pushFilter(
      filters,
      "mai.type",
      "Type",
      "Type",
      uniqueOptions(maiCards.map((card) => cardFilterValue(card, effectiveCardEdits(edits, card), "mai.type"))),
    );
    pushFilter(
      filters,
      "mai.character",
      "Character",
      "Character",
      uniqueOptions(maiCards.map((card) => cardFilterValue(card, effectiveCardEdits(edits, card), "mai.character"))),
    );
    pushFilter(
      filters,
      "mai.version",
      "Version",
      "Version",
      uniqueOptions(maiCards.map((card) => cardFilterValue(card, effectiveCardEdits(edits, card), "mai.version"))),
    );
  }

  if (selectedGame === "MU3") {
    const mu3Cards = cards.filter((card) => card.game === "MU3");
    pushFilter(
      filters,
      "mu3.rarity",
      "Rarity",
      "Rarity",
      uniqueOptions(mu3Cards.map((card) => cardFilterValue(card, effectiveCardEdits(edits, card), "mu3.rarity"))),
    );
    pushFilter(
      filters,
      "mu3.character",
      "Character",
      "Character",
      uniqueOptions(mu3Cards.map((card) => cardFilterValue(card, effectiveCardEdits(edits, card), "mu3.character"))),
    );
    pushFilter(
      filters,
      "mu3.version",
      "Version",
      "Version",
      uniqueOptions(mu3Cards.map((card) => cardFilterValue(card, effectiveCardEdits(edits, card), "mu3.version"))),
    );
  }

  return filters;
}

function pushFilter(filters: CardFilterConfig[], key: string, label: string, placeholder: string, options: FilterOption[]) {
  if (options.length <= 1) return;
  filters.push({ key, label, placeholder, options });
}

function uniqueOptions(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) continue;
    seen.add(value);
  }
  return Array.from(seen)
    .sort(naturalCompare)
    .map((value) => ({ value, label: value }));
}

function naturalCompare(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function cardMatchesFilters(card: CardRecord, edits: CardEdits | undefined, filters: Record<string, string>) {
  for (const [key, expected] of Object.entries(filters)) {
    if (!expected) continue;
    if (cardFilterValue(card, edits, key) !== expected) return false;
  }
  return true;
}

function cardFilterValue(card: CardRecord, edits: CardEdits | undefined, key: string) {
  const merged = applyEdits(card, edits);
  switch (key) {
    case "game":
      return merged.game;
    case "mai.type":
      return maiTypeName(fieldString(merged, "typeId"));
    case "mai.character":
      return firstCardField(merged, ["charaName", "characterName"]) || merged.characterName || merged.displayName;
    case "mai.version":
      return normalizedVersion(firstCardField(merged, ["verCharaId", "version", "versionId", "releaseVersion"]));
    case "mu3.rarity":
      return mu3RarityKind(merged);
    case "mu3.character":
      return firstCardField(merged, ["baseCharacterName", "characterName", "nameForCommonModel"]) || merged.characterName || merged.displayName;
    case "mu3.version":
      return normalizedVersion(firstCardField(merged, ["cardNo", "version", "versionId", "releaseVersion", "verCharaId"]));
    default:
      return "";
  }
}

function firstCardField(card: CardRecord, keys: string[]) {
  for (const key of keys) {
    const value = fieldString(card, key);
    if (value) return value;
  }
  return "";
}

function maiTypeName(typeId: string) {
  switch (typeId.trim()) {
    case "2":
      return "Bronze";
    case "3":
      return "Silver";
    case "4":
      return "Gold";
    case "6":
      return "Freedom";
    case "":
      return "";
    default:
      return `Type ${typeId.trim()}`;
  }
}

function normalizedVersion(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const numberedCardVersion = trimmed.match(/^(.+)-\d+$/);
  if (numberedCardVersion) return numberedCardVersion[1];
  const numericVersion = trimmed.match(/^([A-Za-z]*\s*\d+(?:\.\d+){1,3})/);
  if (numericVersion) return numericVersion[1].trim();
  return trimmed;
}

export function App() {
  const [packageRoot, setPackageRoot] = React.useState(DEFAULT_PACKAGE_ROOT);
  const [scanResult, setScanResult] = React.useState<ScanResult | null>(null);
  const [selectedId, setSelectedId] = React.useState<string>("");
  const [query, setQuery] = React.useState("");
  const [cardFilters, setCardFilters] = React.useState<Record<string, string>>({});
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

  // Precompute one lowercased haystack per card so typing only re-runs cheap
  // substring checks instead of rebuilding+lowercasing every card's fields on
  // each keystroke. Rebuilt only when the cards or their edits change.
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

  function updatePlayerData(fieldKey: string, value: PrintFieldValue) {
    if (!selected || !PLAYER_EDIT_KEYS.has(fieldKey)) return;
    setEdits((prev) => {
      const next: Record<string, CardEdits> = {
        ...prev,
        [SHARED_PLAYER_EDITS_KEY]: {
          ...sharedPlayerEdits(prev),
          [fieldKey]: value,
        },
      };

      for (const [key, cardEdits] of Object.entries(prev)) {
        if (key === SHARED_PLAYER_EDITS_KEY || cardEdits[fieldKey] === undefined) continue;
        const cleaned = { ...cardEdits };
        delete cleaned[fieldKey];
        if (Object.keys(cleaned).length === 0) {
          delete next[key];
        } else {
          next[key] = cleaned;
        }
      }

      return next;
    });
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
            onChange={updateSelected}
            onPlayerChange={updatePlayerData}
            onReset={resetSelectedEdits}
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
