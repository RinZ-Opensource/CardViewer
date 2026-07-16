use std::{
    fs,
    path::{Path, PathBuf},
};

pub(super) fn find_named_files(root: &Path, file_name: &str) -> Vec<PathBuf> {
    if !root.exists() {
        return Vec::new();
    }

    walk_files(root)
        .into_iter()
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.eq_ignore_ascii_case(file_name))
                .unwrap_or(false)
        })
        .collect()
}

pub(super) fn walk_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(path) = stack.pop() {
        let Ok(entries) = fs::read_dir(&path) else {
            continue;
        };

        for entry in entries.flatten() {
            let child = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };

            if file_type.is_dir() {
                stack.push(child);
            } else if file_type.is_file() {
                files.push(child);
            }
        }
    }

    files
}

pub(super) fn resolve_sibling(xml_path: &Path, relative: &str) -> Option<String> {
    let relative = relative.trim();
    if relative.is_empty() {
        return None;
    }

    let path = xml_path.parent()?.join(relative);
    if path.exists() {
        Some(path_string(&path))
    } else {
        None
    }
}

pub(super) fn same_path(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

pub(super) fn path_string(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_root(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "cardviewer-fsutil-{label}-{}-{unique}",
            std::process::id()
        ))
    }

    #[test]
    fn missing_roots_have_no_files() {
        let root = test_root("missing");
        assert!(!root.exists());
        assert!(walk_files(&root).is_empty());
        assert!(find_named_files(&root, "Card.xml").is_empty());
    }

    #[test]
    fn walks_nested_files_and_finds_names_case_insensitively() {
        let root = test_root("walk");
        let first_dir = root.join("a");
        let second_dir = root.join("b").join("nested");
        fs::create_dir_all(&first_dir).unwrap();
        fs::create_dir_all(&second_dir).unwrap();
        let first = first_dir.join("Card.xml");
        let second = second_dir.join("card.XML");
        let other = second_dir.join("other.bin");
        fs::write(&first, b"first").unwrap();
        fs::write(&second, b"second").unwrap();
        fs::write(&other, b"other").unwrap();

        let walked = walk_files(&root).into_iter().collect::<HashSet<_>>();
        assert_eq!(
            walked,
            HashSet::from([first.clone(), second.clone(), other])
        );

        let named = find_named_files(&root, "card.xml")
            .into_iter()
            .collect::<HashSet<_>>();
        assert_eq!(named, HashSet::from([first, second]));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resolves_existing_siblings_and_formats_paths_for_windows() {
        let root = test_root("sibling");
        fs::create_dir_all(&root).unwrap();
        let xml = root.join("Card.xml");
        let image = root.join("image.png");
        fs::write(&xml, b"xml").unwrap();
        fs::write(&image, b"png").unwrap();

        assert_eq!(
            resolve_sibling(&xml, "  image.png  "),
            Some(path_string(&image))
        );
        assert_eq!(resolve_sibling(&xml, ""), None);
        assert_eq!(resolve_sibling(&xml, "missing.png"), None);
        assert_eq!(
            path_string(Path::new("assets/mai/card.png")),
            "assets\\mai\\card.png"
        );
        assert!(same_path(&root, &root.join(".")));
        assert!(!same_path(&root, &root.join("missing")));

        fs::remove_dir_all(root).unwrap();
    }
}
