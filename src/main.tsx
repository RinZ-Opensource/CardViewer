import React from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import QRCode from "qrcode";
import "./styles.css";

type PrintFieldType = "text" | "multiline" | "number" | "bool" | "select" | "metadata";

type PrintFieldOption = {
  value: string;
  label: string;
};

type PrintField = {
  key: string;
  label: string;
  fieldType: PrintFieldType;
  value: string;
  options?: PrintFieldOption[];
};

type AssetLayer = {
  key: string;
  label: string;
  path: string;
};

type CardRecord = {
  id: string;
  game: string;
  recordType: string;
  dataName: string;
  displayName: string;
  characterName: string;
  skillName: string;
  skillText: string;
  rareType: number | null;
  labelType: number | null;
  difType: number | null;
  miss: number | null;
  combo: number | null;
  chain: number | null;
  imagePath: string | null;
  thumbnailPath: string | null;
  assetLayers: AssetLayer[];
  sourceXml: string;
  editableFields: string[];
  printFields: PrintField[];
  editedPrintFields?: string[];
};

type ScanStats = {
  chuCards: number;
  maiCards: number;
  maiCardTypes: number;
  maiCardCharas: number;
  mu3AssetCards: number;
  mu3XmlRecords: number;
  pngAssets: number;
  unityBundles: number;
  unityBundleBytes: number;
};

type ScanResult = {
  packageRoot: string;
  streamingAssets: string;
  cards: CardRecord[];
  stats: ScanStats;
  warnings: string[];
};

type OnlineManifestShardInfo = {
  key: string;
  game: string;
  href: string;
  cardCount: number;
};

type OnlineManifestIndex = {
  packageRoot: string;
  streamingAssets: string;
  stats: ScanStats;
  warnings: string[];
  totalCards: number;
  shards: OnlineManifestShardInfo[];
};

type OnlineManifestShard = {
  key: string;
  game: string;
  cards: CardRecord[];
};

type PrintFieldValue = string | boolean;
type CardEdits = Record<string, PrintFieldValue>;
type LoadedImageDataUrl = {
  path: string;
  dataUrl: string;
};
type LoadedAssetDataUrls = {
  signature: string;
  urls: Record<string, string>;
};
type ViewMode = "2d" | "3d";
type DeploymentMode = "private" | "public";
type Bounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};
type OfficialFontKey = "kaku40" | "maru32" | "kaku16";

type UnityGlyph = {
  index: number;
  uv: [number, number, number, number];
  vert: [number, number, number, number];
  advance: number;
};

type UnityFontMetrics = {
  name: string;
  lineSpacing: number;
  characterSpacing: number;
  texture: string;
  width: number;
  height: number;
  chars: Record<string, UnityGlyph>;
};

type TmpGlyph = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  xOffset: number;
  yOffset: number;
  xAdvance: number;
  scale: number;
};

type TmpFontMetrics = {
  name: string;
  fontInfo: {
    PointSize: number;
    LineHeight: number;
    Ascender: number;
    Descender: number;
    Padding: number;
  };
  texture: string;
  width: number;
  height: number;
  glyphs: Record<string, TmpGlyph>;
};

const DEFAULT_PACKAGE_ROOT = "I:\\package";
const EDIT_STORAGE_KEY = "configarc-card-viewer.print-edits";
const EXPLICIT_STATIC_MANIFEST_URL = import.meta.env.VITE_CARD_MANIFEST_URL?.trim() ?? "";
const STATIC_MANIFEST_URL = EXPLICIT_STATIC_MANIFEST_URL || "/official/generated/cards.json";
const CARD_TILT_X_MAX = 26;
const CARD_TILT_Y_MAX = 34;
const CARD_ROW_HEIGHT = 82;
const CARD_LIST_OVERSCAN = 6;
const DEPLOYMENT_MODE: DeploymentMode =
  import.meta.env.VITE_DEPLOYMENT_MODE === "public" ? "public" : "private";
const USE_OFFICIAL_ASSETS = DEPLOYMENT_MODE === "private";
const HOLO_ENABLED = true;
const OfficialFontContext = React.createContext<Partial<Record<OfficialFontKey, UnityFontMetrics>>>({});
const TmpFontContext = React.createContext<TmpFontMetrics | null>(null);
const CANVAS_FONT_SEGA_MARU_DB =
  '"CardViewer SegaMaruDB", "CardViewer Zen Maru", "Yu Gothic", "Meiryo", "Segoe UI", sans-serif';
const MU3_LIMIT_BREAK_STAR_POSITIONS = [
  -208, -172.2, -134.3, -96.1, -58, -25, 11.3, 47.8, 81.6, 120, 156.8,
];
const MU3_LIMIT_BREAK_STAR_Y = -290.1;
const MU3_AWAKEN_MARK_RECT = { x: -273.7, y: 289, w: 174, h: 152 };
const MU3_LEVEL_LIMITS = [1, 50, 55, 60, 65, 70, 80, 90, 100, 100000];

installPrivateFontFaces();

const canInvokeTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const IMAGE_LOAD_CONCURRENCY = 3;
const THUMBNAIL_BUFFER_ROWS = 24;
type ImageLoadPriority = "high" | "normal";
const imageDataUrlCache = new Map<string, string>();
const imageDataUrlPending = new Map<string, Promise<string>>();
let activeImageLoads = 0;
const highPriorityImageLoads: Array<() => void> = [];
const queuedImageLoads: Array<() => void> = [];

function scheduleImageLoad<T>(
  task: () => Promise<T>,
  priority: ImageLoadPriority = "normal",
): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeImageLoads += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeImageLoads -= 1;
          runNextImageLoad();
        });
    };

    if (activeImageLoads < IMAGE_LOAD_CONCURRENCY) {
      run();
    } else {
      if (priority === "high") {
        highPriorityImageLoads.push(run);
      } else {
        queuedImageLoads.push(run);
      }
    }
  });
}

function runNextImageLoad() {
  const next = highPriorityImageLoads.shift() ?? queuedImageLoads.shift();
  next?.();
}

function isStaticAssetPath(path: string) {
  return (
    path.startsWith("/") ||
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("data:")
  );
}

function readCachedImageDataUrl(
  path: string,
  priority: ImageLoadPriority = "normal",
): Promise<string> {
  if (isStaticAssetPath(path)) return Promise.resolve(path);
  if (!canInvokeTauri()) return Promise.reject(new Error(`Cannot read local image path: ${path}`));

  const cached = imageDataUrlCache.get(path);
  if (cached) return Promise.resolve(cached);

  const pending = imageDataUrlPending.get(path);
  if (pending) return pending;

  const request = scheduleImageLoad(() =>
    invoke<string>("read_image_data_url", { path }),
    priority,
  )
    .then((dataUrl) => {
      imageDataUrlCache.set(path, dataUrl);
      return dataUrl;
    })
    .finally(() => {
      imageDataUrlPending.delete(path);
    });
  imageDataUrlPending.set(path, request);
  return request;
}

