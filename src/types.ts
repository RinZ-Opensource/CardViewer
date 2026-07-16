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

type CardGame = "CHU" | "MAI" | "MU3";

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

export type ScanResult = {
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

export type ViewMode = "2d" | "3d";
