use base64::{engine::general_purpose, Engine};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    fs,
    hash::{Hash, Hasher},
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock, RwLock},
    time::UNIX_EPOCH,
};

const UNITY_EXTRACT_SCRIPT: &str = include_str!("../../scripts/extract_unity_image.py");
const UNITY_BUNDLE_EXTRACT_SCRIPT: &str = include_str!("../../scripts/extract_unity_bundle.py");
const THUMBNAIL_SCRIPT: &str = include_str!("../../scripts/generate_thumbnails.py");
const MAI_COMPOSITE_SCRIPT: &str =
    include_str!("../../scripts/generate_mai_composite_thumbnails.py");
const MAI_STATIC_NOT_FOUND_MAP_ID: i32 = 3;
const MU3_PRINT_AWAKEN_LEVEL0: &str = "1";
const HOLO_ENABLED: bool = true;
const ONLINE_THUMBNAIL_MAX_WIDTH: u32 = 192;
const ONLINE_THUMBNAIL_MAX_HEIGHT: u32 = 256;
const ONLINE_THUMBNAIL_QUALITY: u8 = 72;
// Full-size display art (card base / character layers / small variants) is
// transcoded to lossy WebP; mask/holo layers go lossless to keep their alpha
// stencil and foil colour exact. method=6 = slowest/best compression (offline).
const ONLINE_IMAGE_WEBP_QUALITY: u8 = 88;
const ONLINE_IMAGE_WEBP_METHOD: u8 = 6;
// Decoded image data URLs are cached for the process lifetime. Bound the cache
// by a byte budget (LRU) so a long session browsing thousands of cards can't
// grow memory without limit.
const IMAGE_DATA_URL_CACHE_MAX_BYTES: usize = 256 * 1024 * 1024;
static IMAGE_DATA_URL_CACHE: OnceLock<Mutex<ImageDataUrlCache>> = OnceLock::new();

// Canonicalized roots from the most recent successful UI scan. Replacing this
// capability on each scan keeps the IPC image reader confined to the package
// currently selected by the user and blocks directory-traversal reads.
static ALLOWED_CONTENT_ROOTS: OnceLock<RwLock<HashSet<PathBuf>>> = OnceLock::new();
// UI scans receive their sequence number when the backend call starts. A slow
// older scan is therefore unable to restore its roots after a newer request.
static LATEST_UI_SCAN_REQUEST: OnceLock<Mutex<u64>> = OnceLock::new();

/// Byte-budgeted LRU cache keyed by file path. The least-recently-used entry is
/// evicted first once the total size of cached data URLs exceeds the budget.
struct ImageDataUrlCache {
    map: HashMap<String, String>,
    order: VecDeque<String>,
    bytes: usize,
    max_bytes: usize,
}

impl ImageDataUrlCache {
    fn new(max_bytes: usize) -> Self {
        Self {
            map: HashMap::new(),
            order: VecDeque::new(),
            bytes: 0,
            max_bytes,
        }
    }

    fn get(&mut self, key: &str) -> Option<String> {
        let value = self.map.get(key)?.clone();
        if let Some(pos) = self.order.iter().position(|k| k == key) {
            if let Some(k) = self.order.remove(pos) {
                self.order.push_back(k);
            }
        }
        Some(value)
    }

    fn insert(&mut self, key: String, value: String) {
        if let Some(old) = self.map.insert(key.clone(), value.clone()) {
            self.bytes = self.bytes.saturating_sub(old.len());
            if let Some(pos) = self.order.iter().position(|k| k == &key) {
                self.order.remove(pos);
            }
        }
        self.bytes += value.len();
        self.order.push_back(key);
        while self.bytes > self.max_bytes && self.order.len() > 1 {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(removed) = self.map.remove(&oldest) {
                self.bytes = self.bytes.saturating_sub(removed.len());
            }
        }
    }

    fn clear(&mut self) {
        self.map.clear();
        self.order.clear();
        self.bytes = 0;
    }
}

mod archive;
mod asset_format;
mod config;
mod fsutil;
mod types;
mod xmlutil;