function installPrivateFontFaces() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.deploymentMode = DEPLOYMENT_MODE;
  if (DEPLOYMENT_MODE !== "private") return;
  if (document.getElementById("cardviewer-private-fonts")) return;

  const style = document.createElement("style");
  style.id = "cardviewer-private-fonts";
  style.textContent = `
@font-face {
  font-family: "CardViewer NewRodin";
  src: url("/fonts/private/FOT-NewRodin-Pro-EB.otf") format("opentype");
  font-weight: 800;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "CardViewer Humming";
  src: url("/fonts/private/FOT-Humming-Std-B.otf") format("opentype");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "CardViewer SegaMaruDB";
  src: url("/fonts/private/SEGA-MaruGothic-DB.ttf") format("truetype");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
html[data-deployment-mode="private"] {
  --font-sega-kaku: "CardViewer Zen Kaku", "CardViewer NewRodin", "Yu Gothic", "Meiryo", "Segoe UI", sans-serif;
  --font-sega-maru: "CardViewer Zen Maru", "CardViewer Humming", "Yu Gothic", "Meiryo", "Segoe UI", sans-serif;
  --font-sega-maru-db: "CardViewer SegaMaruDB", "CardViewer Zen Maru", "Yu Gothic", "Meiryo", "Segoe UI", sans-serif;
  --font-tmp-humming: "CardViewer Humming", "Yu Gothic", "Meiryo", "Segoe UI", sans-serif;
  --font-official-number: "CardViewer NewRodin", "Impact", "Arial Black", sans-serif;
}
html[data-deployment-mode="private"] .holo-rainbow {
  background:
    url("/official/UI_Card_Horo_Rainbow_Hard.png") 0 0 / 128px 128px repeat,
    linear-gradient(115deg, rgba(255, 35, 87, 0.72), rgba(255, 220, 68, 0.68), rgba(35, 235, 165, 0.68), rgba(50, 170, 255, 0.72), rgba(190, 80, 255, 0.72), rgba(255, 35, 87, 0.72));
  background-size: 128px 128px, 180% 180%;
}`;
  document.head.append(style);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} unavailable: ${response.status}`);
  }
  return (await response.json()) as T;
}

function siblingManifestUrl(manifestUrl: string, fileName: string) {
  const base = typeof window === "undefined" ? "http://localhost/" : window.location.href;
  const url = new URL(manifestUrl, base);
  url.pathname = url.pathname.replace(/[^/]*$/, fileName);
  return url.toString();
}

function resolveManifestHref(href: string, manifestUrl: string) {
  const base = typeof window === "undefined" ? "http://localhost/" : manifestUrl;
  return new URL(href, base).toString();
}

function scanResultFromIndex(index: OnlineManifestIndex, cards: CardRecord[]): ScanResult {
  return {
    packageRoot: index.packageRoot,
    streamingAssets: index.streamingAssets,
    cards,
    stats: index.stats,
    warnings: index.warnings,
  };
}

async function loadStaticScanResult(
  onPartial?: (result: ScanResult, loadedCards: number, totalCards: number) => void,
) {
  const indexUrl = STATIC_MANIFEST_URL.endsWith("cards.index.json")
    ? STATIC_MANIFEST_URL
    : siblingManifestUrl(STATIC_MANIFEST_URL, "cards.index.json");
  try {
    const index = await fetchJson<OnlineManifestIndex>(indexUrl);
    const firstShard = index.shards[0];
    if (!firstShard) return scanResultFromIndex(index, []);

    const first = await fetchJson<OnlineManifestShard>(
      resolveManifestHref(firstShard.href, indexUrl),
    );
    let cards = first.cards;
    onPartial?.(scanResultFromIndex(index, cards), cards.length, index.totalCards);

    const remaining = await Promise.all(
      index.shards.slice(1).map((shard) =>
        fetchJson<OnlineManifestShard>(resolveManifestHref(shard.href, indexUrl)),
      ),
    );
    cards = [first, ...remaining].flatMap((shard) => shard.cards);
    return scanResultFromIndex(index, cards);
  } catch {
    return fetchJson<ScanResult>(STATIC_MANIFEST_URL);
  }
}

function App() {
  const [packageRoot, setPackageRoot] = React.useState(DEFAULT_PACKAGE_ROOT);
  const [scanResult, setScanResult] = React.useState<ScanResult | null>(null);
  const [selectedId, setSelectedId] = React.useState<string>("");
  const [query, setQuery] = React.useState("");
  const [gameFilter, setGameFilter] = React.useState("ALL");
  const [viewMode, setViewMode] = React.useState<ViewMode>("3d");
  const [loadedImageDataUrl, setLoadedImageDataUrl] = React.useState<LoadedImageDataUrl | null>(null);
  const [loadedAssetDataUrls, setLoadedAssetDataUrls] = React.useState<LoadedAssetDataUrls>({
    signature: "",
    urls: {},
  });
  const [thumbCache, setThumbCache] = React.useState<Record<string, string>>({});
  const thumbCacheRef = React.useRef<Record<string, string>>({});
  const thumbPendingRef = React.useRef<Set<string>>(new Set());
  const autoLoadStartedRef = React.useRef(false);
  const loadSequenceRef = React.useRef(0);
  const cardListRef = React.useRef<HTMLElement | null>(null);
  const [cardListViewport, setCardListViewport] = React.useState({ height: 0, scrollTop: 0 });
  const [officialFonts, setOfficialFonts] = React.useState<
    Partial<Record<OfficialFontKey, UnityFontMetrics>>
  >({});
  const [tmpFont, setTmpFont] = React.useState<TmpFontMetrics | null>(null);
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
    thumbCacheRef.current = thumbCache;
  }, [thumbCache]);

  React.useEffect(() => {
    if (autoLoadStartedRef.current) return;
    autoLoadStartedRef.current = true;
    void scanPackage();
  }, []);

  React.useEffect(() => {
    const element = cardListRef.current;
    if (!element) return;

    const update = () => {
      setCardListViewport({
        height: element.clientHeight,
        scrollTop: element.scrollTop,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (!USE_OFFICIAL_ASSETS) return;
    let cancelled = false;
    loadOfficialFonts()
      .then((fonts) => {
        if (!cancelled) setOfficialFonts(fonts);
      })
      .catch(() => undefined);
    loadOfficialTmpFont()
      .then((font) => {
        if (!cancelled) setTmpFont(font);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
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
  const imageDataUrl =
    loadedImageDataUrl?.path === selectedImagePath ? loadedImageDataUrl.dataUrl : "";
  const assetDataUrls =
    loadedAssetDataUrls.signature === selectedAssetsSignature ? loadedAssetDataUrls.urls : {};

  const filteredCards = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return displayCards.filter((card) => {
      const merged = applyEdits(card, edits[card.dataName]);
      const gameMatches = gameFilter === "ALL" || card.game === gameFilter;
      const queryMatches =
        normalized.length === 0 ||
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
          .toLocaleLowerCase()
          .includes(normalized);
      return gameMatches && queryMatches;
    });
  }, [displayCards, edits, gameFilter, query]);
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

  const updateCardListScroll = React.useCallback(() => {
    const element = cardListRef.current;
    if (!element) return;
    setCardListViewport((prev) => {
      if (prev.scrollTop === element.scrollTop && prev.height === element.clientHeight) return prev;
      return {
        height: element.clientHeight,
        scrollTop: element.scrollTop,
      };
    });
  }, []);

  React.useEffect(() => {
    if (!selected) {
      setLoadedImageDataUrl(null);
      return;
    }
    if (!selectedImagePath || (!canInvokeTauri() && !isStaticAssetPath(selectedImagePath))) {
      setLoadedImageDataUrl(null);
      return;
    }

    let cancelled = false;
    setLoadedImageDataUrl((prev) => (prev?.path === selectedImagePath ? prev : null));
    readCachedImageDataUrl(selectedImagePath, "high")
      .then((dataUrl) => {
        if (!cancelled) setLoadedImageDataUrl({ path: selectedImagePath, dataUrl });
      })
      .catch(() => {
        if (!cancelled) setLoadedImageDataUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedImagePath]);

  React.useEffect(() => {
    if (!selected) {
      setLoadedAssetDataUrls({ signature: "", urls: {} });
      return;
    }

    let cancelled = false;
    const layers = visibleAssetLayers(selected, scanResult?.streamingAssets);
    const readableLayers = layers.filter((layer) => canInvokeTauri() || isStaticAssetPath(layer.path));
    setLoadedAssetDataUrls((prev) =>
      prev.signature === selectedAssetsSignature ? prev : { signature: selectedAssetsSignature, urls: {} },
    );
    readableLayers.forEach((layer) => {
      readCachedImageDataUrl(layer.path, assetLayerLoadPriority(layer))
        .then((dataUrl) => {
          if (cancelled) return;
          setLoadedAssetDataUrls((prev) => {
            if (prev.signature !== selectedAssetsSignature) return prev;
            if (prev.urls[layer.key] === dataUrl) return prev;
            return {
              signature: selectedAssetsSignature,
              urls: { ...prev.urls, [layer.key]: dataUrl },
            };
          });
        })
        .catch(() => undefined);
    });

    return () => {
      cancelled = true;
    };
  }, [selected?.dataName, selectedAssetsSignature]);

  React.useEffect(() => {
    const pendingLoads = thumbnailCards
      .map((card) => {
        const thumbPath = card.thumbnailPath ?? card.imagePath;
        if (!thumbPath || thumbCacheRef.current[card.dataName] || thumbPendingRef.current.has(card.dataName)) {
          return null;
        }
        if (!canInvokeTauri() && !isStaticAssetPath(thumbPath)) return null;
        thumbPendingRef.current.add(card.dataName);
        return readCachedImageDataUrl(thumbPath)
          .then((dataUrl) => ({ dataName: card.dataName, dataUrl }))
          .catch(() => null)
          .finally(() => {
            thumbPendingRef.current.delete(card.dataName);
          });
      })
      .filter((load): load is Promise<{ dataName: string; dataUrl: string } | null> => Boolean(load));

    if (!pendingLoads.length) return;

    let cancelled = false;
    let pendingFrame = 0;
    let loadedThumbs: Array<{ dataName: string; dataUrl: string }> = [];
    const flushLoadedThumbs = () => {
      pendingFrame = 0;
      const nextEntries = loadedThumbs;
      loadedThumbs = [];
      setThumbCache((prev) => {
        let next = prev;
        for (const entry of nextEntries) {
          if (next[entry.dataName]) continue;
          if (next === prev) next = { ...prev };
          next[entry.dataName] = entry.dataUrl;
        }
        return next;
      });
    };
    const queueLoadedThumb = (entry: { dataName: string; dataUrl: string }) => {
      loadedThumbs.push(entry);
      if (!pendingFrame) pendingFrame = window.requestAnimationFrame(flushLoadedThumbs);
    };

    pendingLoads.forEach((load) => {
      load.then((entry) => {
        if (cancelled || !entry) return;
        queueLoadedThumb(entry);
      });
    });

    return () => {
      cancelled = true;
      if (pendingFrame) window.cancelAnimationFrame(pendingFrame);
    };
  }, [thumbnailCards]);

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
          />
          <EditorPanel
            card={selected}
            edits={selected ? edits[selected.dataName] : undefined}
            onChange={updateSelected}
            onReset={resetSelectedEdits}
          />
        </div>
      </section>
      </main>
      </TmpFontContext.Provider>
    </OfficialFontContext.Provider>
  );
}

function StatsStrip({ stats }: { stats: ScanStats }) {
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <strong>{value.toLocaleString()}</strong>
      <span>{label}</span>
    </div>
  );
}

type SpriteCrop = { sourceW: number; sourceH: number; x: number; y: number; w: number; h: number };

const OFFICIAL_ASSET_ROOT = "/official/";
const CARD_WIDTH = 768;
const CARD_HEIGHT = 1052;
const MAI_PASS_RECT = { x: -134, y: 444, w: 420, h: 124 } as const;
const MAI_PASS_CROPS: SpriteCrop[] = [
  { sourceW: 420, sourceH: 124, x: 7.0429, y: 5.0267, w: 337.9303, h: 111.9398 },
  { sourceW: 420, sourceH: 124, x: 15.0761, y: 3.0761, w: 362.9179, h: 109.8971 },
  { sourceW: 420, sourceH: 124, x: 19.0761, y: 7.0267, w: 373.8971, h: 104.9465 },
  { sourceW: 420, sourceH: 124, x: 4.0429, y: 3.0761, w: 414.881, h: 114.881 },
];
const MAI_NAME_BASE_RECT = { x: -231, y: -308, w: 304, h: 82 } as const;
const MAI_PERIOD_LABEL_RECT = { x: -297.6, y: -314.4, w: 100.9, h: 25 } as const;
const MAI_CHARA_NAME_RECT = { x: -243.5, y: -281.4, w: 225.1, h: 25 } as const;
const MAI_END_DATE_RECT = { x: -169.9, y: -318.5, w: 131.2, h: 18.9 } as const;
const MAI_HOLO_MASK_CODE_RECT = { x: 43.5, y: -407.5, w: 583, h: 197 } as const;
const MAI_HOLO_MASK_PLAYER_DATA_RECT = { x: 212.4, y: 434, w: 285, h: 127 } as const;
const MAI_HOLO_MASK_TEXT_BASE_RECT = { x: 350, y: 245, w: 70, h: 362 } as const;
const MAI_HOLO_MASK_MATCH_LEVEL_RECT = { x: 263.10004, y: 337.69995, w: 186, h: 88 } as const;
const MAI_HOLO_UI_MASKS = [
  { asset: "UI_CMA_Holo_Mask_Code_00", rect: MAI_HOLO_MASK_CODE_RECT },
  { asset: "UI_CMA_Holo_Mask_PlayerData_00", rect: MAI_HOLO_MASK_PLAYER_DATA_RECT },
  { asset: "UI_CMA_Holo_Mask_Text_Base_00", rect: MAI_HOLO_MASK_TEXT_BASE_RECT },
  { asset: "UI_CMA_Holo_Mask_MatchLevel_00", rect: MAI_HOLO_MASK_MATCH_LEVEL_RECT },
  { asset: "UI_CMA_Holo_Mask_MatchLevel_01", rect: MAI_HOLO_MASK_MATCH_LEVEL_RECT },
  { asset: "UI_CMA_Holo_Mask_MatchLevel_02", rect: MAI_HOLO_MASK_MATCH_LEVEL_RECT },
  { asset: "UI_CMA_Holo_Mask_MatchLevel_03", rect: MAI_HOLO_MASK_MATCH_LEVEL_RECT },
] as const;

function officialAsset(name: string) {
  return `${OFFICIAL_ASSET_ROOT}${name}.png`;
}

function officialData(name: string) {
  return `${OFFICIAL_ASSET_ROOT}${name}`;
}

async function loadOfficialFonts() {
  const entries: Array<[OfficialFontKey, string]> = [
    ["kaku40", "FONT_SegaKakuGothic_40px.json"],
    ["maru32", "FONT_SegaMaruGothic_32px.json"],
    ["kaku16", "FONT_SegaKakuGothic_16px.json"],
  ];
  const fonts = await Promise.all(
    entries.map(async ([key, file]) => {
      const response = await fetch(officialData(file));
      if (!response.ok) throw new Error(`Failed to load ${file}`);
      return [key, (await response.json()) as UnityFontMetrics] as const;
    }),
  );
  return Object.fromEntries(fonts) as Partial<Record<OfficialFontKey, UnityFontMetrics>>;
}

async function loadOfficialTmpFont() {
  const file = "FONT_TMP_SEGA_HUMMING_B_SDF.json";
  const response = await fetch(officialData(file));
  if (!response.ok) throw new Error(`Failed to load ${file}`);
  return (await response.json()) as TmpFontMetrics;
}

function PreviewStage({
  card,
  imageDataUrl,
  assetDataUrls,
  mode,
}: {
  card: CardRecord | null;
  imageDataUrl: string;
  assetDataUrls: Record<string, string>;
  mode: ViewMode;
}) {
  const [tilt, setTilt] = React.useState({ x: 0, y: 0 });
  const [flipped, setFlipped] = React.useState(false);
  const [flipAnimating, setFlipAnimating] = React.useState(false);
  const flipTimerRef = React.useRef<number | null>(null);
  const holo = card ? officialHolo(card) : false;
  const renderStageHolo =
    !!card && holo && !(USE_OFFICIAL_ASSETS && card.game === "MU3" && card.recordType === "Card");
  const cardRenderKey = card ? `${card.game}:${card.recordType}:${card.dataName}` : "empty";
  const lightStyle = cardLightStyle(tilt, mode);
  const previewTransform =
    mode === "3d"
      ? `rotateX(${tilt.x}deg) rotateY(${tilt.y + (flipped ? 180 : 0)}deg) translateZ(0)`
      : flipped
        ? "rotateY(180deg) translateZ(0)"
        : "none";

  React.useEffect(() => {
    setFlipped(false);
    setFlipAnimating(false);
    if (flipTimerRef.current !== null) {
      window.clearTimeout(flipTimerRef.current);
      flipTimerRef.current = null;
    }
  }, [cardRenderKey]);

  React.useEffect(() => {
    return () => {
      if (flipTimerRef.current !== null) {
        window.clearTimeout(flipTimerRef.current);
      }
    };
  }, []);

  function onMove(event: React.MouseEvent<HTMLDivElement>) {
    if (mode !== "3d") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: y * -CARD_TILT_X_MAX * 2, y: x * CARD_TILT_Y_MAX * 2 });
  }

  function toggleFlip() {
    if (!card) return;
    if (flipTimerRef.current !== null) {
      window.clearTimeout(flipTimerRef.current);
    }
    setFlipAnimating(true);
    setFlipped((value) => !value);
    flipTimerRef.current = window.setTimeout(() => {
      setFlipAnimating(false);
      flipTimerRef.current = null;
    }, 460);
  }

  function onPreviewKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleFlip();
  }

  function onPreviewMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  return (
    <section className="preview-stage" onMouseMove={onMove} onMouseLeave={() => setTilt({ x: 0, y: 0 })}>
      <div
        className={`card-preview ${mode} ${flipped ? "flipped" : ""} ${flipAnimating ? "is-flipping" : ""}`}
        role="button"
        tabIndex={card ? 0 : -1}
        aria-label={flipped ? "Flip card to front" : "Flip card to back"}
        aria-pressed={flipped}
        onMouseDown={onPreviewMouseDown}
        onClick={toggleFlip}
        onKeyDown={onPreviewKeyDown}
        style={{
          transform: previewTransform,
        }}
      >
        <div className="card-face">
          <OfficialCardCanvas
            key={cardRenderKey}
            card={card}
            imageDataUrl={imageDataUrl}
            assetDataUrls={assetDataUrls}
            lightStyle={lightStyle}
          />
          {renderStageHolo ? <HoloShaderLayer key={`holo:${cardRenderKey}`} card={card} assetDataUrls={assetDataUrls} lightStyle={lightStyle} /> : null}
          <div className="edge-light" style={lightStyle} />
        </div>
        <div className="card-back-face" aria-hidden="true" />
      </div>

      {card ? (
        <div className="preview-meta">
          <span>{card.game}</span>
          <span>{card.printFields.length} print fields</span>
          <span>{holo ? "Holo" : "Normal"}</span>
        </div>
      ) : null}
    </section>
  );
}

function cardLightStyle(tilt: { x: number; y: number }, mode: ViewMode): React.CSSProperties {
  if (mode !== "3d") {
    return {
      "--holo-light-x": "32%",
      "--holo-light-y": "22%",
      "--holo-pointer-x": "32%",
      "--holo-pointer-y": "22%",
      "--holo-pointer-from-center": "0.35",
      "--holo-pointer-from-left": "0.32",
      "--holo-pointer-from-top": "0.22",
      "--holo-bg-x": "47%",
      "--holo-bg-y": "40%",
      "--holo-bg-x-inv": "53%",
      "--holo-bg-y-inv": "60%",
      "--holo-fine-x": "56%",
      "--holo-fine-y": "43%",
      "--holo-shift-x": "-3px",
      "--holo-shift-y": "-4px",
      "--holo-shift-x-inv": "3px",
      "--holo-shift-y-inv": "4px",
      "--holo-opacity": "0.88",
      "--holo-sparkle-opacity": "0.96",
      "--holo-glare-opacity": "0.5",
      "--holo-hue": "0deg",
      "--holo-spectrum-angle": "108deg",
      "--edge-light-left": "0.22",
      "--edge-light-right": "0.18",
    } as React.CSSProperties;
  }

  const pointerX = clampNumber(50 + (tilt.y / CARD_TILT_Y_MAX) * 50, 0, 100);
  const pointerY = clampNumber(50 - (tilt.x / CARD_TILT_X_MAX) * 50, 0, 100);
  const bgX = clampNumber(37 + pointerX * 0.26, 37, 63);
  const bgY = clampNumber(33 + pointerY * 0.34, 33, 67);
  const bgXInv = 100 - bgX;
  const bgYInv = 100 - bgY;
  const distanceFromCenter = clampNumber(Math.hypot(pointerX - 50, pointerY - 50) / 50, 0, 1);
  const lightX = clampNumber(32 - tilt.y * 1.28, 6, 94);
  const lightY = clampNumber(22 + tilt.x * 1.18, 6, 86);
  const leftEdge = clampNumber(0.22 + tilt.y / 85, 0.04, 0.48);
  const rightEdge = clampNumber(0.18 - tilt.y / 85, 0.04, 0.48);
  const shiftX = clampNumber((bgX - 50) * 0.78, -14, 14);
  const shiftY = clampNumber((bgY - 50) * 0.58, -12, 12);
  // Drive a strong, angle-dependent hue sweep for the holographic foil.
  // Horizontal tilt does most of the work; vertical adds a secondary shift so
  // the spectrum visibly travels as the card is moved in any direction.
  const holoHue = clampNumber((pointerX - 50) * 3.4 + (pointerY - 50) * 1.5, -210, 210);
  const spectrumAngle = clampNumber(108 + (pointerX - 50) * 0.7 - (pointerY - 50) * 0.5, 70, 150);

  return {
    "--holo-light-x": `${lightX}%`,
    "--holo-light-y": `${lightY}%`,
    "--holo-pointer-x": `${pointerX}%`,
    "--holo-pointer-y": `${pointerY}%`,
    "--holo-pointer-from-center": `${distanceFromCenter}`,
    "--holo-pointer-from-left": `${pointerX / 100}`,
    "--holo-pointer-from-top": `${pointerY / 100}`,
    "--holo-bg-x": `${bgX}%`,
    "--holo-bg-y": `${bgY}%`,
    "--holo-bg-x-inv": `${bgXInv}%`,
    "--holo-bg-y-inv": `${bgYInv}%`,
    "--holo-fine-x": `${clampNumber(50 + (50 - bgX) * 1.35, 14, 86)}%`,
    "--holo-fine-y": `${clampNumber(50 + (bgY - 50) * 1.2, 12, 88)}%`,
    "--holo-shift-x": `${shiftX}px`,
    "--holo-shift-y": `${shiftY}px`,
    "--holo-shift-x-inv": `${-shiftX}px`,
    "--holo-shift-y-inv": `${-shiftY}px`,
    "--holo-opacity": `${0.84 + distanceFromCenter * 0.14}`,
    "--holo-sparkle-opacity": `${0.86 + distanceFromCenter * 0.12}`,
    "--holo-glare-opacity": `${0.28 + distanceFromCenter * 0.42}`,
    "--holo-hue": `${holoHue}deg`,
    "--holo-spectrum-angle": `${spectrumAngle}deg`,
    "--edge-light-left": String(leftEdge),
    "--edge-light-right": String(rightEdge),
  } as React.CSSProperties;
}

function visibleAssetLayers(card: CardRecord | null, streamingAssets?: string) {
  if (!card) return [];
  const layers = card.assetLayers ?? [];
  if (card.game === "MAI") {
    const dynamicLayers = streamingAssets ? dynamicMaiAssetLayers(card, streamingAssets) : [];
    const dynamicKeys = new Set(dynamicLayers.map((layer) => layer.key));
    const fallbackLayers = layers
      .filter((layer) => dynamicKeys.has(layer.key))
      .map(maiFallbackAssetLayer);
    const mergedLayers = [
      ...dynamicLayers,
      ...fallbackLayers,
      ...layers.filter((layer) => !dynamicKeys.has(layer.key)),
    ];
    return mergedLayers.filter((layer) => !isMaiMaskLayer(layer.key) || maiOfficialHolo(card));
  }
  if (card.game === "MU3") {
    return layers.filter((layer) => {
      if (layer.key === "mu3Mask" || layer.key === "mu3Holo") return officialHolo(card);
      if (layer.key === "mu3Sign" || layer.key === "mu3SignMask") {
        return officialHolo(card) && mu3NeedsSign(card);
      }
      if (layer.key === "mu3Grade") return !fieldBool(card, "hideGrade");
      if (layer.key === "mu3Rights") return numericField(card, "rightsId", 0) > 0;
      return true;
    });
  }
  return layers;
}

function maiFallbackAssetLayer(layer: AssetLayer): AssetLayer {
  const fallbackKey =
    layer.key === "maiBase"
      ? "maiBaseFallback"
      : layer.key === "maiChara"
        ? "maiCharaFallback"
        : layer.key === "maiMask"
          ? "maiMaskFallback"
          : `${layer.key}Fallback`;
  return {
    ...layer,
    key: fallbackKey,
    label: `${layer.label} fallback`,
  };
}

function isMaiMaskLayer(key: string) {
  return key === "maiMask" || key === "maiMaskFallback";
}

function selectedAssetSignature(card: CardRecord | null, streamingAssets?: string) {
  return visibleAssetLayers(card, streamingAssets)
    .map((layer) => `${layer.key}:${layer.path}`)
    .join("|");
}

function assetLayerLoadPriority(layer: AssetLayer): ImageLoadPriority {
  return ["mu3Mask", "mu3Holo", "mu3Sign", "mu3SignMask"].includes(layer.key) ? "normal" : "high";
}

function joinAssetPath(root: string, stem: string) {
  if (isStaticAssetPath(root)) {
    const normalizedRoot = root.replace(/\/+$/, "");
    const fileName = stem.match(/\.(png|jpg|jpeg|webp)$/i) ? stem : `${stem}.png`;
    return `${normalizedRoot}/${fileName}`;
  }
  return `${root}\\${stem}`;
}

function dynamicMaiAssetLayers(card: CardRecord, streamingAssets: string): AssetLayer[] {
  const typeId = numericField(card, "typeId", -1);
  const charaId = numericField(card, "charaId", -1);
  const choice = maiCharaChoice(card, charaId);
  const mapId = choice?.mapId ?? numericField(card, "mapId", -1);
  const root = fieldString(card, "maiAssetRoot") || `${streamingAssets}\\assets_mai`;
  const layers: AssetLayer[] = [];
  if (typeId >= 0 && mapId >= 0) {
    layers.push({
      key: "maiBase",
      label: "MAI card base",
      path: joinAssetPath(
        root,
        `ui_cardbase_${String(typeId).padStart(7, "0")}_${String(mapId).padStart(6, "0")}`,
      ),
    });
  }
  if (charaId > 0) {
    layers.push({
      key: "maiChara",
      label: "MAI character layer",
      path: joinAssetPath(root, `ui_cardchara_${String(charaId).padStart(6, "0")}`),
    });
    layers.push({
      key: "maiMask",
      label: "MAI holo character mask",
      path: joinAssetPath(root, `ui_cardcharamask_${String(charaId).padStart(6, "0")}`),
    });
  }
  return layers;
}

type MaiCharaChoice = {
  id: number;
  mapId: number;
  uniqueId: number;
  name: string;
};

function maiCharaChoice(card: CardRecord, charaId: number): MaiCharaChoice | null {
  return parseMaiCharaChoices(fieldString(card, "charaChoices")).find((choice) => choice.id === charaId) ?? null;
}

function parseMaiCharaChoices(value: string): MaiCharaChoice[] {
  return value
    .split(/\r?\n/)
    .map((line) => {
      const [idText, mapText, uniqueText, ...nameParts] = line.split("|");
      const id = Number(idText);
      const mapId = Number(mapText);
      const uniqueId = Number(uniqueText);
      if (!Number.isFinite(id) || !Number.isFinite(mapId) || !Number.isFinite(uniqueId)) return null;
      return {
        id,
        mapId,
        uniqueId,
        name: nameParts.join("|") || String(id),
      };
    })
    .filter((choice): choice is MaiCharaChoice => choice !== null);
}

function OfficialCardCanvas({
  card,
  imageDataUrl,
  assetDataUrls,
  lightStyle,
}: {
  card: CardRecord | null;
  imageDataUrl: string;
  assetDataUrls: Record<string, string>;
  lightStyle: React.CSSProperties;
}) {
  if (!card) {
    return (
      <div className="preview-placeholder">
        <strong>CARD</strong>
        <span>No selection</span>
      </div>
    );
  }

  if (!USE_OFFICIAL_ASSETS) {
    return <PublicCardCanvas card={card} imageDataUrl={imageDataUrl} />;
  }

  if (card.game === "CHU") {
    return <ChuOfficialCard card={card} imageDataUrl={imageDataUrl} />;
  }

  if (card.game === "MAI") {
    return <MaiOfficialCard card={card} imageDataUrl={imageDataUrl} assetDataUrls={assetDataUrls} />;
  }

  return <Mu3OfficialCard card={card} imageDataUrl={imageDataUrl} assetDataUrls={assetDataUrls} lightStyle={lightStyle} />;
}

function usesPrimaryImageDataUrl(card: CardRecord) {
  return !(USE_OFFICIAL_ASSETS && card.game === "MU3" && card.recordType === "Card");
}

function PublicCardCanvas({
  card,
  imageDataUrl,
}: {
  card: CardRecord;
  imageDataUrl: string;
}) {
  const title =
    fieldString(card, "characterName") ||
    fieldString(card, "charaName") ||
    fieldString(card, "userName") ||
    card.displayName;
  const skillName = fieldString(card, "skillName") || fieldString(card, "cardKind") || card.recordType;
  const skillText =
    fieldString(card, "skillText") ||
    fieldString(card, "effectText") ||
    `${card.game} ${card.dataName}`;
  const serial = fieldString(card, "serialId") || fieldString(card, "cardNo") || card.id;
  const hasQr = card.game !== "CHU";

  return (
    <div className={`official-card public-card public-card-${card.game.toLowerCase()}`}>
      <div className="public-card-bg" />
      {imageDataUrl ? (
        <img className="public-card-art" src={imageDataUrl} alt="" />
      ) : (
        <div className="public-card-emblem">{card.game}</div>
      )}
      <div className="public-card-surface">
        <div className="public-card-kicker">{card.game}</div>
        <div className="public-card-title">{title}</div>
        <div className="public-card-skill">{skillName}</div>
        <div className="public-card-body">{skillText}</div>
        {card.game === "CHU" ? (
          <div className="public-card-counters">
            <span>MISS {fieldString(card, "miss") || "0"}</span>
            <span>COMBO {fieldString(card, "combo") || "0"}</span>
            <span>CHAIN {fieldString(card, "chain") || "0"}</span>
          </div>
        ) : null}
        {card.game === "MAI" ? (
          <div className="public-card-counters">
            <span>{fieldString(card, "userName") || "PLAYER"}</span>
            <span>RATING {fieldString(card, "rating") || "0"}</span>
          </div>
        ) : null}
        <div className="public-card-serial">{serial}</div>
      </div>
      {hasQr ? <LayerQr source={qrSource(card, serial)} x={250} y={-392} w={113} h={113} /> : null}
    </div>
  );
}

function ChuOfficialCard({
  card,
  imageDataUrl,
}: {
  card: CardRecord;
  imageDataUrl: string;
}) {
  const labelType = clampInt(fieldNumber(card, "labelType", card.labelType ?? 0), 0, 7);
  const difType = clampInt(fieldNumber(card, "difType", card.difType ?? 3), 0, 3);
  const difficultyBase = ["Basic", "Advanced", "Expert", "Master"][difType] ?? "Master";
  const label = twoDigits(labelType);

  return (
    <div className="official-card official-chu">
      {!fieldBool(card, "hideBackGround") ? (
        <LayerImage src={officialAsset(`UI_CCH_Card_BG_${label}`)} x={0} y={0} w={768} h={1052} />
      ) : null}
      {imageDataUrl && !fieldBool(card, "hideChara") ? (
        <LayerImage src={imageDataUrl} x={0} y={0} w={768} h={1052} />
      ) : null}
      {!fieldBool(card, "hideParam") ? (
        <LayerImage
          src={officialAsset(`UI_CCH_Card_Parameter_Base_${difficultyBase}`)}
          x={0}
          y={0}
          w={768}
          h={1052}
        />
      ) : null}
      {!fieldBool(card, "hideParam") ? (
        <>
          <LayerImage src={officialAsset(`UI_CCH_Card_Label_${label}`)} x={-335} y={-40.8} w={125} h={36} rotation={-90} />
          <LayerImage src={officialAsset(`UI_CCH_Card_Label_${label}`)} x={-100} y={-476} w={125} h={36} />
          <LayerImage src={officialAsset(`UI_CCH_Card_Label_${label}`)} x={334} y={-241.6} w={125} h={36} rotation={90} />
          <LayerImage src={officialAsset(`UI_CCH_Card_LabelLogo_${label}`)} x={210.3} y={353.4} w={341} h={176} />
        </>
      ) : null}
      {!fieldBool(card, "hideSerialId") && !fieldBool(card, "hideParam") ? (
        <LayerUnityText className="official-serial chu-serial" fontKey="kaku40" fontSize={16} alignment={1} fitHorizontal x={0} y={485.9} w={258.9} h={18}>
          {formatDisplaySerial(fieldString(card, "serialId"))}
        </LayerUnityText>
      ) : null}
      {!fieldBool(card, "hideParam") ? (
        <LayerUnityText className="official-title chu-title" fontKey="kaku40" fontSize={24} alignment={1} fitHorizontal x={0} y={460.7} w={688} h={27}>
          {fieldString(card, "characterName") || card.displayName}
        </LayerUnityText>
      ) : null}
      {!fieldBool(card, "hideParam") ? (
        <>
          <LayerUnityText className="official-skill-name chu-skill-name" fontKey="kaku40" fontSize={24} alignment={1} fitHorizontal x={0} y={-351} w={590} h={27}>
            {fieldString(card, "skillName")}
          </LayerUnityText>
          <LayerUnityText className="official-skill-body chu-skill-body" fontKey="kaku40" fontSize={24} alignment={0} lineSpacing={1.2} fitHorizontal x={0} y={-402.7} w={590} h={53.2}>
            {fieldString(card, "skillText")}
          </LayerUnityText>
          <LayerChuCounter value={fieldString(card, "miss") || "0"} x={-330} y={-383} rotation={-90} />
          <LayerChuCounter value={fieldString(card, "combo") || "0"} x={240} y={-471} />
          <LayerChuCounter value={fieldString(card, "chain") || "0"} x={329} y={100} rotation={90} />
        </>
      ) : null}
    </div>
  );
}

function MaiOfficialCard({
  card,
  imageDataUrl,
  assetDataUrls,
}: {
  card: CardRecord;
  imageDataUrl: string;
  assetDataUrls: Record<string, string>;
}) {
  const hasFriendCode = fieldBool(card, "hasFriendCode");
  const serial = fieldString(card, "serialId");
  const baseFallbackSrc = assetDataUrls.maiBaseFallback || imageDataUrl || "/official/MAI_cardbase_default.png";
  const baseSrc = assetDataUrls.maiBase || baseFallbackSrc;
  const charaFallbackSrc = assetDataUrls.maiCharaFallback;
  const charaSrc = assetDataUrls.maiChara || charaFallbackSrc;
  const hideSerialAndQR = fieldBool(card, "hideSerialAndQR");
  const hidePlayerName = fieldBool(card, "hidePlayerName");
  const hideRating = fieldBool(card, "hideRating");
  const hideFrame = fieldBool(card, "hideFrame");
  const hideCardIcon = fieldBool(card, "hideCardIcon");
  const hideCharaNameAndPeriod = fieldBool(card, "hideCharaNameAndPeriod");
  const hideFriendCode = fieldBool(card, "hideFriendCode");
  const hideChara = fieldBool(card, "hideChara");
  const framePattern = maiFramePattern(card);
  const frameAsset = ["UI_CMA_Card_Frame_00_Gold", "UI_CMA_Card_Frame_01_Silver", "UI_CMA_Card_Frame_02_Bronze", "UI_CMA_Card_Frame_03_Freedom"][framePattern];
  const passAsset = framePattern >= 0 ? `UI_CMA_PassName_${twoDigits(framePattern)}` : null;
  const passCrop = framePattern >= 0 ? MAI_PASS_CROPS[framePattern] : null;
  const passRect = passCrop ? spriteCropDisplayRect(MAI_PASS_RECT, passCrop) : MAI_PASS_RECT;
  const ratingBase = `UI_CMA_Rating_Base_${twoDigits(maiRatingPlatePattern(fieldNumber(card, "rating", 0)))}`;
  const effects = maiCardTypeEffects(card);
  const effectIconAsset = maiEffectIconAsset(card);

  return (
    <div className="official-card official-mai">
      <LayerImage src={baseSrc} fallbackSrc={baseFallbackSrc} x={0} y={0} w={768} h={1052} />
      {charaSrc && !hideChara ? (
        <LayerImage src={charaSrc} fallbackSrc={charaFallbackSrc} x={0} y={0} w={768} h={1052} />
      ) : null}
      {frameAsset && !hideFrame ? (
        <LayerImage src={officialAsset(frameAsset)} x={0} y={0} w={768} h={1052} />
      ) : null}
      {!hideCharaNameAndPeriod ? (
        <>
          <LayerImage src={officialAsset("UI_CMA_Name_Base_00")} {...MAI_NAME_BASE_RECT} />
          <LayerUnityText className="official-code mai-period-label" fontKey="maru32" fontSize={15} alignment={4} color="#5a3900" glyphOffsetY={8} {...MAI_PERIOD_LABEL_RECT}>
            ブースト期限
          </LayerUnityText>
          <LayerUnityText className="official-code mai-chara" fontKey="maru32" fontSize={15} alignment={4} color="#5a3900" fitHorizontal glyphOffsetY={5} {...MAI_CHARA_NAME_RECT}>
            {fieldString(card, "charaName") || card.displayName}
          </LayerUnityText>
          <LayerUnityText className="official-code mai-period" fontKey="maru32" fontSize={20} alignment={1} color="#5a3900" glyphOffsetY={4} {...MAI_END_DATE_RECT}>
            {formatMaiEndDate(fieldString(card, "endDate"))}
          </LayerUnityText>
        </>
      ) : null}
      {passAsset && !hideFrame ? (
        <LayerImage src={officialAsset(passAsset)} {...passRect} />
      ) : null}
      {effectIconAsset && !hideCardIcon ? (
        <LayerImage src={officialAsset(effectIconAsset)} x={-303} y={-403} w={112} h={112} />
      ) : null}
      {effects.master && !hideCardIcon ? (
        <LayerImage src={officialAsset("UI_CMA_Icon_Master_00")} x={-193.2} y={-403} w={112} h={112} />
      ) : null}
      {effects.ratingMusic && !hideCardIcon ? (
        <LayerImage src={officialAsset("UI_CMA_Icon_Rating_00")} x={-84} y={-403} w={112} h={112} />
      ) : null}
      {!hidePlayerName ? (
        <>
          <LayerImage src={officialAsset("UI_CMA_PlayerName_Base_00")} x={211} y={397} w={276} h={48} />
          <LayerUnityText className="official-title mai-player" fontKey="maru32" fontSize={29} alignment={0} color="#000000" fitHorizontal characterSpacing={10} horizontalScale={0.9} x={180.4} y={387} w={181.2} h={50}>
            {fieldString(card, "userName") || "PLAYER"}
          </LayerUnityText>
        </>
      ) : null}
      {!hideFriendCode ? (
        <>
          <LayerImage src={officialAsset("UI_CMA_FriendCode_Base_00")} x={211} y={360.8} w={276} h={40} />
          {hasFriendCode ? (
            <LayerUnityText className="official-code mai-friend" fontKey="maru32" fontSize={16} alignment={4} color="#000000" fitHorizontal characterSpacing={1} fixedGlyphTop x={245.8} y={359.4} w={192} h={23.7}>
              {fieldString(card, "friendCode")}
            </LayerUnityText>
          ) : (
            <LayerUnityText className="official-code mai-friend-empty" fontKey="maru32" fontSize={16} alignment={4} color="#000000" characterSpacing={4} x={246.8} y={360.8} w={190} h={12}>
              - - - - - - - - -
            </LayerUnityText>
          )}
        </>
      ) : null}
      {!hideRating ? (
        <>
          <LayerImage src={officialAsset(ratingBase)} x={212.4} y={456.9} w={280} h={76} />
          <LayerDigitCounter
            className="official-rating mai-rating-counter"
            value={fieldString(card, "rating") || "0"}
            sprite={officialAsset("NUM_MAI_Rating_sheet")}
            x={337.1}
            y={457}
            w={120}
            h={128}
            scale={0.7}
            align="right"
            digitWidth={41}
            digitHeight={41}
            signWidth={50}
            signHeight={50}
            charSpacing={0.9}
            flags={128}
          />
        </>
      ) : null}
      {!hideSerialAndQR ? (
        <>
          <LayerImage src={officialAsset("UI_CMA_SerialCode_Base_00")} x={0} y={-486.5} w={490} h={32} />
          <LayerUnityText className="official-serial mai-serial" fontKey="kaku16" fontSize={16} alignment={1} fitHorizontal characterSpacing={-1} x={-100.9} y={-488.7} w={266} h={18}>
            {formatDisplaySerial(serial)}
          </LayerUnityText>
          <LayerUnityText className="official-serial mai-version" fontKey="kaku16" fontSize={16} alignment={0} fitHorizontal characterSpacing={-1} x={171.3} y={-488.7} w={266} h={18}>
            {fieldString(card, "verCharaId") || card.id}
          </LayerUnityText>
          <LayerImage src={officialAsset("UI_CMA_QRCode_Base_00")} x={249.7} y={-394.7} w={164} h={164} />
          <LayerQr source={qrSource(card, serial)} x={249.7} y={-394.7} w={113} h={113} />
        </>
      ) : null}
    </div>
  );
}

function Mu3OfficialCard({
  card,
  imageDataUrl,
  assetDataUrls,
  lightStyle,
}: {
  card: CardRecord;
  imageDataUrl: string;
  assetDataUrls: Record<string, string>;
  lightStyle: React.CSSProperties;
}) {
  if (card.recordType === "AssetCard") {
    return <Mu3AssetCard card={card} imageDataUrl={imageDataUrl} assetDataUrls={assetDataUrls} />;
  }

  const attr = clampInt(fieldNumber(card, "attribute", 0), 0, 2);
  const rarity = mu3RarityKind(card);
  const rareSprite = mu3RareSpriteName(card);
  const bgAsset =
    rarity === "N" || rarity === "R"
      ? `UI_Card_BG_${rarity}_${twoDigits(attr)}`
      : null;
  const frameAsset = mu3FrameAsset(card, attr);
  const showFrame = mu3ShowMainFrame(card);
  const charaSrc = assetDataUrls.mu3Chara;
  const cardBgSrc = assetDataUrls.mu3CardBg;
  const gradeId = numericField(card, "gradeId", -1);
  const rightsId = numericField(card, "rightsId", -1);
  const attackValue = mu3AttackValue(card);
  const awakenMark = mu3AwakenMarkAsset(card);
  const isCommonModel = fieldBool(card, "isCommonModel");
  const mu3Nickname = fieldString(card, "nickName");
  const mu3CharacterName =
    fieldString(card, "nameForCommonModel") ||
    fieldString(card, "characterName") ||
    card.displayName;
  const mu3BaseCharacterName =
    fieldString(card, "baseCharacterName") ||
    fieldString(card, "characterName") ||
    card.displayName;
  const mu3IpName = fieldString(card, "ipName");

  return (
    <div className="official-card official-mu3">
      {cardBgSrc ? (
        <LayerImage src={cardBgSrc} x={0} y={0} w={768} h={1052} />
      ) : bgAsset ? (
        <LayerImage src={officialAsset(bgAsset)} x={0} y={0} w={768} h={1052} />
      ) : null}
      {charaSrc ? <LayerImage src={charaSrc} x={0} y={0} w={768} h={1052} /> : null}
      {showFrame && frameAsset ? <LayerImage src={officialAsset(frameAsset)} x={0} y={0} w={768} h={1052} /> : null}
      {!fieldBool(card, "hideAttrRarity") ? (
        <>
          <LayerImage src={officialAsset(`UI_Card_Attribute_${twoDigits(attr)}_${mu3AttributeName(attr)}`)} x={-297} y={439} w={130} h={130} />
          <LayerImage src={officialAsset(rareSprite)} x={-161.4} y={442.3} w={208} h={118} />
        </>
      ) : null}
      {fieldBool(card, "digitalOnly") ? (
        <LayerImage src={officialAsset("UI_Card_DigitalMark_00")} x={239.2} y={477.4} w={294} h={102} />
      ) : null}
      {!fieldBool(card, "hideGrade") && assetDataUrls.mu3Grade && gradeId >= 0 ? (
        <LayerImage src={assetDataUrls.mu3Grade} x={295} y={455} w={94} h={142} />
      ) : null}
      {!fieldBool(card, "hideSkill") ? (
        <>
          <LayerImage src={officialAsset(mu3SkillAsset(card))} x={-40.3} y={-367.7} w={628} h={108} />
          <LayerCanvasText
            className="official-skill-name mu3-skill-name"
            fontFamily={CANVAS_FONT_SEGA_MARU_DB}
            fontSize={19}
            alignment={0}
            color="#ffffff"
            x={-35.1}
            y={-333.7}
            w={424}
            h={20}
            fitHorizontal
          >
            {fieldString(card, "skillName")}
          </LayerCanvasText>
          <LayerCanvasText
            className="official-skill-body mu3-skill-body"
            fontFamily={CANVAS_FONT_SEGA_MARU_DB}
            fontSize={14}
            alignment={0}
            color="#000000"
            lineSpacing={1.08}
            x={-36.3}
            y={-381.9}
            w={424}
            h={59.7}
            fitHorizontal
          >
            {fieldString(card, "skillText")}
          </LayerCanvasText>
        </>
      ) : null}
      {!fieldBool(card, "hideAttackLimit") ? (
        <>
          <LayerImage src={officialAsset("UI_Card_max_00")} x={-291} y={-228.6} w={108} h={34} />
          <Mu3LimitBreakStars card={card} />
          <LayerDigitCounter
            className="official-counter mu3-max-attack"
            value={attackValue || "0"}
            sprite={officialAsset("UI_Card_NUM_attack")}
            x={-291}
            y={-276.6}
            w={100}
            h={100}
            align="center"
            digitWidth={70}
            digitHeight={70}
            signWidth={70}
            signHeight={70}
            charSpacing={-29.9}
            flags={0}
          />
        </>
      ) : null}
      {!fieldBool(card, "hideAwaken") && awakenMark ? (
        <LayerImage src={officialAsset(awakenMark)} {...MU3_AWAKEN_MARK_RECT} />
      ) : null}
      {!fieldBool(card, "hideUserName") ? (
        <>
          <LayerImage src={officialAsset("UI_Card_UserName_00")} x={278} y={-291.8} w={212} h={56} />
          <LayerCanvasText className="official-title mu3-user" fontFamily={CANVAS_FONT_SEGA_MARU_DB} fontSize={22} fontWeight={550} alignment={4} color="#000000" characterSpacing={6} x={267.1} y={-300.6} w={190} h={19.2} fitHorizontal>
            {fieldString(card, "userName") || "USER"}
          </LayerCanvasText>
        </>
      ) : null}
      {!fieldBool(card, "hideName") ? (
        isCommonModel ? (
          <>
            <LayerTmpText className="official-title mu3-nickname-shadow" fontSize={23.6} variant="shadow" characterSpacing={-0.06} x={42.9} y={-176.4} w={550} h={26.2} rotation={6}>
              {mu3Nickname}
            </LayerTmpText>
            <LayerTmpText className="official-title mu3-nickname" fontSize={23.6} variant="main" characterSpacing={-0.06} x={40} y={-175} w={550} h={26.2} rotation={6}>
              {mu3Nickname}
            </LayerTmpText>
            <LayerTmpText className="official-title mu3-character-name-shadow" fontSize={43} variant="shadow" autoSize minFontSize={24} x={53.8} y={-199} w={523.8} h={26} rotation={6}>
              {mu3CharacterName}
            </LayerTmpText>
            <LayerTmpText className="official-title mu3-character-name" fontSize={43} variant="main" autoSize minFontSize={24} x={50} y={-197} w={523.8} h={26} rotation={6}>
              {mu3CharacterName}
            </LayerTmpText>
            <LayerTmpText className="official-title mu3-ip-title-shadow" fontSize={14.6} variant="shadow" autoSize minFontSize={12} x={111.6} y={-232.1} w={411.6} h={19.7} rotation={6}>
              {mu3IpName}
            </LayerTmpText>
            <LayerTmpText className="official-title mu3-ip-title" fontSize={14.6} variant="main" autoSize minFontSize={12} x={110.6} y={-230.9} w={411.6} h={19.7} rotation={6}>
              {mu3IpName}
            </LayerTmpText>
            <LayerImage src={officialAsset("UI_Card_CMN_3D_Icon_00")} x={262.8} y={-224.3} w={146} h={38} rotation={6} />
          </>
        ) : (
          <>
            <LayerTmpText className="official-title mu3-nickname-shadow" fontSize={23.6} variant="shadow" characterSpacing={-0.06} x={41.5} y={-185.3} w={550} h={26.2} rotation={6}>
              {mu3Nickname}
            </LayerTmpText>
            <LayerTmpText className="official-title mu3-nickname" fontSize={23.6} variant="main" characterSpacing={-0.06} x={38.6} y={-183.9} w={550} h={26.2} rotation={6}>
              {mu3Nickname}
            </LayerTmpText>
            <LayerTmpText className="official-title mu3-character-name-shadow" fontSize={43} variant="shadow" autoSize minFontSize={24} x={42.7} y={-225.7} w={546} h={37} rotation={6}>
              {mu3BaseCharacterName}
            </LayerTmpText>
            <LayerTmpText className="official-title mu3-character-name" fontSize={43} variant="main" autoSize minFontSize={24} x={38.7} y={-224.5} w={546} h={37} rotation={6}>
              {mu3BaseCharacterName}
            </LayerTmpText>
          </>
        )
      ) : null}
      {!fieldBool(card, "hideQRCode") ? (
        <>
          <LayerImage src={officialAsset("UI_Card_qr_base_00")} x={251.8} y={-396.1} w={157} h={158} />
          <LayerQr source={qrSource(card, fieldString(card, "serialId") || fieldString(card, "cardNo"))} x={249.4} y={-392.3} w={113} h={113} />
        </>
      ) : null}
      <LayerImage src={officialAsset("UI_Card_rightsplate_00")} x={0} y={-502} w={768} h={48} />
      <LayerCanvasText className="official-serial mu3-serial" fontFamily={CANVAS_FONT_SEGA_MARU_DB} fontSize={19} characterSpacing={2} alignment={1} color="#ffffff" x={-135} y={-495.9} w={311} h={21} fitHorizontal>
        {formatDisplaySerial(fieldString(card, "serialId"))}
      </LayerCanvasText>
      <LayerCanvasText className="official-serial mu3-cardno" fontFamily={CANVAS_FONT_SEGA_MARU_DB} fontSize={19} characterSpacing={1} alignment={1} color="#ffffff" x={132} y={-495.9} w={311} h={21} fitHorizontal>
        {fieldString(card, "cardNo") || "CARD NO."}
      </LayerCanvasText>
      {assetDataUrls.mu3Rights && rightsId > 0 ? (
        <LayerImage src={assetDataUrls.mu3Rights} x={-85} y={-447} w={520} h={64} />
      ) : null}
      {officialHolo(card) ? <HoloShaderLayer card={card} assetDataUrls={assetDataUrls} lightStyle={lightStyle} inline /> : null}
    </div>
  );
}

function Mu3AssetCard({
  card,
  imageDataUrl,
  assetDataUrls,
}: {
  card: CardRecord;
  imageDataUrl: string;
  assetDataUrls: Record<string, string>;
}) {
  const gradeId = numericField(card, "gradeId", -1);
  const rightsId = numericField(card, "rightsId", -1);
  const attackValue = mu3AttackValue(card);
  const awakenMark = mu3AwakenMarkAsset(card);
  const mu3Nickname = fieldString(card, "nickName");
  const mu3CharacterName =
    fieldString(card, "baseCharacterName") ||
    fieldString(card, "characterName") ||
    card.displayName;
  return (
    <div className="official-card official-mu3 official-mu3-asset">
      {imageDataUrl ? (
        <LayerImage src={imageDataUrl} x={0} y={0} w={768} h={1052} />
      ) : (
        <LayerImage src={officialAsset("UI_Card_BG_N_00")} x={0} y={0} w={768} h={1052} />
      )}
      {!fieldBool(card, "hideGrade") && assetDataUrls.mu3Grade && gradeId >= 0 ? (
        <LayerImage src={assetDataUrls.mu3Grade} x={295} y={455} w={94} h={142} />
      ) : null}
      {!fieldBool(card, "hideAttackLimit") ? (
        <>
          <LayerImage src={officialAsset("UI_Card_max_00")} x={-291} y={-228.6} w={108} h={34} />
          <Mu3LimitBreakStars card={card} />
          <LayerDigitCounter
            className="official-counter mu3-max-attack"
            value={attackValue || "0"}
            sprite={officialAsset("UI_Card_NUM_attack")}
            x={-291}
            y={-276.6}
            w={100}
            h={100}
            align="center"
            digitWidth={70}
            digitHeight={70}
            signWidth={70}
            signHeight={70}
            charSpacing={-29.9}
            flags={0}
          />
        </>
      ) : null}
      {!fieldBool(card, "hideAwaken") && awakenMark ? (
        <LayerImage src={officialAsset(awakenMark)} {...MU3_AWAKEN_MARK_RECT} />
      ) : null}
      {!fieldBool(card, "hideUserName") ? (
        <>
          <LayerImage src={officialAsset("UI_Card_UserName_00")} x={278} y={-291.8} w={212} h={56} />
          <LayerCanvasText className="official-title mu3-user" fontFamily={CANVAS_FONT_SEGA_MARU_DB} fontSize={19} fontWeight={550} alignment={4} color="#000000" characterSpacing={3} x={267.1} y={-300.6} w={190} h={19.2} fitHorizontal>
            {fieldString(card, "userName") || "USER"}
          </LayerCanvasText>
        </>
      ) : null}
      {!fieldBool(card, "hideName") ? (
        <>
          {mu3Nickname ? (
            <>
              <LayerTmpText className="official-title mu3-nickname-shadow" fontSize={23.6} variant="shadow" characterSpacing={-0.06} x={41.5} y={-185.3} w={550} h={26.2} rotation={6}>
                {mu3Nickname}
              </LayerTmpText>
              <LayerTmpText className="official-title mu3-nickname" fontSize={23.6} variant="main" characterSpacing={-0.06} x={38.6} y={-183.9} w={550} h={26.2} rotation={6}>
                {mu3Nickname}
              </LayerTmpText>
            </>
          ) : null}
          <LayerTmpText className="official-title mu3-character-name-shadow" fontSize={43} variant="shadow" autoSize minFontSize={24} x={42.7} y={-225.7} w={546} h={37} rotation={6}>
            {mu3CharacterName}
          </LayerTmpText>
          <LayerTmpText className="official-title mu3-character-name" fontSize={43} variant="main" autoSize minFontSize={24} x={38.7} y={-224.5} w={546} h={37} rotation={6}>
            {mu3CharacterName}
          </LayerTmpText>
        </>
      ) : null}
      {!fieldBool(card, "hideQRCode") ? (
        <>
          <LayerImage src={officialAsset("UI_Card_qr_base_00")} x={251.8} y={-396.1} w={157} h={158} />
          <LayerQr source={qrSource(card, fieldString(card, "cardNo"))} x={249.4} y={-392.3} w={113} h={113} />
        </>
      ) : null}
      <LayerImage src={officialAsset("UI_Card_rightsplate_00")} x={0} y={-502} w={768} h={48} />
      <LayerCanvasText className="official-serial mu3-serial" fontFamily={CANVAS_FONT_SEGA_MARU_DB} fontSize={19} characterSpacing={2} alignment={1} color="#ffffff" x={-135} y={-495.9} w={311} h={21} fitHorizontal>
        {formatDisplaySerial(fieldString(card, "serialId"))}
      </LayerCanvasText>
      <LayerCanvasText className="official-serial mu3-cardno" fontFamily={CANVAS_FONT_SEGA_MARU_DB} fontSize={19} characterSpacing={2} alignment={1} color="#ffffff" x={132} y={-495.9} w={311} h={21} fitHorizontal>
        {fieldString(card, "cardNo") || card.id}
      </LayerCanvasText>
      {assetDataUrls.mu3Rights && rightsId > 0 ? (
        <LayerImage src={assetDataUrls.mu3Rights} x={-85} y={-447} w={520} h={64} />
      ) : null}
    </div>
  );
}

function LayerImage({
  src,
  fallbackSrc,
  className,
  x,
  y,
  w,
  h,
  rotation,
  scale,
}: {
  src: string;
  fallbackSrc?: string;
  className?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  scale?: number;
}) {
  const [currentSrc, setCurrentSrc] = React.useState(src);
  React.useEffect(() => {
    setCurrentSrc(src);
  }, [src]);
  const onError = React.useCallback(() => {
    if (fallbackSrc && currentSrc !== fallbackSrc) {
      setCurrentSrc(fallbackSrc);
    }
  }, [currentSrc, fallbackSrc]);

  return (
    <img
      className={["official-layer-img", className].filter(Boolean).join(" ")}
      src={currentSrc}
      alt=""
      onError={onError}
      style={unityRect(x, y, w, h, { rotation, scale })}
    />
  );
}

function LayerSpriteCrop({
  src,
  className,
  crop,
  x,
  y,
  w,
  h,
  rotation,
  scale,
}: {
  src: string;
  className?: string;
  crop: SpriteCrop;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  scale?: number;
}) {
  const imageStyle: React.CSSProperties = {
    left: `${(-crop.x / crop.w) * 100}%`,
    top: `${(-crop.y / crop.h) * 100}%`,
    width: `${(crop.sourceW / crop.w) * 100}%`,
    height: `${(crop.sourceH / crop.h) * 100}%`,
    objectFit: "fill",
  };
  return (
    <div className="official-layer-crop" style={unityRect(x, y, w, h, { rotation, scale })}>
      <img
        className={["official-layer-img", className].filter(Boolean).join(" ")}
        src={src}
        alt=""
        style={imageStyle}
      />
    </div>
  );
}

function spriteCropDisplayRect(
  rect: { x: number; y: number; w: number; h: number },
  crop: SpriteCrop,
) {
  return {
    x: rect.x - rect.w / 2 + crop.x + crop.w / 2,
    y: rect.y + rect.h / 2 - crop.y - crop.h / 2,
    w: crop.w,
    h: crop.h,
  };
}

function LayerText({
  children,
  className,
  x,
  y,
  w,
  h,
  rotation,
  scale,
}: {
  children: React.ReactNode;
  className: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  scale?: number;
}) {
  return (
    <div className={`official-layer-text ${className}`} style={unityRect(x, y, w, h, { rotation, scale })}>
      {children}
    </div>
  );
}

function LayerCanvasText({
  children,
  className,
  fontFamily,
  fontSize,
  fontWeight = 700,
  alignment,
  color,
  lineSpacing = 1,
  fitHorizontal = false,
  characterSpacing = 0,
  x,
  y,
  w,
  h,
  rotation,
  scale,
}: {
  children: React.ReactNode;
  className: string;
  fontFamily: string;
  fontSize: number;
  fontWeight?: number;
  alignment: number;
  color: string;
  lineSpacing?: number;
  fitHorizontal?: boolean;
  characterSpacing?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  scale?: number;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const text = reactText(children);

  React.useEffect(() => {
    let cancelled = false;
    const draw = async () => {
      await waitForCanvasFont(fontFamily, fontSize);
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      renderCanvasText(canvas, text, {
        w,
        h,
        fontFamily,
        fontSize,
        fontWeight,
        alignment,
        color,
        lineSpacing,
        fitHorizontal,
        characterSpacing,
      });
    };
    draw();
    return () => {
      cancelled = true;
    };
  }, [alignment, characterSpacing, color, fitHorizontal, fontFamily, fontSize, fontWeight, h, lineSpacing, text, w]);

  return (
    <div className={`official-canvas-text ${className}`} style={unityRect(x, y, w, h, { rotation, scale })}>
      <canvas className="official-text-canvas" ref={canvasRef} aria-hidden="true" />
    </div>
  );
}

function renderCanvasText(
  canvas: HTMLCanvasElement,
  text: string,
  options: {
    w: number;
    h: number;
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    alignment: number;
    color: string;
    lineSpacing: number;
    fitHorizontal: boolean;
    characterSpacing: number;
  },
) {
  const pixelRatio =
    typeof window === "undefined" ? 2 : Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
  const canvasWidth = Math.max(1, Math.ceil(options.w * pixelRatio));
  const canvasHeight = Math.max(1, Math.ceil(options.h * pixelRatio));
  if (canvas.width !== canvasWidth) canvas.width = canvasWidth;
  if (canvas.height !== canvasHeight) canvas.height = canvasHeight;

  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.save();
  context.scale(pixelRatio, pixelRatio);
  context.fillStyle = options.color;
  context.font = `${options.fontWeight} ${options.fontSize}px ${options.fontFamily}`;
  context.textBaseline = "top";

  const lines = text.split(/\r?\n/);
  const lineHeight = options.fontSize * options.lineSpacing;
  const totalHeight = lineHeight * Math.max(1, lines.length);
  const vertical = Math.floor(options.alignment / 3);
  const horizontal = options.alignment % 3;
  const top = vertical === 0 ? 0 : vertical === 1 ? (options.h - totalHeight) / 2 : options.h - totalHeight;

  lines.forEach((line, lineIndex) => {
    const lineWidth = Math.max(1, measureCanvasLine(context, line, options.characterSpacing));
    const fitScale = options.fitHorizontal ? Math.min(1, options.w / lineWidth) : 1;
    const drawWidth = lineWidth * fitScale;
    const left =
      horizontal === 0 ? 0 : horizontal === 1 ? (options.w - drawWidth) / 2 : options.w - drawWidth;
    context.save();
    context.translate(left, top + lineIndex * lineHeight);
    context.scale(fitScale, 1);
    drawCanvasLine(context, line, options.characterSpacing);
    context.restore();
  });
  context.restore();
}

function measureCanvasLine(context: CanvasRenderingContext2D, line: string, characterSpacing: number) {
  if (!line) return 0;
  if (!characterSpacing) return context.measureText(line).width;
  let width = 0;
  for (const char of Array.from(line)) {
    width += context.measureText(char).width;
  }
  return width + Math.max(0, Array.from(line).length - 1) * characterSpacing;
}

function drawCanvasLine(context: CanvasRenderingContext2D, line: string, characterSpacing: number) {
  if (!characterSpacing) {
    context.fillText(line, 0, 0);
    return;
  }
  let x = 0;
  for (const char of Array.from(line)) {
    context.fillText(char, x, 0);
    x += context.measureText(char).width + characterSpacing;
  }
}

function waitForCanvasFont(fontFamily: string, fontSize: number) {
  if (typeof document === "undefined" || !("fonts" in document)) {
    return Promise.resolve();
  }

  const families = fontFamily
    .split(",")
    .map((family) => family.trim())
    .filter(Boolean)
    .slice(0, 3);

  return Promise.allSettled([
    ...families.map((family) => document.fonts.load(`700 ${fontSize}px ${family}`)),
    document.fonts.ready,
  ]).then(() => undefined);
}

function LayerUnityText({
  children,
  className,
  fontKey,
  fontSize,
  alignment,
  color = "#ffffff",
  lineSpacing = 1,
  fitHorizontal = false,
  characterSpacing = 0,
  horizontalScale = 1,
  glyphOffsetY = 0,
  fixedGlyphTop = false,
  x,
  y,
  w,
  h,
  rotation,
  scale,
}: {
  children: React.ReactNode;
  className: string;
  fontKey: OfficialFontKey;
  fontSize: number;
  alignment: number;
  color?: string;
  lineSpacing?: number;
  fitHorizontal?: boolean;
  characterSpacing?: number;
  horizontalScale?: number;
  glyphOffsetY?: number;
  fixedGlyphTop?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  scale?: number;
}) {
  const fonts = React.useContext(OfficialFontContext);
  const font = fonts[fontKey];
  const text = reactText(children);
  const maskIdPrefix = React.useId().replace(/:/g, "");

  if (!font) {
    return (
      <LayerText className={className} x={x} y={y} w={w} h={h} rotation={rotation} scale={scale}>
        {children}
      </LayerText>
    );
  }

  const glyphs = layoutUnityText(font, text, fontSize, w, h, alignment, lineSpacing, color, fitHorizontal, characterSpacing, horizontalScale, glyphOffsetY, fixedGlyphTop);
  return (
    <div className={`official-bitmap-text ${className}`} style={unityRect(x, y, w, h, { rotation, scale })}>
      {glyphs.map((glyph) => {
        const maskId = `${maskIdPrefix}-${glyph.key}`;
        return (
          <span className="official-bitmap-glyph" style={glyph.style} key={glyph.key}>
            <svg className="official-bitmap-svg" viewBox={`0 0 ${glyph.sourceW} ${glyph.sourceH}`} preserveAspectRatio="none">
              <defs>
                <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={glyph.sourceW} height={glyph.sourceH}>
                  <image href={`${OFFICIAL_ASSET_ROOT}${font.texture}`} x={-glyph.sourceX} y={-glyph.sourceY} width={font.width} height={font.height} />
                </mask>
              </defs>
              <rect width={glyph.sourceW} height={glyph.sourceH} fill={glyph.color} mask={`url(#${maskId})`} />
            </svg>
          </span>
        );
      })}
    </div>
  );
}

