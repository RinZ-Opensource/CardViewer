use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub(crate) fn resolve_export_output_root(output_root: String) -> PathBuf {
    let trimmed = output_root.trim();
    if !trimmed.is_empty() {
        return PathBuf::from(trimmed);
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("private-assets")
        .join("official")
        .join("generated")
}

pub(crate) fn normalize_public_base_url(value: &str) -> String {
    let trimmed = value.trim();
    let base = if trimmed.is_empty() {
        "/official/generated"
    } else {
        trimmed
    };
    let normalized = base.trim_end_matches('/');
    if normalized.is_empty() {
        "/".to_string()
    } else {
        normalized.to_string()
    }
}

/// Reads a boolean feature flag from an environment variable. Treats
/// `1`/`true`/`yes`/`on` (case-insensitive, trimmed) as enabled; anything else
/// (including an unset variable) is disabled.
fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .map(|value| {
            let value = value.trim().to_ascii_lowercase();
            matches!(value.as_str(), "1" | "true" | "yes" | "on")
        })
        .unwrap_or(false)
}

pub(crate) fn export_force_enabled() -> bool {
    env_flag("CARDVIEWER_EXPORT_FORCE")
}

pub(crate) fn export_all_assets_enabled() -> bool {
    env_flag("CARDVIEWER_EXPORT_ALL_ASSETS")
}

pub(crate) fn export_prune_enabled() -> bool {
    env_flag("CARDVIEWER_EXPORT_PRUNE")
}

pub(crate) fn mobile_referenced_only_enabled() -> bool {
    env_flag("CARDVIEWER_MOBILE_REFERENCED_ONLY")
}

pub(crate) fn mobile_skip_raw_enabled() -> bool {
    env_flag("CARDVIEWER_MOBILE_SKIP_RAW")
}

pub(crate) fn mobile_card_limit_per_game() -> Option<usize> {
    std::env::var("CARDVIEWER_MOBILE_CARD_LIMIT_PER_GAME")
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|limit| *limit > 0)
}

pub(crate) fn mobile_card_id_filter() -> Option<HashSet<(String, String)>> {
    let value = std::env::var("CARDVIEWER_MOBILE_CARD_IDS").ok()?;
    let mut filters = HashSet::new();
    for token in value.split([',', ';', '\n', '\r']) {
        let token = token.trim();
        if token.is_empty() {
            continue;
        }
        let (game, id) = token
            .split_once(':')
            .or_else(|| token.split_once('='))
            .unwrap_or(("", token));
        let game = game.trim().to_ascii_uppercase();
        let id = id.trim().to_string();
        if id.is_empty() {
            continue;
        }
        filters.insert((game, id));
    }
    if filters.is_empty() {
        None
    } else {
        Some(filters)
    }
}

pub(crate) fn mobile_card_id_filter_label(filters: &HashSet<(String, String)>) -> String {
    let mut values: Vec<String> = filters
        .iter()
        .map(|(game, id)| {
            if game.is_empty() {
                id.clone()
            } else {
                format!("{game}:{id}")
            }
        })
        .collect();
    values.sort();
    values.join(",")
}