use archive::{archive_path, path_from_archive_path, write_cmpack_archive};
use asset_format::{
    classify_export_asset, detect_image_mime, image_export_file_name, is_image_extension,
    is_lossless_webp_layer, is_unity_asset_bundle, read_file_header, thumbnail_file_name,
    webp_export_file_name, ExportAssetKind,
};
use config::*;
use fsutil::{find_named_files, path_string, resolve_sibling, same_path, walk_files};
pub use types::{
    AssetLayer, CardRecord, MobilePackResult, OnlineExportResult, PrintField, PrintOption,
    ScanResult, ScanStats,
};
use xmlutil::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobilePackManifest {
    schema_version: u32,
    pack_format: String,
    created_at: String,
    source: MobilePackSource,
    resource_policy: MobileResourcePolicy,
    stats: ScanStats,
    cards_manifest: String,
    index_manifest: String,
    asset_index: String,
    integrity_manifest: String,
    asset_count: usize,
    raw_file_count: usize,
    bundle_count: usize,
    bundle_object_count: usize,
    games: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobilePackSource {
    package_root: String,
    streaming_assets: String,
    content_roots: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileResourcePolicy {
    no_generated_placeholder_art: bool,
    unity_asset_bundles_converted_to_png: bool,
    raw_official_data_included: bool,
    print_and_network_are_stubbed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileIntegrityManifest {
    algorithm: String,
    files: Vec<MobileIntegrityFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileIntegrityFile {
    path: String,
    size: u64,
    sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileAssetIndex {
    schema_version: u32,
    bundles: Vec<MobileBundleIndexEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileBundleIndexEntry {
    source_path: String,
    group: String,
    bundle_dir: String,
    metadata_path: String,
    primary_path: String,
    primary_name: String,
    primary_path_id: String,
    object_count: usize,
    objects: Vec<MobileBundleObject>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileBundleObject {
    name: String,
    object_type: String,
    path_id: String,
    width: u32,
    height: u32,
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtractedUnityBundleManifest {
    primary_name: String,
    primary_path_id: String,
    object_count: usize,
    objects: Vec<ExtractedUnityObject>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtractedUnityObject {
    name: Option<String>,
    #[serde(rename = "type")]
    object_type: Option<String>,
    path_id: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    file: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OnlineManifestIndex<'a> {
    package_root: &'a str,
    streaming_assets: &'a str,
    stats: &'a ScanStats,
    warnings: &'a [String],
    total_cards: usize,
    shards: Vec<OnlineManifestShardInfo>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OnlineManifestShardInfo {
    key: String,
    game: String,
    href: String,
    card_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OnlineManifestShard<'a> {
    key: &'a str,
    game: &'a str,
    cards: Vec<&'a CardRecord>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThumbnailJob {
    source: String,
    output: String,
    max_width: u32,
    max_height: u32,
    quality: u8,
}

struct ThumbnailPlan {
    source_url: String,
    thumbnail_url: String,
    output_path: PathBuf,
    job: Option<ThumbnailJob>,
}

#[derive(Clone, Debug, Serialize)]
struct UnityExtractJob {
    source: String,
    output: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageTranscodeJob {
    source: String,
    output: String,
    quality: u8,
    method: u8,
    lossless: bool,
    // Full-image transcode never downscales (resize stays false); the thumbnail
    // path keeps using ThumbnailJob, which the script resizes by default.
    resize: bool,
}

#[derive(Clone, Debug)]
struct MaiCardTypeInfo {
    id: Option<i32>,
    title: String,
    kind: String,
    effect_text: String,
    param_id: Option<i32>,
    map_bonus: String,
    extend_bit: Option<i32>,
}

#[derive(Clone, Debug)]
struct MaiCharaInfo {
    name: String,
    unique_id: Option<i32>,
    map_id: Option<i32>,
}

#[derive(Clone, Debug)]
struct MaiCharaPackInfo {
    name: String,
    chara_ids: Vec<i32>,
}

#[derive(Clone, Debug)]
struct Mu3SkillInfo {
    name: String,
    text: String,
    category: String,
}

#[derive(Clone, Debug)]
struct PackedFile {
    path: String,
    bytes: Vec<u8>,
}

#[derive(Clone, Debug)]
struct VfsPackEntry {
    entry_type: i32,
    name_offset: usize,
    name_length: usize,
    data_size: usize,
    data_offset: usize,
}

struct OnlineAssetExporter {
    output_root: PathBuf,
    public_base_url: String,
    unity_extract_script_path: PathBuf,
    thumbnail_script_path: PathBuf,
    force: bool,
    asset_urls: HashMap<String, String>,
    url_output_paths: HashMap<String, PathBuf>,
    asset_output_paths: HashSet<String>,
    asset_count: usize,
    reused_asset_count: usize,
    skipped_asset_count: usize,
    pruned_asset_count: usize,
    thumbnail_count: usize,
    reused_thumbnail_count: usize,
    skipped_thumbnail_count: usize,
    unity_jobs: Vec<UnityExtractJob>,
    image_jobs: Vec<ImageTranscodeJob>,
    // Unity-extracted PNGs that feed a transcode job and are deleted afterwards.
    image_intermediates: Vec<PathBuf>,
    warnings: Vec<String>,
}

struct MobileAssetExporter {
    staging_root: PathBuf,
    unity_extract_script_path: PathBuf,
    unity_bundle_extract_script_path: PathBuf,
    force: bool,
    content_roots: Vec<PathBuf>,
    asset_urls: HashMap<String, String>,
    asset_output_paths: HashMap<String, PathBuf>,
    bundle_index: Vec<MobileBundleIndexEntry>,
    asset_count: usize,
    reused_asset_count: usize,
    skipped_asset_count: usize,
    bundle_count: usize,
    bundle_object_count: usize,
    warnings: Vec<String>,
}

pub fn scan_package_impl(package_root: String) -> Result<ScanResult, String> {
    let request_id = begin_ui_scan_request()?;
    scan_package(package_root, Some(request_id))
}

fn scan_package(
    package_root: String,
    image_access_request: Option<u64>,
) -> Result<ScanResult, String> {
    let root = PathBuf::from(package_root.trim());
    if !root.exists() {
        return Err(format!("Package path does not exist: {}", root.display()));
    }

    let streaming = root.join("CardMaker_Data").join("StreamingAssets");
    if !streaming.exists() {
        return Err(format!(
            "Missing CardMaker_Data\\StreamingAssets under {}",
            root.display()
        ));
    }

    let mut warnings = Vec::new();
    let mut stats = ScanStats::default();
    let mut cards = Vec::new();
    let content_roots = discover_content_roots(&root, &streaming, &mut warnings);

    for content_root in &content_roots {
        scan_chu_cards(content_root, &mut cards, &mut stats, &mut warnings);
    }

    let mut mai_card_types = HashMap::new();
    for content_root in &content_roots {
        mai_card_types.extend(scan_mai_card_types(
            content_root,
            &mut cards,
            &mut stats,
            &mut warnings,
        ));
    }
    let mut mai_charas = HashMap::new();
    for content_root in &content_roots {
        mai_charas.extend(scan_mai_card_charas(
            content_root,
            &mut stats,
            &mut warnings,
        ));
    }
    let mut mai_chara_packs = HashMap::new();
    for content_root in &content_roots {
        mai_chara_packs.extend(scan_mai_chara_packs(content_root, &mut warnings));
    }
    let mai_card_sources = MaiCardScanSources {
        content_roots: &content_roots,
        card_types: &mai_card_types,
        charas: &mai_charas,
        chara_packs: &mai_chara_packs,
    };
    for content_root in &content_roots {
        scan_mai_cards(
            content_root,
            &mai_card_sources,
            &mut cards,
            &mut stats,
            &mut warnings,
        );
    }

    let mu3_skill_map = scan_mu3_skill_map(&content_roots, &mut warnings);
    let mut mu3_xml_ids = HashSet::new();
    for content_root in &content_roots {
        mu3_xml_ids.extend(scan_mu3_xml(
            content_root,
            &mu3_skill_map,
            &mut cards,
            &mut stats,
            &mut warnings,
        ));
    }
    scan_mu3_assets(&streaming, &mu3_xml_ids, &mut cards, &mut stats);
    scan_asset_counts(&streaming, &mut stats);

    dedupe_cards_keep_last(&mut cards);

    cards.sort_by(|a, b| {
        a.game
            .cmp(&b.game)
            .then(a.record_type.cmp(&b.record_type))
            .then(a.data_name.cmp(&b.data_name))
    });

    if let Some(request_id) = image_access_request {
        let mut image_roots = content_roots.clone();
        image_roots.push(root.clone());
        activate_allowed_content_roots(&image_roots, request_id)?;
    }

    Ok(ScanResult {
        package_root: path_string(&root),
        streaming_assets: path_string(&streaming),
        cards,
        stats,
        warnings,
    })
}

fn discover_content_roots(
    package_root: &Path,
    streaming: &Path,
    warnings: &mut Vec<String>,
) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut seen = HashSet::new();
    push_content_root(&mut roots, &mut seen, streaming);

    // Extra update content roots are purely configuration-driven via
    // CARDVIEWER_EXTRA_CONTENT_ROOTS (a platform path list). No machine-specific
    // path is assumed by default.
    if let Some(raw) = std::env::var_os("CARDVIEWER_EXTRA_CONTENT_ROOTS") {
        for path in std::env::split_paths(&raw) {
            discover_content_root_candidate(&path, &mut roots, &mut seen);
        }
    }

    let package_update_root = package_root.join("downloads");
    discover_content_root_candidate(&package_update_root, &mut roots, &mut seen);

    if roots.len() > 1 {
        warnings.push(format!(
            "Using {} additional update content roots",
            roots.len() - 1
        ));
    }

    roots
}

fn discover_content_root_candidate(
    path: &Path,
    roots: &mut Vec<PathBuf>,
    seen: &mut HashSet<String>,
) {
    if is_content_root(path) {
        push_content_root(roots, seen, path);
        return;
    }

    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    let mut children = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            entry
                .file_type()
                .ok()
                .filter(|file_type| file_type.is_dir())
                .map(|_| path)
        })
        .collect::<Vec<_>>();
    children.sort();

    for child in children {
        if is_content_root(&child) {
            push_content_root(roots, seen, &child);
        }
    }
}

fn push_content_root(roots: &mut Vec<PathBuf>, seen: &mut HashSet<String>, path: &Path) {
    let key = path
        .canonicalize()
        .map(|path| path_string(&path))
        .unwrap_or_else(|_| path_string(path));
    if seen.insert(key) {
        roots.push(path.to_path_buf());
    }
}

fn is_content_root(path: &Path) -> bool {
    path.join("MAI").exists()
        || path.join("MU3").exists()
        || path.join("CHU").exists()
        || path.join("assets_mai").exists()
        || path.join("assets_mu3").exists()
}

fn dedupe_cards_keep_last(cards: &mut Vec<CardRecord>) {
    let mut seen = HashSet::new();
    let mut deduped = Vec::with_capacity(cards.len());
    for card in cards.drain(..).rev() {
        let key = format!("{}|{}|{}", card.game, card.record_type, card.id);
        if seen.insert(key) {
            deduped.push(card);
        }
    }
    deduped.reverse();
    *cards = deduped;
}

pub fn read_image_data_url_impl(path: String) -> Result<String, String> {
    let requested_path = PathBuf::from(path);
    let path = requested_path.canonicalize().map_err(|err| {
        format!(
            "Failed to resolve image path {}: {err}",
            requested_path.display()
        )
    })?;
    // Keep a shared capability guard through cache access and file I/O. A scan
    // switch takes the write side of this lock, so it cannot finish revoking a
    // package while an already-authorized read is still returning or caching it.
    let allowed = allowed_content_roots()
        .read()
        .map_err(|err| format!("Failed to lock image root permissions: {err}"))?;
    if !allowed.iter().any(|root| path.starts_with(root)) {
        return Err(format!(
            "Refusing to read image outside the scanned content roots: {}",
            requested_path.display()
        ));
    }
    let cache_key = path_string(&path);
    if let Some(cached) = image_data_url_cache()
        .lock()
        .map_err(|err| format!("Failed to lock image cache: {err}"))?
        .get(&cache_key)
    {
        return Ok(cached);
    }

    let ext_mime = match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "" => None,
        other => return Err(format!("Unsupported image extension: {}", other)),
    };

    let mime = match ext_mime {
        Some(mime) => mime,
        None => {
            let mut file =
                fs::File::open(&path).map_err(|err| format!("Failed to inspect image: {err}"))?;
            let mut header = [0u8; 16];
            let len = file
                .read(&mut header)
                .map_err(|err| format!("Failed to inspect image: {err}"))?;
            if let Some(mime) = detect_image_mime(&header[..len]) {
                mime
            } else if is_unity_asset_bundle(&header[..len]) {
                let extracted = extract_unity_image_to_cache(&path)?;
                let bytes =
                    fs::read(&extracted).map_err(|err| format!("Failed to read image: {err}"))?;
                let encoded = general_purpose::STANDARD.encode(bytes);
                let data_url = format!("data:image/png;base64,{encoded}");
                remember_image_data_url(cache_key, &data_url)?;
                return Ok(data_url);
            } else {
                return Err(format!("Unsupported image payload: {}", path.display()));
            }
        }
    };

    let bytes = fs::read(&path).map_err(|err| format!("Failed to read image: {err}"))?;
    let encoded = general_purpose::STANDARD.encode(bytes);
    let data_url = format!("data:{mime};base64,{encoded}");
    remember_image_data_url(cache_key, &data_url)?;
    Ok(data_url)
}

fn image_data_url_cache() -> &'static Mutex<ImageDataUrlCache> {
    IMAGE_DATA_URL_CACHE
        .get_or_init(|| Mutex::new(ImageDataUrlCache::new(IMAGE_DATA_URL_CACHE_MAX_BYTES)))
}

fn allowed_content_roots() -> &'static RwLock<HashSet<PathBuf>> {
    ALLOWED_CONTENT_ROOTS.get_or_init(|| RwLock::new(HashSet::new()))
}

fn latest_ui_scan_request() -> &'static Mutex<u64> {
    LATEST_UI_SCAN_REQUEST.get_or_init(|| Mutex::new(0))
}

fn begin_ui_scan_request() -> Result<u64, String> {
    let mut latest = latest_ui_scan_request()
        .lock()
        .map_err(|err| format!("Failed to lock UI scan sequence: {err}"))?;
    *latest = latest
        .checked_add(1)
        .ok_or_else(|| "UI scan sequence exhausted".to_string())?;
    Ok(*latest)
}

/// Replaces the current scan's image-read capability with canonicalized roots.
/// The write guard waits for prior reads to finish; the scan sequence prevents
/// a slower older request from restoring roots after a newer request started.
fn activate_allowed_content_roots(roots: &[PathBuf], request_id: u64) -> Result<bool, String> {
    let mut replacement = HashSet::new();
    for root in roots {
        let canonical = root
            .canonicalize()
            .map_err(|err| format!("Failed to authorize image root {}: {err}", root.display()))?;
        replacement.insert(canonical);
    }

    let mut allowed = allowed_content_roots()
        .write()
        .map_err(|err| format!("Failed to lock image root permissions: {err}"))?;
    let latest = latest_ui_scan_request()
        .lock()
        .map_err(|err| format!("Failed to lock UI scan sequence: {err}"))?;
    if *latest != request_id {
        return Ok(false);
    }
    let mut cache = image_data_url_cache()
        .lock()
        .map_err(|err| format!("Failed to lock image cache: {err}"))?;

    // Publish roots and clear revoked bytes while both locks are held, so an
    // error cannot leave a half-applied capability transition.
    *allowed = replacement;
    cache.clear();
    Ok(true)
}

fn remember_image_data_url(cache_key: String, data_url: &str) -> Result<(), String> {
    image_data_url_cache()
        .lock()
        .map_err(|err| format!("Failed to lock image cache: {err}"))?
        .insert(cache_key, data_url.to_string());
    Ok(())
}

pub fn save_edit_session_impl(package_root: String, edits_json: String) -> Result<String, String> {
    let parsed: serde_json::Value =
        serde_json::from_str(&edits_json).map_err(|err| format!("Invalid edit JSON: {err}"))?;

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    package_root.hash(&mut hasher);
    let package_hash = hasher.finish();

    let app_data = std::env::var_os("CARDVIEWER_EDIT_DIR")
        .or_else(|| std::env::var_os("APPDATA"))
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let dir = app_data.join("ConfigArc").join("CardViewer");
    fs::create_dir_all(&dir).map_err(|err| format!("Failed to create edit directory: {err}"))?;

    let path = dir.join(format!("edits-{package_hash:016x}.json"));
    let payload = serde_json::json!({
        "packageRoot": package_root,
        "savedAt": chrono_like_timestamp(),
        "edits": parsed
    });
    let body = serde_json::to_string_pretty(&payload)
        .map_err(|err| format!("Failed to serialize edit session: {err}"))?;
    fs::write(&path, body).map_err(|err| format!("Failed to write edit session: {err}"))?;
    Ok(path_string(&path))
}

pub fn export_online_package_impl(
    package_root: String,
    output_root: String,
    public_base_url: String,
) -> Result<OnlineExportResult, String> {
    export_online_package_with_progress_impl(package_root, output_root, public_base_url, |_| {})
}

pub fn export_online_package_with_progress_impl<F>(
    package_root: String,
    output_root: String,
    public_base_url: String,
    mut progress: F,
) -> Result<OnlineExportResult, String>
where
    F: FnMut(String),
{
    progress(format!("Scanning package: {}", package_root.trim()));
    let mut scan = scan_package(package_root, None)?;
    progress(format!(
        "Scan complete: {} records, {} MAI cards, {} MU3 asset cards, {} Unity bundles",
        scan.cards.len(),
        scan.stats.mai_cards,
        scan.stats.mu3_asset_cards,
        scan.stats.unity_bundles
    ));
    let output_root = resolve_export_output_root(output_root);
    let public_base_url = normalize_public_base_url(&public_base_url);

    fs::create_dir_all(&output_root)
        .map_err(|err| format!("Failed to create export directory: {err}"))?;
    progress(format!("Export directory: {}", output_root.display()));

    let mut exporter = OnlineAssetExporter::new(output_root.clone(), public_base_url.clone());
    let package_root = PathBuf::from(&scan.package_root);
    let streaming = PathBuf::from(&scan.streaming_assets);
    let mut content_warnings = Vec::new();
    let content_roots = discover_content_roots(&package_root, &streaming, &mut content_warnings);
    exporter.warnings.extend(content_warnings);
    progress(format!(
        "Discovered {} content roots for asset export",
        content_roots.len()
    ));
    if export_all_assets_enabled() {
        progress(
            "Exporting all MAI/MU3 assets because CARDVIEWER_EXPORT_ALL_ASSETS is enabled"
                .to_string(),
        );
        exporter.export_all_game_assets(&content_roots, &mut progress);
    } else {
        progress("Exporting only assets referenced by card rendering".to_string());
        exporter.export_referenced_dynamic_assets(&scan, &content_roots, &mut progress);
    }
    rewrite_scan_result_for_online(&mut scan, &mut exporter);
    // Flush after rewrite too: rewriting card image/thumbnail/layer paths also
    // queues asset extractions (e.g. the MAI "_s" thumbnail bundles). Thumbnail
    // generation below reads these files, so they must exist first.
    exporter.flush_unity_jobs(&mut progress);
    // Transcode every exported image (plus the just-extracted Unity PNGs) to
    // WebP before thumbnails are generated, since thumbnails are derived from
    // these outputs.
    exporter.flush_image_jobs(&mut progress);
    generate_online_thumbnails(&mut scan, &mut exporter, &mut progress);
    scan.streaming_assets = format!("{public_base_url}/assets");
    if export_prune_enabled() {
        progress("Pruning generated assets not referenced by the current manifest".to_string());
        exporter.prune_unreferenced_assets();
        progress(format!(
            "Pruned {} unreferenced generated asset files",
            exporter.pruned_asset_count
        ));
    }
    scan.warnings.extend(exporter.warnings.clone());
    progress(format!(
        "Asset export complete: {} new, {} reused, {} skipped, {} thumbnails, {} reused thumbnails, {} skipped thumbnails, {} pruned",
        exporter.asset_count,
        exporter.reused_asset_count,
        exporter.skipped_asset_count,
        exporter.thumbnail_count,
        exporter.reused_thumbnail_count,
        exporter.skipped_thumbnail_count,
        exporter.pruned_asset_count
    ));

    let manifest_path = output_root.join("cards.json");
    progress(format!("Writing manifest: {}", manifest_path.display()));
    let manifest = serde_json::to_string(&scan)
        .map_err(|err| format!("Failed to serialize online manifest: {err}"))?;
    fs::write(&manifest_path, manifest)
        .map_err(|err| format!("Failed to write online manifest: {err}"))?;
    let (index_manifest_path, shard_count) =
        write_online_manifest_shards(&scan, &output_root, &mut progress)?;
    // Replace MAI card thumbnails with base+character composites. Runs after the
    // manifests are written and rewrites the MAI thumbnailPath entries in place,
    // so re-running export no longer clobbers them back to the bare "_s" base.
    let has_mai_card_records = scan
        .cards
        .iter()
        .any(|card| card.game == "MAI" && card.record_type == "Card");
    composite_mai_thumbnails(
        has_mai_card_records,
        &output_root,
        &public_base_url,
        &mut progress,
    )?;
    progress("Online export finished".to_string());

    Ok(OnlineExportResult {
        package_root: scan.package_root,
        output_root: path_string(&output_root),
        manifest_path: path_string(&manifest_path),
        index_manifest_path: path_string(&index_manifest_path),
        public_manifest_url: format!("{public_base_url}/cards.json"),
        public_index_manifest_url: format!("{public_base_url}/cards.index.json"),
        public_base_url,
        card_count: scan.cards.len(),
        shard_count,
        asset_count: exporter.asset_count,
        reused_asset_count: exporter.reused_asset_count,
        skipped_asset_count: exporter.skipped_asset_count,
        pruned_asset_count: exporter.pruned_asset_count,
        thumbnail_count: exporter.thumbnail_count,
        reused_thumbnail_count: exporter.reused_thumbnail_count,
        skipped_thumbnail_count: exporter.skipped_thumbnail_count,
        warnings: scan.warnings,
    })
}

pub fn export_mobile_pack_impl(
    package_root: String,
    output_path: String,
) -> Result<MobilePackResult, String> {
    export_mobile_pack_with_progress_impl(package_root, output_path, |_| {})
}

pub fn export_mobile_pack_with_progress_impl<F>(
    package_root: String,
    output_path: String,
    mut progress: F,
) -> Result<MobilePackResult, String>
where
    F: FnMut(String),
{
    progress(format!(
        "Scanning package for mobile pack: {}",
        package_root.trim()
    ));
    let mut scan = scan_package(package_root, None)?;
    let package_root = PathBuf::from(&scan.package_root);
    let streaming = PathBuf::from(&scan.streaming_assets);
    let mut content_warnings = Vec::new();
    let content_roots = discover_content_roots(&package_root, &streaming, &mut content_warnings);
    scan.warnings.extend(content_warnings);
    if let Some(filters) = mobile_card_id_filter() {
        let before = scan.cards.len();
        filter_mobile_cards_by_id(&mut scan.cards, &filters);
        let after = scan.cards.len();
        progress(format!(
            "Filtered mobile card export by CARDVIEWER_MOBILE_CARD_IDS: {before} -> {after}"
        ));
        scan.warnings.push(format!(
            "Diagnostic mobile card id filter was applied: {}",
            mobile_card_id_filter_label(&filters)
        ));
    }
    if let Some(limit) = mobile_card_limit_per_game() {
        let before = scan.cards.len();
        limit_mobile_cards_per_game(&mut scan.cards, limit);
        let after = scan.cards.len();
        progress(format!(
            "Limited mobile card export to {limit} record(s) per game for diagnostics: {before} -> {after}"
        ));
        scan.warnings.push(format!(
            "Diagnostic mobile card limit was applied: {limit} record(s) per game"
        ));
    }

    let output_path = resolve_mobile_pack_output_path(output_path);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create mobile pack directory: {err}"))?;
    }
    let staging_root = resolve_mobile_staging_root(&output_path);
    fs::create_dir_all(&staging_root)
        .map_err(|err| format!("Failed to create mobile staging directory: {err}"))?;
    progress(format!(
        "Mobile pack staging root: {}",
        staging_root.display()
    ));

    let mut exporter = MobileAssetExporter::new(staging_root.clone(), content_roots.clone());
    if mobile_referenced_only_enabled() {
        progress("Exporting only card-referenced mobile assets".to_string());
    } else {
        progress("Exporting all known official image assets for mobile use".to_string());
        exporter.export_all_known_assets(&mut progress);
    }
    rewrite_scan_result_for_mobile(&mut scan, &mut exporter);
    scan.warnings.extend(exporter.warnings.clone());
    scan.streaming_assets = "assets".to_string();

    let raw_file_count = if mobile_skip_raw_enabled() {
        scan.warnings
            .push("Diagnostic mobile raw data copy was skipped".to_string());
        progress("Skipping raw official data copy for diagnostic mobile export".to_string());
        0
    } else {
        let count =
            copy_mobile_raw_official_data(&content_roots, &staging_root, &mut scan.warnings)?;
        progress(format!("Copied {count} raw official data files"));
        count
    };

    let cards_manifest_path = staging_root.join("cards.json");
    progress(format!(
        "Writing mobile card manifest: {}",
        cards_manifest_path.display()
    ));
    let cards_body = serde_json::to_string_pretty(&scan)
        .map_err(|err| format!("Failed to serialize mobile card manifest: {err}"))?;
    fs::write(&cards_manifest_path, cards_body)
        .map_err(|err| format!("Failed to write mobile card manifest: {err}"))?;
    let (index_manifest_path, shard_count) =
        write_online_manifest_shards(&scan, &staging_root, &mut progress)?;
    let asset_index_path = staging_root.join("assets").join("index.json");
    write_mobile_asset_index(&exporter, &asset_index_path)?;
    progress(format!(
        "Writing mobile asset index: {} ({} bundles, {} objects)",
        asset_index_path.display(),
        exporter.bundle_count,
        exporter.bundle_object_count
    ));

    let manifest_path = staging_root.join("manifest.json");
    let manifest = MobilePackManifest {
        schema_version: 1,
        pack_format: "cmpack-ustar-v1".to_string(),
        created_at: chrono_like_timestamp(),
        source: MobilePackSource {
            package_root: scan.package_root.clone(),
            streaming_assets: path_string(&streaming),
            content_roots: content_roots.iter().map(|path| path_string(path)).collect(),
        },
        resource_policy: MobileResourcePolicy {
            no_generated_placeholder_art: true,
            unity_asset_bundles_converted_to_png: true,
            raw_official_data_included: true,
            print_and_network_are_stubbed: true,
        },
        stats: scan.stats.clone(),
        cards_manifest: "cards.json".to_string(),
        index_manifest: "cards.index.json".to_string(),
        asset_index: "assets/index.json".to_string(),
        integrity_manifest: "integrity/files.json".to_string(),
        asset_count: exporter.asset_count + exporter.reused_asset_count,
        raw_file_count,
        bundle_count: exporter.bundle_count,
        bundle_object_count: exporter.bundle_object_count,
        games: vec!["CHU".to_string(), "MAI".to_string(), "MU3".to_string()],
        warnings: scan.warnings.clone(),
    };
    progress(format!(
        "Writing mobile pack manifest: {}",
        manifest_path.display()
    ));
    let manifest_body = serde_json::to_string_pretty(&manifest)
        .map_err(|err| format!("Failed to serialize mobile pack manifest: {err}"))?;
    fs::write(&manifest_path, manifest_body)
        .map_err(|err| format!("Failed to write mobile pack manifest: {err}"))?;

    let integrity_path = write_mobile_integrity_manifest(&staging_root)?;
    progress(format!(
        "Writing mobile pack archive: {}",
        output_path.display()
    ));
    let archive_files = walk_files(&staging_root)
        .into_iter()
        .filter(|file| !is_mobile_internal_tool_file(&staging_root, file))
        .collect();
    let (pack_file_count, pack_size_bytes) =
        write_cmpack_archive(&staging_root, &output_path, archive_files)?;
    progress("Mobile pack export finished".to_string());

    Ok(MobilePackResult {
        package_root: scan.package_root,
        output_path: path_string(&output_path),
        staging_root: path_string(&staging_root),
        manifest_path: path_string(&manifest_path),
        cards_manifest_path: path_string(&cards_manifest_path),
        index_manifest_path: path_string(&index_manifest_path),
        card_count: scan.cards.len(),
        shard_count,
        asset_count: exporter.asset_count,
        reused_asset_count: exporter.reused_asset_count,
        skipped_asset_count: exporter.skipped_asset_count,
        raw_file_count,
        bundle_count: exporter.bundle_count,
        bundle_object_count: exporter.bundle_object_count,
        pack_file_count,
        pack_size_bytes,
        warnings: {
            let mut warnings = scan.warnings;
            warnings.push(format!(
                "Integrity manifest written to {}",
                integrity_path.display()
            ));
            warnings
        },
    })
}

impl OnlineAssetExporter {
    fn new(output_root: PathBuf, public_base_url: String) -> Self {
        Self {
            unity_extract_script_path: output_root.join(".tools").join("extract_unity_image.py"),
            thumbnail_script_path: output_root.join(".tools").join("generate_thumbnails.py"),
            force: export_force_enabled(),
            output_root,
            public_base_url,
            asset_urls: HashMap::new(),
            url_output_paths: HashMap::new(),
            asset_output_paths: HashSet::new(),
            asset_count: 0,
            reused_asset_count: 0,
            skipped_asset_count: 0,
            pruned_asset_count: 0,
            thumbnail_count: 0,
            reused_thumbnail_count: 0,
            skipped_thumbnail_count: 0,
            unity_jobs: Vec::new(),
            image_jobs: Vec::new(),
            image_intermediates: Vec::new(),
            warnings: Vec::new(),
        }
    }

    fn export_all_game_assets<F>(&mut self, content_roots: &[PathBuf], progress: &mut F)
    where
        F: FnMut(String),
    {
        let mut seen_dirs = HashSet::new();
        for (game, asset_dir, group) in [("MAI", "assets_mai", "mai"), ("MU3", "assets_mu3", "mu3")]
        {
            for content_root in content_roots.iter().rev() {
                for dir in content_asset_dirs(content_root, game, asset_dir) {
                    if !dir.exists() {
                        continue;
                    }
                    let key = dir
                        .canonicalize()
                        .map(|path| path_string(&path))
                        .unwrap_or_else(|_| path_string(&dir));
                    if !seen_dirs.insert(key) {
                        continue;
                    }

                    let mut files = walk_files(&dir);
                    files.sort();
                    let total = files.len();
                    progress(format!(
                        "Exporting {} assets from {} ({} files)",
                        group,
                        dir.display(),
                        total
                    ));
                    for (index, file) in files.into_iter().enumerate() {
                        let name = file
                            .file_name()
                            .and_then(|name| name.to_str())
                            .unwrap_or_default();
                        progress(format!("[{} {}/{}] {}", group, index + 1, total, name));
                        let before_exported = self.asset_count;
                        let before_reused = self.reused_asset_count;
                        let before_skipped = self.skipped_asset_count;
                        let source = path_string(&file);
                        self.export_asset_url(&source, group);
                        if self.asset_count > before_exported {
                            progress(format!(
                                "  exported {} new asset(s), total new={}",
                                self.asset_count - before_exported,
                                self.asset_count
                            ));
                        } else if self.reused_asset_count > before_reused {
                            progress(format!(
                                "  reused existing asset, total reused={}",
                                self.reused_asset_count
                            ));
                        } else if self.skipped_asset_count > before_skipped {
                            let detail = self
                                .warnings
                                .last()
                                .cloned()
                                .unwrap_or_else(|| "unknown skip reason".to_string());
                            progress(format!("  skipped: {detail}"));
                        }
                    }
                }
            }
        }
    }

    fn export_referenced_dynamic_assets<F>(
        &mut self,
        scan: &ScanResult,
        content_roots: &[PathBuf],
        progress: &mut F,
    ) where
        F: FnMut(String),
    {
        let mut seen_sources = HashSet::new();
        let mut requested = 0usize;
        for card in scan.cards.iter().filter(|card| card.game == "MAI") {
            let preferred_root = print_field_value(card, "maiAssetRoot")
                .filter(|root| !root.trim().is_empty() && !is_web_asset_path(root))
                .map(PathBuf::from);

            let type_id = print_field_i32(card, "typeId");
            let default_map_id = print_field_i32(card, "mapId");
            if let (Some(type_id), Some(map_id)) = (type_id, default_map_id) {
                requested += self.export_mai_stem(
                    &format!("ui_cardbase_{type_id:07}_{map_id:06}"),
                    preferred_root.as_deref(),
                    content_roots,
                    &mut seen_sources,
                ) as usize;
            }

            let mut chara_ids = HashSet::new();
            if let Some(chara_id) = print_field_i32(card, "charaId") {
                chara_ids.insert(chara_id);
            }
            for (chara_id, map_id) in parse_mai_chara_choice_ids(
                print_field_value(card, "charaChoices").unwrap_or_default(),
            ) {
                chara_ids.insert(chara_id);
                if let Some(type_id) = type_id {
                    requested += self.export_mai_stem(
                        &format!("ui_cardbase_{type_id:07}_{map_id:06}"),
                        preferred_root.as_deref(),
                        content_roots,
                        &mut seen_sources,
                    ) as usize;
                }
            }

            for chara_id in chara_ids {
                requested += self.export_mai_stem(
                    &format!("ui_cardchara_{chara_id:06}"),
                    preferred_root.as_deref(),
                    content_roots,
                    &mut seen_sources,
                ) as usize;
                requested += self.export_mai_stem(
                    &format!("ui_cardcharamask_{chara_id:06}"),
                    preferred_root.as_deref(),
                    content_roots,
                    &mut seen_sources,
                ) as usize;
            }

            if requested > 0 && requested.is_multiple_of(100) {
                progress(format!(
                    "  queued {requested} referenced MAI dynamic assets"
                ));
            }
        }
        progress(format!(
            "Referenced dynamic asset pass queued {requested} existing MAI assets"
        ));
    }

    fn export_mai_stem(
        &mut self,
        stem: &str,
        preferred_root: Option<&Path>,
        content_roots: &[PathBuf],
        seen_sources: &mut HashSet<String>,
    ) -> bool {
        let Some(path) = resolve_mai_export_asset(stem, preferred_root, content_roots) else {
            return false;
        };
        if !path.exists() {
            return false;
        }
        let source = path_string(&path);
        if !seen_sources.insert(source.clone()) {
            return false;
        }
        self.export_asset_url(&source, "mai").is_some()
    }

    fn export_asset_url(&mut self, source: &str, group: &str) -> Option<String> {
        let source = source.trim();
        if source.is_empty() {
            return None;
        }
        if is_web_asset_path(source) {
            return Some(source.to_string());
        }

        let source_path = PathBuf::from(source);
        let cache_key = path_string(&source_path);
        if let Some(url) = self.asset_urls.get(&cache_key) {
            return Some(url.clone());
        }

        let output_name = match webp_export_file_name(&source_path) {
            Ok(name) => name,
            Err(err) => {
                self.skipped_asset_count += 1;
                self.warnings
                    .push(format!("Skipped asset {}: {err}", source_path.display()));
                return None;
            }
        };
        let output_path = self
            .output_root
            .join("assets")
            .join(group)
            .join(&output_name);
        let url = format!(
            "{}/assets/{}/{}",
            self.public_base_url,
            group,
            percent_encode_path_segment(&output_name)
        );

        if output_path.exists() && !self.force {
            self.asset_urls.insert(cache_key, url.clone());
            self.remember_url_output_path(&url, &output_path);
            self.remember_asset_output_path(&output_path);
            self.reused_asset_count += 1;
            return Some(url);
        }

        if let Some(parent) = output_path.parent() {
            if let Err(err) = fs::create_dir_all(parent) {
                self.skipped_asset_count += 1;
                self.warnings
                    .push(format!("Skipped asset {}: {err}", source_path.display()));
                return None;
            }
        }

        // Everything is transcoded to WebP. Plain images are queued directly;
        // Unity bundles are first extracted to an intermediate PNG (batched, so
        // Python/UnityPy is spawned once for the whole run) which then feeds the
        // same transcode queue. Both queues are flushed once, after this pass.
        let lossless = is_lossless_webp_layer(&source_path);
        match classify_export_asset(&source_path) {
            Ok(ExportAssetKind::Image) => {
                self.image_jobs.push(ImageTranscodeJob {
                    source: path_string(&source_path),
                    output: path_string(&output_path),
                    quality: ONLINE_IMAGE_WEBP_QUALITY,
                    method: ONLINE_IMAGE_WEBP_METHOD,
                    lossless,
                    resize: false,
                });
                // Counted in flush_image_jobs once transcoding actually runs.
            }
            Ok(ExportAssetKind::Unity) => {
                let intermediate = output_path.with_extension("png");
                self.unity_jobs.push(UnityExtractJob {
                    source: path_string(&source_path),
                    output: path_string(&intermediate),
                });
                self.image_jobs.push(ImageTranscodeJob {
                    source: path_string(&intermediate),
                    output: path_string(&output_path),
                    quality: ONLINE_IMAGE_WEBP_QUALITY,
                    method: ONLINE_IMAGE_WEBP_METHOD,
                    lossless,
                    resize: false,
                });
                self.image_intermediates.push(intermediate);
                // Counted in flush_image_jobs once transcoding actually runs.
            }
            Ok(ExportAssetKind::Unsupported) | Err(_) => {
                self.skipped_asset_count += 1;
                self.warnings.push(format!(
                    "Skipped asset {}: unsupported image payload",
                    source_path.display()
                ));
                return None;
            }
        }

        self.asset_urls.insert(cache_key, url.clone());
        self.remember_url_output_path(&url, &output_path);
        self.remember_asset_output_path(&output_path);
        Some(url)
    }

    fn flush_unity_jobs<F>(&mut self, progress: &mut F)
    where
        F: FnMut(String),
    {
        if self.unity_jobs.is_empty() {
            return;
        }
        let all_jobs = std::mem::take(&mut self.unity_jobs);
        let total = all_jobs.len();

        if let Err(err) = write_extract_script(&self.unity_extract_script_path) {
            self.warnings.push(err);
        }
        let tools_dir = self.output_root.join(".tools");
        if let Err(err) = fs::create_dir_all(&tools_dir) {
            self.warnings
                .push(format!("Failed to create Unity job directory: {err}"));
        }
        let unitypy_path = find_unitypy_path()
            .map(|path| path_string(&path))
            .unwrap_or_default();
        let worker_count = unity_worker_count().min(total).max(1);
        let chunk_size = total.div_ceil(worker_count);
        progress(format!(
            "Extracting {total} Unity image assets across {worker_count} worker process(es)"
        ));

        // UnityPy is not reliable inside a spawned process pool, so run several
        // serial extractor processes in parallel instead: each imports UnityPy
        // once and handles a contiguous slice of the jobs.
        let script_path = &self.unity_extract_script_path;
        let chunk_warnings: Vec<String> = all_jobs
            .par_chunks(chunk_size)
            .enumerate()
            .flat_map(|(index, chunk)| {
                let mut warnings = Vec::new();
                let jobs_path = tools_dir.join(format!("unity_extract_jobs_{index}.json"));
                let body = match serde_json::to_string(chunk) {
                    Ok(body) => body,
                    Err(err) => {
                        warnings.push(format!("Failed to serialize Unity jobs: {err}"));
                        return warnings;
                    }
                };
                if let Err(err) = fs::write(&jobs_path, body) {
                    warnings.push(format!("Failed to write Unity jobs: {err}"));
                    return warnings;
                }
                let mut ran = false;
                let mut errors = Vec::new();
                for candidate in python_candidates() {
                    let mut command = Command::new(&candidate);
                    command.arg(script_path).arg("--jobs").arg(&jobs_path);
                    if !unitypy_path.is_empty() {
                        command.env("PYTHONPATH", &unitypy_path);
                    }
                    match command.status() {
                        Ok(status) if status.success() => {
                            ran = true;
                            break;
                        }
                        Ok(status) => errors.push(format!("{candidate}: exited with {status}")),
                        Err(err) => errors.push(format!("{candidate}: {err}")),
                    }
                }
                if !ran {
                    warnings.push(format!(
                        "Failed to extract Unity images (worker {index}). {}",
                        errors.join(" | ")
                    ));
                }
                warnings
            })
            .collect();
        self.warnings.extend(chunk_warnings);

        // Unity outputs are intermediate PNGs that feed the WebP transcode pass,
        // so the final asset is counted in flush_image_jobs, not here. Warn on a
        // missing extraction; its transcode job will then be marked skipped.
        for job in &all_jobs {
            if !Path::new(&job.output).exists() {
                self.warnings.push(format!(
                    "Skipped asset {}: Unity extraction produced no image",
                    job.source
                ));
            }
        }
    }

    fn flush_image_jobs<F>(&mut self, progress: &mut F)
    where
        F: FnMut(String),
    {
        let jobs = std::mem::take(&mut self.image_jobs);
        let intermediates = std::mem::take(&mut self.image_intermediates);
        if jobs.is_empty() {
            return;
        }
        let total = jobs.len();
        progress(format!("Transcoding {total} images to WebP"));

        let jobs_path = self
            .output_root
            .join(".tools")
            .join("image_transcode_jobs.json");
        if let Some(parent) = jobs_path.parent() {
            if let Err(err) = fs::create_dir_all(parent) {
                self.warnings
                    .push(format!("Failed to create image job directory: {err}"));
            }
        }
        if let Err(err) = write_thumbnail_script(&self.thumbnail_script_path) {
            self.warnings.push(err);
        }
        match serde_json::to_string(&jobs) {
            Ok(body) => {
                if let Err(err) = fs::write(&jobs_path, body) {
                    self.warnings
                        .push(format!("Failed to write image jobs: {err}"));
                } else {
                    let mut ran = false;
                    let mut errors = Vec::new();
                    for candidate in python_candidates() {
                        match Command::new(&candidate)
                            .arg(&self.thumbnail_script_path)
                            .arg(&jobs_path)
                            .status()
                        {
                            Ok(status) if status.success() => {
                                ran = true;
                                break;
                            }
                            Ok(status) => errors.push(format!("{candidate}: exited with {status}")),
                            Err(err) => errors.push(format!("{candidate}: {err}")),
                        }
                    }
                    if !ran {
                        self.warnings.push(format!(
                            "Failed to transcode images to WebP. {}",
                            errors.join(" | ")
                        ));
                    }
                }
            }
            Err(err) => self
                .warnings
                .push(format!("Failed to serialize image jobs: {err}")),
        }

        // Reconcile counts against what actually landed on disk.
        for job in &jobs {
            if Path::new(&job.output).exists() {
                self.asset_count += 1;
            } else {
                self.skipped_asset_count += 1;
                self.warnings.push(format!(
                    "Skipped asset {}: WebP transcode produced no output",
                    job.source
                ));
            }
        }

        // Drop the Unity-extracted PNG intermediates now that they are transcoded.
        for png in &intermediates {
            let _ = fs::remove_file(png);
        }
    }

    fn remember_url_output_path(&mut self, url: &str, output_path: &Path) {
        self.url_output_paths
            .insert(url.to_string(), output_path.to_path_buf());
    }

    fn remember_asset_output_path(&mut self, output_path: &Path) {
        self.asset_output_paths.insert(path_string(output_path));
    }

    fn prepare_thumbnail_url(&mut self, source_url: &str, group: &str) -> Option<ThumbnailPlan> {
        let source_path = self.url_output_paths.get(source_url)?.clone();
        if !source_path.exists() {
            return None;
        }
        let source_name = source_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("thumbnail");
        let output_name = thumbnail_file_name(source_name);
        let output_path = self
            .output_root
            .join("assets")
            .join("thumbs")
            .join(group)
            .join(&output_name);
        let url = format!(
            "{}/assets/thumbs/{}/{}",
            self.public_base_url,
            group,
            percent_encode_path_segment(&output_name)
        );
        self.remember_asset_output_path(&output_path);

        if output_path.exists() && !self.force {
            self.reused_thumbnail_count += 1;
            return Some(ThumbnailPlan {
                source_url: source_url.to_string(),
                thumbnail_url: url,
                output_path,
                job: None,
            });
        }

        Some(ThumbnailPlan {
            source_url: source_url.to_string(),
            thumbnail_url: url,
            output_path: output_path.clone(),
            job: Some(ThumbnailJob {
                source: path_string(&source_path),
                output: path_string(&output_path),
                max_width: ONLINE_THUMBNAIL_MAX_WIDTH,
                max_height: ONLINE_THUMBNAIL_MAX_HEIGHT,
                quality: ONLINE_THUMBNAIL_QUALITY,
            }),
        })
    }

    fn generate_thumbnail_jobs(&mut self, jobs: &[ThumbnailJob]) -> bool {
        if jobs.is_empty() {
            return true;
        }

        let jobs_path = self.output_root.join(".tools").join("thumbnail_jobs.json");
        if let Some(parent) = jobs_path.parent() {
            if let Err(err) = fs::create_dir_all(parent) {
                self.warnings
                    .push(format!("Failed to create thumbnail job directory: {err}"));
                return false;
            }
        }
        let body = match serde_json::to_string(jobs) {
            Ok(body) => body,
            Err(err) => {
                self.warnings
                    .push(format!("Failed to serialize thumbnail jobs: {err}"));
                return false;
            }
        };
        if let Err(err) = fs::write(&jobs_path, body) {
            self.warnings
                .push(format!("Failed to write thumbnail jobs: {err}"));
            return false;
        }
        if let Err(err) = write_thumbnail_script(&self.thumbnail_script_path) {
            self.warnings.push(err);
            return false;
        }

        let mut errors = Vec::new();
        for candidate in python_candidates() {
            let status = Command::new(&candidate)
                .arg(&self.thumbnail_script_path)
                .arg(&jobs_path)
                .status();
            match status {
                Ok(status) if status.success() => return true,
                Ok(status) => errors.push(format!("{candidate}: exited with {status}")),
                Err(err) => errors.push(format!("{candidate}: {err}")),
            }
        }

        self.warnings.push(format!(
            "Failed to generate online thumbnails. {}",
            errors.join(" | ")
        ));
        false
    }

    fn prune_unreferenced_assets(&mut self) {
        let assets_root = self.output_root.join("assets");
        if !assets_root.exists() {
            return;
        }

        for file in walk_files(&assets_root) {
            let key = path_string(&file);
            if self.asset_output_paths.contains(&key) {
                continue;
            }
            match fs::remove_file(&file) {
                Ok(()) => {
                    self.pruned_asset_count += 1;
                }
                Err(err) => self.warnings.push(format!(
                    "Failed to prune unreferenced asset {}: {err}",
                    file.display()
                )),
            }
        }
    }
}

impl MobileAssetExporter {
    fn new(staging_root: PathBuf, content_roots: Vec<PathBuf>) -> Self {
        Self {
            unity_extract_script_path: staging_root.join(".tools").join("extract_unity_image.py"),
            unity_bundle_extract_script_path: staging_root
                .join(".tools")
                .join("extract_unity_bundle.py"),
            force: export_force_enabled(),
            staging_root,
            content_roots,
            asset_urls: HashMap::new(),
            asset_output_paths: HashMap::new(),
            bundle_index: Vec::new(),
            asset_count: 0,
            reused_asset_count: 0,
            skipped_asset_count: 0,
            bundle_count: 0,
            bundle_object_count: 0,
            warnings: Vec::new(),
        }
    }

    fn export_all_known_assets<F>(&mut self, progress: &mut F)
    where
        F: FnMut(String),
    {
        let mut seen_sources = HashSet::new();
        let roots = self.content_roots.clone();
        for (game, asset_dir, group) in [
            ("Common", "assets_com", "common"),
            ("MAI", "assets_mai", "mai"),
            ("MU3", "assets_mu3", "mu3"),
        ] {
            for content_root in roots.iter().rev() {
                for dir in content_asset_dirs(content_root, game, asset_dir) {
                    if !dir.exists() {
                        continue;
                    }
                    let mut files = walk_files(&dir);
                    files.sort();
                    progress(format!(
                        "Exporting mobile {} assets from {} ({} files)",
                        group,
                        dir.display(),
                        files.len()
                    ));
                    for file in files {
                        let source = path_string(&file);
                        if seen_sources.insert(source.clone()) {
                            self.export_asset_url(&source, group);
                        }
                    }
                }
            }
        }

        for content_root in roots.iter().rev() {
            let chu_root = content_root.join("CHU");
            if !chu_root.exists() {
                continue;
            }
            let mut files = walk_files(&chu_root)
                .into_iter()
                .filter(|path| mobile_should_export_direct_image(path))
                .collect::<Vec<_>>();
            files.sort();
            progress(format!(
                "Exporting mobile CHU direct images from {} ({} files)",
                chu_root.display(),
                files.len()
            ));
            for file in files {
                let source = path_string(&file);
                if seen_sources.insert(source.clone()) {
                    self.export_asset_url(&source, "chu");
                }
            }
        }
    }

    fn export_asset_url(&mut self, source: &str, group: &str) -> Option<String> {
        let source = source.trim();
        if source.is_empty() {
            return None;
        }
        if is_web_asset_path(source) {
            return Some(source.to_string());
        }

        let source_path = PathBuf::from(source);
        let cache_key = path_string(&source_path);
        if let Some(url) = self.asset_urls.get(&cache_key) {
            return Some(url.clone());
        }
        let header = match read_file_header(&source_path, 16) {
            Ok(header) => header,
            Err(err) => {
                self.skipped_asset_count += 1;
                self.warnings
                    .push(format!("Skipped asset {}: {err}", source_path.display()));
                return None;
            }
        };

        let relative_path =
            match mobile_asset_relative_path(&source_path, group, &self.content_roots) {
                Ok(path) => path,
                Err(err) => {
                    self.skipped_asset_count += 1;
                    self.warnings
                        .push(format!("Skipped asset {}: {err}", source_path.display()));
                    return None;
                }
            };
        let output_path = self
            .staging_root
            .join(path_from_archive_path(&relative_path));
        let is_unity_bundle = is_unity_asset_bundle(&header);

        if output_path.exists() && !self.force {
            if is_unity_bundle {
                match self.remember_mobile_bundle(&source_path, group, &relative_path) {
                    Ok(()) => {}
                    Err(err) => {
                        self.skipped_asset_count += 1;
                        self.warnings.push(format!(
                            "Skipped bundle metadata {}: {err}",
                            source_path.display()
                        ));
                        return None;
                    }
                }
            }
            self.asset_urls.insert(cache_key, relative_path.clone());
            self.asset_output_paths
                .insert(relative_path.clone(), output_path);
            self.reused_asset_count += 1;
            return Some(relative_path);
        }

        let export_result = if is_unity_bundle {
            self.export_mobile_bundle(&source_path, group, &relative_path)
        } else {
            export_image_asset(&source_path, &output_path, &self.unity_extract_script_path)
        };
        if let Err(err) = export_result {
            self.skipped_asset_count += 1;
            self.warnings
                .push(format!("Skipped asset {}: {err}", source_path.display()));
            return None;
        }

        self.asset_urls.insert(cache_key, relative_path.clone());
        self.asset_output_paths
            .insert(relative_path.clone(), output_path);
        self.asset_count += 1;
        Some(relative_path)
    }

    fn export_mobile_bundle(
        &mut self,
        source_path: &Path,
        group: &str,
        primary_relative_path: &str,
    ) -> Result<(), String> {
        let bundle_dir = mobile_bundle_dir_relative_path(source_path, group, &self.content_roots)?;
        let bundle_output_dir = self.staging_root.join(path_from_archive_path(&bundle_dir));
        let primary_output_path = self
            .staging_root
            .join(path_from_archive_path(primary_relative_path));
        extract_unity_bundle_to_mobile_dir(
            source_path,
            &bundle_output_dir,
            &primary_output_path,
            primary_relative_path,
            &self.unity_bundle_extract_script_path,
        )?;
        self.remember_mobile_bundle(source_path, group, primary_relative_path)
    }

    fn remember_mobile_bundle(
        &mut self,
        source_path: &Path,
        group: &str,
        primary_relative_path: &str,
    ) -> Result<(), String> {
        let bundle_dir = mobile_bundle_dir_relative_path(source_path, group, &self.content_roots)?;
        let metadata_path = path_from_archive_path(&bundle_dir).join("metadata.json");
        let metadata_output_path = self.staging_root.join(&metadata_path);
        let metadata_body = fs::read_to_string(&metadata_output_path).map_err(|err| {
            format!(
                "Failed to read Unity bundle metadata {}: {err}",
                metadata_output_path.display()
            )
        })?;
        let metadata: ExtractedUnityBundleManifest = serde_json::from_str(&metadata_body)
            .map_err(|err| format!("Failed to parse Unity bundle metadata: {err}"))?;
        let metadata_archive_path = archive_path(&metadata_path)?;
        let mut objects = Vec::new();
        for object in metadata.objects {
            let Some(file) = object.file else {
                continue;
            };
            let object_path = format!("{}/{}", bundle_dir, file.replace('\\', "/"));
            objects.push(MobileBundleObject {
                name: object.name.unwrap_or_default(),
                object_type: object.object_type.unwrap_or_default(),
                path_id: object.path_id.unwrap_or_default(),
                width: object.width.unwrap_or_default(),
                height: object.height.unwrap_or_default(),
                path: object_path,
            });
        }

        let object_count = objects.len();
        self.bundle_index.push(MobileBundleIndexEntry {
            source_path: path_string(source_path),
            group: group.to_string(),
            bundle_dir,
            metadata_path: metadata_archive_path,
            primary_path: primary_relative_path.to_string(),
            primary_name: metadata.primary_name,
            primary_path_id: metadata.primary_path_id,
            object_count: metadata.object_count.max(object_count),
            objects,
        });
        self.bundle_count += 1;
        self.bundle_object_count += object_count;
        Ok(())
    }
}

fn write_online_manifest_shards<F>(
    scan: &ScanResult,
    output_root: &Path,
    progress: &mut F,
) -> Result<(PathBuf, usize), String>
where
    F: FnMut(String),
{
    let mut grouped: BTreeMap<String, Vec<&CardRecord>> = BTreeMap::new();
    for card in &scan.cards {
        grouped.entry(card.game.clone()).or_default().push(card);
    }

    let mut shards = Vec::new();
    for (game, cards) in &grouped {
        let key = game.to_ascii_lowercase();
        let href = format!("cards.{key}.json");
        let path = output_root.join(&href);
        let shard = OnlineManifestShard {
            key: &key,
            game,
            cards: cards.clone(),
        };
        progress(format!(
            "Writing manifest shard: {} ({} records)",
            path.display(),
            cards.len()
        ));
        let body = serde_json::to_string(&shard)
            .map_err(|err| format!("Failed to serialize online manifest shard: {err}"))?;
        fs::write(&path, body)
            .map_err(|err| format!("Failed to write online manifest shard: {err}"))?;
        shards.push(OnlineManifestShardInfo {
            key,
            game: game.clone(),
            href,
            card_count: cards.len(),
        });
    }

    let index = OnlineManifestIndex {
        package_root: &scan.package_root,
        streaming_assets: &scan.streaming_assets,
        stats: &scan.stats,
        warnings: &scan.warnings,
        total_cards: scan.cards.len(),
        shards,
    };
    let index_path = output_root.join("cards.index.json");
    progress(format!("Writing manifest index: {}", index_path.display()));
    let body = serde_json::to_string_pretty(&index)
        .map_err(|err| format!("Failed to serialize online manifest index: {err}"))?;
    fs::write(&index_path, body)
        .map_err(|err| format!("Failed to write online manifest index: {err}"))?;

    Ok((index_path, index.shards.len()))
}

fn generate_online_thumbnails<F>(
    scan: &mut ScanResult,
    exporter: &mut OnlineAssetExporter,
    progress: &mut F,
) where
    F: FnMut(String),
{
    let mut plans_by_source = HashMap::new();
    for card in &scan.cards {
        // MAI cards get base+character composite thumbnails afterwards, so skip
        // the redundant "_s" thumbnail pass for them here.
        if card.game == "MAI" && card.record_type == "Card" {
            continue;
        }
        let Some(source_url) = card
            .thumbnail_path
            .as_ref()
            .or(card.image_path.as_ref())
            .filter(|path| !path.trim().is_empty())
        else {
            continue;
        };
        if plans_by_source.contains_key(source_url) {
            continue;
        }
        let group = game_asset_group(&card.game);
        if let Some(plan) = exporter.prepare_thumbnail_url(source_url, &group) {
            plans_by_source.insert(source_url.clone(), plan);
        }
    }

    let jobs = plans_by_source
        .values()
        .filter_map(|plan| plan.job.clone())
        .collect::<Vec<_>>();
    progress(format!(
        "Generating online thumbnails: {} new, {} reused",
        jobs.len(),
        exporter.reused_thumbnail_count
    ));

    let generated = exporter.generate_thumbnail_jobs(&jobs);
    let mut thumbnail_urls = HashMap::new();
    for plan in plans_by_source.values() {
        if plan.output_path.exists() {
            thumbnail_urls.insert(plan.source_url.clone(), plan.thumbnail_url.clone());
            if plan.job.is_some() {
                exporter.thumbnail_count += 1;
            }
        } else if plan.job.is_some() && generated {
            exporter.skipped_thumbnail_count += 1;
            exporter.warnings.push(format!(
                "Thumbnail output was not created for {}",
                plan.source_url
            ));
        } else if plan.job.is_some() {
            exporter.skipped_thumbnail_count += 1;
        }
    }

    for card in &mut scan.cards {
        let Some(source_url) = card
            .thumbnail_path
            .as_ref()
            .or(card.image_path.as_ref())
            .cloned()
        else {
            continue;
        };
        if let Some(thumbnail_url) = thumbnail_urls.get(&source_url) {
            card.thumbnail_path = Some(thumbnail_url.clone());
        }
    }
}

fn filter_mobile_cards_by_id(cards: &mut Vec<CardRecord>, filters: &HashSet<(String, String)>) {
    cards.retain(|card| {
        filters.contains(&(card.game.to_ascii_uppercase(), card.id.clone()))
            || filters.contains(&(String::new(), card.id.clone()))
    });
}

fn limit_mobile_cards_per_game(cards: &mut Vec<CardRecord>, limit: usize) {
    let mut counts: HashMap<String, usize> = HashMap::new();
    let mut selected_indices = HashSet::new();

    for prefer_renderable in [true, false] {
        for (index, card) in cards.iter().enumerate() {
            if selected_indices.contains(&index) {
                continue;
            }
            if prefer_renderable && !is_mobile_render_candidate(card) {
                continue;
            }
            let count = counts.entry(card.game.clone()).or_default();
            if *count >= limit {
                continue;
            }
            *count += 1;
            selected_indices.insert(index);
        }
    }

    let mut index = 0usize;
    cards.retain(|_| {
        let keep = selected_indices.contains(&index);
        index += 1;
        keep
    });
}

fn is_mobile_render_candidate(card: &CardRecord) -> bool {
    card.record_type == "Card" && (card.image_path.is_some() || !card.asset_layers.is_empty())
}

fn resolve_mobile_pack_output_path(value: String) -> PathBuf {
    let trimmed = value.trim();
    if !trimmed.is_empty() {
        return PathBuf::from(trimmed);
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("private-assets")
        .join("official")
        .join("mobile")
        .join("CardMakerMobilePack.cmpack")
}

fn resolve_mobile_staging_root(output_path: &Path) -> PathBuf {
    let parent = output_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = output_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("CardMakerMobilePack.cmpack");
    parent
        .join(".cmpack-staging")
        .join(format!("{stem}-{}", unix_timestamp_secs()))
}

fn mobile_asset_relative_path(
    source_path: &Path,
    group: &str,
    content_roots: &[PathBuf],
) -> Result<String, String> {
    let mut relative = None;
    for root in content_roots {
        if let Ok(path) = source_path.strip_prefix(root) {
            relative = Some(path.to_path_buf());
            break;
        }
    }
    let relative = relative.unwrap_or_else(|| {
        source_path
            .file_name()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("asset"))
    });
    let file_name = image_export_file_name(source_path)?;
    let mut archive = PathBuf::from("assets").join(group).join(relative);
    archive.set_file_name(file_name);
    archive_path(&archive)
}

fn mobile_bundle_dir_relative_path(
    source_path: &Path,
    group: &str,
    content_roots: &[PathBuf],
) -> Result<String, String> {
    let mut relative = None;
    for root in content_roots {
        if let Ok(path) = source_path.strip_prefix(root) {
            relative = Some(path.to_path_buf());
            break;
        }
    }
    let relative = relative.unwrap_or_else(|| {
        source_path
            .file_name()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("asset"))
    });
    let file_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "missing bundle file name".to_string())?;
    let mut archive = PathBuf::from("assets").join(group).join(relative);
    archive.set_file_name(format!("{file_name}.bundle"));
    archive_path(&archive)
}

fn write_mobile_asset_index(
    exporter: &MobileAssetExporter,
    asset_index_path: &Path,
) -> Result<(), String> {
    if let Some(parent) = asset_index_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create mobile asset index directory: {err}"))?;
    }
    let index = MobileAssetIndex {
        schema_version: 1,
        bundles: exporter.bundle_index.clone(),
    };
    let body = serde_json::to_string_pretty(&index)
        .map_err(|err| format!("Failed to serialize mobile asset index: {err}"))?;
    fs::write(asset_index_path, body)
        .map_err(|err| format!("Failed to write mobile asset index: {err}"))
}