type TmpTextVariant = "main" | "shadow";
type TmpHorizontalAlign = "left" | "center" | "right";
type TmpVerticalAlign = "top" | "middle" | "bottom";
const TMP_TEXT_PADDING = 36;

type TmpTextRenderOptions = {
  w: number;
  h: number;
  padding: number;
  fontSize: number;
  variant: TmpTextVariant;
  characterSpacing: number;
  autoSize: boolean;
  minFontSize: number;
  horizontalAlign: TmpHorizontalAlign;
  verticalAlign: TmpVerticalAlign;
  maskIncludeUnderlay?: boolean;
};

type RasterizedTextLayer = {
  colorCanvas: HTMLCanvasElement;
  maskCanvas: HTMLCanvasElement;
  bounds: Bounds;
};

function LayerTmpText({
  children,
  className,
  fontSize,
  variant,
  characterSpacing = 0,
  autoSize = false,
  minFontSize,
  horizontalAlign = "right",
  verticalAlign = "top",
  x,
  y,
  w,
  h,
  rotation,
  scale,
}: {
  children: React.ReactNode;
  className: string;
  fontSize: number;
  variant: TmpTextVariant;
  characterSpacing?: number;
  autoSize?: boolean;
  minFontSize?: number;
  horizontalAlign?: TmpHorizontalAlign;
  verticalAlign?: TmpVerticalAlign;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  scale?: number;
}) {
  const font = React.useContext(TmpFontContext);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [readyKey, setReadyKey] = React.useState("");
  const [failedKey, setFailedKey] = React.useState("");
  const text = reactText(children);
  const resolvedMinFontSize = minFontSize ?? fontSize;
  const renderKey = React.useMemo(
    () =>
      JSON.stringify([
        font?.texture ?? "",
        font?.fontInfo.PointSize ?? 0,
        font?.fontInfo.LineHeight ?? 0,
        text,
        fontSize,
        variant,
        characterSpacing,
        autoSize,
        resolvedMinFontSize,
        horizontalAlign,
        verticalAlign,
        w,
        h,
      ]),
    [
      autoSize,
      characterSpacing,
      font?.fontInfo.LineHeight,
      font?.fontInfo.PointSize,
      font?.texture,
      fontSize,
      h,
      horizontalAlign,
      resolvedMinFontSize,
      text,
      variant,
      verticalAlign,
      w,
    ],
  );
  const canvasReady = readyKey === renderKey;
  const fallbackReady = failedKey === renderKey;

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    clearCanvas(canvas);
    setReadyKey("");
    setFailedKey("");

    if (!font || !text) {
      return;
    }

    let cancelled = false;
    loadTmpAtlas(font)
      .then((atlas) => {
        if (cancelled) return;
        const didRender = renderTmpText(canvas, atlas, font, text, {
          w,
          h,
          padding: TMP_TEXT_PADDING,
          fontSize,
          variant,
          characterSpacing,
          autoSize,
          minFontSize: resolvedMinFontSize,
          horizontalAlign,
          verticalAlign,
        });
        if (didRender) {
          setReadyKey(renderKey);
        } else {
          setFailedKey(renderKey);
        }
      })
      .catch(() => {
        if (cancelled) return;
        clearCanvas(canvas);
        setReadyKey("");
        setFailedKey(renderKey);
      });

    return () => {
      cancelled = true;
    };
  }, [autoSize, characterSpacing, font, fontSize, h, horizontalAlign, renderKey, resolvedMinFontSize, text, variant, verticalAlign, w]);

  if (!font) {
    return (
      <LayerText className={className} x={x} y={y} w={w} h={h} rotation={rotation} scale={scale}>
        {children}
      </LayerText>
    );
  }

  return (
    <div className={`official-tmp-text ${className}`} style={unityRect(x, y, w, h, { rotation, scale })}>
      <span
        className="official-tmp-fallback"
        style={{
          opacity: fallbackReady ? 1 : 0,
          fontSize,
          justifyContent:
            horizontalAlign === "left" ? "flex-start" : horizontalAlign === "center" ? "center" : "flex-end",
          alignItems:
            verticalAlign === "top" ? "flex-start" : verticalAlign === "middle" ? "center" : "flex-end",
          letterSpacing: characterSpacing,
          textAlign: horizontalAlign,
        }}
      >
        {text}
      </span>
      <canvas
        key={renderKey}
        className="official-tmp-canvas"
        ref={canvasRef}
        aria-hidden="true"
        style={{
          left: `${(-TMP_TEXT_PADDING / w) * 100}%`,
          top: `${(-TMP_TEXT_PADDING / h) * 100}%`,
          width: `${((w + TMP_TEXT_PADDING * 2) / w) * 100}%`,
          height: `${((h + TMP_TEXT_PADDING * 2) / h) * 100}%`,
          opacity: canvasReady ? 1 : 0,
        }}
      />
    </div>
  );
}

function clearCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  context?.clearRect(0, 0, canvas.width, canvas.height);
}

const tmpAtlasCache = new Map<string, Promise<HTMLImageElement>>();
const tmpGlyphCanvasCache = new Map<string, HTMLCanvasElement>();

function loadTmpAtlas(font: TmpFontMetrics) {
  const src = `${OFFICIAL_ASSET_ROOT}${font.texture}`;
  const cached = tmpAtlasCache.get(src);
  if (cached) return cached;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load ${font.texture}`));
    image.src = src;
  });
  tmpAtlasCache.set(src, promise);
  return promise;
}

function renderTmpText(
  canvas: HTMLCanvasElement,
  atlas: HTMLImageElement,
  font: TmpFontMetrics,
  text: string,
  options: TmpTextRenderOptions,
): boolean {
  const rasterized = rasterizeTmpText(atlas, font, text, options);
  if (!rasterized) {
    clearCanvas(canvas);
    return false;
  }

  if (canvas.width !== rasterized.colorCanvas.width) canvas.width = rasterized.colorCanvas.width;
  if (canvas.height !== rasterized.colorCanvas.height) canvas.height = rasterized.colorCanvas.height;
  const context = canvas.getContext("2d");
  if (!context) return false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(rasterized.colorCanvas, 0, 0);
  return rasterized.bounds.w > 0 && rasterized.bounds.h > 0;
}

function rasterizeTmpText(
  atlas: HTMLImageElement,
  font: TmpFontMetrics,
  text: string,
  options: TmpTextRenderOptions,
): RasterizedTextLayer | null {
  const pixelRatio =
    typeof window === "undefined" ? 2 : Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
  const logicalWidth = options.w + options.padding * 2;
  const logicalHeight = options.h + options.padding * 2;
  const canvasWidth = Math.max(1, Math.ceil(logicalWidth * pixelRatio));
  const canvasHeight = Math.max(1, Math.ceil(logicalHeight * pixelRatio));

  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = canvasWidth;
  colorCanvas.height = canvasHeight;
  const colorContext = colorCanvas.getContext("2d", { willReadFrequently: true });
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = canvasWidth;
  maskCanvas.height = canvasHeight;
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!colorContext || !maskContext) return null;

  const lines = text.split(/\r?\n/);
  let effectiveSize = options.fontSize;
  if (options.autoSize) {
    const widest = Math.max(
      1,
      ...lines.map((line) => measureTmpLine(font, line, effectiveSize, options.characterSpacing)),
    );
    if (widest > options.w) {
      effectiveSize = Math.max(options.minFontSize, effectiveSize * (options.w / widest));
    }
  }

  const fontScale = effectiveSize / font.fontInfo.PointSize;
  const lineHeight = font.fontInfo.LineHeight * fontScale;
  const totalHeight = lineHeight * Math.max(1, lines.length);
  const top =
    options.verticalAlign === "top"
      ? options.padding
      : options.verticalAlign === "middle"
        ? options.padding + (options.h - totalHeight) / 2
        : options.padding + options.h - totalHeight;
  const mainColor = options.variant === "main" ? [255, 255, 255] : [38, 146, 192];
  const outlineColor = options.variant === "main" ? [37, 146, 193] : [30, 128, 178];
  lines.forEach((line, lineIndex) => {
    const lineWidth = measureTmpLine(font, line, effectiveSize, options.characterSpacing);
    const originX =
      options.horizontalAlign === "left"
        ? options.padding
        : options.horizontalAlign === "center"
          ? options.padding + (options.w - lineWidth) / 2
          : options.padding + options.w - lineWidth;
    const baseline = top + lineIndex * lineHeight + font.fontInfo.Ascender * fontScale;
    const sharedRun = {
      dpr: pixelRatio,
      fontScale,
      baseline,
      originX,
      characterSpacing: options.characterSpacing,
      offsetX: 0,
      offsetY: 0,
    };
    const underlayRun = {
      ...sharedRun,
      offsetX: options.variant === "main" ? 1.1 : 0.8,
      offsetY: options.variant === "main" ? 1.1 : 0.8,
    };
    drawTmpRun(colorContext, atlas, font, line, {
      ...underlayRun,
      color: [0, 0, 0],
      kind: "underlay",
      alphaScale: options.variant === "main" ? 0.46 : 0.36,
    });
    drawTmpRun(colorContext, atlas, font, line, {
      ...sharedRun,
      color: outlineColor,
      kind: "outline",
      alphaScale: 1,
    });
    drawTmpRun(colorContext, atlas, font, line, {
      ...sharedRun,
      color: mainColor,
      kind: "face",
      alphaScale: 1,
    });
    if (options.maskIncludeUnderlay) {
      drawTmpRun(maskContext, atlas, font, line, {
        ...underlayRun,
        color: [255, 255, 255],
        kind: "underlay",
        alphaScale: 1,
      });
    }
    drawTmpRun(maskContext, atlas, font, line, {
      ...sharedRun,
      color: [255, 255, 255],
      kind: "outline",
      alphaScale: 1,
    });
    drawTmpRun(maskContext, atlas, font, line, {
      ...sharedRun,
      color: [255, 255, 255],
      kind: "face",
      alphaScale: 1,
    });
  });

  const bounds = canvasAlphaBounds(maskContext, canvasWidth, canvasHeight, pixelRatio);
  if (bounds.w <= 0 || bounds.h <= 0) return null;
  return {
    colorCanvas,
    maskCanvas,
    bounds,
  };
}

function drawTmpRun(
  context: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  font: TmpFontMetrics,
  line: string,
  options: {
    dpr: number;
    fontScale: number;
    baseline: number;
    originX: number;
    characterSpacing: number;
    color: number[];
    kind: "face" | "outline" | "underlay";
    alphaScale: number;
    offsetX: number;
    offsetY: number;
  },
): number {
  let cursor = options.originX;
  let drawnGlyphCount = 0;
  Array.from(line).forEach((char) => {
    const glyph = tmpGlyph(font, char);
    const advance = ((glyph?.xAdvance ?? font.fontInfo.PointSize * 0.5) + options.characterSpacing) * options.fontScale;
    if (
      !glyph ||
      glyph.width <= 0 ||
      glyph.height <= 0 ||
      glyph.x < 0 ||
      glyph.y < 0 ||
      glyph.x + glyph.width > font.width ||
      glyph.y + glyph.height > font.height
    ) {
      cursor += advance;
      return;
    }

    const destX = (cursor + glyph.xOffset * options.fontScale + options.offsetX) * options.dpr;
    const destY =
      (options.baseline - glyph.yOffset * options.fontScale + options.offsetY) * options.dpr;
    const destW = Math.max(1, Math.ceil(glyph.width * options.fontScale * options.dpr));
    const destH = Math.max(1, Math.ceil(glyph.height * options.fontScale * options.dpr));
    const glyphCanvas = renderTmpGlyphCanvas(atlas, glyph, destW, destH, options);
    context.drawImage(glyphCanvas, Math.round(destX), Math.round(destY));
    drawnGlyphCount += 1;
    cursor += advance;
  });
  return drawnGlyphCount;
}

function renderTmpGlyphCanvas(
  atlas: HTMLImageElement,
  glyph: TmpGlyph,
  width: number,
  height: number,
  options: {
    color: number[];
    kind: "face" | "outline" | "underlay";
    alphaScale: number;
  },
) {
  const cacheKey = [
    glyph.id,
    width,
    height,
    options.kind,
    options.alphaScale,
    options.color.join("."),
  ].join("|");
  const cached = tmpGlyphCanvasCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return canvas;

  context.drawImage(atlas, glyph.x, glyph.y, glyph.width, glyph.height, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const sdf = data[index + 3];
    const alpha = tmpSdfAlpha(sdf, options.kind) * options.alphaScale;
    data[index] = options.color[0];
    data[index + 1] = options.color[1];
    data[index + 2] = options.color[2];
    data[index + 3] = Math.round(alpha * 255);
  }
  context.putImageData(imageData, 0, 0);
  tmpGlyphCanvasCache.set(cacheKey, canvas);
  return canvas;
}

function canvasAlphaBounds(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  pixelRatio: number,
): Bounds {
  const pixels = context.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha <= 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  return {
    x: minX / pixelRatio,
    y: minY / pixelRatio,
    w: (maxX - minX + 1) / pixelRatio,
    h: (maxY - minY + 1) / pixelRatio,
  };
}

function tmpSdfAlpha(value: number, kind: "face" | "outline" | "underlay") {
  if (kind === "face") return smoothAlpha(value, 152, 22);
  if (kind === "outline") return smoothAlpha(value, 88, 34);
  return smoothAlpha(value, 74, 42);
}

function smoothAlpha(value: number, edge: number, softness: number) {
  const min = edge - softness;
  const max = edge + softness;
  const t = clampNumber((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function measureTmpLine(
  font: TmpFontMetrics,
  line: string,
  fontSize: number,
  characterSpacing: number,
) {
  const fontScale = fontSize / font.fontInfo.PointSize;
  return Array.from(line).reduce((sum, char, index, chars) => {
    const glyph = tmpGlyph(font, char);
    const advance = glyph?.xAdvance ?? font.fontInfo.PointSize * 0.5;
    return sum + (advance + (index < chars.length - 1 ? characterSpacing : 0)) * fontScale;
  }, 0);
}

function tmpGlyph(font: TmpFontMetrics, char: string) {
  const code = char.codePointAt(0) ?? 0;
  return font.glyphs[String(code)] ?? font.glyphs["9633"] ?? font.glyphs["63"];
}

function reactText(children: React.ReactNode) {
  return React.Children.toArray(children)
    .map((child) => (typeof child === "string" || typeof child === "number" ? String(child) : ""))
    .join("");
}

function layoutUnityText(
  font: UnityFontMetrics,
  text: string,
  fontSize: number,
  rectWidth: number,
  rectHeight: number,
  alignment: number,
  lineSpacing: number,
  color: string,
  fitHorizontal: boolean,
  extraCharacterSpacing: number,
  horizontalScale: number,
  glyphOffsetY: number,
  fixedGlyphTop: boolean,
) {
  const scale = fontSize / font.lineSpacing;
  const scaleX = clampNumber(horizontalScale, 0.1, 2);
  const lines = text.split(/\r?\n/);
  const laidOutLines = lines.map((line) => {
    const chars = Array.from(line);
    const width = chars.reduce((sum, char, index) => {
      const glyph = unityGlyph(font, char);
      const spacing = index < chars.length - 1 ? font.characterSpacing + extraCharacterSpacing : 0;
      return sum + ((glyph?.advance ?? font.lineSpacing * 0.5) + spacing) * scale * scaleX;
    }, 0);
    return { chars, width };
  });
  const maxWidth = Math.max(1, ...laidOutLines.map((line) => line.width));
  const fitScaleX = fitHorizontal ? Math.min(1, rectWidth / maxWidth) : 1;
  const lineHeight = font.lineSpacing * scale * lineSpacing;
  const totalHeight = lineHeight * Math.max(1, lines.length);
  const vertical = Math.floor(alignment / 3);
  const horizontal = alignment % 3;
  const topBase =
    vertical === 0 ? 0 : vertical === 1 ? (rectHeight - totalHeight) / 2 : rectHeight - totalHeight;
  const output: Array<{
    key: string;
    style: React.CSSProperties;
    sourceX: number;
    sourceY: number;
    sourceW: number;
    sourceH: number;
    color: string;
  }> = [];

  laidOutLines.forEach((line, lineIndex) => {
    const lineWidth = line.width * fitScaleX;
    const lineLeft =
      horizontal === 0 ? 0 : horizontal === 1 ? (rectWidth - lineWidth) / 2 : rectWidth - lineWidth;
    let cursor = 0;

    line.chars.forEach((char, charIndex) => {
      const glyph = unityGlyph(font, char);
      const spacing = charIndex < line.chars.length - 1 ? font.characterSpacing + extraCharacterSpacing : 0;
      const advance = ((glyph?.advance ?? font.lineSpacing * 0.5) + spacing) * scale * scaleX;
      if (glyph) {
        const [uvX, uvY, uvW, uvH] = glyph.uv;
        const [vertX, vertY, vertW, vertH] = glyph.vert;
        const sourceW = Math.abs(uvW) * font.width;
        const sourceH = Math.abs(uvH) * font.height;
        const displayW = Math.abs(vertW) * scale * scaleX * fitScaleX;
        const displayH = Math.abs(vertH) * scale;
        if (sourceW > 0 && sourceH > 0 && displayW > 0 && displayH > 0) {
          const sourceX = uvX * font.width;
          const sourceY = (1 - uvY - uvH) * font.height;
          const glyphLeft = lineLeft + (cursor + vertX * scale * scaleX) * fitScaleX;
          const glyphTop =
            topBase +
            lineIndex * lineHeight +
            (fixedGlyphTop ? 0 : (vertH < 0 ? -vertY : vertY) * scale) +
            glyphOffsetY;
          output.push({
            key: `${lineIndex}-${charIndex}-${char.codePointAt(0) ?? 0}`,
            style: {
              left: `${(glyphLeft / rectWidth) * 100}%`,
              top: `${(glyphTop / rectHeight) * 100}%`,
              width: `${(displayW / rectWidth) * 100}%`,
              height: `${(displayH / rectHeight) * 100}%`,
            },
            sourceX,
            sourceY,
            sourceW,
            sourceH,
            color,
          });
        }
      }
      cursor += advance;
    });
  });

  return output;
}

function unityGlyph(font: UnityFontMetrics, char: string) {
  const code = char.codePointAt(0) ?? 0;
  return font.chars[String(code)] ?? font.chars["9633"] ?? font.chars["63"];
}

type CounterAlign = "center" | "left" | "right";

function LayerChuCounter({
  value,
  x,
  y,
  rotation,
}: {
  value: string;
  x: number;
  y: number;
  rotation?: number;
}) {
  return (
    <LayerDigitCounter
      className="official-counter chu-counter"
      value={value || "0"}
      sprite={officialAsset("NUM_CHU_Parameter_sheet")}
      x={x}
      y={y}
      w={150}
      h={54}
      rotation={rotation}
      align="center"
      digitWidth={41}
      digitHeight={41}
      signWidth={50}
      signHeight={50}
      charSpacing={-12}
      flags={128}
    />
  );
}

function LayerDigitCounter({
  value,
  sprite,
  className,
  x,
  y,
  w,
  h,
  rotation,
  scale,
  align,
  digitWidth,
  digitHeight,
  signWidth = digitWidth,
  signHeight = digitHeight,
  charSpacing,
  flags,
}: {
  value: string;
  sprite: string;
  className: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  scale?: number;
  align: CounterAlign;
  digitWidth: number;
  digitHeight: number;
  signWidth?: number;
  signHeight?: number;
  charSpacing: number;
  flags: number;
}) {
  const figures = calcCounterFigures(value, flags);
  const widths = figures.map((figure) => counterFigureWidth(figure, digitWidth, signWidth));
  const totalWidth =
    widths.reduce((sum, width) => sum + width, 0) +
    Math.max(0, widths.length - 1) * charSpacing;
  const anchorPivot = align === "left" ? 0 : align === "right" ? 1 : 0.5;
  const startX = w / 2 - anchorPivot * totalWidth;
  const groupHeight = Math.max(digitHeight, signHeight);
  const groupTop = (h - groupHeight) / 2;
  let cursor = startX;

  return (
    <div className={`official-digit-counter ${className}`} style={unityRect(x, y, w, h, { rotation, scale })}>
      {figures.map((figure, index) => {
        const figureWidth = widths[index];
        const figureHeight = counterFigureHeight(figure, digitHeight, signHeight);
        const localTop = groupTop + (groupHeight - figureHeight) / 2;
        const style: React.CSSProperties = {
          left: `${(cursor / w) * 100}%`,
          top: `${(localTop / h) * 100}%`,
          width: `${(figureWidth / w) * 100}%`,
          height: `${(figureHeight / h) * 100}%`,
          backgroundImage: `url("${sprite}")`,
          backgroundPosition: counterFigureBackgroundPosition(figure),
        };
        cursor += figureWidth + charSpacing;
        return <span className="official-digit" style={style} key={`${figure}-${index}`} />;
      })}
    </div>
  );
}

function calcCounterFigures(rawValue: string, flags: number) {
  const parsed = Number(rawValue);
  const value = Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  const figures: number[] = [];
  let digitCount = 0;
  const comma = (flags & 2) !== 0;

  if (value === 0) {
    figures.push(0);
    digitCount = 1;
  } else {
    let remaining = Math.abs(value);
    while (remaining > 0) {
      const next = Math.trunc(remaining / 10);
      figures.push(remaining - next * 10);
      remaining = next;
      digitCount += 1;
      if (comma && digitCount % 3 === 0 && remaining > 0) {
        figures.push(11);
      }
    }
  }

  if (value < 0) {
    figures.push(12);
  } else if ((flags & 1) !== 0 && (value !== 0 || (flags & 128) === 0)) {
    figures.push(10);
  }

  return figures.reverse();
}

function counterFigureWidth(figure: number, digitWidth: number, signWidth: number) {
  return figure === 10 || figure === 11 || figure === 12 || figure === 13 ? signWidth : digitWidth;
}

function counterFigureHeight(figure: number, digitHeight: number, signHeight: number) {
  return figure === 10 || figure === 11 || figure === 12 || figure === 13 ? signHeight : digitHeight;
}

function counterFigureBackgroundPosition(figure: number) {
  let col = 0;
  let row = 0;
  switch (figure) {
    case 10:
      col = 2;
      row = 2;
      break;
    case 11:
      col = 1;
      row = 3;
      break;
    case 12:
      col = 3;
      row = 2;
      break;
    case 13:
      col = 0;
      row = 3;
      break;
    default:
      col = figure & 3;
      row = figure >> 2;
      break;
  }
  return `${(col / 3) * 100}% ${(row / 3) * 100}%`;
}

type QrSource = string | { data: Uint8ClampedArray; mode: "byte" }[];

function LayerQr({
  source,
  x,
  y,
  w,
  h,
}: {
  source: QrSource;
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  const [dataUrl, setDataUrl] = React.useState("");
  const sourceKey =
    typeof source === "string" ? source : Array.from(source[0]?.data ?? []).join(",");

  React.useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(source || "CARDVIEWER", {
      errorCorrectionLevel: "M",
      version: typeof source === "string" ? undefined : 1,
      margin: 0,
      scale: 5,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [sourceKey]);

  return (
    <div className="official-qr" style={unityRect(x, y, w, h)}>
      {dataUrl ? <img src={dataUrl} alt="" /> : null}
    </div>
  );
}

function HoloShaderLayer({
  card,
  assetDataUrls,
  lightStyle,
  inline = false,
}: {
  card: CardRecord;
  assetDataUrls: Record<string, string>;
  lightStyle: React.CSSProperties;
  inline?: boolean;
}) {
  const maskUrl =
    card.game === "MU3"
      ? assetDataUrls.mu3Mask
      : card.game === "MAI"
        ? assetDataUrls.maiMask || assetDataUrls.maiMaskFallback
        : "";
  const layerClassName = [
    "holo-layer",
    !USE_OFFICIAL_ASSETS ? "holo-public" : "",
    `holo-${card.game.toLowerCase()}`,
    inline ? "holo-inline" : "",
  ].filter(Boolean).join(" ");

  if (!USE_OFFICIAL_ASSETS) {
    return <HoloMaterialLayer layerClassName={layerClassName} lightStyle={lightStyle} game={card.game} />;
  }

  if (card.game === "MAI") {
    return (
      <MaiOfficialHoloLayer
        card={card}
        assetDataUrls={assetDataUrls}
        layerClassName={layerClassName}
        lightStyle={lightStyle}
      />
    );
  }

  if (card.game !== "MU3") {
    return <HoloMaterialLayer layerClassName={layerClassName} lightStyle={lightStyle} game={card.game} maskUrl={maskUrl} />;
  }

  return (
    <Mu3OfficialHoloLayer
      card={card}
      assetDataUrls={assetDataUrls}
      layerClassName={layerClassName}
      lightStyle={lightStyle}
    />
  );
}

function HoloMaterialLayer({
  layerClassName,
  lightStyle,
  game,
  maskUrl = "",
}: {
  layerClassName: string;
  lightStyle: React.CSSProperties;
  game: string;
  maskUrl?: string;
}) {
  if (USE_OFFICIAL_ASSETS && !maskUrl) return null;
  const maskStyle = holoMaskStyle(maskUrl);
  const foilEffectGame = game === "MAI" ? "MU3" : game;
  const foilClassName = [
    "holo-foil-plane",
    `holo-foil-${foilEffectGame.toLowerCase()}`,
    !USE_OFFICIAL_ASSETS ? "holo-foil-public" : "",
  ].filter(Boolean).join(" ");
  return (
    <div className={layerClassName} style={lightStyle}>
      <div className={foilClassName} style={maskStyle}>
        <div className="holo-foil-darkgrain" />
        <div className="holo-foil-base" />
        <div className="holo-foil-flakes" />
        <div className="holo-foil-sparkles" />
        <div className="holo-foil-glints" />
        <div className="holo-foil-glare" />
      </div>
    </div>
  );
}

type Mu3SvgImage = {
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  maskMode?: HoloRootMaskMode;
};

type Mu3SvgRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
};

type Mu3TmpTextMask = Mu3SvgRect & {
  text: string;
  fontSize: number;
  variant: TmpTextVariant;
  characterSpacing?: number;
  autoSize?: boolean;
  minFontSize?: number;
  horizontalAlign?: TmpHorizontalAlign;
  verticalAlign?: TmpVerticalAlign;
  dilation?: number;
  maskIncludeUnderlay?: boolean;
};

type Mu3MaskMode = "alpha" | "light-or-alpha" | "dark-or-alpha" | "raw";
type HoloRootMaskMode = Mu3MaskMode | "red";

type HoloCssMaskOptions = {
  fallbackAllowWhenSparse?: boolean;
  invertApplicationArea?: boolean;
};

function pushMu3TmpTextMask(masks: Mu3TmpTextMask[], mask: Mu3TmpTextMask) {
  if (!mask.text) return;
  masks.push({
    horizontalAlign: "right",
    verticalAlign: "top",
    dilation: 1,
    ...mask,
  });
}

function MaiOfficialHoloLayer({
  card,
  assetDataUrls,
  layerClassName,
  lightStyle,
}: {
  card: CardRecord;
  assetDataUrls: Record<string, string>;
  layerClassName: string;
  lightStyle: React.CSSProperties;
}) {
  const hasFriendCode = fieldBool(card, "hasFriendCode");
  const hideSerialAndQR = fieldBool(card, "hideSerialAndQR");
  const hidePlayerName = fieldBool(card, "hidePlayerName");
  const hideRating = fieldBool(card, "hideRating");
  const hideFrame = fieldBool(card, "hideFrame");
  const hideCardIcon = fieldBool(card, "hideCardIcon");
  const hideCharaNameAndPeriod = fieldBool(card, "hideCharaNameAndPeriod");
  const hideFriendCode = fieldBool(card, "hideFriendCode");
  const hideChara = fieldBool(card, "hideChara");
  const maskSrc = assetDataUrls.maiMask || assetDataUrls.maiMaskFallback;
  const charaSrc = assetDataUrls.maiChara || assetDataUrls.maiCharaFallback;
  const framePattern = maiFramePattern(card);
  const frameAsset = ["UI_CMA_Card_Frame_00_Gold", "UI_CMA_Card_Frame_01_Silver", "UI_CMA_Card_Frame_02_Bronze", "UI_CMA_Card_Frame_03_Freedom"][framePattern];
  const passAsset = framePattern >= 0 ? `UI_CMA_PassName_${twoDigits(framePattern)}` : null;
  const passCrop = framePattern >= 0 ? MAI_PASS_CROPS[framePattern] : null;
  const passRect = passCrop ? spriteCropDisplayRect(MAI_PASS_RECT, passCrop) : MAI_PASS_RECT;
  const ratingBase = `UI_CMA_Rating_Base_${twoDigits(maiRatingPlatePattern(fieldNumber(card, "rating", 0)))}`;
  const effects = maiCardTypeEffects(card);
  const effectIconAsset = maiEffectIconAsset(card);
  const rootImages: Mu3SvgImage[] = [];
  const frontImages: Mu3SvgImage[] = [];
  const frontRects: Mu3SvgRect[] = [];

  rootImages.push({ href: officialAsset("UI_CMA_Holo_CardBase_00"), x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw" });
  if (maskSrc) {
    rootImages.push({ href: maskSrc, x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw" });
  } else if (charaSrc && !hideChara) {
    rootImages.push({ href: charaSrc, x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "alpha" });
  }
  if (frameAsset && !hideFrame) {
    rootImages.push({ href: officialAsset("UI_CMA_Holo_Frame_00"), x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw" });
  }
  MAI_HOLO_UI_MASKS.forEach(({ asset, rect }) => {
    rootImages.push({ href: officialAsset(asset), ...rect, maskMode: "alpha" });
  });
  if (passAsset && !hideFrame) {
    frontImages.push({ href: officialAsset(passAsset), ...passRect, maskMode: "alpha" });
  }
  if (!hideCharaNameAndPeriod) {
    frontImages.push({ href: officialAsset("UI_CMA_Name_Base_00"), ...MAI_NAME_BASE_RECT, maskMode: "alpha" });
    frontRects.push({ ...MAI_PERIOD_LABEL_RECT });
    frontRects.push({ ...MAI_CHARA_NAME_RECT });
    frontRects.push({ ...MAI_END_DATE_RECT });
  }
  if (effectIconAsset && !hideCardIcon) {
    frontImages.push({ href: officialAsset(effectIconAsset), x: -303, y: -403, w: 112, h: 112 });
  }
  if (effects.master && !hideCardIcon) {
    frontImages.push({ href: officialAsset("UI_CMA_Icon_Master_00"), x: -193.2, y: -403, w: 112, h: 112 });
  }
  if (effects.ratingMusic && !hideCardIcon) {
    frontImages.push({ href: officialAsset("UI_CMA_Icon_Rating_00"), x: -84, y: -403, w: 112, h: 112 });
  }
  if (!hidePlayerName) {
    frontImages.push({ href: officialAsset("UI_CMA_PlayerName_Base_00"), x: 211, y: 397, w: 276, h: 48 });
    frontRects.push({ x: 180.4, y: 387, w: 181.2, h: 50 });
  }
  if (!hideFriendCode) {
    frontImages.push({ href: officialAsset("UI_CMA_FriendCode_Base_00"), x: 211, y: 360.8, w: 276, h: 40 });
    frontRects.push(
      hasFriendCode
        ? { x: 245.8, y: 359.4, w: 192, h: 23.7 }
        : { x: 246.8, y: 360.8, w: 190, h: 12 },
    );
  }
  if (!hideRating) {
    frontImages.push({ href: officialAsset(ratingBase), x: 212.4, y: 456.9, w: 280, h: 76 });
    frontRects.push({ x: 333, y: 457, w: 138, h: 94 });
  }
  if (!hideSerialAndQR) {
    frontImages.push({ href: officialAsset("UI_CMA_SerialCode_Base_00"), x: 0, y: -486.5, w: 490, h: 32 });
    frontImages.push({ href: officialAsset("UI_CMA_QRCode_Base_00"), x: 249.7, y: -394.7, w: 164, h: 164 });
    frontRects.push({ x: -100.9, y: -488.7, w: 266, h: 18 });
    frontRects.push({ x: 171.3, y: -488.7, w: 266, h: 18 });
    frontRects.push({ x: 249.7, y: -394.7, w: 113, h: 113 });
  }

  const hasHoloMaskSource = rootImages.length > 0 || frontImages.length > 0 || frontRects.length > 0;
  const cssMaskUrl = useOfficialHoloMask(rootImages, frontImages, frontRects, hasHoloMaskSource, {
    fallbackAllowWhenSparse: false,
    invertApplicationArea: true,
  });
  if (!hasHoloMaskSource) {
    return null;
  }

  return <HoloMaterialLayer layerClassName={layerClassName} lightStyle={lightStyle} game={card.game} maskUrl={cssMaskUrl} />;
}

function Mu3OfficialHoloLayer({
  card,
  assetDataUrls,
  layerClassName,
  lightStyle,
}: {
  card: CardRecord;
  assetDataUrls: Record<string, string>;
  layerClassName: string;
  lightStyle: React.CSSProperties;
}) {
  const attr = clampInt(fieldNumber(card, "attribute", 0), 0, 2);
  const showSign = mu3NeedsSign(card) && assetDataUrls.mu3Sign && assetDataUrls.mu3SignMask;
  const rightsId = numericField(card, "rightsId", -1);
  const rootImages: Mu3SvgImage[] = [];
  const frontImages: Mu3SvgImage[] = [];
  const frontRects: Mu3SvgRect[] = [];
  const frontTextMasks: Mu3TmpTextMask[] = [];
  const signMaskImages: Mu3SvgImage[] = [];
  const signClearImages: Mu3SvgImage[] = [];
  const excludeImages: Mu3SvgImage[] = [];
  const tmpFont = React.useContext(TmpFontContext);
  const isCommonModel = fieldBool(card, "isCommonModel");
  const mu3Nickname = fieldString(card, "nickName");
  const mu3CharacterName =
    fieldString(card, "nameForCommonModel") ||
    fieldString(card, "characterName") ||
    card.displayName;
  const mu3BaseCharacterName =
    fieldString(card, "baseCharacterName") ||
    fieldString(card, "characterName") ||
    card.displayName;
  const mu3IpName = fieldString(card, "ipName");

  if (assetDataUrls.mu3Holo) {
    rootImages.push({ href: assetDataUrls.mu3Holo, x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw" });
  }
  if (!assetDataUrls.mu3Holo) {
    const holoBg = mu3HoloBgAsset(card, attr);
    const holoFrameBase = mu3HoloFrameBaseAsset(card);
    const holoFrameOverlay = mu3HoloFrameOverlayAsset(card);
    if (holoBg) {
      // The extracted UI_Card_Horo_BG_* foil textures sit ~12px left / 3px up of the
      // printed UI_Card_BG_* art (a systematic registration offset, identical across
      // rarities). Nudge the holo BG right+down so the foil "ONGEKI" logo and line-art
      // line up with the printed background. (+x = right, -y = down in this coord space.)
      //
      // Backfill first: an un-nudged full-frame copy paints the whole card, so the 12px
      // left / 3px bottom margin that the nudge would otherwise leave uncovered (showing
      // up as a bare vertical strip) is filled with edge foil instead. The opaque nudged
      // copy then overwrites the interior, so only the extreme card edge keeps the
      // un-nudged pattern.
      rootImages.push({ href: officialAsset(holoBg), x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw" });
      rootImages.push({ href: officialAsset(holoBg), x: 12, y: -3, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw" });
    }
    if (holoFrameBase) {
      rootImages.push({ href: officialAsset(holoFrameBase), x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw" });
    }
    if (assetDataUrls.mu3Mask) {
      rootImages.push({ href: assetDataUrls.mu3Mask, x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw" });
      excludeImages.push({ href: assetDataUrls.mu3Mask, x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "alpha" });
    }
    if (holoFrameOverlay) {
      rootImages.push({ href: officialAsset(holoFrameOverlay), x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw" });
    }
  }
  if (!fieldBool(card, "hideAttrRarity")) {
    frontImages.push({ href: officialAsset(`UI_Card_Attribute_${twoDigits(attr)}_${mu3AttributeName(attr)}`), x: -297, y: 439, w: 130, h: 130 });
    frontImages.push({ href: officialAsset(mu3RareSpriteName(card)), x: -161.4, y: 442.3, w: 208, h: 118 });
  }
  if (fieldBool(card, "digitalOnly")) {
    frontImages.push({ href: officialAsset("UI_Card_DigitalMark_00"), x: 239.2, y: 477.4, w: 294, h: 102 });
  }
  if (!fieldBool(card, "hideGrade") && assetDataUrls.mu3Grade) {
    frontImages.push({ href: assetDataUrls.mu3Grade, x: 295, y: 455, w: 94, h: 142 });
  }
  if (!fieldBool(card, "hideSkill")) {
    frontImages.push({ href: officialAsset(mu3SkillAsset(card)), x: -40.3, y: -367.7, w: 628, h: 108 });
    frontRects.push({ x: -36.3, y: -381.9, w: 444, h: 66 });
  }
  if (!fieldBool(card, "hideAttackLimit")) {
    frontImages.push({ href: officialAsset("UI_Card_max_00"), x: -291, y: -228.6, w: 108, h: 34 });
    frontRects.push({ x: -291, y: -276.6, w: 132, h: 112 });
    frontRects.push({ x: -26, y: -290.1, w: 398, h: 52 });
  }
  if (!fieldBool(card, "hideAwaken") && mu3AwakenMarkAsset(card)) {
    frontImages.push({ href: officialAsset(mu3AwakenMarkAsset(card)), ...MU3_AWAKEN_MARK_RECT });
  }
  if (!fieldBool(card, "hideUserName")) {
    frontImages.push({ href: officialAsset("UI_Card_UserName_00"), x: 278, y: -291.8, w: 212, h: 56 });
    frontRects.push({ x: 267.1, y: -300.6, w: 206, h: 28 });
  }
  if (!fieldBool(card, "hideName")) {
    if (isCommonModel) {
      pushMu3TmpTextMask(frontTextMasks, { text: mu3Nickname, fontSize: 23.6, variant: "shadow", characterSpacing: -0.06, x: 42.9, y: -176.4, w: 550, h: 26.2, rotation: 6 });
      pushMu3TmpTextMask(frontTextMasks, { text: mu3Nickname, fontSize: 23.6, variant: "main", characterSpacing: -0.06, x: 40, y: -175, w: 550, h: 26.2, rotation: 6 });
      pushMu3TmpTextMask(frontTextMasks, { text: mu3CharacterName, fontSize: 43, variant: "shadow", autoSize: true, minFontSize: 24, x: 53.8, y: -199, w: 523.8, h: 26, rotation: 6 });
      pushMu3TmpTextMask(frontTextMasks, { text: mu3CharacterName, fontSize: 43, variant: "main", autoSize: true, minFontSize: 24, x: 50, y: -197, w: 523.8, h: 26, rotation: 6 });
      pushMu3TmpTextMask(frontTextMasks, { text: mu3IpName, fontSize: 14.6, variant: "shadow", autoSize: true, minFontSize: 12, x: 111.6, y: -232.1, w: 411.6, h: 19.7, rotation: 6 });
      pushMu3TmpTextMask(frontTextMasks, { text: mu3IpName, fontSize: 14.6, variant: "main", autoSize: true, minFontSize: 12, x: 110.6, y: -230.9, w: 411.6, h: 19.7, rotation: 6 });
      frontImages.push({ href: officialAsset("UI_Card_CMN_3D_Icon_00"), x: 262.8, y: -224.3, w: 146, h: 38, rotation: 6 });
    } else {
      pushMu3TmpTextMask(frontTextMasks, { text: mu3Nickname, fontSize: 23.6, variant: "shadow", characterSpacing: -0.06, x: 41.5, y: -185.3, w: 550, h: 26.2, rotation: 6 });
      pushMu3TmpTextMask(frontTextMasks, { text: mu3Nickname, fontSize: 23.6, variant: "main", characterSpacing: -0.06, x: 38.6, y: -183.9, w: 550, h: 26.2, rotation: 6 });
      pushMu3TmpTextMask(frontTextMasks, { text: mu3BaseCharacterName, fontSize: 43, variant: "shadow", autoSize: true, minFontSize: 24, x: 42.7, y: -225.7, w: 546, h: 37, rotation: 6 });
      pushMu3TmpTextMask(frontTextMasks, { text: mu3BaseCharacterName, fontSize: 43, variant: "main", autoSize: true, minFontSize: 24, x: 38.7, y: -224.5, w: 546, h: 37, rotation: 6 });
    }
  }
  if (!fieldBool(card, "hideQRCode")) {
    frontImages.push({ href: officialAsset("UI_Card_qr_base_00"), x: 251.8, y: -396.1, w: 157, h: 158 });
    frontRects.push({ x: 249.4, y: -392.3, w: 128, h: 128 });
  }
  frontImages.push({ href: officialAsset("UI_Card_rightsplate_00"), x: 0, y: -502, w: 768, h: 48 });
  frontRects.push({ x: -135, y: -495.9, w: 326, h: 30 });
  frontRects.push({ x: 132, y: -495.9, w: 326, h: 30 });
  if (assetDataUrls.mu3Rights && rightsId > 0) {
    frontImages.push({ href: assetDataUrls.mu3Rights, x: -85, y: -447, w: 520, h: 64 });
  }
  if (showSign && assetDataUrls.mu3SignMask) {
    signMaskImages.push({ href: assetDataUrls.mu3SignMask, x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "alpha" });
  }
  if (showSign && assetDataUrls.mu3Sign) {
    signClearImages.push({ href: assetDataUrls.mu3Sign, x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "alpha" });
  }

  const hasHoloMaskSource =
    rootImages.length > 0 ||
    frontImages.length > 0 ||
    frontRects.length > 0 ||
    frontTextMasks.length > 0 ||
    signMaskImages.length > 0;
  const cssMaskUrl = useOfficialHoloMask(
    rootImages,
    frontImages,
    frontRects,
    hasHoloMaskSource,
    { invertApplicationArea: true },
    signMaskImages,
    signClearImages,
    frontTextMasks,
    tmpFont,
    excludeImages,
  );
  if (!hasHoloMaskSource) {
    return null;
  }

  return <HoloMaterialLayer layerClassName={layerClassName} lightStyle={lightStyle} game={card.game} maskUrl={cssMaskUrl} />;
}

function useOfficialHoloMask(
  rootImages: Mu3SvgImage[],
  frontImages: Mu3SvgImage[],
  frontRects: Mu3SvgRect[],
  enabled: boolean,
  options: HoloCssMaskOptions = {},
  signMaskImages: Mu3SvgImage[] = [],
  signClearImages: Mu3SvgImage[] = [],
  frontTextMasks: Mu3TmpTextMask[] = [],
  tmpFont: TmpFontMetrics | null = null,
  excludeImages: Mu3SvgImage[] = [],
) {
  const maskKey = JSON.stringify({
    enabled,
    fallbackAllowWhenSparse: options.fallbackAllowWhenSparse ?? true,
    invertApplicationArea: options.invertApplicationArea ?? false,
    root: rootImages.map((image) => [image.href, image.x, image.y, image.w, image.h, image.rotation ?? 0, image.maskMode ?? "alpha"]),
    front: frontImages.map((image) => [image.href, image.x, image.y, image.w, image.h, image.rotation ?? 0, image.maskMode ?? "alpha"]),
    rects: frontRects.map((rect) => [rect.x, rect.y, rect.w, rect.h, rect.rotation ?? 0]),
    text: frontTextMasks.map((mask) => [
      mask.text,
      mask.x,
      mask.y,
      mask.w,
      mask.h,
      mask.rotation ?? 0,
      mask.fontSize,
      mask.variant,
      mask.characterSpacing ?? 0,
      mask.autoSize ?? false,
      mask.minFontSize ?? mask.fontSize,
      mask.horizontalAlign ?? "right",
      mask.verticalAlign ?? "top",
      mask.dilation ?? 1,
      mask.maskIncludeUnderlay ?? false,
    ]),
    tmpFont: tmpFont ? [tmpFont.texture, tmpFont.fontInfo.PointSize, tmpFont.fontInfo.LineHeight, tmpFont.fontInfo.Ascender] : null,
    signMask: signMaskImages.map((image) => [image.href, image.x, image.y, image.w, image.h, image.rotation ?? 0, image.maskMode ?? "alpha"]),
    signClear: signClearImages.map((image) => [image.href, image.x, image.y, image.w, image.h, image.rotation ?? 0, image.maskMode ?? "alpha"]),
    exclude: excludeImages.map((image) => [image.href, image.x, image.y, image.w, image.h, image.rotation ?? 0, image.maskMode ?? "alpha"]),
  });
  const [maskUrl, setMaskUrl] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    setMaskUrl("");
    if (!enabled) {
      return () => {
        cancelled = true;
      };
    }
    renderOfficialHoloMask(rootImages, frontImages, frontRects, options, signMaskImages, signClearImages, frontTextMasks, tmpFont, excludeImages)
      .then((url) => {
        if (!cancelled) setMaskUrl(url);
      })
      .catch(() => {
        if (!cancelled) setMaskUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [maskKey]);

  return maskUrl;
}

async function renderOfficialHoloMask(
  rootImages: Mu3SvgImage[],
  frontImages: Mu3SvgImage[],
  frontRects: Mu3SvgRect[],
  options: HoloCssMaskOptions = {},
  signMaskImages: Mu3SvgImage[] = [],
  signClearImages: Mu3SvgImage[] = [],
  frontTextMasks: Mu3TmpTextMask[] = [],
  tmpFont: TmpFontMetrics | null = null,
  excludeImages: Mu3SvgImage[] = [],
) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const rootCanvas = document.createElement("canvas");
  rootCanvas.width = CARD_WIDTH;
  rootCanvas.height = CARD_HEIGHT;
  const rootCtx = rootCanvas.getContext("2d", { willReadFrequently: true });
  const frontCanvas = document.createElement("canvas");
  frontCanvas.width = CARD_WIDTH;
  frontCanvas.height = CARD_HEIGHT;
  const frontCtx = frontCanvas.getContext("2d", { willReadFrequently: true });
  const frontTextCanvas = document.createElement("canvas");
  frontTextCanvas.width = CARD_WIDTH;
  frontTextCanvas.height = CARD_HEIGHT;
  const frontTextCtx = frontTextCanvas.getContext("2d", { willReadFrequently: true });
  const signMaskCanvas = document.createElement("canvas");
  signMaskCanvas.width = CARD_WIDTH;
  signMaskCanvas.height = CARD_HEIGHT;
  const signMaskCtx = signMaskCanvas.getContext("2d", { willReadFrequently: true });
  const signClearCanvas = document.createElement("canvas");
  signClearCanvas.width = CARD_WIDTH;
  signClearCanvas.height = CARD_HEIGHT;
  const signClearCtx = signClearCanvas.getContext("2d", { willReadFrequently: true });
  const excludeCanvas = document.createElement("canvas");
  excludeCanvas.width = CARD_WIDTH;
  excludeCanvas.height = CARD_HEIGHT;
  const excludeCtx = excludeCanvas.getContext("2d", { willReadFrequently: true });
  if (!rootCtx || !frontCtx || !frontTextCtx || !signMaskCtx || !signClearCtx || !excludeCtx) return "";

  rootCtx.imageSmoothingEnabled = true;
  frontCtx.imageSmoothingEnabled = true;
  frontTextCtx.imageSmoothingEnabled = true;
  signMaskCtx.imageSmoothingEnabled = true;
  signClearCtx.imageSmoothingEnabled = true;
  excludeCtx.imageSmoothingEnabled = true;

  const loadImages = (images: Mu3SvgImage[]) =>
    Promise.all(
      images.map(async (image) => {
        try {
          return { image, element: await loadMaskImage(image.href) };
        } catch {
          return null;
        }
      }),
    );

  const [loadedRootImages, loadedFrontImages, loadedSignMaskImages, loadedSignClearImages, loadedExcludeImages] = await Promise.all([
    loadImages(rootImages),
    loadImages(frontImages),
    loadImages(signMaskImages),
    loadImages(signClearImages),
    loadImages(excludeImages),
  ]);
  const tmpAtlas =
    tmpFont && frontTextMasks.length
      ? await loadTmpAtlas(tmpFont).catch(() => null)
      : null;

  for (const loaded of loadedRootImages) {
    if (!loaded) continue;
    drawMu3ImageMask(rootCtx, loaded.image, loaded.element);
  }
  for (const loaded of loadedFrontImages) {
    if (!loaded) continue;
    drawMu3ImageMask(frontCtx, loaded.image, loaded.element);
  }
  frontCtx.fillStyle = "#ffffff";
  for (const rect of frontRects) {
    drawMu3RectExclusion(frontCtx, rect);
  }
  if (tmpFont && tmpAtlas) {
    for (const mask of frontTextMasks) {
      drawMu3TmpTextMask(frontTextCtx, mask, tmpFont, tmpAtlas);
    }
  }
  for (const loaded of loadedSignMaskImages) {
    if (!loaded) continue;
    drawMu3ImageMask(signMaskCtx, loaded.image, loaded.element);
  }
  for (const loaded of loadedSignClearImages) {
    if (!loaded) continue;
    drawMu3ImageMask(signClearCtx, loaded.image, loaded.element);
  }
  for (const loaded of loadedExcludeImages) {
    if (!loaded) continue;
    drawMu3ImageMask(excludeCtx, loaded.image, loaded.element);
  }

  const rootData = rootCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const frontData = frontCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const frontTextData = frontTextCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const signMaskData = signMaskCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const signClearData = signClearCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const excludeData = excludeCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const frontMask = binarizeRenderedPixels(frontData);
  const frontTextMask = binarizeRenderedPixels(frontTextData);
  for (let pixel = 0; pixel < frontMask.length; pixel += 1) {
    if (frontTextMask[pixel] > 127) frontMask[pixel] = 255;
  }
  const dilatedFrontMask = dilateBinaryMask(frontMask, CARD_WIDTH, CARD_HEIGHT, 7);
  const out = ctx.createImageData(CARD_WIDTH, CARD_HEIGHT);
  for (let pixel = 0, index = 0; pixel < dilatedFrontMask.length; pixel += 1, index += 4) {
    const rootAdds = rootData.data[index] > 127;
    const frontAdds = dilatedFrontMask[pixel] > 127;
    const signAdds = signMaskData.data[index + 3] > 127;
    const signClears = signClearData.data[index + 3] > 127;
    const excluded = excludeData.data[index + 3] > 127;
    const baseActive = !signClears && (rootAdds || frontAdds || signAdds);
    const alpha = options.invertApplicationArea
      ? !signClears && !baseActive && !excluded
        ? 255
        : 0
      : baseActive
        ? 255
        : 0;
    out.data[index] = 255;
    out.data[index + 1] = 255;
    out.data[index + 2] = 255;
    out.data[index + 3] = alpha;
  }

  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL("image/png");
}

function binarizeRenderedPixels(imageData: ImageData) {
  const mask = new Uint8ClampedArray(imageData.width * imageData.height);
  for (let src = 0, dst = 0; src < imageData.data.length; src += 4, dst += 1) {
    mask[dst] =
      imageData.data[src] > 0 ||
      imageData.data[src + 1] > 0 ||
      imageData.data[src + 2] > 0 ||
      imageData.data[src + 3] > 0
        ? 255
        : 0;
  }
  return mask;
}

function paintBinaryMask(imageData: ImageData, mask: Uint8ClampedArray<ArrayBufferLike>) {
  for (let pixel = 0, index = 0; pixel < mask.length; pixel += 1, index += 4) {
    const alpha = mask[pixel] > 0 ? 255 : 0;
    imageData.data[index] = 255;
    imageData.data[index + 1] = 255;
    imageData.data[index + 2] = 255;
    imageData.data[index + 3] = alpha;
  }
}

function dilateBinaryMask(src: Uint8ClampedArray<ArrayBufferLike>, width: number, height: number, iterations: number) {
  let current: Uint8ClampedArray<ArrayBufferLike> = src;
  let next: Uint8ClampedArray<ArrayBufferLike> = new Uint8ClampedArray(src.length);
  for (let pass = 0; pass < iterations; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      const y0 = Math.max(y - 1, 0) * width;
      const y1 = y * width;
      const y2 = Math.min(y + 1, height - 1) * width;
      for (let x = 0; x < width; x += 1) {
        const x0 = Math.max(x - 1, 0);
        const x1 = x;
        const x2 = Math.min(x + 1, width - 1);
        next[y1 + x1] =
          current[y0 + x0] > 0 ||
          current[y0 + x1] > 0 ||
          current[y0 + x2] > 0 ||
          current[y1 + x0] > 0 ||
          current[y1 + x2] > 0 ||
          current[y2 + x0] > 0 ||
          current[y2 + x1] > 0 ||
          current[y2 + x2] > 0
            ? 255
            : 0;
      }
    }
    const tmp = current;
    current = next;
    next = tmp;
  }
  return current;
}

function loadMaskImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function drawMu3ImageMask(ctx: CanvasRenderingContext2D, image: Mu3SvgImage, element: HTMLImageElement) {
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = CARD_WIDTH;
  maskCanvas.height = CARD_HEIGHT;
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!maskCtx) return;

  withUnityCanvasRect(maskCtx, image, (left, top, width, height) => {
    maskCtx.drawImage(element, left, top, width, height);
  });

  const imageData = maskCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
  normalizeMu3MaskData(imageData.data, image.maskMode ?? "alpha");
  maskCtx.putImageData(imageData, 0, 0);

  ctx.drawImage(maskCanvas, 0, 0);
}

function normalizeMu3MaskData(data: Uint8ClampedArray, mode: HoloRootMaskMode) {
  if (mode === "raw") {
    return;
  }

  if (mode === "red") {
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      const red = data[index];
      const maskAlpha = alpha > 8 && red > 127 ? 255 : 0;
      data[index] = maskAlpha;
      data[index + 1] = maskAlpha;
      data[index + 2] = maskAlpha;
      data[index + 3] = maskAlpha;
    }
    return;
  }

  if (mode === "alpha") {
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      data[index] = alpha;
      data[index + 1] = alpha;
      data[index + 2] = alpha;
      data[index + 3] = alpha;
    }
    return;
  }

  let alphaPixels = 0;
  let lightPixels = 0;
  let darkPixels = 0;
  const totalPixels = data.length / 4;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha <= 8) continue;
    alphaPixels += 1;
    const luminance = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    if (luminance >= 128) lightPixels += 1;
    if (luminance <= 144) darkPixels += 1;
  }

  const alphaCoverage = alphaPixels / totalPixels;
  const lightCoverage = alphaPixels > 0 ? lightPixels / alphaPixels : 0;
  const darkCoverage = alphaPixels > 0 ? darkPixels / alphaPixels : 0;
  const useLightLuminance = alphaCoverage > 0.72 && lightCoverage > 0.01 && lightCoverage < 0.96;
  const useDarkLuminance = alphaCoverage > 0.72 && lightCoverage >= 0.96;
  const preferDarkLuminance = mode === "dark-or-alpha" && alphaCoverage > 0.42 && darkCoverage > 0.005 && darkCoverage < 0.98;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    const luminance = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    let maskAlpha = alpha;
    if (preferDarkLuminance) {
      maskAlpha = alpha * clampNumber((212 - luminance) / 168, 0, 1);
    } else if (useLightLuminance) {
      maskAlpha = alpha * clampNumber((luminance - 24) / 200, 0, 1);
    } else if (useDarkLuminance) {
      maskAlpha = alpha * clampNumber((232 - luminance) / 200, 0, 1);
    }
    data[index] = maskAlpha;
    data[index + 1] = maskAlpha;
    data[index + 2] = maskAlpha;
    data[index + 3] = maskAlpha;
  }
}

function drawMu3RectExclusion(ctx: CanvasRenderingContext2D, rect: Mu3SvgRect) {
  withUnityCanvasRect(ctx, rect, (left, top, width, height) => {
    ctx.fillRect(left, top, width, height);
  });
}

function drawMu3TmpTextMask(
  ctx: CanvasRenderingContext2D,
  mask: Mu3TmpTextMask,
  font: TmpFontMetrics,
  atlas: HTMLImageElement,
) {
  const rasterized = rasterizeTmpText(atlas, font, mask.text, {
    w: mask.w,
    h: mask.h,
    padding: TMP_TEXT_PADDING,
    fontSize: mask.fontSize,
    variant: mask.variant,
    characterSpacing: mask.characterSpacing ?? 0,
    autoSize: mask.autoSize ?? false,
    minFontSize: mask.minFontSize ?? mask.fontSize,
    horizontalAlign: mask.horizontalAlign ?? "right",
    verticalAlign: mask.verticalAlign ?? "top",
    maskIncludeUnderlay: mask.maskIncludeUnderlay ?? false,
  });
  if (!rasterized) return;

  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = CARD_WIDTH;
  rawCanvas.height = CARD_HEIGHT;
  const rawCtx = rawCanvas.getContext("2d", { willReadFrequently: true });
  if (!rawCtx) return;
  rawCtx.imageSmoothingEnabled = true;
  const left = CARD_WIDTH / 2 + mask.x - mask.w / 2;
  const top = CARD_HEIGHT / 2 - mask.y - mask.h / 2;
  const centerX = left + mask.w / 2;
  const centerY = top + mask.h / 2;
  rawCtx.save();
  if (mask.rotation) {
    rawCtx.translate(centerX, centerY);
    rawCtx.rotate((-mask.rotation * Math.PI) / 180);
    rawCtx.translate(-centerX, -centerY);
  }
  rawCtx.drawImage(
    rasterized.maskCanvas,
    left - TMP_TEXT_PADDING,
    top - TMP_TEXT_PADDING,
    mask.w + TMP_TEXT_PADDING * 2,
    mask.h + TMP_TEXT_PADDING * 2,
  );
  rawCtx.restore();

  const rawData = rawCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const rawMask = binarizeRenderedPixels(rawData);
  const dilation = Math.max(0, Math.floor(mask.dilation ?? 1));
  const outputMask = dilation > 0 ? dilateBinaryMask(rawMask, CARD_WIDTH, CARD_HEIGHT, dilation) : rawMask;
  const output = rawCtx.createImageData(CARD_WIDTH, CARD_HEIGHT);
  paintBinaryMask(output, outputMask);
  rawCtx.putImageData(output, 0, 0);
  ctx.drawImage(rawCanvas, 0, 0);
}

function withUnityCanvasRect(
  ctx: CanvasRenderingContext2D,
  rect: Mu3SvgImage | Mu3SvgRect,
  draw: (left: number, top: number, width: number, height: number) => void,
) {
  const left = CARD_WIDTH / 2 + rect.x - rect.w / 2;
  const top = CARD_HEIGHT / 2 - rect.y - rect.h / 2;
  const centerX = left + rect.w / 2;
  const centerY = top + rect.h / 2;
  ctx.save();
  if (rect.rotation) {
    ctx.translate(centerX, centerY);
    ctx.rotate((-rect.rotation * Math.PI) / 180);
    ctx.translate(-centerX, -centerY);
  }
  draw(left, top, rect.w, rect.h);
  ctx.restore();
}

function cssImageUrl(url: string) {
  return `url("${url.replace(/"/g, '\\"')}")`;
}

