use super::{game_asset_group, is_web_asset_path, set_print_field_value, write_manifest_shards};
use crate::scanner::{
    asset_format::{
        classify_export_asset, is_lossless_webp_layer, thumbnail_file_name, webp_export_file_name,
        ExportAssetKind,
    },
    config::{
        export_all_assets_enabled, export_force_enabled, export_prune_enabled,
        normalize_public_base_url, resolve_export_output_root,
    },
    discover_content_roots,
    fsutil::{path_string, walk_files},
    games::content_asset_dirs,
    scan_package,
    tools::{extract_unity_image_jobs, python_candidates, write_tool_script, UnityExtractJob},
    CardRecord, OnlineExportResult, ScanResult,
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
};

const THUMBNAIL_SCRIPT: &str = include_str!("../../../scripts/generate_thumbnails.py");
const MAI_COMPOSITE_SCRIPT: &str =
    include_str!("../../../scripts/generate_mai_composite_thumbnails.py");
const ONLINE_THUMBNAIL_MAX_WIDTH: u32 = 192;
const ONLINE_THUMBNAIL_MAX_HEIGHT: u32 = 256;
const ONLINE_THUMBNAIL_QUALITY: u8 = 72;
// Full-size display art (card base / character layers / small variants) is
// transcoded to lossy WebP; mask/holo layers go lossless to keep their alpha
// stencil and foil colour exact. method=6 = slowest/best compression (offline).
const ONLINE_IMAGE_WEBP_QUALITY: u8 = 88;
const ONLINE_IMAGE_WEBP_METHOD: u8 = 6;

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
        write_manifest_shards(&scan, &output_root, &mut progress)?;
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
                self.unity_jobs
                    .push(UnityExtractJob::new(&source_path, &intermediate));
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
        let tools_dir = self.output_root.join(".tools");
        self.warnings.extend(extract_unity_image_jobs(
            &self.unity_extract_script_path,
            &tools_dir,
            std::mem::take(&mut self.unity_jobs),
            progress,
        ));
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

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose, Engine};

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
}