fn mobile_should_export_direct_image(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    is_image_extension(&ext)
}

fn copy_mobile_raw_official_data(
    content_roots: &[PathBuf],
    staging_root: &Path,
    warnings: &mut Vec<String>,
) -> Result<usize, String> {
    let mut copied = 0usize;
    let mut seen = HashSet::new();
    for (index, content_root) in content_roots.iter().enumerate() {
        if !content_root.exists() {
            continue;
        }
        for source in walk_files(content_root) {
            if should_skip_mobile_raw_file(&source) {
                continue;
            }
            let Ok(relative) = source.strip_prefix(content_root) else {
                continue;
            };
            let output = staging_root
                .join("raw")
                .join(format!("root_{index:02}"))
                .join(relative);
            let key = archive_path(
                &PathBuf::from("raw")
                    .join(format!("root_{index:02}"))
                    .join(relative),
            )?;
            if !seen.insert(key) {
                continue;
            }
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent).map_err(|err| {
                    format!(
                        "Failed to create raw data directory {}: {err}",
                        parent.display()
                    )
                })?;
            }
            match fs::copy(&source, &output) {
                Ok(_) => copied += 1,
                Err(err) => warnings.push(format!(
                    "Failed to copy raw official data {}: {err}",
                    source.display()
                )),
            }
        }
    }
    Ok(copied)
}

