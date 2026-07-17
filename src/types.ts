export type PrintFieldType = "text" | "multiline" | "number" | "bool" | "select" | "metadata";

export type PrintFieldOption = {
  value: string;
  label: string;
};

export type PrintField = {
  key: string;
  label: string;
  fieldType: PrintFieldType;
  value: string;
  options?: PrintFieldOption[];
};

export type AssetLayer = {
  key: string;
  label: string;
  path: string;
};

export type CardGame = "CHU" | "MAI" | "MU3";

export type CardRecord = {
  id: string;
  game: CardGame;
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
  sourceXml?: string;
  editableFields: string[];
  printFields: PrintField[];
  editedPrintFields?: string[];
};

export type ScanStats = {
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

export type ScanResult = {
  packageRoot: string;
  streamingAssets: string;
  cards: CardRecord[];
  stats: ScanStats;
  warnings: string[];
};

export type OnlineManifestShardInfo = {
  key: string;
  game: string;
  href: string;
  cardCount: number;
};

export type OnlineManifestIndex = {
  packageRoot: string;
  streamingAssets: string;
  stats: ScanStats;
  warnings: string[];
  totalCards: number;
  shards: OnlineManifestShardInfo[];
};

export type OnlineManifestShard = {
  key: string;
  game: string;
  cards: CardRecord[];
};

export type PrintFieldValue = string | boolean;
export type CardEdits = Record<string, PrintFieldValue>;

export type LoadedImageDataUrl = {
  path: string;
  dataUrl: string;
};
export type LoadedAssetDataUrls = {
  signature: string;
  urls: Record<string, string>;
};
export type QrSource = string | { data: Uint8ClampedArray; mode: "byte" }[];
export type ViewMode = "2d" | "3d";
export type DeploymentMode = "private" | "public";
export type Bounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};
export type OfficialFontKey = "kaku40" | "maru32" | "kaku16" | "maru16";

export type UnityGlyph = {
  index: number;
  uv: [number, number, number, number];
  vert: [number, number, number, number];
  advance: number;
};

export type UnityFontMetrics = {
  name: string;
  lineSpacing: number;
  characterSpacing: number;
  texture: string;
  width: number;
  height: number;
  chars: Record<string, UnityGlyph>;
};

export type TmpGlyph = {
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

export type TmpFontMetrics = {
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