function HoloColorMask({
  className,
  maskUrl,
}: {
  className: string;
  maskUrl: string;
}) {
  return (
    <div className={`holo-color-mask ${className}`} style={holoMaskStyle(maskUrl)}>
      <div className="holo-rainbow holo-rainbow-mask" />
      <div className="holo-fixed-light holo-fixed-light-mask" />
    </div>
  );
}

function holoMaskStyle(maskUrl: string): React.CSSProperties | undefined {
  if (!maskUrl) return undefined;
  return {
    WebkitMaskImage: `url("${maskUrl}")`,
    maskImage: `url("${maskUrl}")`,
  };
}

function unityRect(
  x: number,
  y: number,
  w: number,
  h: number,
  transform: { rotation?: number; scale?: number } = {},
): React.CSSProperties {
  const left = CARD_WIDTH / 2 + x - w / 2;
  const top = CARD_HEIGHT / 2 - y - h / 2;
  const transforms = [
    transform.rotation ? `rotate(${-transform.rotation}deg)` : "",
    transform.scale && transform.scale !== 1 ? `scale(${transform.scale})` : "",
  ].filter(Boolean);
  return {
    left: `${(left / CARD_WIDTH) * 100}%`,
    top: `${(top / CARD_HEIGHT) * 100}%`,
    width: `${(w / CARD_WIDTH) * 100}%`,
    height: `${(h / CARD_HEIGHT) * 100}%`,
    transform: transforms.length ? transforms.join(" ") : undefined,
    transformOrigin: "50% 50%",
  };
}