fn should_skip_mobile_raw_file(path: &Path) -> bool {
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("meta"))
        .unwrap_or(false)
    {
        return true;
    }
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let is_asset_set = matches!(
        file_name.as_str(),
        "assets_mai.bytes" | "assets_mu3.bytes" | "assets_com.bytes" | "assets_chu.bytes"
    );
    path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy().to_ascii_lowercase();
        if matches!(name.as_str(), "assets_mai" | "assets_mu3" | "assets_com") {
            return !is_asset_set;
        }
        name == "__macosx"
    })
}

fn write_mobile_integrity_manifest(staging_root: &Path) -> Result<PathBuf, String> {
    let integrity_dir = staging_root.join("integrity");
    fs::create_dir_all(&integrity_dir)
        .map_err(|err| format!("Failed to create integrity directory: {err}"))?;
    let integrity_path = integrity_dir.join("files.json");
    let mut files = Vec::new();
    for file in walk_files(staging_root) {
        if file == integrity_path {
            continue;
        }
        if is_mobile_internal_tool_file(staging_root, &file) {
            continue;
        }
        let relative = archive_path(file.strip_prefix(staging_root).unwrap_or(&file))?;
        let bytes = fs::read(&file).map_err(|err| {
            format!(
                "Failed to read file for integrity {}: {err}",
                file.display()
            )
        })?;
        let sha256 = hex_bytes(&Sha256::digest(&bytes));
        files.push(MobileIntegrityFile {
            path: relative,
            size: bytes.len() as u64,
            sha256,
        });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let manifest = MobileIntegrityManifest {
        algorithm: "sha256".to_string(),
        files,
    };
    let body = serde_json::to_string_pretty(&manifest)
        .map_err(|err| format!("Failed to serialize integrity manifest: {err}"))?;
    fs::write(&integrity_path, body)
        .map_err(|err| format!("Failed to write integrity manifest: {err}"))?;
    Ok(integrity_path)
}

fn is_mobile_internal_tool_file(staging_root: &Path, file: &Path) -> bool {
    let relative = file.strip_prefix(staging_root).unwrap_or(file);
    relative.components().any(|component| {
        component
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(".tools")
    })
}

fn rewrite_scan_result_for_online(scan: &mut ScanResult, exporter: &mut OnlineAssetExporter) {
    for card in &mut scan.cards {
        let group = game_asset_group(&card.game);
        // The online manifest is public and never reads sourceXml; drop the
        // local build-machine path so it isn't leaked or shipped to clients.
        card.source_xml.clear();
        card.image_path = rewrite_optional_asset_path(card.image_path.take(), &group, exporter);
        card.thumbnail_path =
            rewrite_optional_asset_path(card.thumbnail_path.take(), &group, exporter);

        let mut layers = Vec::with_capacity(card.asset_layers.len());
        for mut layer in card.asset_layers.drain(..) {
            if let Some(url) = exporter.export_asset_url(&layer.path, &group) {
                layer.path = url;
                layers.push(layer);
            }
        }
        card.asset_layers = layers;

        if card.game == "MAI" {
            set_print_field_value(
                card,
                "maiAssetRoot",
                "MAI asset root",
                "metadata",
                format!("{}/assets/mai", exporter.public_base_url),
            );
        }
    }
}

fn rewrite_optional_asset_path(
    path: Option<String>,
    group: &str,
    exporter: &mut OnlineAssetExporter,
) -> Option<String> {
    path.and_then(|path| exporter.export_asset_url(&path, group))
}

fn rewrite_scan_result_for_mobile(scan: &mut ScanResult, exporter: &mut MobileAssetExporter) {
    for card in &mut scan.cards {
        let group = game_asset_group(&card.game);
        card.image_path =
            rewrite_optional_mobile_asset_path(card.image_path.take(), &group, exporter);
        card.thumbnail_path =
            rewrite_optional_mobile_asset_path(card.thumbnail_path.take(), &group, exporter);

        let mut layers = Vec::with_capacity(card.asset_layers.len());
        for mut layer in card.asset_layers.drain(..) {
            if let Some(path) = exporter.export_asset_url(&layer.path, &group) {
                layer.path = path;
                layers.push(layer);
            }
        }
        card.asset_layers = layers;

        if card.game == "MAI" {
            set_print_field_value(
                card,
                "maiAssetRoot",
                "MAI asset root",
                "metadata",
                "assets/mai",
            );
        }
    }
}

fn rewrite_optional_mobile_asset_path(
    path: Option<String>,
    group: &str,
    exporter: &mut MobileAssetExporter,
) -> Option<String> {
    path.and_then(|path| exporter.export_asset_url(&path, group))
}

fn set_print_field_value(
    card: &mut CardRecord,
    key: &str,
    label: &str,
    field_type: &str,
    value: impl Into<String>,
) {
    let value = value.into();
    if let Some(field) = card.print_fields.iter_mut().find(|field| field.key == key) {
        field.value = value;
    } else {
        card.print_fields
            .push(print_field(key, label, field_type, value));
    }
}

fn print_field_value<'a>(card: &'a CardRecord, key: &str) -> Option<&'a str> {
    card.print_fields
        .iter()
        .find(|field| field.key == key)
        .map(|field| field.value.trim())
}

fn print_field_i32(card: &CardRecord, key: &str) -> Option<i32> {
    print_field_value(card, key).and_then(|value| value.parse::<i32>().ok())
}

fn parse_mai_chara_choice_ids(value: &str) -> Vec<(i32, i32)> {
    value
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('|');
            let chara_id = parts.next()?.trim().parse::<i32>().ok()?;
            let map_id = parts.next()?.trim().parse::<i32>().ok()?;
            Some((chara_id, map_id))
        })
        .collect()
}

fn resolve_mai_export_asset(
    stem: &str,
    preferred_root: Option<&Path>,
    content_roots: &[PathBuf],
) -> Option<PathBuf> {
    if let Some(root) = preferred_root {
        let path = root.join(stem);
        if path.exists() {
            return Some(path);
        }
    }

    for content_root in content_roots.iter().rev() {
        for dir in content_asset_dirs(content_root, "MAI", "assets_mai") {
            let path = dir.join(stem);
            if path.exists() {
                return Some(path);
            }
        }
    }

    None
}

fn game_asset_group(game: &str) -> String {
    match game {
        "CHU" => "chu".to_string(),
        "MAI" => "mai".to_string(),
        "MU3" => "mu3".to_string(),
        other => other.to_ascii_lowercase(),
    }
}

fn export_image_asset(
    source_path: &Path,
    output_path: &Path,
    script_path: &Path,
) -> Result<(), String> {
    let header = read_file_header(source_path, 16)?;
    let lower_ext = source_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    fs::create_dir_all(
        output_path
            .parent()
            .ok_or_else(|| "missing output parent".to_string())?,
    )
    .map_err(|err| format!("Failed to create asset export directory: {err}"))?;

    if is_image_extension(&lower_ext) || detect_image_mime(&header).is_some() {
        fs::copy(source_path, output_path)
            .map_err(|err| format!("Failed to copy image asset: {err}"))?;
        return Ok(());
    }
    if is_unity_asset_bundle(&header) {
        extract_unity_image_to_path(source_path, output_path, script_path)?;
        return Ok(());
    }

    Err("unsupported image payload".to_string())
}

fn is_web_asset_path(path: &str) -> bool {
    path.starts_with('/')
        || path.starts_with("http://")
        || path.starts_with("https://")
        || path.starts_with("data:")
}

fn percent_encode_path_segment(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push('%');
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
    }
    encoded
}

fn scan_chu_cards(
    content_root: &Path,
    cards: &mut Vec<CardRecord>,
    stats: &mut ScanStats,
    warnings: &mut Vec<String>,
) {
    let xml_paths: Vec<PathBuf> = game_data_leaf_roots(content_root, "CHU", "card")
        .into_iter()
        .flat_map(|card_root| find_named_files(&card_root, "Card.xml"))
        .collect();
    // Read + parse XMLs in parallel; merge sequentially to preserve order.
    let results: Vec<Result<Option<CardRecord>, String>> = xml_paths
        .par_iter()
        .map(|xml_path| match fs::read_to_string(xml_path) {
            Ok(xml) => Ok(parse_chu_card(xml_path, &xml)),
            Err(err) => Err(format!("Failed to read {}: {err}", xml_path.display())),
        })
        .collect();
    for result in results {
        match result {
            Ok(Some(card)) => {
                stats.chu_cards += 1;
                cards.push(card);
            }
            Ok(None) => {}
            Err(warning) => warnings.push(warning),
        }
    }
}

fn scan_mai_card_types(
    content_root: &Path,
    cards: &mut Vec<CardRecord>,
    stats: &mut ScanStats,
    warnings: &mut Vec<String>,
) -> HashMap<i32, MaiCardTypeInfo> {
    let mut card_types = HashMap::new();

    for card_type_root in game_data_leaf_roots(content_root, "MAI", "cardType") {
        for xml_path in find_named_files(&card_type_root, "CardType.xml") {
            match fs::read_to_string(&xml_path) {
                Ok(xml) => {
                    if let Some(info) = parse_mai_card_type_info(&xml) {
                        if let Some(id) = info.id {
                            card_types.insert(id, info);
                        }
                    }
                    if let Some(card) = parse_mai_card_type(content_root, &xml_path, &xml) {
                        stats.mai_card_types += 1;
                        cards.push(card);
                    }
                }
                Err(err) => warnings.push(format!("Failed to read {}: {err}", xml_path.display())),
            }
        }
    }

    card_types
}

fn scan_mai_card_charas(
    content_root: &Path,
    stats: &mut ScanStats,
    warnings: &mut Vec<String>,
) -> HashMap<i32, MaiCharaInfo> {
    let mut charas = HashMap::new();

    for chara_root in game_data_leaf_roots(content_root, "MAI", "cardChara") {
        for xml_path in find_named_files(&chara_root, "CardChara.xml") {
            match fs::read_to_string(&xml_path) {
                Ok(xml) => {
                    if let Some((id, info)) = parse_mai_chara_info(&xml) {
                        stats.mai_card_charas += 1;
                        charas.insert(id, info);
                    }
                }
                Err(err) => warnings.push(format!("Failed to read {}: {err}", xml_path.display())),
            }
        }
    }

    charas
}

fn scan_mai_chara_packs(
    content_root: &Path,
    warnings: &mut Vec<String>,
) -> HashMap<i32, MaiCharaPackInfo> {
    let mut packs = HashMap::new();

    for pack_root in game_data_leaf_roots(content_root, "MAI", "cardCharaPack") {
        for xml_path in find_named_files(&pack_root, "CardCharaPack.xml") {
            match fs::read_to_string(&xml_path) {
                Ok(xml) => {
                    if let Some((id, pack)) = parse_mai_chara_pack_info(&xml) {
                        packs.insert(id, pack);
                    }
                }
                Err(err) => warnings.push(format!("Failed to read {}: {err}", xml_path.display())),
            }
        }
    }

    packs
}

struct MaiCardScanSources<'a> {
    content_roots: &'a [PathBuf],
    card_types: &'a HashMap<i32, MaiCardTypeInfo>,
    charas: &'a HashMap<i32, MaiCharaInfo>,
    chara_packs: &'a HashMap<i32, MaiCharaPackInfo>,
}

fn scan_mai_cards(
    content_root: &Path,
    sources: &MaiCardScanSources<'_>,
    cards: &mut Vec<CardRecord>,
    stats: &mut ScanStats,
    warnings: &mut Vec<String>,
) {
    let xml_paths: Vec<PathBuf> = game_data_leaf_roots(content_root, "MAI", "card")
        .into_iter()
        .flat_map(|card_root| find_named_files(&card_root, "Card.xml"))
        .collect();
    // Read + parse XMLs in parallel; merge sequentially to preserve order.
    let results: Vec<Result<Option<CardRecord>, String>> = xml_paths
        .par_iter()
        .map(|xml_path| match fs::read_to_string(xml_path) {
            Ok(xml) => Ok(parse_mai_card(
                xml_path,
                &xml,
                content_root,
                sources.content_roots,
                sources.card_types,
                sources.charas,
                sources.chara_packs,
            )),
            Err(err) => Err(format!("Failed to read {}: {err}", xml_path.display())),
        })
        .collect();
    for result in results {
        match result {
            Ok(Some(card)) => {
                stats.mai_cards += 1;
                cards.push(card);
            }
            Ok(None) => {}
            Err(warning) => warnings.push(warning),
        }
    }
}

fn scan_mu3_assets(
    streaming: &Path,
    xml_card_ids: &HashSet<String>,
    cards: &mut Vec<CardRecord>,
    stats: &mut ScanStats,
) {
    let asset_root = streaming.join("assets_mu3");
    if !asset_root.exists() {
        return;
    }

    for asset_path in walk_files(&asset_root) {
        let Some(file_name) = asset_path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(card_no) = mu3_card_asset_id(file_name) else {
            continue;
        };

        stats.mu3_asset_cards += 1;
        if xml_card_ids.contains(&card_no) {
            continue;
        }
        cards.push(parse_mu3_asset_card(&asset_path, &card_no));
    }
}

fn scan_mu3_skill_map(
    content_roots: &[PathBuf],
    warnings: &mut Vec<String>,
) -> HashMap<i32, Mu3SkillInfo> {
    let mut skill_map = HashMap::new();
    for content_root in content_roots {
        for skill_root in game_data_leaf_roots(content_root, "MU3", "skill") {
            for xml_path in find_named_files(&skill_root, "Skill.xml") {
                match fs::read_to_string(&xml_path) {
                    Ok(xml) => {
                        if let Some((skill_id, skill)) = parse_mu3_skill_xml(&xml) {
                            skill_map.insert(skill_id, skill);
                        }
                    }
                    Err(err) => {
                        warnings.push(format!("Failed to read {}: {err}", xml_path.display()))
                    }
                }
            }
        }

        for mu3_pack in game_data_pack_paths(content_root, "MU3") {
            if !mu3_pack.exists() {
                continue;
            }
            match read_vfs_pack_named_files(&mu3_pack, &["Skill.xml"]) {
                Ok(files) => {
                    for file in files {
                        let xml = String::from_utf8_lossy(&file.bytes);
                        if let Some((skill_id, skill)) = parse_mu3_skill_xml(&xml) {
                            skill_map.insert(skill_id, skill);
                        }
                    }
                }
                Err(err) => warnings.push(format!("Failed to read {}: {err}", mu3_pack.display())),
            }
        }
    }
    skill_map
}

fn scan_mu3_xml(
    content_root: &Path,
    skill_map: &HashMap<i32, Mu3SkillInfo>,
    cards: &mut Vec<CardRecord>,
    stats: &mut ScanStats,
    warnings: &mut Vec<String>,
) -> HashSet<String> {
    let mut parsed_ids = HashSet::new();

    for card_root in game_data_leaf_roots(content_root, "MU3", "card") {
        for xml_path in find_named_files(&card_root, "Card.xml") {
            match fs::read_to_string(&xml_path) {
                Ok(xml) => {
                    if let Some(card) =
                        parse_generic_mu3_xml(&xml_path, &xml, content_root, skill_map)
                    {
                        stats.mu3_xml_records += 1;
                        parsed_ids.insert(card.id.clone());
                        cards.push(card);
                    }
                }
                Err(err) => warnings.push(format!("Failed to read {}: {err}", xml_path.display())),
            }
        }
    }

    for mu3_pack in game_data_pack_paths(content_root, "MU3") {
        if !mu3_pack.exists() {
            continue;
        }
        match read_vfs_pack_named_files(&mu3_pack, &["Card.xml"]) {
            Ok(files) => {
                for file in files {
                    let xml = String::from_utf8_lossy(&file.bytes);
                    let source = mu3_pack.join(file.path.replace('/', "\\"));
                    if let Some(card) =
                        parse_generic_mu3_xml(&source, &xml, content_root, skill_map)
                    {
                        if parsed_ids.insert(card.id.clone()) {
                            stats.mu3_xml_records += 1;
                            cards.push(card);
                        }
                    }
                }
            }
            Err(err) => warnings.push(format!("Failed to read {}: {err}", mu3_pack.display())),
        }
    }

    parsed_ids
}

fn scan_asset_counts(streaming: &Path, stats: &mut ScanStats) {
    for file in walk_files(streaming) {
        if file
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("png"))
            .unwrap_or(false)
        {
            stats.png_assets += 1;
        }
    }

    for asset_dir in ["assets_com", "assets_mai", "assets_mu3"] {
        let root = streaming.join(asset_dir);
        for file in walk_files(&root) {
            if file.extension().is_none() {
                stats.unity_bundles += 1;
                stats.unity_bundle_bytes += fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
            }
        }
    }
}

fn print_field(key: &str, label: &str, field_type: &str, value: impl Into<String>) -> PrintField {
    PrintField {
        key: key.to_string(),
        label: label.to_string(),
        field_type: field_type.to_string(),
        value: value.into(),
        options: Vec::new(),
    }
}

fn print_select(
    key: &str,
    label: &str,
    value: impl Into<String>,
    options: Vec<PrintOption>,
) -> PrintField {
    PrintField {
        key: key.to_string(),
        label: label.to_string(),
        field_type: "select".to_string(),
        value: value.into(),
        options,
    }
}

fn print_option(value: impl Into<String>, label: impl Into<String>) -> PrintOption {
    PrintOption {
        value: value.into(),
        label: label.into(),
    }
}

