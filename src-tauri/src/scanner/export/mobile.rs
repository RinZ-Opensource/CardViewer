use super::{game_asset_group, is_web_asset_path, set_print_field_value, write_manifest_shards};
use crate::scanner::{
    archive::{archive_path, path_from_archive_path, write_cmpack_archive},
    asset_format::{
        detect_image_mime, image_export_file_name, is_image_extension, is_unity_asset_bundle,
        read_file_header,
    },
    chrono_like_timestamp,
    config::{
        export_force_enabled, mobile_card_id_filter, mobile_card_id_filter_label,
        mobile_card_limit_per_game, mobile_referenced_only_enabled, mobile_skip_raw_enabled,
    },
    discover_content_roots,
    fsutil::{path_string, walk_files},
    games::content_asset_dirs,
    scan_package,
    tools::{extract_unity_bundle_to_mobile_dir, extract_unity_image_to_path},
    types::{CardRecord, MobilePackResult, ScanResult, ScanStats},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

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
        write_manifest_shards(&scan, &staging_root, &mut progress)?;
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

fn hex_bytes(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
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
    use base64::{engine::general_purpose, Engine};

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
}