function EditorPanel({
  card,
  edits,
  onChange,
  onReset,
}: {
  card: CardRecord | null;
  edits: CardEdits | undefined;
  onChange: (fieldKey: string, value: PrintFieldValue) => void;
  onReset: () => void;
}) {
  if (!card) {
    return <aside className="editor-panel empty">No selection</aside>;
  }

  const merged = applyEdits(card, edits);
  const valueFields = merged.printFields.filter((field) => field.fieldType !== "bool" && field.fieldType !== "metadata");
  const flagFields = merged.printFields.filter((field) => field.fieldType === "bool");
  const editJson = JSON.stringify(edits ?? {}, null, 2);

  return (
    <aside className="editor-panel">
      <div className="editor-header">
        <div>
          <h3>Print Surface</h3>
        </div>
        <button className="ghost-button" onClick={onReset} disabled={!edits}>
          Reset
        </button>
      </div>

      <div className="form-grid">
        {valueFields.map((field) => (
          <PrintFieldControl key={field.key} field={field} onChange={onChange} />
        ))}
        {flagFields.length ? (
          <div className="flag-section">
            <h4>Visibility / print flags</h4>
            {flagFields.map((field) => (
              <PrintFieldControl key={field.key} field={field} onChange={onChange} />
            ))}
          </div>
        ) : null}
      </div>

      <details className="edit-json">
        <summary>Override JSON</summary>
        <pre>{editJson}</pre>
      </details>
    </aside>
  );
}