fn print_number(key: &str, label: &str, value: Option<i32>) -> PrintField {
    print_field(
        key,
        label,
        "number",
        value.map(|v| v.to_string()).unwrap_or_default(),
    )
}

fn print_metadata_number(key: &str, label: &str, value: Option<i32>) -> PrintField {
    print_field(
        key,
        label,
        "metadata",
        value.map(|v| v.to_string()).unwrap_or_default(),
    )
}

fn print_metadata_bool(key: &str, label: &str, value: bool) -> PrintField {
    print_field(key, label, "metadata", if value { "true" } else { "false" })
}

fn print_bool(key: &str, label: &str, value: bool) -> PrintField {
    print_field(key, label, "bool", if value { "true" } else { "false" })
}

fn parse_mu3_skill_xml(xml: &str) -> Option<(i32, Mu3SkillInfo)> {
    let name_block = block_any(xml, &["name", "Name"])?;
    let id = int_tag_any(&name_block, &["id"])?;
    let name = tag_any(&name_block, &["str"]).unwrap_or_default();
    let text = block_any(xml, &["info", "Info"])
        .and_then(|value| tag_any(&value, &["str"]))
        .unwrap_or_default();
    let category = tag_any(xml, &["categoryIcon", "CategoryIcon"]).unwrap_or_else(|| "None".into());

    Some((
        id,
        Mu3SkillInfo {
            name,
            text,
            category,
        },
    ))
}

fn asset_layer(key: &str, label: &str, path: String) -> AssetLayer {
    AssetLayer {
        key: key.to_string(),
        label: label.to_string(),
        path,
    }
}

fn parse_chu_card(xml_path: &Path, xml: &str) -> Option<CardRecord> {
    let data_name = tag(xml, "dataName")?;
    let name_block = block(xml, "name").unwrap_or_default();
    let name_id = tag(&name_block, "id").unwrap_or_default();
    let image = block(xml, "image").and_then(|value| tag(&value, "path"));
    let image_small = block(xml, "imageSmall").and_then(|value| tag(&value, "path"));

    let image_path = image.and_then(|rel| resolve_sibling(xml_path, &rel));
    let thumbnail_path = image_small.and_then(|rel| resolve_sibling(xml_path, &rel));
    let chara_name = tag(xml, "charaName")
        .or_else(|| block(xml, "chuniCharaName").and_then(|value| tag(&value, "str")))
        .unwrap_or_else(|| data_name.clone());
    let skill_name = tag(xml, "skillName").unwrap_or_default();
    let skill_text = tag(xml, "skillText").unwrap_or_default();
    let rare_type = int_tag(xml, "rareType");
    let label_type = int_tag(xml, "labelType");
    let dif_type = int_tag(xml, "difType");
    let miss = int_tag(xml, "miss");
    let combo = int_tag(xml, "combo");
    let chain = int_tag(xml, "chain");

    Some(CardRecord {
        id: if name_id.is_empty() {
            data_name.clone()
        } else {
            name_id.clone()
        },
        game: "CHU".to_string(),
        record_type: "Card".to_string(),
        data_name: data_name.clone(),
        display_name: chara_name.clone(),
        character_name: chara_name.clone(),
        skill_name: skill_name.clone(),
        skill_text: skill_text.clone(),
        rare_type,
        label_type,
        dif_type,
        miss,
        combo,
        chain,
        image_path,
        thumbnail_path,
        asset_layers: Vec::new(),
        source_xml: path_string(xml_path),
        editable_fields: vec![
            "characterName".into(),
            "skillName".into(),
            "skillText".into(),
            "rareType".into(),
            "labelType".into(),
            "difType".into(),
            "miss".into(),
            "combo".into(),
            "chain".into(),
        ],
        print_fields: vec![
            print_field("characterName", "Character name", "text", chara_name),
            print_field("skillName", "Skill name", "text", skill_name),
            print_field("skillText", "Skill description", "multiline", skill_text),
            print_field("serialId", "Serial ID", "text", ""),
            print_metadata_number("rareType", "Rare type", rare_type),
            print_number("labelType", "Label type", label_type),
            print_number("difType", "Difficulty type", dif_type),
            print_number("miss", "MISS count", miss),
            print_number("combo", "COMBO count", combo),
            print_number("chain", "CHAIN count", chain),
            print_metadata_bool("holo", "Holographic print", false),
            print_bool("hideParam", "Hide score parameters", false),
            print_bool("hideSerialId", "Hide serial", false),
            print_bool("hideBackGround", "Hide background label", false),
            print_bool("hideChara", "Hide character", false),
        ],
    })
}

fn parse_mai_card_type_info(xml: &str) -> Option<MaiCardTypeInfo> {
    let name_block = block(xml, "name").unwrap_or_default();
    let data_name = tag(xml, "dataName")?;
    let title = tag(xml, "title")
        .or_else(|| tag(&name_block, "str"))
        .unwrap_or_else(|| data_name.clone());

    Some(MaiCardTypeInfo {
        id: int_tag(&name_block, "id"),
        title,
        kind: tag(xml, "kind").unwrap_or_default(),
        effect_text: tag(xml, "effectText").unwrap_or_default(),
        param_id: int_tag(xml, "paramId"),
        map_bonus: tag(xml, "mapBonus").unwrap_or_default(),
        extend_bit: int_tag(xml, "extendBitParameter"),
    })
}

fn parse_mai_chara_info(xml: &str) -> Option<(i32, MaiCharaInfo)> {
    let name_block = block(xml, "name").unwrap_or_default();
    let id = int_tag(&name_block, "id")?;
    let name = tag(&name_block, "str").unwrap_or_else(|| id.to_string());
    let unique_id = int_tag(xml, "uniqueId");
    let map_id = block(xml, "mapId").and_then(|value| int_tag(&value, "id"));

    Some((
        id,
        MaiCharaInfo {
            name,
            unique_id,
            map_id,
        },
    ))
}

fn parse_mai_chara_pack_info(xml: &str) -> Option<(i32, MaiCharaPackInfo)> {
    let name_block = block(xml, "name").unwrap_or_default();
    let id = int_tag(&name_block, "id")?;
    let name = tag(&name_block, "str").unwrap_or_else(|| id.to_string());
    let chara_list_block = block(xml, "CardCharaIds").unwrap_or_default();
    let chara_ids = blocks(&chara_list_block, "StringID")
        .into_iter()
        .filter_map(|value| int_tag(&value, "id"))
        .collect();

    Some((id, MaiCharaPackInfo { name, chara_ids }))
}

fn mai_card_type_is_holo(type_id: Option<i32>) -> bool {
    HOLO_ENABLED && matches!(type_id, Some(4 | 6))
}

fn parse_mai_card(
    xml_path: &Path,
    xml: &str,
    content_root: &Path,
    content_roots: &[PathBuf],
    card_types: &HashMap<i32, MaiCardTypeInfo>,
    charas: &HashMap<i32, MaiCharaInfo>,
    chara_packs: &HashMap<i32, MaiCharaPackInfo>,
) -> Option<CardRecord> {
    let data_name = tag(xml, "dataName")?;
    let name_block = block(xml, "name").unwrap_or_default();
    let name_id = tag(&name_block, "id").unwrap_or_default();
    let card_name = tag(&name_block, "str").unwrap_or_else(|| data_name.clone());
    let type_block = block(xml, "type").unwrap_or_default();
    let type_id = int_tag(&type_block, "id");
    let type_name = tag(&type_block, "str").unwrap_or_default();
    let chara_block = block(xml, "chara").unwrap_or_default();
    let chara_pack_id = int_tag(&chara_block, "id");
    let chara_ref_name = tag(&chara_block, "str").unwrap_or_default();
    let release_tag = block(xml, "releaseTagName")
        .and_then(|value| tag(&value, "str"))
        .unwrap_or_default();
    let enable_version = block(xml, "enableVersion")
        .and_then(|value| tag(&value, "str"))
        .unwrap_or_default();
    let disabled = bool_tag(xml, "disable").unwrap_or(false);
    let priority = int_tag(xml, "priority");
    let type_info = type_id.and_then(|id| card_types.get(&id));
    let chara_pack = chara_pack_id.and_then(|id| chara_packs.get(&id));
    let default_chara_id = chara_pack
        .and_then(|pack| pack.chara_ids.first().copied())
        .unwrap_or(101);
    let chara_info = charas.get(&default_chara_id);
    let chara_name = chara_info
        .map(|info| info.name.clone())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| {
            if card_name.is_empty() {
                data_name.clone()
            } else {
                card_name.clone()
            }
        });
    let card_kind = type_info
        .map(|info| {
            if info.kind.is_empty() {
                info.title.clone()
            } else {
                info.kind.clone()
            }
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| type_name.clone());
    let effect_text = type_info
        .map(|info| info.effect_text.clone())
        .unwrap_or_default();
    let card_type_param_id = type_info.and_then(|info| info.param_id);
    let map_bonus = type_info
        .map(|info| info.map_bonus.clone())
        .unwrap_or_default();
    let extend_bit = type_info.and_then(|info| info.extend_bit);
    let unique_id = chara_info
        .and_then(|info| info.unique_id)
        .or(Some(default_chara_id))
        .unwrap_or_default();
    let map_id = chara_info
        .and_then(|info| info.map_id)
        .unwrap_or(MAI_STATIC_NOT_FOUND_MAP_ID);
    let base_stem = type_id.map(|id| format!("ui_cardbase_{id:07}_{map_id:06}"));
    let chara_stem = Some(format!("ui_cardchara_{default_chara_id:06}"));
    let mask_stem = Some(format!("ui_cardcharamask_{default_chara_id:06}"));
    let image_path = base_stem.as_deref().and_then(|stem| {
        resolve_content_asset_with_fallback_roots(
            stem,
            content_root,
            content_roots,
            "MAI",
            "assets_mai",
        )
    });
    let thumbnail_path = base_stem.as_deref().and_then(|stem| {
        resolve_content_asset_with_fallback_roots(
            &format!("{stem}_s"),
            content_root,
            content_roots,
            "MAI",
            "assets_mai",
        )
    });
    let mut asset_layers = Vec::new();
    if let Some(path) = image_path.clone() {
        asset_layers.push(asset_layer("maiBase", "MAI card base", path));
    }
    if let Some(path) = chara_stem.as_deref().and_then(|stem| {
        resolve_content_asset_with_fallback_roots(
            stem,
            content_root,
            content_roots,
            "MAI",
            "assets_mai",
        )
    }) {
        asset_layers.push(asset_layer("maiChara", "MAI character layer", path));
    }
    if let Some(path) = mask_stem.as_deref().and_then(|stem| {
        resolve_content_asset_with_fallback_roots(
            stem,
            content_root,
            content_roots,
            "MAI",
            "assets_mai",
        )
    }) {
        asset_layers.push(asset_layer("maiMask", "MAI holo character mask", path));
    }
    let ver_chara_id = format!("[maimaiDX]{}-{unique_id:04}", enable_version);
    let mai_asset_root = resolve_content_asset_root_with_fallback_roots(
        content_root,
        content_roots,
        "MAI",
        "assets_mai",
    )
    .map(|path| path_string(&path))
    .unwrap_or_default();
    let official_holo = mai_card_type_is_holo(type_id);

    Some(CardRecord {
        id: if name_id.is_empty() {
            data_name.clone()
        } else {
            name_id.clone()
        },
        game: "MAI".to_string(),
        record_type: "Card".to_string(),
        data_name: data_name.clone(),
        display_name: chara_name.clone(),
        character_name: chara_name.clone(),
        skill_name: card_kind.clone(),
        skill_text: effect_text.clone(),
        rare_type: None,
        label_type: None,
        dif_type: None,
        miss: None,
        combo: None,
        chain: None,
        image_path,
        thumbnail_path,
        asset_layers,
        source_xml: path_string(xml_path),
        editable_fields: vec!["charaName".into(), "cardKind".into(), "effectText".into()],
        print_fields: vec![
            print_field("userName", "Player name", "text", ""),
            print_field("rating", "Rating", "number", ""),
            print_field("friendCode", "Friend code", "text", ""),
            print_bool("hasFriendCode", "Print friend code", false),
            print_field("charaName", "Character/card name", "text", chara_name),
            print_field("cardKind", "Card type", "metadata", card_kind),
            print_field("effectText", "Effect text", "metadata", effect_text),
            print_field("endDate", "End date", "text", ""),
            print_field("serialId", "Serial ID", "text", ""),
            print_field("verCharaId", "Version character ID", "text", ver_chara_id),
            print_field("qrPayload", "QR text override", "multiline", ""),
            print_field(
                "cardId",
                "Card ID",
                "number",
                if name_id.is_empty() {
                    data_name.clone()
                } else {
                    name_id.clone()
                },
            ),
            print_field(
                "typeId",
                "Type ID",
                "number",
                type_id.map(|id| id.to_string()).unwrap_or_default(),
            ),
            print_select(
                "charaId",
                "Character ID",
                default_chara_id.to_string(),
                mai_chara_options(chara_pack, charas),
            ),
            print_field(
                "charaPackId",
                "Character pack ID",
                "metadata",
                chara_pack_id.map(|id| id.to_string()).unwrap_or_default(),
            ),
            print_field(
                "charaChoices",
                "Character choices",
                "metadata",
                chara_pack
                    .map(|pack| format_mai_chara_choices(pack, charas))
                    .unwrap_or_default(),
            ),
            print_field(
                "uniqueId",
                "Character unique ID",
                "number",
                unique_id.to_string(),
            ),
            print_field("mapId", "Map asset ID", "number", map_id.to_string()),
            print_field(
                "cardTypeParamId",
                "Card type parameter ID",
                "number",
                card_type_param_id
                    .map(|id| id.to_string())
                    .unwrap_or_default(),
            ),
            print_field("mapBonus", "Map bonus", "text", map_bonus),
            print_field(
                "extendBitParameter",
                "Effect bit flags",
                "number",
                extend_bit.map(|id| id.to_string()).unwrap_or_default(),
            ),
            print_field("releaseTag", "Release tag", "metadata", release_tag),
            print_field("charaRef", "Character source", "metadata", chara_ref_name),
            print_field("maiAssetRoot", "MAI asset root", "metadata", mai_asset_root),
            print_field(
                "priority",
                "Priority",
                "metadata",
                priority.map(|id| id.to_string()).unwrap_or_default(),
            ),
            print_metadata_bool("disabled", "Disabled in data", disabled),
            print_bool("holo", "Holographic print", official_holo),
            print_bool("hideSerialAndQR", "Hide serial and QR", false),
            print_bool("hidePlayerName", "Hide player name", false),
            print_bool("hideRating", "Hide rating", false),
            print_bool("hideFrame", "Hide frame", false),
            print_bool("hideCardIcon", "Hide card icon", false),
            print_bool("hideCharaNameAndPeriod", "Hide name and period", false),
            print_bool("hideFriendCode", "Hide friend code", false),
            print_bool("hideChara", "Hide character", false),
        ],
    })
}

fn parse_mai_card_type(content_root: &Path, xml_path: &Path, xml: &str) -> Option<CardRecord> {
    let data_name = tag(xml, "dataName")?;
    let name_block = block(xml, "name").unwrap_or_default();
    let name_id = tag(&name_block, "id").unwrap_or_default();
    let info = parse_mai_card_type_info(xml)?;
    let title = info.title;
    let kind = info.kind;
    let effect = info.effect_text;
    let type_id = info.id;
    let param_id = info.param_id;
    let map_bonus = info.map_bonus;
    let extend_bit = info.extend_bit;
    let image_path = tag(xml, "imageFile").and_then(|rel| resolve_sibling(xml_path, &rel));
    let thumbnail_path = tag(xml, "thumbnailName").and_then(|rel| resolve_sibling(xml_path, &rel));
    let mai_asset_root = content_asset_dirs(content_root, "MAI", "assets_mai")
        .into_iter()
        .find(|path| path.exists())
        .map(|path| path_string(&path))
        .unwrap_or_default();

    Some(CardRecord {
        id: if name_id.is_empty() {
            data_name.clone()
        } else {
            name_id
        },
        game: "MAI".to_string(),
        record_type: "CardType".to_string(),
        data_name: data_name.clone(),
        display_name: title.clone(),
        character_name: title.clone(),
        skill_name: kind.clone(),
        skill_text: effect.clone(),
        rare_type: None,
        label_type: None,
        dif_type: None,
        miss: None,
        combo: None,
        chain: None,
        image_path,
        thumbnail_path,
        asset_layers: Vec::new(),
        source_xml: path_string(xml_path),
        editable_fields: vec![
            "characterName".into(),
            "skillName".into(),
            "skillText".into(),
        ],
        print_fields: vec![
            print_field("userName", "Player name", "text", ""),
            print_field("rating", "Rating", "number", ""),
            print_field("friendCode", "Friend code", "text", ""),
            print_bool("hasFriendCode", "Print friend code", false),
            print_field("charaName", "Character/card name", "text", title),
            print_field("cardKind", "Card type", "metadata", kind),
            print_field("effectText", "Effect text", "metadata", effect),
            print_field("endDate", "End date", "text", ""),
            print_field("serialId", "Serial ID", "text", ""),
            print_field("verCharaId", "Version character ID", "text", ""),
            print_field("qrPayload", "QR payload", "multiline", ""),
            print_field(
                "typeId",
                "Type ID",
                "number",
                type_id.map(|id| id.to_string()).unwrap_or_default(),
            ),
            print_field(
                "cardTypeParamId",
                "Card type parameter ID",
                "number",
                param_id.map(|id| id.to_string()).unwrap_or_default(),
            ),
            print_field("mapBonus", "Map bonus", "text", map_bonus),
            print_field(
                "extendBitParameter",
                "Effect bit flags",
                "number",
                extend_bit.map(|id| id.to_string()).unwrap_or_default(),
            ),
            print_field("maiAssetRoot", "MAI asset root", "metadata", mai_asset_root),
            print_bool("holo", "Holographic print", mai_card_type_is_holo(type_id)),
            print_bool("hideSerialAndQR", "Hide serial and QR", false),
            print_bool("hidePlayerName", "Hide player name", false),
            print_bool("hideRating", "Hide rating", false),
            print_bool("hideFrame", "Hide frame", false),
            print_bool("hideCardIcon", "Hide card icon", false),
            print_bool("hideCharaNameAndPeriod", "Hide name and period", false),
            print_bool("hideFriendCode", "Hide friend code", false),
            print_bool("hideChara", "Hide character", false),
        ],
    })
}

