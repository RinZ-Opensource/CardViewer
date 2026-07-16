use std::path::{Path, PathBuf};

use super::super::fsutil::{path_string, same_path};

pub(super) fn resolve_content_asset(
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

pub(in crate::scanner) fn resolve_content_asset_with_fallback_roots(
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

pub(in crate::scanner) fn resolve_content_asset_root_with_fallback_roots(
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

pub(in crate::scanner) fn content_asset_dirs(
    content_root: &Path,
    game: &str,
    asset_dir: &str,
) -> Vec<PathBuf> {
    vec![
        content_root.join(asset_dir),
        content_root.join(game).join(asset_dir),
    ]
}

pub(in crate::scanner) fn game_data_leaf_roots(
    content_root: &Path,
    game: &str,
    leaf: &str,
) -> Vec<PathBuf> {
    vec![
        content_root.join(game).join("Data").join("A000").join(leaf),
        content_root.join(game).join(leaf),
    ]
}

pub(in crate::scanner) fn game_data_pack_paths(content_root: &Path, game: &str) -> Vec<PathBuf> {
    vec![
        content_root.join(game).join("Data").join("A000.pac"),
        content_root.join(game).join("A000.pac"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn test_root(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "cardviewer-game-paths-{label}-{}-{unique}",
            std::process::id()
        ))
    }

    #[test]
    fn constructs_content_paths_in_priority_order() {
        let root = Path::new("content");
        assert_eq!(
            content_asset_dirs(root, "MAI", "assets_mai"),
            vec![root.join("assets_mai"), root.join("MAI").join("assets_mai")]
        );
        assert_eq!(
            game_data_leaf_roots(root, "CHU", "card"),
            vec![
                root.join("CHU").join("Data").join("A000").join("card"),
                root.join("CHU").join("card"),
            ]
        );
        assert_eq!(
            game_data_pack_paths(root, "MU3"),
            vec![
                root.join("MU3").join("Data").join("A000.pac"),
                root.join("MU3").join("A000.pac"),
            ]
        );
    }

    #[test]
    fn content_asset_resolution_prefers_unscoped_directory() {
        let root = test_root("local-priority");
        let unscoped = root.join("assets_mai").join("card.asset");
        let scoped = root.join("MAI").join("assets_mai").join("card.asset");
        fs::create_dir_all(unscoped.parent().unwrap()).unwrap();
        fs::create_dir_all(scoped.parent().unwrap()).unwrap();
        fs::write(&unscoped, b"unscoped").unwrap();
        fs::write(&scoped, b"scoped").unwrap();

        assert_eq!(
            resolve_content_asset("card.asset", &root, "MAI", "assets_mai"),
            Some(path_string(&unscoped))
        );

        fs::remove_file(&unscoped).unwrap();
        assert_eq!(
            resolve_content_asset("card.asset", &root, "MAI", "assets_mai"),
            Some(path_string(&scoped))
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn fallback_resolution_prefers_requested_root_then_reverse_root_order() {
        let root = test_root("fallback-priority");
        let earlier = root.join("earlier");
        let preferred = root.join("preferred");
        let later = root.join("later");
        let earlier_asset = earlier.join("assets_mai").join("card.asset");
        let later_asset = later.join("MAI").join("assets_mai").join("card.asset");
        fs::create_dir_all(earlier_asset.parent().unwrap()).unwrap();
        fs::create_dir_all(later_asset.parent().unwrap()).unwrap();
        fs::write(&earlier_asset, b"earlier").unwrap();
        fs::write(&later_asset, b"later").unwrap();
        let content_roots = vec![earlier.clone(), preferred.clone(), later.clone()];

        assert_eq!(
            resolve_content_asset_with_fallback_roots(
                "card.asset",
                &preferred,
                &content_roots,
                "MAI",
                "assets_mai",
            ),
            Some(path_string(&later_asset))
        );
        assert_eq!(
            resolve_content_asset_root_with_fallback_roots(
                &preferred,
                &content_roots,
                "MAI",
                "assets_mai",
            ),
            later_asset.parent().map(Path::to_path_buf)
        );

        let preferred_asset = preferred.join("assets_mai").join("card.asset");
        fs::create_dir_all(preferred_asset.parent().unwrap()).unwrap();
        fs::write(&preferred_asset, b"preferred").unwrap();
        assert_eq!(
            resolve_content_asset_with_fallback_roots(
                "card.asset",
                &preferred,
                &content_roots,
                "MAI",
                "assets_mai",
            ),
            Some(path_string(&preferred_asset))
        );
        assert_eq!(
            resolve_content_asset_root_with_fallback_roots(
                &preferred,
                &content_roots,
                "MAI",
                "assets_mai",
            ),
            preferred_asset.parent().map(Path::to_path_buf)
        );

        fs::remove_dir_all(root).unwrap();
    }
}