function PrintFieldControl({
  field,
  onChange,
}: {
  field: PrintField;
  onChange: (fieldKey: string, value: PrintFieldValue) => void;
}) {
  if (field.fieldType === "bool") {
    return (
      <label className="control toggle-control">
        <input
          type="checkbox"
          checked={field.value === "true"}
          onChange={(event) => onChange(field.key, event.target.checked)}
        />
        <span>{field.label}</span>
      </label>
    );
  }

  if (field.fieldType === "multiline") {
    return (
      <label className="control wide">
        <span>{field.label}</span>
        <textarea
          value={field.value ?? ""}
          onChange={(event) => onChange(field.key, event.target.value)}
          rows={5}
        />
      </label>
    );
  }

  if (field.fieldType === "select") {
    return (
      <label className="control">
        <span>{field.label}</span>
        <select
          value={field.value ?? ""}
          onChange={(event) => onChange(field.key, event.target.value)}
        >
          {(field.options ?? []).map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const input = (
    <input
      type={field.fieldType === "number" ? "number" : "text"}
      value={field.value ?? ""}
      onChange={(event) => onChange(field.key, event.target.value)}
    />
  );

  return (
    <label className="control">
      <span>{field.label}</span>
      {field.key === "serialId" ? (
        <span className="input-with-action">
          {input}
          <button
            type="button"
            className="input-action-button"
            aria-label="Generate 20 digit random serial"
            title="Generate 20 digit random serial"
            onClick={() => onChange(field.key, randomDigitString(20))}
          >
            ↻
          </button>
        </span>
      ) : (
        input
      )}
    </label>
  );
}

function randomDigitString(length: number) {
  const digits = new Uint8Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(digits);
  } else {
    for (let index = 0; index < digits.length; index += 1) {
      digits[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(digits, (value) => String(value % 10)).join("");
}

function applyEdits(card: CardRecord, edits?: CardEdits): CardRecord {
  if (!edits) return card;
  const editedPrintFields = Object.keys(edits);
  const printFields = card.printFields.map((field) => {
    const value = edits[field.key];
    if (value === undefined) return field;
    return { ...field, value: String(value) };
  });
  const printedName = firstPrintedValue(printFields, [
    "characterName",
    "charaName",
    "userName",
  ]);
  return {
    ...card,
    printFields,
    editedPrintFields,
    displayName: printedName || card.displayName,
  };
}

function maiLinkedPrintEdits(card: CardRecord, fieldKey: string, value: PrintFieldValue): CardEdits {
  const edits: CardEdits = { [fieldKey]: value };
  if (card.game !== "MAI" || fieldKey !== "charaId") return edits;

  const charaId = Number(value);
  const choice = maiCharaChoice(card, charaId);
  if (!choice) return edits;

  edits.mapId = String(choice.mapId);
  edits.uniqueId = String(choice.uniqueId);
  edits.charaName = choice.name;
  const currentVer = fieldString(card, "verCharaId");
  const prefix = currentVer.replace(/-\d{1,}$/, "") || "[maimaiDX]";
  edits.verCharaId = `${prefix}-${String(choice.uniqueId).padStart(4, "0")}`;
  return edits;
}

function firstPrintedValue(fields: PrintField[], keys: string[]) {
  for (const key of keys) {
    const value = fields.find((field) => field.key === key)?.value.trim();
    if (value) return value;
  }
  return "";
}

function fieldString(card: CardRecord, key: string) {
  return card.printFields.find((field) => field.key === key)?.value.trim() ?? "";
}

function fieldEdited(card: CardRecord, key: string) {
  return card.editedPrintFields?.includes(key) ?? false;
}

function formatDisplaySerial(serialId: string) {
  const raw = serialId.replace(/[\s-]/g, "");
  if (!raw) return "";
  const paddedLength = (raw.length + 3) & -4;
  let count = 0;
  let display = "";
  for (let i = raw.length; i < paddedLength; i += 1) {
    display += " ";
    count += 1;
  }
  for (const char of raw) {
    display += char;
    count += 1;
    if ((count & 3) === 0) display += " ";
  }
  return display;
}

function formatMaiEndDate(endDate: string) {
  const value = endDate.trim();
  if (!value) return "";
  const dateOnly = value.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const parsedDate = new Date(year, month - 1, day);
    if (
      parsedDate.getFullYear() !== year ||
      parsedDate.getMonth() !== month - 1 ||
      parsedDate.getDate() !== day
    ) {
      return "0000/00/00";
    }
    return `${dateOnly[1]}/${dateOnly[2].padStart(2, "0")}/${dateOnly[3].padStart(2, "0")}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "0000/00/00";
  const displayDate = new Date(parsed);
  displayDate.setHours(0, 0, 0, 0);
  if (parsed.getHours() < 7) {
    displayDate.setDate(displayDate.getDate() - 1);
  }
  const year = displayDate.getFullYear().toString().padStart(4, "0");
  const month = (displayDate.getMonth() + 1).toString().padStart(2, "0");
  const day = displayDate.getDate().toString().padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function fieldBool(card: CardRecord, key: string) {
  return card.printFields.find((field) => field.key === key)?.value === "true";
}

function officialHolo(card: CardRecord) {
  if (!HOLO_ENABLED) return false;
  if (card.game === "CHU") return false;
  if (card.game === "MAI") return maiOfficialHolo(card);
  if (card.game === "MU3") return fieldBool(card, "holo");
  return fieldBool(card, "holo");
}

function maiOfficialHolo(card: CardRecord) {
  if (card.printFields.some((field) => field.key === "holo")) {
    return fieldBool(card, "holo");
  }
  return [4, 6].includes(numericField(card, "typeId", -1));
}

function mu3NeedsSign(card: CardRecord) {
  return (
    mu3RarityKind(card) === "SSR" &&
    fieldBool(card, "hideAttrRarity") &&
    fieldBool(card, "hideAttackLimit") &&
    fieldBool(card, "hideSkill") &&
    fieldBool(card, "hideGrade") &&
    fieldBool(card, "hideName") &&
    fieldBool(card, "hideAwaken") &&
    fieldBool(card, "hideUserName") &&
    fieldBool(card, "hideQRCode")
  );
}

function numericField(card: CardRecord, key: string, fallback: number) {
  const raw = fieldString(card, key);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function numericText(value: string, fallback: number) {
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const match = value.match(/\d+/);
  if (!match) return fallback;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function qrSource(card: CardRecord, fallback: string): QrSource {
  const override = fieldString(card, "qrPayload");
  if (override) return override;

  const bytes = card.game === "MAI" ? maiQrBytes(card) : card.game === "MU3" ? mu3QrBytes(card) : null;
  if (bytes) {
    return [{ data: new Uint8ClampedArray(bytes), mode: "byte" }];
  }

  return [card.game, card.dataName, fieldString(card, "serialId"), fallback].filter(Boolean).join("|");
}

function maiQrBytes(card: CardRecord) {
  const cardId = numericField(card, "cardId", numericText(card.id, NaN));
  const charaId = numericField(card, "charaId", 0);
  if (!Number.isFinite(cardId) || !Number.isFinite(charaId)) return null;
  const bytes = createQrBytes(cardId, charaId, 5915972);
  return rc4(bytes, [144, 95, 51, 167, 195, 243, 253, 226, 84, 194, 239, 80, 177, 205, 41, 78]);
}

function mu3QrBytes(card: CardRecord) {
  const cardId = numericField(
    card,
    "cardId",
    numericText(fieldString(card, "cardNo") || card.id || card.dataName, NaN),
  );
  if (!Number.isFinite(cardId)) return null;
  const bytes = createQrBytes(cardId, 0, 5522500);
  return rc4(bytes, [38, 34, 177, 150, 54, 114, 151, 245, 80, 162, 229, 42, 75, 224, 55, 156]);
}

function createQrBytes(cardId: number, serial: number, gameId: number) {
  const bytes = new Uint8Array(14);
  writeLe32(bytes, 0, 0);
  writeLe24(bytes, 4, cardId);
  writeLe32(bytes, 7, serial);
  writeLe24(bytes, 11, gameId);
  return bytes;
}

function writeLe24(bytes: Uint8Array, offset: number, value: number) {
  const number = Math.trunc(value);
  bytes[offset] = number & 0xff;
  bytes[offset + 1] = (number >> 8) & 0xff;
  bytes[offset + 2] = (number >> 16) & 0xff;
}

function writeLe32(bytes: Uint8Array, offset: number, value: number) {
  const number = Math.trunc(value);
  bytes[offset] = number & 0xff;
  bytes[offset + 1] = (number >> 8) & 0xff;
  bytes[offset + 2] = (number >> 16) & 0xff;
  bytes[offset + 3] = (number >> 24) & 0xff;
}

function rc4(input: Uint8Array, key: number[]) {
  const state = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + state[i] + key[i % key.length]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
  }
  let i = 0;
  j = 0;
  const output = new Uint8Array(input);
  for (let n = 0; n < output.length; n += 1) {
    i = (i + 1) & 0xff;
    j = (j + state[i]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
    output[n] ^= state[(state[i] + state[j]) & 0xff];
  }
  return output;
}

function maiFramePattern(card: CardRecord) {
  switch (numericField(card, "typeId", -1)) {
    case 4:
      return 0;
    case 3:
      return 1;
    case 2:
      return 2;
    case 6:
      return 3;
    default:
      return -1;
  }
}

function maiEffectIconAsset(card: CardRecord) {
  const typeId = numericField(card, "typeId", -1);
  const paramId = numericField(card, "cardTypeParamId", 0);
  const mapBonus = fieldString(card, "mapBonus");
  const effects = maiCardTypeEffects(card);

  if (typeId === 4) {
    return mapBonus === "GoldBonus" && paramId === 200
      ? "UI_CMA_Icon_LevelUp_00"
      : "UI_CMA_Icon_PowerUp_00";
  }
  if (effects.freedom) {
    return "UI_CMA_Icon_Freedom_00";
  }
  return null;
}

function maiCardTypeEffects(card: CardRecord) {
  const flags = maiEffectFlags(card);
  return {
    master: (flags & 1) !== 0,
    ratingMusic: (flags & 2) !== 0,
    freedom: (flags & 4) !== 0,
  };
}

function maiEffectFlags(card: CardRecord) {
  const raw = fieldString(card, "extendBitParameter");
  if (raw) return numericField(card, "extendBitParameter", 0);
  return 0;
}

function maiRatingPlatePattern(rating: number) {
  const safeRating = rating < 0 || rating > 99999 ? 0 : rating;
  const thresholds = [0, 1000, 2000, 4000, 7000, 10000, 12000, 13000, 14000, 14500, 15000];
  let pattern = 0;
  thresholds.forEach((threshold, index) => {
    if (safeRating >= threshold) pattern = index;
  });
  return pattern;
}

function Mu3LimitBreakStars({ card }: { card: CardRecord }) {
  const maxStars = mu3MaxOwnCount(card);
  const activeStars = clampInt(numericField(card, "ownCount", 0), 0, maxStars);
  return (
    <>
      {MU3_LIMIT_BREAK_STAR_POSITIONS.slice(0, maxStars).map((x, index) => (
        <LayerImage
          src={officialAsset(index < activeStars ? "UI_Card_star_01" : "UI_Card_star_00")}
          x={x}
          y={MU3_LIMIT_BREAK_STAR_Y}
          w={50}
          h={50}
          key={index}
        />
      ))}
    </>
  );
}

function mu3AttackValue(card: CardRecord) {
  if (fieldEdited(card, "maxAttack")) {
    return fieldString(card, "maxAttack");
  }

  const params = mu3LevelParams(card);
  if (!params.length) return fieldString(card, "maxAttack");

  const ownCount = numericField(card, "ownCount", 0);
  const awaken = mu3Awaken(card);
  const level = mu3MaxLevel(card, ownCount, awaken > 0);
  return String(mu3LevelPower(params, level, awaken === 2));
}

function mu3LevelParams(card: CardRecord) {
  return fieldString(card, "levelParams")
    .split(/[,\s]+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

function mu3MaxOwnCount(card: CardRecord) {
  return mu3RarityKind(card) === "N" ? 11 : 5;
}

function mu3MaxLevel(card: CardRecord, ownCount: number, isKaika: boolean) {
  const max = mu3MaxOwnCount(card);
  const clampedOwnCount = clampInt(ownCount, 1, max) - 1;
  return 10 + clampedOwnCount * 5 + (isKaika ? 40 : 0);
}

function mu3LevelPower(params: number[], level: number, isChoKaika: boolean) {
  const count = Math.min(params.length, MU3_LEVEL_LIMITS.length);
  if (count <= 0) return 0;
  if (isChoKaika) return params[count - 1] ?? 0;

  let segment = -1;
  for (let index = 0; index < count - 2; index += 1) {
    if (MU3_LEVEL_LIMITS[index] <= level && level <= MU3_LEVEL_LIMITS[index + 1]) {
      segment = index;
      break;
    }
  }
  if (segment < 0) return 0;
  if (count - 2 <= segment) return params[segment] ?? 0;

  const fromLevel = MU3_LEVEL_LIMITS[segment];
  const toLevel = MU3_LEVEL_LIMITS[segment + 1];
  const t = (level - fromLevel) / (toLevel - fromLevel);
  const fromPower = params[segment] ?? 0;
  const toPower = params[segment + 1] ?? fromPower;
  return Math.trunc(fromPower + (toPower - fromPower) * t);
}

function mu3Awaken(card: CardRecord) {
  return clampInt(numericField(card, "awaken", 1), 0, 2);
}

function mu3AwakenMarkAsset(card: CardRecord) {
  switch (mu3Awaken(card)) {
    case 1:
      return "UI_Card_PrintMark_01_kaika";
    case 2:
      return "UI_Card_PrintMark_02_tyoukaika";
    default:
      return "";
  }
}

function mu3RarityKind(card: CardRecord) {
  const rare = numericField(card, "rareType", card.rareType ?? 0);
  if (rare === 1) return "R";
  if (rare === 2) return "SR";
  if (rare === 3) return "SSR";
  if (rare === 12) return "SRPlus";
  return "N";
}

function mu3RareSpriteName(card: CardRecord) {
  switch (mu3RarityKind(card)) {
    case "R":
      return "UI_Card_Rare_01_R";
    case "SR":
      return "UI_Card_Rare_02_SR";
    case "SSR":
      return "UI_Card_Rare_03_SSR";
    case "SRPlus":
      return "UI_Card_Rare_05_SRPlus";
    default:
      return "UI_Card_Rare_00_N";
  }
}

function mu3SkillAsset(card: CardRecord) {
  switch (fieldString(card, "skillCategory").toLowerCase()) {
    case "attack":
      return "UI_Card_Skill_00_Attack";
    case "dangerattack":
      return "UI_Card_Skill_00_Attack_Danger";
    case "support":
      return "UI_Card_Skill_01_Assist";
    case "dangersupport":
      return "UI_Card_Skill_01_Assist_Danger";
    case "guard":
      return "UI_Card_Skill_02_Guard";
    case "dangerguard":
      return "UI_Card_Skill_02_Guard_Danger";
    case "boost":
      return "UI_Card_Skill_03_Boost";
    case "dangerboost":
      return "UI_Card_Skill_03_Boost_Danger";
    default:
      return "UI_Card_Skill_00_Attack";
  }
}

function mu3FrameAsset(card: CardRecord, attr: number) {
  const rarity = mu3RarityKind(card);
  if (rarity === "N" || rarity === "R") return `UI_Card_frame_${rarity}_${twoDigits(attr)}`;
  if (rarity === "SR") return `UI_Card_frame_SR_${twoDigits(attr)}`;
  if (rarity === "SRPlus") return "UI_Card_frame_SRPlus_00";
  if (rarity === "SSR") return "UI_Card_frame_SSR_00";
  return "";
}

function mu3HoloFrameBaseAsset(card: CardRecord) {
  switch (mu3RarityKind(card)) {
    case "N":
      return "UI_Card_Horo_Frame_N_00";
    case "R":
      return "UI_Card_Horo_Frame_R_00";
    case "SR":
    case "SRPlus":
      return "UI_Card_Horo_Frame_SR_00";
    default:
      return "";
  }
}

function mu3HoloFrameOverlayAsset(card: CardRecord) {
  switch (mu3RarityKind(card)) {
    case "SR":
    case "SRPlus":
      return "UI_Card_Horo_Frame_SR_01";
    case "SSR":
      return "UI_Card_Horo_Frame_SSR_00";
    default:
      return "";
  }
}

function mu3HoloBgAsset(card: CardRecord, attr: number) {
  switch (mu3RarityKind(card)) {
    case "N":
      return "UI_Card_Horo_BG_N_00";
    case "R":
      return "UI_Card_Horo_BG_R_00";
    case "SR":
    case "SRPlus":
      return "UI_Card_Horo_BG_SR_00";
    case "SSR":
      return "UI_Card_Horo_BG_SSR_00";
    default:
      return "";
  }
}

function mu3ShowMainFrame(card: CardRecord) {
  return !fieldBool(card, "hideFrame");
}

function mu3AttributeName(attr: number) {
  return ["Red", "Bule", "Green"][attr] ?? "Red";
}

function fieldNumber(card: CardRecord, key: string, fallback: number) {
  const value = Number(fieldString(card, key));
  return Number.isFinite(value) ? value : fallback;
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function twoDigits(value: number) {
  return String(value).padStart(2, "0");
}

function mockScanResult(packageRoot: string): ScanResult {
  return {
    packageRoot,
    streamingAssets: `${packageRoot}\\CardMaker_Data\\StreamingAssets`,
    cards: [
      {
        id: "1002",
        game: "CHU",
        recordType: "Card",
        dataName: "card00001002",
        displayName: "Sample CHU Character",
        characterName: "Sample CHU Character",
        skillName: "Technical Challenge",
        skillText: "COMBO and CHAIN bonuses are printed on the final surface.",
        rareType: 2,
        labelType: 3,
        difType: 0,
        miss: 0,
        combo: 150,
        chain: 300,
        imagePath: null,
        thumbnailPath: null,
        assetLayers: [],
        sourceXml: "Browser fallback",
        editableFields: ["characterName", "skillName", "skillText"],
        printFields: [
          pf("characterName", "Character name", "text", "Sample CHU Character"),
          pf("skillName", "Skill name", "text", "Technical Challenge"),
          pf("skillText", "Skill description", "multiline", "COMBO and CHAIN bonuses are printed on the final surface."),
          pf("serialId", "Serial ID", "text", "A000-0000-0000"),
          pf("rareType", "Rare type", "metadata", "2"),
          pf("labelType", "Label type", "number", "3"),
          pf("difType", "Difficulty type", "number", "0"),
          pf("miss", "MISS count", "number", "0"),
          pf("combo", "COMBO count", "number", "150"),
          pf("chain", "CHAIN count", "number", "300"),
          pf("holo", "Holographic print", "metadata", "false"),
          pf("hideParam", "Hide score parameters", "bool", "false"),
          pf("hideSerialId", "Hide serial", "bool", "false"),
          pf("hideBackGround", "Hide background label", "bool", "false"),
          pf("hideChara", "Hide character", "bool", "false"),
        ],
      },
      {
        id: "1",
        game: "MAI",
        recordType: "CardType",
        dataName: "cardtype000004",
        displayName: "Sample MAI Gold Pass",
        characterName: "Sample MAI Gold Pass",
        skillName: "Pass",
        skillText: "The renderer combines player name, rating, QR, serial, period, and card frame.",
        rareType: null,
        labelType: null,
        difType: null,
        miss: null,
        combo: null,
        chain: null,
        imagePath: null,
        thumbnailPath: null,
        assetLayers: [],
        sourceXml: "Browser fallback",
        editableFields: ["characterName", "skillName", "skillText"],
        printFields: [
          pf("userName", "Player name", "text", "PLAYER"),
          pf("rating", "Rating", "number", "12345"),
          pf("friendCode", "Friend code", "text", "0000-0000-0000"),
          pf("hasFriendCode", "Print friend code", "bool", "true"),
          pf("charaName", "Character/card name", "text", "Sample MAI Gold Pass"),
          pf("cardKind", "Card type", "metadata", "Pass"),
          pf("effectText", "Effect text", "metadata", "The renderer combines player name, rating, QR, serial, period, and card frame."),
          pf("endDate", "End date", "text", "2099/12/31"),
          pf("serialId", "Serial ID", "text", "M000-0000-0000"),
          pf("verCharaId", "Version character ID", "text", "[maimaiDX]1.00-0001"),
          pf("qrPayload", "QR text override", "multiline", ""),
          pf("cardId", "Card ID", "number", "1012"),
          pf("typeId", "Type ID", "number", "4"),
          pf("charaId", "Character ID", "number", "101"),
          pf("cardTypeParamId", "Card type parameter ID", "number", "200"),
          pf("mapBonus", "Map bonus", "text", "GoldBonus"),
          pf("extendBitParameter", "Effect bit flags", "number", "3"),
          pf("holo", "Holographic print", "metadata", "true"),
          pf("hideSerialAndQR", "Hide serial and QR", "bool", "false"),
          pf("hidePlayerName", "Hide player name", "bool", "false"),
          pf("hideRating", "Hide rating", "bool", "false"),
          pf("hideFrame", "Hide frame", "bool", "false"),
          pf("hideCardIcon", "Hide card icon", "bool", "false"),
          pf("hideCharaNameAndPeriod", "Hide name and period", "bool", "false"),
          pf("hideFriendCode", "Hide friend code", "bool", "false"),
          pf("hideChara", "Hide character", "bool", "false"),
        ],
      },
      {
        id: "100001",
        game: "MU3",
        recordType: "Card",
        dataName: "mu3_sample_100001",
        displayName: "Sample MU3 Character",
        characterName: "Sample MU3 Character",
        skillName: "Attack Boost",
        skillText: "Boosts printed attack and limit break indicators.",
        rareType: 2,
        labelType: null,
        difType: null,
        miss: null,
        combo: null,
        chain: null,
        imagePath: null,
        thumbnailPath: null,
        assetLayers: [],
        sourceXml: "Browser fallback",
        editableFields: ["characterName", "skillName", "skillText"],
        printFields: [
          pf("userName", "User name", "text", "USER"),
          pf("characterName", "Character name", "text", "Sample MU3 Character"),
          pf("baseCharacterName", "Base character name", "metadata", "Sample MU3 Character"),
          pf("nameForCommonModel", "Common model name", "metadata", "Common Model"),
          pf("isCommonModel", "Common model", "metadata", "true"),
          pf("nickName", "Nickname", "text", "Sample Title"),
          pf("ipName", "IP / school", "text", "Sample School"),
          pf("skillName", "Skill name", "text", "Attack Boost"),
          pf("skillText", "Skill description", "multiline", "Boosts printed attack and limit break indicators."),
          pf("serialId", "Serial ID", "text", "U000-0000-0000"),
          pf("qrPayload", "QR payload", "multiline", ""),
          pf("cardNo", "Card number", "text", "No. 100001"),
          pf("maxAttack", "Max attack", "number", "312"),
          pf("levelParams", "Level parameters", "text", "100,160,190,220,250,280,300,310,312,340"),
          pf("ownCount", "Own count", "number", "3"),
          pf("awaken", "Awaken state", "number", "1"),
          pf("rareType", "Rarity", "number", "2"),
          pf("attribute", "Attribute", "number", "0"),
          pf("holo", "Holographic print", "bool", "true"),
          pf("sign", "Signed card", "metadata", "false"),
          pf("hideAttrRarity", "Hide attribute and rarity", "bool", "false"),
          pf("hideAttackLimit", "Hide attack limit", "bool", "false"),
          pf("hideSkill", "Hide skill", "bool", "false"),
          pf("hideGrade", "Hide grade", "bool", "false"),
          pf("hideFrame", "Hide frame", "bool", "false"),
          pf("hideName", "Hide names", "bool", "false"),
          pf("hideAwaken", "Hide awaken", "bool", "false"),
          pf("hideUserName", "Hide user name", "bool", "false"),
          pf("hideQRCode", "Hide QR code", "bool", "false"),
          pf("hideCardNo", "Hide card number", "metadata", "false"),
        ],
      },
    ],
    stats: {
      chuCards: 1,
      maiCards: 0,
      maiCardTypes: 1,
      maiCardCharas: 0,
      mu3AssetCards: 0,
      mu3XmlRecords: 1,
      pngAssets: 2,
      unityBundles: 0,
      unityBundleBytes: 0,
    },
    warnings: [],
  };
}

function pf(key: string, label: string, fieldType: PrintFieldType, value: string): PrintField {
  return { key, label, fieldType, value };
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