fn parse_generic_mu3_xml(
    xml_path: &Path,
    xml: &str,
    streaming: &Path,
    skill_map: &HashMap<i32, Mu3SkillInfo>,
) -> Option<CardRecord> {
    let data_name = tag_any(xml, &["dataName", "DataName"])?;
    let name_block = block_any(xml, &["name", "Name"]).unwrap_or_default();
    let name_id = tag_any(&name_block, &["id"]).unwrap_or_else(|| data_name.clone());
    let card_id = name_id
        .parse::<i32>()
        .ok()
        .or_else(|| trailing_number(&data_name));
    let name_text = tag_any(&name_block, &["str"]).unwrap_or_else(|| data_name.clone());
    let chara_block = block_any(xml, &["charaId", "CharaID"]);
    let character_name = chara_block
        .as_deref()
        .and_then(|value| tag_any(value, &["str"]))
        .or_else(|| tag_any(xml, &["charaName", "title", "CharacterName"]))
        .or_else(|| Some(strip_mu3_rarity_prefix(&name_text)))
        .unwrap_or_else(|| data_name.clone());
    let title = if name_text.trim().is_empty() {
        character_name.clone()
    } else {
        name_text
    };
    let skill_block = block_any(xml, &["skillId", "SkillID"]);
    let skill_id = skill_block
        .as_deref()
        .and_then(|value| int_tag_any(value, &["id"]));
    let skill_from_map = skill_id.and_then(|id| skill_map.get(&id));
    let skill_name = tag_any(xml, &["skillName", "SkillName"])
        .or_else(|| skill_from_map.map(|skill| skill.name.clone()))
        .or_else(|| {
            skill_block
                .as_deref()
                .and_then(|value| tag_any(value, &["str"]))
        })
        .unwrap_or_default();
    let skill_text = tag_any(xml, &["skillText", "SkillText"])
        .or_else(|| skill_from_map.map(|skill| skill.text.clone()))
        .unwrap_or_default();
    let skill_category = skill_from_map
        .map(|skill| skill.category.clone())
        .unwrap_or_default();
    let rare_type = int_tag_any(xml, &["rareType", "RarityType"])
        .or_else(|| tag_any(xml, &["rarity", "Rarity"]).and_then(|value| mu3_rarity_id(&value)));
    let attribute = int_tag_any(xml, &["attribute", "attributeType"])
        .or_else(|| tag_any(xml, &["Attribute"]).and_then(|value| mu3_attribute_id(&value)));
    let label_type = int_tag_any(xml, &["labelType"]);
    let dif_type = int_tag_any(xml, &["difType"]);
    let miss = int_tag_any(xml, &["miss"]);
    let combo = int_tag_any(xml, &["combo"]);
    let chain = int_tag_any(xml, &["chain"]);
    let grade_id =
        block_any(xml, &["gakunen", "Gakunen"]).and_then(|value| int_tag_any(&value, &["id"]));
    let rights_id = block_any(xml, &["cardRightsName", "CardRightsName"])
        .and_then(|value| int_tag_any(&value, &["id"]));
    let nick_name = tag_any(xml, &["nickName", "NickName"]).unwrap_or_default();
    let school_name = block_any(xml, &["school", "School"])
        .and_then(|value| tag_any(&value, &["str"]))
        .unwrap_or_default();
    let name_for_common_model =
        tag_any(xml, &["nameForCommonModel", "NameForCommonModel"]).unwrap_or_default();
    let is_common_model = bool_tag_any(xml, &["isCommonModel", "IsCommonModel"]).unwrap_or(false);
    let is_digital = bool_tag_any(xml, &["isDigital", "IsDigital"]).unwrap_or(false);
    let asset_layers = mu3_asset_layers(streaming, card_id, grade_id, rights_id);
    let asset_root = content_asset_dirs(streaming, "MU3", "assets_mu3")
        .into_iter()
        .find(|path| path.exists())
        .unwrap_or_else(|| streaming.join("assets_mu3"));
    let image_path = card_id
        .map(|id| asset_root.join(format!("ui_card_{id:06}")))
        .filter(|path| path.exists())
        .map(|path| path_string(&path))
        .or_else(|| {
            block_any(xml, &["image", "Image"])
                .and_then(|value| tag_any(&value, &["path"]))
                .and_then(|rel| resolve_sibling(xml_path, &rel))
        });
    let thumbnail_path = card_id
        .map(|id| asset_root.join(format!("ui_card_{id:06}_s")))
        .filter(|path| path.exists())
        .map(|path| path_string(&path))
        .or_else(|| {
            block_any(xml, &["imageSmall", "ImageSmall"])
                .and_then(|value| tag_any(&value, &["path"]))
                .and_then(|rel| resolve_sibling(xml_path, &rel))
        });
    let card_no = tag_any(xml, &["cardNumberString", "CardNumberString"]).unwrap_or_default();
    let level_params = parse_mu3_level_params(xml);
    let max_attack = level_params
        .iter()
        .copied()
        .max()
        .map(|value| value.to_string())
        .unwrap_or_default();
    let level_params_text = level_params
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let effective_name = if is_common_model && !name_for_common_model.is_empty() {
        name_for_common_model.clone()
    } else {
        character_name.clone()
    };

    Some(CardRecord {
        id: name_id,
        game: "MU3".to_string(),
        record_type: "Card".to_string(),
        data_name: data_name.clone(),
        display_name: title.clone(),
        character_name: effective_name.clone(),
        skill_name: skill_name.clone(),
        skill_text: skill_text.clone(),
        rare_type,
        label_type,
        dif_type,
        miss,
        combo,
        chain,
        image_path,
        thumbnail_path,
        asset_layers,
        source_xml: path_string(xml_path),
        editable_fields: vec![
            "characterName".into(),
            "skillName".into(),
            "skillText".into(),
        ],
        print_fields: vec![
            print_field("userName", "User name", "text", ""),
            print_field("characterName", "Character name", "text", effective_name),
            print_field(
                "baseCharacterName",
                "Base character name",
                "metadata",
                character_name,
            ),
            print_field(
                "nameForCommonModel",
                "Common model name",
                "metadata",
                name_for_common_model,
            ),
            print_field(
                "isCommonModel",
                "Common model",
                "metadata",
                if is_common_model { "true" } else { "false" },
            ),
            print_field("nickName", "Nickname", "text", nick_name),
            print_field("ipName", "IP / school", "text", school_name),
            print_field("skillName", "Skill name", "text", skill_name),
            print_field("skillText", "Skill description", "multiline", skill_text),
            print_field("skillCategory", "Skill category", "text", skill_category),
            print_field("serialId", "Serial ID", "text", ""),
            print_field("qrPayload", "QR payload", "multiline", ""),
            print_field("cardNo", "Card number", "text", card_no),
            print_field("maxAttack", "Max attack", "number", max_attack),
            print_field("levelParams", "Level parameters", "text", level_params_text),
            print_field("ownCount", "Own count", "number", ""),
            print_field("awaken", "Awaken state", "number", MU3_PRINT_AWAKEN_LEVEL0),
            print_field(
                "gradeId",
                "Grade ID",
                "number",
                grade_id.map(|value| value.to_string()).unwrap_or_default(),
            ),
            print_field(
                "rightsId",
                "Rights ID",
                "number",
                rights_id.map(|value| value.to_string()).unwrap_or_default(),
            ),
            print_field(
                "rareType",
                "Rarity",
                "number",
                rare_type.map(|value| value.to_string()).unwrap_or_default(),
            ),
            print_field(
                "attribute",
                "Attribute",
                "number",
                attribute.map(|value| value.to_string()).unwrap_or_default(),
            ),
            print_bool("holo", "Holographic print", false),
            print_metadata_bool("sign", "Signed card", false),
            print_bool("digitalOnly", "Digital only mark", is_digital),
            print_bool("hideAttrRarity", "Hide attribute and rarity", false),
            print_bool("hideAttackLimit", "Hide attack limit", false),
            print_bool("hideSkill", "Hide skill", false),
            print_bool("hideGrade", "Hide grade", false),
            print_bool("hideFrame", "Hide frame", false),
            print_bool("hideName", "Hide names", false),
            print_bool("hideAwaken", "Hide awaken", false),
            print_bool("hideUserName", "Hide user name", false),
            print_bool("hideQRCode", "Hide QR code", false),
            print_metadata_bool("hideCardNo", "Hide card number", false),
        ],
    })
}

fn parse_mu3_asset_card(asset_path: &Path, card_no: &str) -> CardRecord {
    let data_name = asset_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(card_no)
        .to_string();
    let display_name = format!("MU3 Card {card_no}");
    let thumbnail_path = asset_path
        .parent()
        .map(|parent| parent.join(format!("{data_name}_s")))
        .filter(|path| path.exists())
        .map(|path| path_string(&path));
    let asset_layers = asset_path
        .parent()
        .map(|root| mu3_asset_card_layers(root, card_no))
        .unwrap_or_default();

    CardRecord {
        id: card_no.to_string(),
        game: "MU3".to_string(),
        record_type: "AssetCard".to_string(),
        data_name: data_name.clone(),
        display_name: display_name.clone(),
        character_name: display_name.clone(),
        skill_name: String::new(),
        skill_text: String::new(),
        rare_type: None,
        label_type: None,
        dif_type: None,
        miss: None,
        combo: None,
        chain: None,
        image_path: Some(path_string(asset_path)),
        thumbnail_path,
        asset_layers,
        source_xml: path_string(asset_path),
        editable_fields: vec![
            "characterName".into(),
            "skillName".into(),
            "skillText".into(),
        ],
        print_fields: vec![
            print_field("userName", "User name", "text", ""),
            print_field("characterName", "Character name", "text", display_name),
            print_field("nickName", "Nickname", "text", ""),
            print_field("ipName", "IP / school", "text", ""),
            print_field("skillName", "Skill name", "text", ""),
            print_field("skillText", "Skill description", "multiline", ""),
            print_field("serialId", "Serial ID", "text", ""),
            print_field("qrPayload", "QR payload", "multiline", ""),
            print_field("cardNo", "Card number", "text", card_no),
            print_field("maxAttack", "Max attack", "number", ""),
            print_field("levelParams", "Level parameters", "text", ""),
            print_field("ownCount", "Own count", "number", ""),
            print_field("awaken", "Awaken state", "number", MU3_PRINT_AWAKEN_LEVEL0),
            print_field("gradeId", "Grade ID", "number", ""),
            print_field("rightsId", "Rights ID", "number", ""),
            print_field("rareType", "Rarity", "number", ""),
            print_field("attribute", "Attribute", "number", ""),
            print_bool("holo", "Holographic print", false),
            print_metadata_bool("sign", "Signed card", false),
            print_bool("hideAttrRarity", "Hide attribute and rarity", false),
            print_bool("hideAttackLimit", "Hide attack limit", false),
            print_bool("hideSkill", "Hide skill", false),
            print_bool("hideGrade", "Hide grade", false),
            print_bool("hideFrame", "Hide frame", false),
            print_bool("hideName", "Hide names", false),
            print_bool("hideAwaken", "Hide awaken", false),
            print_bool("hideUserName", "Hide user name", false),
            print_bool("hideQRCode", "Hide QR code", false),
            print_metadata_bool("hideCardNo", "Hide card number", false),
        ],
    }
}

fn mu3_asset_layers(
    content_root: &Path,
    card_id: Option<i32>,
    grade_id: Option<i32>,
    rights_id: Option<i32>,
) -> Vec<AssetLayer> {
    let Some(card_id) = card_id else {
        return Vec::new();
    };
    let root = content_asset_dirs(content_root, "MU3", "assets_mu3")
        .into_iter()
        .find(|path| path.exists())
        .unwrap_or_else(|| content_root.join("assets_mu3"));
    let card_no = format!("{card_id:06}");
    let mut layers = mu3_asset_card_layers(&root, &card_no);

    if let Some(grade_id) = grade_id {
        push_mu3_asset_layer(
            &mut layers,
            &root,
            "mu3Grade",
            "MU3 grade layer",
            &format!("ui_card_grade_{grade_id:05}"),
        );
    }

    if let Some(rights_id) = rights_id.filter(|id| *id > 0) {
        push_mu3_asset_layer(
            &mut layers,
            &root,
            "mu3Rights",
            "MU3 rights layer",
            &format!("ui_rights_{rights_id:03}"),
        );
    }

    layers
}

fn mu3_asset_card_layers(asset_root: &Path, card_no: &str) -> Vec<AssetLayer> {
    let card_id = card_no.parse::<i32>().ok();
    let card_no6 = card_id
        .map(|id| format!("{id:06}"))
        .unwrap_or_else(|| card_no.to_string());
    let card_no5 = card_id
        .map(|id| format!("{id:05}"))
        .unwrap_or_else(|| card_no.to_string());
    let mut layers = Vec::new();

    push_mu3_asset_layer(
        &mut layers,
        asset_root,
        "mu3CardBg",
        "MU3 per-card background",
        &format!("ui_card_bg_{card_no6}"),
    );
    if !push_mu3_asset_layer(
        &mut layers,
        asset_root,
        "mu3Chara",
        "MU3 character print layer",
        &format!("ui_card_chara_{card_no5}_p"),
    ) {
        push_mu3_asset_layer(
            &mut layers,
            asset_root,
            "mu3Chara",
            "MU3 character print layer",
            &format!("ui_card_chara_{card_no6}"),
        );
    }
    push_mu3_asset_layer(
        &mut layers,
        asset_root,
        "mu3Mask",
        "MU3 holo character mask",
        &format!("ui_card_chara_mask_{card_no6}"),
    );
    push_mu3_asset_layer(
        &mut layers,
        asset_root,
        "mu3Holo",
        "MU3 special holo layer",
        &format!("ui_card_holo_{card_no6}"),
    );
    push_mu3_asset_layer(
        &mut layers,
        asset_root,
        "mu3Sign",
        "MU3 signature holo layer",
        &format!("ui_card_holo_sign_{card_no6}"),
    );
    push_mu3_asset_layer(
        &mut layers,
        asset_root,
        "mu3SignMask",
        "MU3 signature mask layer",
        &format!("ui_card_holo_signmask_{card_no6}"),
    );

    layers
}

fn push_mu3_asset_layer(
    layers: &mut Vec<AssetLayer>,
    asset_root: &Path,
    key: &str,
    label: &str,
    stem: &str,
) -> bool {
    let path = asset_root.join(stem);
    if !path.exists() {
        return false;
    }
    if layers.iter().any(|layer| layer.key == key) {
        return true;
    }
    layers.push(asset_layer(key, label, path_string(&path)));
    true
}

fn mu3_card_asset_id(file_name: &str) -> Option<String> {
    let id = file_name.strip_prefix("ui_card_")?;
    if id.ends_with("_s") || id.is_empty() || !id.bytes().all(|value| value.is_ascii_digit()) {
        return None;
    }
    Some(id.to_string())
}

fn mu3_rarity_id(value: &str) -> Option<i32> {
    match value.trim().to_ascii_lowercase().as_str() {
        "n" => Some(0),
        "r" => Some(1),
        "sr" => Some(2),
        "ssr" => Some(3),
        "srplus" | "sr_plus" | "sr+" => Some(12),
        _ => value.trim().parse().ok(),
    }
}

fn mu3_attribute_id(value: &str) -> Option<i32> {
    match value.trim().to_ascii_lowercase().as_str() {
        "fire" | "red" => Some(0),
        "aqua" | "blue" | "bule" => Some(1),
        "leaf" | "green" => Some(2),
        _ => value.trim().parse().ok(),
    }
}

fn strip_mu3_rarity_prefix(value: &str) -> String {
    let trimmed = value.trim();
    if let Some(rest) = trimmed
        .strip_prefix('【')
        .and_then(|value| value.split_once('】').map(|(_, rest)| rest))
    {
        return rest.trim().to_string();
    }
    if let Some(rest) = trimmed
        .strip_prefix('[')
        .and_then(|value| value.split_once(']').map(|(_, rest)| rest))
    {
        return rest.trim().to_string();
    }
    trimmed.to_string()
}

fn parse_mu3_level_params(xml: &str) -> Vec<i32> {
    let Some(level_param) = block_any(xml, &["levelParam", "LevelParam"]) else {
        return Vec::new();
    };
    let mut rest = level_param.as_str();
    let mut values = Vec::new();

    while let Some(start) = rest.find("<int>") {
        let value_start = start + "<int>".len();
        let Some(end) = rest[value_start..].find("</int>") else {
            break;
        };
        if let Ok(value) = rest[value_start..value_start + end].trim().parse::<i32>() {
            values.push(value);
        }
        rest = &rest[value_start + end + "</int>".len()..];
    }

    values
}

fn trailing_number(value: &str) -> Option<i32> {
    let digits: String = value
        .chars()
        .rev()
        .take_while(|ch| ch.is_ascii_digit())
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    if digits.is_empty() {
        None
    } else {
        digits.parse().ok()
    }
}

fn read_vfs_pack_named_files(
    pack_path: &Path,
    file_names: &[&str],
) -> Result<Vec<PackedFile>, String> {
    let bytes = fs::read(pack_path)
        .map_err(|err| format!("Failed to read VFS pack {}: {err}", pack_path.display()))?;
    if bytes.len() < 32 {
        return Err(format!("VFS pack is too small: {}", pack_path.display()));
    }
    if &bytes[0..4] != b"PACK" {
        return Err(format!(
            "Unexpected VFS signature in {}",
            pack_path.display()
        ));
    }

    let entry_count = read_le_i64(&bytes, 8)? as usize;
    let string_offset = read_le_i64(&bytes, 16)? as usize;
    let data_offset = read_le_i64(&bytes, 24)? as usize;
    let entries_end = 32usize
        .checked_add(
            entry_count
                .checked_mul(28)
                .ok_or("VFS entry table overflow")?,
        )
        .ok_or("VFS entry table overflow")?;
    if entries_end > bytes.len() || string_offset > bytes.len() || data_offset > bytes.len() {
        return Err(format!(
            "VFS pack offsets are out of range: {}",
            pack_path.display()
        ));
    }

    let mut entries = Vec::with_capacity(entry_count);
    for index in 0..entry_count {
        let offset = 32 + index * 28;
        let data_size = read_le_i32(&bytes, offset + 16)?;
        let data_offset_value = read_le_i64(&bytes, offset + 20)?;
        if data_size < 0 || data_offset_value < 0 {
            return Err(format!("Negative VFS entry field at index {index}"));
        }
        entries.push(VfsPackEntry {
            entry_type: read_le_i32(&bytes, offset)?,
            name_offset: read_le_i32(&bytes, offset + 8)?.max(0) as usize,
            name_length: read_le_i32(&bytes, offset + 12)?.max(0) as usize,
            data_size: data_size as usize,
            data_offset: data_offset_value as usize,
        });
    }

    let mut names = Vec::with_capacity(entry_count);
    for entry in &entries {
        names.push(read_vfs_name(&bytes, string_offset, entry)?);
    }

    let targets: HashSet<String> = file_names
        .iter()
        .map(|name| name.to_ascii_lowercase())
        .collect();
    let mut files = Vec::new();
    if entries.is_empty() {
        return Ok(files);
    }

    collect_vfs_files(
        &bytes,
        &entries,
        &names,
        data_offset,
        &targets,
        0,
        "",
        &mut files,
    )?;
    Ok(files)
}

#[allow(clippy::too_many_arguments)]
fn collect_vfs_files(
    bytes: &[u8],
    entries: &[VfsPackEntry],
    names: &[String],
    data_root: usize,
    targets: &HashSet<String>,
    index: usize,
    prefix: &str,
    files: &mut Vec<PackedFile>,
) -> Result<(), String> {
    let Some(entry) = entries.get(index) else {
        return Err(format!("VFS entry index out of range: {index}"));
    };
    let name = names.get(index).map(String::as_str).unwrap_or_default();
    let path = if name.is_empty() {
        prefix.to_string()
    } else if prefix.is_empty() {
        name.to_string()
    } else {
        format!("{prefix}/{name}")
    };

    match entry.entry_type {
        1 => {
            let first_child = entry.data_offset;
            let last_child = first_child
                .checked_add(entry.data_size)
                .ok_or("VFS child index overflow")?;
            if last_child > entries.len() {
                return Err(format!("VFS child range out of bounds for {path}"));
            }
            for child in first_child..last_child {
                collect_vfs_files(
                    bytes, entries, names, data_root, targets, child, &path, files,
                )?;
            }
        }
        0 => {
            if targets.contains(&name.to_ascii_lowercase()) {
                let start = data_root
                    .checked_add(entry.data_offset)
                    .ok_or("VFS file offset overflow")?;
                let end = start
                    .checked_add(entry.data_size)
                    .ok_or("VFS file size overflow")?;
                if end > bytes.len() {
                    return Err(format!("VFS file data out of bounds for {path}"));
                }
                files.push(PackedFile {
                    path,
                    bytes: bytes[start..end].to_vec(),
                });
            }
        }
        other => return Err(format!("Unknown VFS entry type {other} for {path}")),
    }

    Ok(())
}

fn read_vfs_name(
    bytes: &[u8],
    string_offset: usize,
    entry: &VfsPackEntry,
) -> Result<String, String> {
    let start = string_offset
        .checked_add(
            entry
                .name_offset
                .checked_mul(2)
                .ok_or("VFS name offset overflow")?,
        )
        .ok_or("VFS name offset overflow")?;
    let end = start
        .checked_add(
            entry
                .name_length
                .checked_mul(2)
                .ok_or("VFS name length overflow")?,
        )
        .ok_or("VFS name length overflow")?;
    if end > bytes.len() {
        return Err("VFS name out of bounds".into());
    }
    let units: Vec<u16> = bytes[start..end]
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    Ok(String::from_utf16_lossy(&units))
}

fn read_le_i32(bytes: &[u8], offset: usize) -> Result<i32, String> {
    // checked_add avoids the integer overflow that `offset + 4` would hit for a
    // near-usize::MAX offset (which would wrap and pass the bounds check).
    if offset.checked_add(4).is_none_or(|end| end > bytes.len()) {
        return Err(format!("i32 read out of bounds at {offset}"));
    }
    Ok(i32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ]))
}

fn read_le_i64(bytes: &[u8], offset: usize) -> Result<i64, String> {
    if offset.checked_add(8).is_none_or(|end| end > bytes.len()) {
        return Err(format!("i64 read out of bounds at {offset}"));
    }
    Ok(i64::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7],
    ]))
}

fn resolve_content_asset(
    stem: &str,
    content_root: &Path,
    game: &str,
    asset_dir: &str,
) -> Option<String> {
    for dir in content_asset_dirs(content_root, game, asset_dir) {
        let path = dir.join(stem);
        if path.exists() {
            return Some(path_string(&path));
        }
    }
    None
}

fn resolve_content_asset_with_fallback_roots(
    stem: &str,
    preferred_content_root: &Path,
    content_roots: &[PathBuf],
    game: &str,
    asset_dir: &str,
) -> Option<String> {
    if let Some(path) = resolve_content_asset(stem, preferred_content_root, game, asset_dir) {
        return Some(path);
    }

    for content_root in content_roots.iter().rev() {
        if same_path(content_root, preferred_content_root) {
            continue;
        }
        if let Some(path) = resolve_content_asset(stem, content_root, game, asset_dir) {
            return Some(path);
        }
    }

    None
}

fn resolve_content_asset_root_with_fallback_roots(
    preferred_content_root: &Path,
    content_roots: &[PathBuf],
    game: &str,
    asset_dir: &str,
) -> Option<PathBuf> {
    if let Some(path) = content_asset_dirs(preferred_content_root, game, asset_dir)
        .into_iter()
        .find(|path| path.exists())
    {
        return Some(path);
    }

    for content_root in content_roots.iter().rev() {
        if same_path(content_root, preferred_content_root) {
            continue;
        }
        if let Some(path) = content_asset_dirs(content_root, game, asset_dir)
            .into_iter()
            .find(|path| path.exists())
        {
            return Some(path);
        }
    }

    None
}

