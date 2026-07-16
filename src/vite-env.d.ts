/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CARD_MANIFEST_URL?: string;
  /** songdb worker base URL (workers/songdb-sync); unset = jsDelivr fallback. */
  readonly VITE_SONGDB_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
