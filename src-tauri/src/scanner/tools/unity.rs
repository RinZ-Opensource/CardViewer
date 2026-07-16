use rayon::prelude::*;
use serde::Serialize;
use std::{
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    process::Command,
    time::UNIX_EPOCH,
};

use super::{python_candidates, write_tool_script};
use crate::scanner::fsutil::path_string;

const UNITY_EXTRACT_SCRIPT: &str = include_str!("../../../scripts/extract_unity_image.py");
const UNITY_BUNDLE_EXTRACT_SCRIPT: &str = include_str!("../../../scripts/extract_unity_bundle.py");

#[derive(Clone, Debug, Serialize)]
pub(in crate::scanner) struct UnityExtractJob {
    source: String,
    output: String,
}

impl UnityExtractJob {
    pub(in crate::scanner) fn new(source: &Path, output: &Path) -> Self {
        Self {
            source: path_string(source),
            output: path_string(output),
        }
    }
}

pub(in crate::scanner) fn extract_unity_image_jobs<F>(
    script_path: &Path,
    tools_dir: &Path,
    jobs: Vec<UnityExtractJob>,
    progress: &mut F,
) -> Vec<String>
where
    F: FnMut(String),
{
    if jobs.is_empty() {
        return Vec::new();
    }

    let total = jobs.len();
    let mut warnings = Vec::new();
    if let Err(err) = write_extract_script(script_path) {
        warnings.push(err);
    }
    if let Err(err) = fs::create_dir_all(tools_dir) {
        warnings.push(format!("Failed to create Unity job directory: {err}"));
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
    let chunk_warnings: Vec<String> = jobs
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
    warnings.extend(chunk_warnings);

    // Unity outputs are intermediate PNGs that feed the WebP transcode pass,
    // so the final asset is counted by the caller, not here.
    for job in &jobs {
        if !Path::new(&job.output).exists() {
            warnings.push(format!(
                "Skipped asset {}: Unity extraction produced no image",
                job.source
            ));
        }
    }
    warnings
}

pub(in crate::scanner) fn extract_unity_image_to_cache(
    asset_path: &Path,
) -> Result<PathBuf, String> {
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

pub(in crate::scanner) fn extract_unity_image_to_path(
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

pub(in crate::scanner) fn extract_unity_bundle_to_mobile_dir(
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

/// Runs one UnityPy extraction command. All Unity entry points use this so
/// interpreter discovery, PYTHONPATH wiring, and error aggregation stay aligned.
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

fn unity_worker_count() -> usize {
    let configured = std::env::var("CARDVIEWER_UNITY_WORKERS").ok();
    let cores = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(4);
    resolve_unity_worker_count(configured.as_deref(), cores)
}

fn resolve_unity_worker_count(configured: Option<&str>, cores: usize) -> usize {
    if let Some(count) = configured
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|count| *count > 0)
    {
        return count;
    }
    cores.min(4)
}

fn write_extract_script(script_path: &Path) -> Result<(), String> {
    write_tool_script(script_path, UNITY_EXTRACT_SCRIPT, "Unity extraction")
}

fn write_bundle_extract_script(script_path: &Path) -> Result<(), String> {
    write_tool_script(
        script_path,
        UNITY_BUNDLE_EXTRACT_SCRIPT,
        "Unity bundle extraction",
    )
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worker_count_honors_positive_configuration_and_caps_defaults() {
        assert_eq!(resolve_unity_worker_count(Some(" 7 "), 16), 7);
        assert_eq!(resolve_unity_worker_count(Some("0"), 16), 4);
        assert_eq!(resolve_unity_worker_count(Some("invalid"), 2), 2);
        assert_eq!(resolve_unity_worker_count(None, 12), 4);
    }

    #[test]
    fn cache_keys_are_stable_and_path_sensitive() {
        let first = Path::new("assets/mai/card.asset");
        let second = Path::new("assets/mai/other.asset");
        assert_eq!(unity_cache_key(first), unity_cache_key(first));
        assert_ne!(unity_cache_key(first), unity_cache_key(second));
    }

    #[test]
    fn extract_jobs_keep_the_python_json_contract() {
        let job = UnityExtractJob::new(Path::new("source.asset"), Path::new("output.png"));
        let value = serde_json::to_value(job).unwrap();
        assert_eq!(value["source"], "source.asset");
        assert_eq!(value["output"], "output.png");
    }
}