fn content_asset_dirs(content_root: &Path, game: &str, asset_dir: &str) -> Vec<PathBuf> {
    vec![
        content_root.join(asset_dir),
        content_root.join(game).join(asset_dir),
    ]
}

fn game_data_leaf_roots(content_root: &Path, game: &str, leaf: &str) -> Vec<PathBuf> {
    vec![
        content_root.join(game).join("Data").join("A000").join(leaf),
        content_root.join(game).join(leaf),
    ]
}

fn game_data_pack_paths(content_root: &Path, game: &str) -> Vec<PathBuf> {
    vec![
        content_root.join(game).join("Data").join("A000.pac"),
        content_root.join(game).join("A000.pac"),
    ]
}

fn format_mai_chara_choices(
    pack: &MaiCharaPackInfo,
    charas: &HashMap<i32, MaiCharaInfo>,
) -> String {
    if pack.chara_ids.is_empty() {
        return pack.name.clone();
    }

    pack.chara_ids
        .iter()
        .map(|id| {
            let info = charas.get(id);
            let map_id = info
                .and_then(|info| info.map_id)
                .unwrap_or(MAI_STATIC_NOT_FOUND_MAP_ID);
            let unique_id = info.and_then(|info| info.unique_id).unwrap_or(*id);
            let name = info
                .map(|info| info.name.clone())
                .unwrap_or_else(|| id.to_string());
            format!("{id}|{map_id}|{unique_id}|{name}")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn mai_chara_options(
    pack: Option<&MaiCharaPackInfo>,
    charas: &HashMap<i32, MaiCharaInfo>,
) -> Vec<PrintOption> {
    let Some(pack) = pack else {
        return Vec::new();
    };

    pack.chara_ids
        .iter()
        .map(|id| {
            let label = charas
                .get(id)
                .map(|info| format!("{id:06} {}", info.name))
                .unwrap_or_else(|| format!("{id:06}"));
            print_option(id.to_string(), label)
        })
        .collect()
}

/// Runs the UnityPy extractor under each candidate Python interpreter until one
/// succeeds (exit 0 and `is_success` confirms the expected files landed). Shared
/// by the image-to-cache, image-to-path, and bundle-to-dir extractors so the
/// interpreter discovery, PYTHONPATH wiring, and error aggregation live in one
/// place. `kind` is "image" or "bundle" for the failure message.
fn run_unity_extractor<C, S>(
    asset_path: &Path,
    kind: &str,
    configure: C,
    is_success: S,
) -> Result<(), String>
where
    C: Fn(&mut Command),
    S: Fn() -> bool,
{
    let unitypy_path = find_unitypy_path();
    let python_paths = unitypy_path
        .as_ref()
        .map(|path| path_string(path))
        .unwrap_or_default();
    let mut errors = Vec::new();

    for candidate in python_candidates() {
        let mut command = Command::new(&candidate);
        configure(&mut command);
        if !python_paths.is_empty() {
            command.env("PYTHONPATH", &python_paths);
        }

        match command.output() {
            Ok(output) if output.status.success() && is_success() => return Ok(()),
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let detail = if stderr.is_empty() { stdout } else { stderr };
                errors.push(format!("{candidate}: {detail}"));
            }
            Err(err) => errors.push(format!("{candidate}: {err}")),
        }
    }

    Err(format!(
        "Failed to extract Unity {kind} from {}. UnityPy path: {}. {}",
        asset_path.display(),
        unitypy_path
            .as_ref()
            .map(|path| path_string(path))
            .unwrap_or_else(|| "not found".into()),
        errors.join(" | ")
    ))
}

fn extract_unity_image_to_cache(asset_path: &Path) -> Result<PathBuf, String> {
    let cache_dir = app_data_dir().join("asset-cache");
    fs::create_dir_all(&cache_dir)
        .map_err(|err| format!("Failed to create asset cache directory: {err}"))?;
    let script_path = cache_dir.join("extract_unity_image.py");
    write_extract_script(&script_path)?;

    let output_path = cache_dir.join(format!("{}.png", unity_cache_key(asset_path)));
    if output_path.exists() {
        return Ok(output_path);
    }

    run_unity_extractor(
        asset_path,
        "image",
        |command| {
            command.arg(&script_path).arg(asset_path).arg(&output_path);
        },
        || output_path.exists(),
    )?;
    Ok(output_path)
}

fn extract_unity_image_to_path(
    asset_path: &Path,
    output_path: &Path,
    script_path: &Path,
) -> Result<(), String> {
    write_extract_script(script_path)?;
    if output_path.exists() {
        return Ok(());
    }

    run_unity_extractor(
        asset_path,
        "image",
        |command| {
            command.arg(script_path).arg(asset_path).arg(output_path);
        },
        || output_path.exists(),
    )
}

fn extract_unity_bundle_to_mobile_dir(
    asset_path: &Path,
    output_dir: &Path,
    primary_output_path: &Path,
    primary_archive_path: &str,
    script_path: &Path,
) -> Result<(), String> {
    write_bundle_extract_script(script_path)?;
    let metadata_path = output_dir.join("metadata.json");

    run_unity_extractor(
        asset_path,
        "bundle",
        |command| {
            command
                .arg(script_path)
                .arg(asset_path)
                .arg(output_dir)
                .arg(primary_output_path)
                .arg(primary_archive_path);
        },
        || primary_output_path.exists() && metadata_path.exists(),
    )
}

fn unity_worker_count() -> usize {
    if let Ok(value) = std::env::var("CARDVIEWER_UNITY_WORKERS") {
        if let Ok(count) = value.trim().parse::<usize>() {
            if count > 0 {
                return count;
            }
        }
    }
    // Each worker loads a whole Unity bundle + UnityPy into memory, so default
    // to a conservative concurrency to avoid exhausting RAM. Raise it with
    // CARDVIEWER_UNITY_WORKERS on machines with spare memory.
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    cores.min(4)
}

fn write_extract_script(script_path: &Path) -> Result<(), String> {
    write_tool_script(script_path, UNITY_EXTRACT_SCRIPT, "Unity extraction")
}

fn composite_mai_thumbnails<F>(
    has_mai_card_records: bool,
    output_root: &Path,
    public_base_url: &str,
    progress: &mut F,
) -> Result<(), String>
where
    F: FnMut(String),
{
    if !has_mai_card_records {
        progress("No MAI card records; skipping MAI composite thumbnails".to_string());
        return Ok(());
    }

    let shard_path = output_root.join("cards.mai.json");
    if !shard_path.is_file() {
        return Err(format!(
            "MAI card records were exported, but the MAI manifest shard is missing: {}",
            shard_path.display()
        ));
    }

    progress("Compositing MAI card thumbnails (base + character)".to_string());
    let script_path = output_root
        .join(".tools")
        .join("generate_mai_composite_thumbnails.py");
    write_tool_script(
        &script_path,
        MAI_COMPOSITE_SCRIPT,
        "MAI composite thumbnail",
    )?;

    run_mai_composite_script(
        &script_path,
        output_root,
        public_base_url,
        &python_candidates(),
    )
}

fn run_mai_composite_script(
    script_path: &Path,
    output_root: &Path,
    public_base_url: &str,
    candidates: &[String],
) -> Result<(), String> {
    let mut errors = Vec::new();
    for candidate in candidates {
        let mut command = Command::new(candidate);
        command
            .arg(script_path)
            .arg(output_root)
            .arg(public_base_url);
        match command.output() {
            Ok(output) if output.status.success() => return Ok(()),
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let detail = if !stderr.is_empty() {
                    stderr
                } else if !stdout.is_empty() {
                    stdout
                } else {
                    format!("exited with {}", output.status)
                };
                errors.push(format!("{candidate}: {detail}"));
            }
            Err(err) => errors.push(format!("{candidate}: {err}")),
        }
    }

    Err(format!(
        "MAI composite thumbnails were not generated. {}",
        errors.join(" | ")
    ))
}

fn write_thumbnail_script(script_path: &Path) -> Result<(), String> {
    write_tool_script(script_path, THUMBNAIL_SCRIPT, "thumbnail generation")
}

fn write_bundle_extract_script(script_path: &Path) -> Result<(), String> {
    write_tool_script(
        script_path,
        UNITY_BUNDLE_EXTRACT_SCRIPT,
        "Unity bundle extraction",
    )
}

fn write_tool_script(script_path: &Path, content: &str, label: &str) -> Result<(), String> {
    if let Some(parent) = script_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create {label} script directory: {err}"))?;
    }
    if fs::read_to_string(script_path)
        .map(|body| body == content)
        .unwrap_or(false)
    {
        return Ok(());
    }
    fs::write(script_path, content).map_err(|err| format!("Failed to write {label} script: {err}"))
}

fn unity_cache_key(asset_path: &Path) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path_string(asset_path).hash(&mut hasher);
    if let Ok(metadata) = fs::metadata(asset_path) {
        metadata.len().hash(&mut hasher);
        if let Ok(modified) = metadata.modified() {
            if let Ok(duration) = modified.duration_since(UNIX_EPOCH) {
                duration.as_secs().hash(&mut hasher);
                duration.subsec_nanos().hash(&mut hasher);
            }
        }
    }
    format!("{:016x}", hasher.finish())
}

fn app_data_dir() -> PathBuf {
    std::env::var_os("CARDVIEWER_CACHE_DIR")
        .or_else(|| std::env::var_os("APPDATA"))
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("ConfigArc")
        .join("CardViewer")
}

fn python_candidates() -> Vec<String> {
    if let Some(python) = std::env::var_os("CARDVIEWER_PYTHON") {
        return vec![PathBuf::from(python).to_string_lossy().into_owned()];
    }

    vec!["py".into(), "python".into(), "python3".into()]
}

fn find_unitypy_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("CARDVIEWER_UNITYPY_PATH").map(PathBuf::from) {
        if path.exists() {
            return Some(path);
        }
    }

    let mut roots = Vec::new();
    if let Ok(current_dir) = std::env::current_dir() {
        roots.push(current_dir);
    }
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")));

    for root in roots {
        for ancestor in root.ancestors() {
            let candidate = ancestor.join(".analysis").join("py");
            if candidate.join("UnityPy").exists() {
                return Some(candidate);
            }
        }
    }

    None
}

fn hex_bytes(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn chrono_like_timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("unix:{}", now.as_secs())
}

fn unix_timestamp_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    static IMAGE_ACCESS_TEST_LOCK: Mutex<()> = Mutex::new(());

    fn lock_image_access_test_state() -> std::sync::MutexGuard<'static, ()> {
        IMAGE_ACCESS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[test]
    fn parses_chu_card_fields() {
        let xml = r#"
<CardData>
  <dataName>card00001002</dataName>
  <name><id>1002</id><str>card00001002</str><data /></name>
  <image><path>CHU_card_00001002.png</path></image>
  <charaName>シズマ・クロサキ</charaName>
  <rareType>2</rareType>
  <skillName>テクニカル</skillName>
  <skillText>COMBO &amp; CHAIN</skillText>
</CardData>"#;

        let card = parse_chu_card(Path::new("Card.xml"), xml).unwrap();
        assert_eq!(card.id, "1002");
        assert_eq!(card.data_name, "card00001002");
        assert_eq!(card.character_name, "シズマ・クロサキ");
        assert_eq!(card.rare_type, Some(2));
        assert_eq!(card.skill_text, "COMBO & CHAIN");
        assert!(card
            .print_fields
            .iter()
            .any(|field| field.key == "serialId"));
        assert!(card
            .print_fields
            .iter()
            .any(|field| field.key == "hideParam"));
    }

    #[test]
    fn parses_mai_card_with_type_chara_and_asset() {
        let streaming = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-mai-scan")
            .join("StreamingAssets");
        let asset_dir = streaming.join("assets_mai");
        fs::create_dir_all(&asset_dir).unwrap();
        fs::write(asset_dir.join("ui_cardbase_0000002_000001"), b"UnityFS").unwrap();
        fs::write(asset_dir.join("ui_cardbase_0000002_000001_s"), b"UnityFS").unwrap();
        fs::write(asset_dir.join("ui_cardchara_000101"), b"UnityFS").unwrap();

        let mut card_types = HashMap::new();
        card_types.insert(
            2,
            MaiCardTypeInfo {
                id: Some(2),
                title: "Bronze".into(),
                kind: "Pass".into(),
                effect_text: "Bonus text".into(),
                param_id: Some(100),
                map_bonus: "BronzeBonus".into(),
                extend_bit: Some(2),
            },
        );
        let mut charas = HashMap::new();
        charas.insert(
            101,
            MaiCharaInfo {
                name: "Pack 101".into(),
                unique_id: Some(1),
                map_id: Some(1),
            },
        );
        let mut chara_packs = HashMap::new();
        chara_packs.insert(
            900,
            MaiCharaPackInfo {
                name: "Pack source".into(),
                chara_ids: vec![101],
            },
        );
        let xml = r#"
<CardData>
  <dataName>card00001012</dataName>
  <releaseTagName><id>1</id><str>Ver1.00.00</str></releaseTagName>
  <disable>false</disable>
  <name><id>1012</id><str>Bronze Card 101</str></name>
  <type><id>2</id><str>BronzePass</str></type>
  <chara><id>900</id><str>Pack source</str></chara>
  <enableVersion><id>1</id><str>1.00</str></enableVersion>
  <priority>7</priority>
</CardData>"#;

        let content_roots = vec![streaming.clone()];
        let card = parse_mai_card(
            Path::new("Card.xml"),
            xml,
            &streaming,
            &content_roots,
            &card_types,
            &charas,
            &chara_packs,
        )
        .unwrap();

        assert_eq!(card.game, "MAI");
        assert_eq!(card.record_type, "Card");
        assert_eq!(card.id, "1012");
        assert_eq!(card.display_name, "Pack 101");
        assert_eq!(card.skill_name, "Pass");
        assert_eq!(card.skill_text, "Bonus text");
        assert!(card
            .image_path
            .as_deref()
            .unwrap()
            .ends_with("assets_mai\\ui_cardbase_0000002_000001"));
        assert!(card
            .thumbnail_path
            .as_deref()
            .unwrap()
            .ends_with("assets_mai\\ui_cardbase_0000002_000001_s"));
        assert!(card
            .print_fields
            .iter()
            .any(|field| { field.key == "uniqueId" && field.value == "1" }));
        assert!(card
            .print_fields
            .iter()
            .any(|field| { field.key == "charaPackId" && field.value == "900" }));
        assert!(card
            .print_fields
            .iter()
            .any(|field| { field.key == "charaChoices" && field.value == "101|1|1|Pack 101" }));
        assert!(card.print_fields.iter().any(|field| {
            field.key == "charaId" && field.field_type == "select" && field.options.len() == 1
        }));
        assert!(card
            .asset_layers
            .iter()
            .any(|layer| layer.key == "maiChara"));
    }

    #[test]
    fn parses_mai_card_assets_from_fallback_content_root() {
        let root = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-mai-fallback");
        let streaming = root.join("StreamingAssets");
        let update_root = root.join("updates").join("SDED_A000");
        let asset_dir = streaming.join("assets_mai");
        fs::create_dir_all(&asset_dir).unwrap();
        fs::write(asset_dir.join("ui_cardbase_0000004_000001"), b"UnityFS").unwrap();
        fs::write(asset_dir.join("ui_cardbase_0000004_000001_s"), b"UnityFS").unwrap();
        fs::write(asset_dir.join("ui_cardchara_000101"), b"UnityFS").unwrap();
        fs::write(asset_dir.join("ui_cardcharamask_000101"), b"UnityFS").unwrap();
        fs::create_dir_all(&update_root).unwrap();

        let mut card_types = HashMap::new();
        card_types.insert(
            4,
            MaiCardTypeInfo {
                id: Some(4),
                title: "Gold".into(),
                kind: "Pass".into(),
                effect_text: "Gold bonus".into(),
                param_id: Some(400),
                map_bonus: String::new(),
                extend_bit: Some(4),
            },
        );
        let mut charas = HashMap::new();
        charas.insert(
            101,
            MaiCharaInfo {
                name: "Fallback Chara".into(),
                unique_id: Some(1),
                map_id: Some(1),
            },
        );
        let mut chara_packs = HashMap::new();
        chara_packs.insert(
            101,
            MaiCharaPackInfo {
                name: "Fallback Pack".into(),
                chara_ids: vec![101],
            },
        );
        let xml = r#"
<CardData>
  <dataName>card00001014</dataName>
  <name><id>1014</id><str>Gold Card</str></name>
  <type><id>4</id><str>GoldPass</str></type>
  <chara><id>101</id><str>Fallback Pack</str></chara>
  <enableVersion><id>1</id><str>1.00</str></enableVersion>
</CardData>"#;

        let content_roots = vec![streaming.clone(), update_root.clone()];
        let card = parse_mai_card(
            Path::new("Card.xml"),
            xml,
            &update_root,
            &content_roots,
            &card_types,
            &charas,
            &chara_packs,
        )
        .unwrap();

        assert!(card
            .image_path
            .as_deref()
            .unwrap()
            .ends_with("assets_mai\\ui_cardbase_0000004_000001"));
        assert!(card.asset_layers.iter().any(|layer| layer.key == "maiMask"));
        assert!(card.print_fields.iter().any(|field| {
            field.key == "maiAssetRoot" && field.value.ends_with("StreamingAssets\\assets_mai")
        }));
    }

    #[test]
    fn parses_mu3_numeric_asset_cards_only() {
        assert_eq!(mu3_card_asset_id("ui_card_100001"), Some("100001".into()));
        assert_eq!(mu3_card_asset_id("ui_card_100001_s"), None);
        assert_eq!(mu3_card_asset_id("ui_card_holo_sign_100001"), None);

        let card = parse_mu3_asset_card(Path::new("assets_mu3\\ui_card_100001"), "100001");
        assert_eq!(card.game, "MU3");
        assert_eq!(card.record_type, "AssetCard");
        assert_eq!(card.id, "100001");
        assert!(card
            .print_fields
            .iter()
            .any(|field| field.key == "cardNo" && field.value == "100001"));
    }

    #[test]
    fn attaches_mu3_official_asset_layers() {
        let asset_dir = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-mu3-layers")
            .join("assets_mu3");
        fs::create_dir_all(&asset_dir).unwrap();
        for name in [
            "ui_card_100001",
            "ui_card_chara_100001_p",
            "ui_card_chara_mask_100001",
            "ui_card_holo_100001",
            "ui_card_grade_00002",
            "ui_rights_001",
            "ui_card_holo_sign_100001",
            "ui_card_holo_signmask_100001",
        ] {
            fs::write(asset_dir.join(name), b"UnityFS").unwrap();
        }

        let card = parse_mu3_asset_card(&asset_dir.join("ui_card_100001"), "100001");
        assert!(card
            .asset_layers
            .iter()
            .any(|layer| layer.key == "mu3Chara"));
        assert!(card.asset_layers.iter().any(|layer| layer.key == "mu3Mask"));
        assert!(card.asset_layers.iter().any(|layer| layer.key == "mu3Holo"));

        let layers = mu3_asset_layers(asset_dir.parent().unwrap(), Some(100001), Some(2), Some(1));
        for key in ["mu3Grade", "mu3Rights", "mu3Sign", "mu3SignMask"] {
            assert!(layers.iter().any(|layer| layer.key == key), "missing {key}");
        }
    }

    #[test]
    fn parses_mu3_official_card_xml_fields() {
        let streaming = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-mu3-official-xml")
            .join("StreamingAssets");
        let asset_dir = streaming.join("assets_mu3");
        fs::create_dir_all(&asset_dir).unwrap();
        for name in [
            "ui_card_100001",
            "ui_card_100001_s",
            "ui_card_chara_100001_p",
            "ui_card_chara_mask_100001",
            "ui_card_grade_00002",
            "ui_rights_001",
        ] {
            fs::write(asset_dir.join(name), b"UnityFS").unwrap();
        }

        let mut skills = HashMap::new();
        skills.insert(
            100000,
            Mu3SkillInfo {
                name: "ボスアタック +5".into(),
                text: "バトル後半で、自身の攻撃力5％アップ".into(),
                category: "Attack".into(),
            },
        );
        let xml = r#"
<CardData>
  <dataName>card100001</dataName>
  <Name><id>100001</id><str>【N】星咲 あかり</str></Name>
  <CharaID><id>1000</id><str>星咲 あかり</str></CharaID>
  <NickName>あかり</NickName>
  <Attribute>Fire</Attribute>
  <School><id>1</id><str>奏坂学園</str></School>
  <NameForCommonModel />
  <IsCommonModel>false</IsCommonModel>
  <IsDigital>true</IsDigital>
  <Gakunen><id>2</id><str>高校2年生</str></Gakunen>
  <Rarity>N</Rarity>
  <LevelParam><int>10</int><int>20</int><int>30</int></LevelParam>
  <SkillID><id>100000</id><str>ボスアタック +5</str></SkillID>
  <CardRightsName><id>1</id><str>ONGEKI</str></CardRightsName>
  <CardNumberString>[O.N.G.E.K.I.]1.00-0001</CardNumberString>
</CardData>"#;

        let card = parse_generic_mu3_xml(Path::new("Card.xml"), xml, &streaming, &skills).unwrap();
        assert_eq!(card.id, "100001");
        assert_eq!(card.display_name, "【N】星咲 あかり");
        assert_eq!(card.character_name, "星咲 あかり");
        assert_eq!(card.rare_type, Some(0));
        assert!(card
            .asset_layers
            .iter()
            .any(|layer| layer.key == "mu3Chara"));
        assert!(card
            .asset_layers
            .iter()
            .any(|layer| layer.key == "mu3Grade"));
        assert!(card
            .asset_layers
            .iter()
            .any(|layer| layer.key == "mu3Rights"));
        for (key, value) in [
            ("nickName", "あかり"),
            ("ipName", "奏坂学園"),
            ("skillCategory", "Attack"),
            ("cardNo", "[O.N.G.E.K.I.]1.00-0001"),
            ("maxAttack", "30"),
            ("levelParams", "10,20,30"),
            ("awaken", MU3_PRINT_AWAKEN_LEVEL0),
            ("digitalOnly", "true"),
        ] {
            assert!(
                card.print_fields
                    .iter()
                    .any(|field| field.key == key && field.value == value),
                "missing {key}={value}"
            );
        }
    }

    #[test]
    fn reads_extensionless_image_by_magic() {
        let _guard = lock_image_access_test_state();
        let dir = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-image-magic");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("png_without_extension");
        fs::write(&path, [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]).unwrap();

        // The IPC reader only serves files under a registered content root (as a
        // real scan would establish before any image is requested).
        let request_id = begin_ui_scan_request().unwrap();
        assert!(activate_allowed_content_roots(std::slice::from_ref(&dir), request_id).unwrap());

        let data_url = read_image_data_url_impl(path_string(&path)).unwrap();
        assert!(data_url.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn replacing_image_roots_revokes_old_paths_and_cache_entries() {
        let _guard = lock_image_access_test_state();
        let base = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-image-root-revocation");
        let old_root = base.join("old");
        let current_root = base.join("current");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(old_root.join("CardMaker_Data").join("StreamingAssets")).unwrap();
        fs::create_dir_all(current_root.join("CardMaker_Data").join("StreamingAssets")).unwrap();
        let old_image = old_root.join("old.png");
        let current_image = current_root.join("current.png");
        let outside_image = base.join("outside.png");
        fs::write(&old_image, b"old-image").unwrap();
        fs::write(&current_image, b"current-image").unwrap();
        fs::write(&outside_image, b"outside-image").unwrap();

        scan_package_impl(path_string(&old_root)).unwrap();
        read_image_data_url_impl(path_string(&old_image)).unwrap();
        let old_cache_key = path_string(&old_image.canonicalize().unwrap());
        assert!(image_data_url_cache()
            .lock()
            .unwrap()
            .map
            .contains_key(&old_cache_key));

        scan_package_impl(path_string(&current_root)).unwrap();

        let error = read_image_data_url_impl(path_string(&old_image)).unwrap_err();
        assert!(error.contains("outside the scanned content roots"));
        assert!(!image_data_url_cache()
            .lock()
            .unwrap()
            .map
            .contains_key(&old_cache_key));
        assert!(read_image_data_url_impl(path_string(&current_image)).is_ok());
        let traversal = current_root.join("..").join("outside.png");
        let error = read_image_data_url_impl(path_string(&traversal)).unwrap_err();
        assert!(error.contains("outside the scanned content roots"));
    }

    #[test]
    fn stale_ui_scan_cannot_restore_older_image_roots() {
        let _guard = lock_image_access_test_state();
        let base = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-image-root-ordering");
        let old_root = base.join("old");
        let current_root = base.join("current");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&old_root).unwrap();
        fs::create_dir_all(&current_root).unwrap();

        let old_request = begin_ui_scan_request().unwrap();
        let current_request = begin_ui_scan_request().unwrap();
        assert!(
            !activate_allowed_content_roots(std::slice::from_ref(&old_root), old_request,).unwrap()
        );
        assert!(activate_allowed_content_roots(
            std::slice::from_ref(&current_root),
            current_request,
        )
        .unwrap());

        let allowed = allowed_content_roots().read().unwrap();
        assert!(allowed.contains(&current_root.canonicalize().unwrap()));
        assert!(!allowed.contains(&old_root.canonicalize().unwrap()));
    }

    #[test]
    fn image_read_guard_delays_root_revocation() {
        let _guard = lock_image_access_test_state();
        let base = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-image-root-read-guard");
        let old_root = base.join("old");
        let current_root = base.join("current");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&old_root).unwrap();
        fs::create_dir_all(&current_root).unwrap();

        let old_request = begin_ui_scan_request().unwrap();
        activate_allowed_content_roots(std::slice::from_ref(&old_root), old_request).unwrap();
        let current_request = begin_ui_scan_request().unwrap();
        let read_guard = allowed_content_roots().read().unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        let current_root_for_thread = current_root.clone();
        let worker = std::thread::spawn(move || {
            let result = activate_allowed_content_roots(
                std::slice::from_ref(&current_root_for_thread),
                current_request,
            );
            sender.send(result).unwrap();
        });

        assert!(receiver
            .recv_timeout(std::time::Duration::from_millis(50))
            .is_err());
        drop(read_guard);
        assert!(receiver
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap()
            .unwrap());
        worker.join().unwrap();
    }

    #[test]
    fn detects_unityfs_payload() {
        assert!(is_unity_asset_bundle(b"UnityFS\0\0"));
        assert!(!is_unity_asset_bundle(&[0x89, b'P', b'N', b'G']));
    }

    #[test]
    fn skips_mai_compositing_when_export_has_no_mai_cards() {
        let root = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-mai-composite-skip");
        let _ = fs::remove_dir_all(&root);
        let mut messages = Vec::new();

        composite_mai_thumbnails(false, &root, "/official/generated", &mut |message| {
            messages.push(message)
        })
        .unwrap();

        assert!(!root.exists());
        assert_eq!(
            messages,
            ["No MAI card records; skipping MAI composite thumbnails"]
        );
    }

    #[test]
    fn rejects_mai_compositing_when_manifest_shard_is_missing() {
        let root = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-mai-composite-missing-shard");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let error =
            composite_mai_thumbnails(true, &root, "/official/generated", &mut |_| {}).unwrap_err();

        assert!(error.contains("MAI manifest shard is missing"));
        assert!(!root.join(".tools").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn propagates_mai_composite_interpreter_failures() {
        let root = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-mai-composite-interpreter-failure");
        let missing_interpreter = path_string(&root.join("missing-python.exe"));

        let error = run_mai_composite_script(
            &root.join("composite.py"),
            &root,
            "/official/generated",
            std::slice::from_ref(&missing_interpreter),
        )
        .unwrap_err();

        assert!(error.starts_with("MAI composite thumbnails were not generated."));
        assert!(error.contains(&missing_interpreter));
    }

    #[test]
    fn rejects_mai_cards_without_composite_inputs() {
        let root = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-mai-composite-missing-inputs");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let card = r#"{
            "game": "MAI",
            "recordType": "Card",
            "dataName": "card-missing-inputs",
            "printFields": []
        }"#;
        fs::write(root.join("cards.json"), format!(r#"{{"cards":[{card}]}}"#)).unwrap();
        fs::write(
            root.join("cards.mai.json"),
            format!(r#"{{"cards":[{card}]}}"#),
        )
        .unwrap();
        let script_path = root.join("composite.py");
        write_tool_script(
            &script_path,
            MAI_COMPOSITE_SCRIPT,
            "MAI composite thumbnail test",
        )
        .unwrap();

        let error = run_mai_composite_script(
            &script_path,
            &root,
            "/official/generated",
            &python_candidates(),
        )
        .unwrap_err();

        assert!(error.contains("missing typeId/mapId"));
        assert!(!root
            .join("assets")
            .join("thumbs")
            .join("mai")
            .join("card_card-missing-inputs.webp")
            .exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_mai_cards_with_a_missing_character_layer() {
        let root = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-mai-composite-missing-character");
        let _ = fs::remove_dir_all(&root);
        let assets = root.join("assets").join("mai");
        fs::create_dir_all(&assets).unwrap();
        let png = general_purpose::STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=")
            .unwrap();
        fs::write(assets.join("ui_cardbase_0000002_000001.png"), png).unwrap();
        let card = r#"{
            "game": "MAI",
            "recordType": "Card",
            "dataName": "card-missing-character",
            "printFields": [
                {"key": "typeId", "value": "2"},
                {"key": "mapId", "value": "1"},
                {"key": "charaId", "value": "101"}
            ]
        }"#;
        fs::write(root.join("cards.json"), format!(r#"{{"cards":[{card}]}}"#)).unwrap();
        fs::write(
            root.join("cards.mai.json"),
            format!(r#"{{"cards":[{card}]}}"#),
        )
        .unwrap();
        let script_path = root.join("composite.py");
        write_tool_script(
            &script_path,
            MAI_COMPOSITE_SCRIPT,
            "MAI composite thumbnail test",
        )
        .unwrap();

        let error = run_mai_composite_script(
            &script_path,
            &root,
            "/official/generated",
            &python_candidates(),
        )
        .unwrap_err();

        assert!(error.contains("missing character layer"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn atomically_replaces_and_invalidates_cached_mai_thumbnails() {
        let root = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-mai-composite-corrupt-thumbnail");
        let _ = fs::remove_dir_all(&root);
        let assets = root.join("assets").join("mai");
        let thumbs = root.join("assets").join("thumbs").join("mai");
        fs::create_dir_all(&assets).unwrap();
        fs::create_dir_all(&thumbs).unwrap();
        let png = general_purpose::STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=")
            .unwrap();
        fs::write(assets.join("ui_cardbase_0000002_000001.png"), &png).unwrap();
        let output = thumbs.join("card_card-valid.webp");
        fs::write(&output, b"not a webp").unwrap();
        let card = r#"{
            "game": "MAI",
            "recordType": "Card",
            "dataName": "card-valid",
            "printFields": [
                {"key": "typeId", "value": "2"},
                {"key": "mapId", "value": "1"},
                {"key": "charaId", "value": "0"}
            ]
        }"#;
        fs::write(root.join("cards.json"), format!(r#"{{"cards":[{card}]}}"#)).unwrap();
        fs::write(
            root.join("cards.mai.json"),
            format!(r#"{{"cards":[{card}]}}"#),
        )
        .unwrap();
        let script_path = root.join("composite.py");
        write_tool_script(
            &script_path,
            MAI_COMPOSITE_SCRIPT,
            "MAI composite thumbnail test",
        )
        .unwrap();

        run_mai_composite_script(
            &script_path,
            &root,
            "/official/generated",
            &python_candidates(),
        )
        .unwrap();

        let image = fs::read(&output).unwrap();
        assert!(image.len() > 12);
        assert_eq!(&image[..4], b"RIFF");
        assert_eq!(&image[8..12], b"WEBP");
        let manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(root.join("cards.json")).unwrap()).unwrap();
        assert_eq!(
            manifest["cards"][0]["thumbnailPath"],
            "/official/generated/assets/thumbs/mai/card_card-valid.webp"
        );
        let cache_path = root.join(".tools").join("mai-composite-cache.json");
        let cache_before = fs::read_to_string(&cache_path).unwrap();
        let card_with_character = r#"{
            "game": "MAI",
            "recordType": "Card",
            "dataName": "card-valid",
            "printFields": [
                {"key": "typeId", "value": "2"},
                {"key": "mapId", "value": "1"},
                {"key": "charaId", "value": "101"}
            ]
        }"#;
        fs::write(
            root.join("cards.json"),
            format!(r#"{{"cards":[{card_with_character}]}}"#),
        )
        .unwrap();
        fs::write(
            root.join("cards.mai.json"),
            format!(r#"{{"cards":[{card_with_character}]}}"#),
        )
        .unwrap();

        let error = run_mai_composite_script(
            &script_path,
            &root,
            "/official/generated",
            &python_candidates(),
        )
        .unwrap_err();
        assert!(error.contains("missing character layer"));
        assert_eq!(fs::read(&output).unwrap(), image);
        assert_eq!(fs::read_to_string(&cache_path).unwrap(), cache_before);

        fs::write(assets.join("ui_cardchara_000101.png"), &png).unwrap();
        run_mai_composite_script(
            &script_path,
            &root,
            "/official/generated",
            &python_candidates(),
        )
        .unwrap();
        assert_ne!(fs::read_to_string(&cache_path).unwrap(), cache_before);
        assert!(!fs::read_dir(&root).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
        assert!(!fs::read_dir(&thumbs).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn exports_online_manifest_with_static_urls() {
        let root = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-online-export");
        let package = root.join("package");
        let output = root.join("generated");
        let _ = fs::remove_dir_all(&root);
        let previous_extra_roots = std::env::var_os("CARDVIEWER_EXTRA_CONTENT_ROOTS");
        std::env::set_var("CARDVIEWER_EXTRA_CONTENT_ROOTS", root.join("extra-content"));

        let card_dir = package
            .join("CardMaker_Data")
            .join("StreamingAssets")
            .join("CHU")
            .join("Data")
            .join("A000")
            .join("card")
            .join("card00001002");
        fs::create_dir_all(&card_dir).unwrap();
        let png = general_purpose::STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=")
            .unwrap();
        fs::write(card_dir.join("CHU_card_00001002.png"), png).unwrap();
        fs::write(
            card_dir.join("Card.xml"),
            r#"
<CardData>
  <dataName>card00001002</dataName>
  <name><id>1002</id><str>card00001002</str></name>
  <image><path>CHU_card_00001002.png</path></image>
  <charaName>Export Test</charaName>
</CardData>"#,
        )
        .unwrap();

        let result = export_online_package_impl(
            path_string(&package),
            path_string(&output),
            "/static/cards".into(),
        )
        .unwrap();

        assert_eq!(result.card_count, 1);
        assert_eq!(result.public_manifest_url, "/static/cards/cards.json");
        assert_eq!(
            result.public_index_manifest_url,
            "/static/cards/cards.index.json"
        );
        assert_eq!(result.shard_count, 1);
        // The online pipeline transcodes the full card art to WebP.
        assert!(output
            .join("assets")
            .join("chu")
            .join("CHU_card_00001002.webp")
            .exists());
        assert!(output
            .join("assets")
            .join("thumbs")
            .join("chu")
            .join("CHU_card_00001002.webp")
            .exists());

        let manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(output.join("cards.json")).unwrap()).unwrap();
        assert_eq!(
            manifest["cards"][0]["imagePath"],
            "/static/cards/assets/chu/CHU_card_00001002.webp"
        );
        assert_eq!(
            manifest["cards"][0]["thumbnailPath"],
            "/static/cards/assets/thumbs/chu/CHU_card_00001002.webp"
        );
        let index: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(output.join("cards.index.json")).unwrap())
                .unwrap();
        assert_eq!(index["totalCards"], 1);
        assert_eq!(index["shards"][0]["href"], "cards.chu.json");
        let shard: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(output.join("cards.chu.json")).unwrap())
                .unwrap();
        assert_eq!(shard["cards"][0]["dataName"], "card00001002");

        if let Some(previous) = previous_extra_roots {
            std::env::set_var("CARDVIEWER_EXTRA_CONTENT_ROOTS", previous);
        } else {
            std::env::remove_var("CARDVIEWER_EXTRA_CONTENT_ROOTS");
        }
    }

    #[test]
    fn exports_mobile_pack_with_manifest_and_integrity() {
        let root = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-mobile-pack");
        let package = root.join("package");
        let output = root.join("CardMakerMobilePack.cmpack");
        let _ = fs::remove_dir_all(&root);
        let previous_extra_roots = std::env::var_os("CARDVIEWER_EXTRA_CONTENT_ROOTS");
        let previous_mobile_mode = std::env::var_os("CARDVIEWER_MOBILE_REFERENCED_ONLY");
        std::env::set_var("CARDVIEWER_EXTRA_CONTENT_ROOTS", root.join("extra-content"));
        std::env::set_var("CARDVIEWER_MOBILE_REFERENCED_ONLY", "1");

        let card_dir = package
            .join("CardMaker_Data")
            .join("StreamingAssets")
            .join("CHU")
            .join("Data")
            .join("A000")
            .join("card")
            .join("card00001002");
        fs::create_dir_all(&card_dir).unwrap();
        let png = general_purpose::STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=")
            .unwrap();
        fs::write(card_dir.join("CHU_card_00001002.png"), png).unwrap();
        fs::write(
            card_dir.join("Card.xml"),
            r#"
<CardData>
  <dataName>card00001002</dataName>
  <name><id>1002</id><str>card00001002</str></name>
  <image><path>CHU_card_00001002.png</path></image>
  <charaName>Mobile Pack Test</charaName>
</CardData>"#,
        )
        .unwrap();

        let result = export_mobile_pack_impl(path_string(&package), path_string(&output)).unwrap();

        assert_eq!(result.card_count, 1);
        assert_eq!(result.shard_count, 1);
        assert_eq!(result.asset_count, 1);
        assert!(output.exists());
        assert!(result.pack_size_bytes > 0);
        let staging = PathBuf::from(&result.staging_root);
        assert!(staging.join("manifest.json").exists());
        assert!(staging.join("cards.json").exists());
        assert!(staging.join("assets").join("index.json").exists());
        assert!(staging.join("integrity").join("files.json").exists());

        let cards: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(staging.join("cards.json")).unwrap()).unwrap();
        assert_eq!(cards["cards"][0]["game"], "CHU");
        assert!(cards["cards"][0]["imagePath"]
            .as_str()
            .unwrap()
            .starts_with("assets/chu/CHU/Data/A000/card/card00001002/"));

        let manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(staging.join("manifest.json")).unwrap())
                .unwrap();
        assert_eq!(manifest["packFormat"], "cmpack-ustar-v1");
        assert_eq!(manifest["assetIndex"], "assets/index.json");
        assert_eq!(
            manifest["resourcePolicy"]["noGeneratedPlaceholderArt"],
            true
        );
        let asset_index: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(staging.join("assets").join("index.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(asset_index["schemaVersion"], 1);

        let integrity: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(staging.join("integrity").join("files.json")).unwrap(),
        )
        .unwrap();
        assert!(integrity["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|file| file["path"] == "manifest.json"));
        assert!(integrity["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|file| file["path"] == "cards.json"));

        if let Some(previous) = previous_extra_roots {
            std::env::set_var("CARDVIEWER_EXTRA_CONTENT_ROOTS", previous);
        } else {
            std::env::remove_var("CARDVIEWER_EXTRA_CONTENT_ROOTS");
        }
        if let Some(previous) = previous_mobile_mode {
            std::env::set_var("CARDVIEWER_MOBILE_REFERENCED_ONLY", previous);
        } else {
            std::env::remove_var("CARDVIEWER_MOBILE_REFERENCED_ONLY");
        }
    }

    #[test]
    fn scans_configured_package_root() {
        let Ok(root) = std::env::var("CARDVIEWER_SCAN_ROOT") else {
            return;
        };
        let _guard = lock_image_access_test_state();
        if std::env::var_os("CARDVIEWER_CACHE_DIR").is_none() {
            std::env::set_var(
                "CARDVIEWER_CACHE_DIR",
                std::env::current_dir()
                    .unwrap()
                    .join("target")
                    .join("test-cache"),
            );
        }

        let result = scan_package_impl(root).unwrap();
        assert!(result.stats.chu_cards > 0);
        assert!(result.stats.mai_cards > 0);
        assert!(result.stats.mu3_asset_cards > 0);
        assert!(result.stats.mu3_xml_records > 0);
        assert!(result
            .cards
            .iter()
            .all(|card| !card.print_fields.is_empty()));
        let Some(mu3_sample) = result
            .cards
            .iter()
            .find(|card| card.game == "MU3" && card.id == "100001" && card.record_type == "Card")
        else {
            panic!("missing MU3 sample card");
        };
        for key in ["mu3Chara", "mu3Mask"] {
            assert!(
                mu3_sample.asset_layers.iter().any(|layer| layer.key == key),
                "missing {key} on MU3 sample"
            );
        }
        for game in ["MAI", "MU3"] {
            let Some(image_path) = result.cards.iter().find_map(|card| {
                if card.game == game {
                    card.image_path.clone()
                } else {
                    None
                }
            }) else {
                panic!("missing {game} image path");
            };
            let data_url = read_image_data_url_impl(image_path).unwrap();
            assert!(data_url.starts_with("data:image/png;base64,"));
        }
        println!(
            "cards={}, chu={}, mai_cards={}, mai_types={}, mu3_assets={}, png={}, unityfs={}",
            result.cards.len(),
            result.stats.chu_cards,
            result.stats.mai_cards,
            result.stats.mai_card_types,
            result.stats.mu3_asset_cards,
            result.stats.png_assets,
            result.stats.unity_bundles
        );
    }

    #[test]
    fn saves_edit_session_json() {
        let test_dir = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-edits");
        std::env::set_var("CARDVIEWER_EDIT_DIR", &test_dir);
        let path = save_edit_session_impl(
            "I:\\package".into(),
            r#"{"card00001002":{"combo":999}}"#.into(),
        )
        .unwrap();
        assert!(Path::new(&path).exists());
    }
}
