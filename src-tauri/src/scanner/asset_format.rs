use std::{fs, io::Read, path::Path};

pub(super) enum ExportAssetKind {
    Image,
    Unity,
    Unsupported,
}

pub(super) fn image_export_file_name(source_path: &Path) -> Result<String, String> {
    let file_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "missing file name".to_string())?;
    let header = read_file_header(source_path, 16)?;
    let lower_ext = source_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if is_image_extension(&lower_ext) {
        return Ok(file_name.to_string());
    }
    if let Some(mime) = detect_image_mime(&header) {
        return Ok(format!("{file_name}.{}", image_extension_for_mime(mime)));
    }
    if is_unity_asset_bundle(&header) {
        return Ok(format!("{file_name}.png"));
    }

    Err("unsupported image payload".to_string())
}

/// Online-export output name: every supported source (plain image or Unity
/// bundle) becomes `<stem>.webp`, since the online pipeline transcodes all art
/// to WebP. Kept separate from `image_export_file_name` (which the mobile pack
/// still uses to preserve original formats).
pub(super) fn webp_export_file_name(source_path: &Path) -> Result<String, String> {
    let file_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "missing file name".to_string())?;
    let header = read_file_header(source_path, 16)?;
    let lower_ext = source_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let is_image = is_image_extension(&lower_ext) || detect_image_mime(&header).is_some();
    if !is_image && !is_unity_asset_bundle(&header) {
        return Err("unsupported image payload".to_string());
    }
    // For real image files swap the extension; for Unity bundles (no image
    // extension) keep the full name so distinct bundles don't collide.
    let base = if is_image_extension(&lower_ext) {
        source_path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or(file_name)
    } else {
        file_name
    };
    Ok(format!("{base}.webp"))
}

/// Mask and holo layers are transcoded losslessly: lossy WebP would risk
/// degrading the alpha stencil / foil colour, and for these flat images it is
/// often larger than the source anyway. Everything else uses lossy WebP.
pub(super) fn is_lossless_webp_layer(source_path: &Path) -> bool {
    let name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    name.contains("mask") || name.contains("holo")
}

pub(super) fn thumbnail_file_name(source_name: &str) -> String {
    let stem = Path::new(source_name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .unwrap_or(source_name);
    format!("{stem}.webp")
}

pub(super) fn classify_export_asset(source_path: &Path) -> Result<ExportAssetKind, String> {
    let header = read_file_header(source_path, 16)?;
    let lower_ext = source_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if is_image_extension(&lower_ext) || detect_image_mime(&header).is_some() {
        Ok(ExportAssetKind::Image)
    } else if is_unity_asset_bundle(&header) {
        Ok(ExportAssetKind::Unity)
    } else {
        Ok(ExportAssetKind::Unsupported)
    }
}

pub(super) fn read_file_header(path: &Path, max_len: usize) -> Result<Vec<u8>, String> {
    let mut file =
        fs::File::open(path).map_err(|err| format!("Failed to open {}: {err}", path.display()))?;
    let mut header = vec![0u8; max_len];
    let len = file
        .read(&mut header)
        .map_err(|err| format!("Failed to read {}: {err}", path.display()))?;
    header.truncate(len);
    Ok(header)
}

pub(super) fn is_image_extension(ext: &str) -> bool {
    matches!(ext, "png" | "jpg" | "jpeg" | "webp")
}

fn image_extension_for_mime(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => "png",
    }
}

pub(super) fn detect_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("image/jpeg");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    None
}

pub(super) fn is_unity_asset_bundle(bytes: &[u8]) -> bool {
    bytes.starts_with(b"UnityFS")
        || bytes.starts_with(b"UnityWeb")
        || bytes.starts_with(b"UnityRaw")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        path::PathBuf,
        process,
        sync::atomic::{AtomicU64, Ordering},
    };

    static NEXT_TEST_DIR: AtomicU64 = AtomicU64::new(0);

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(label: &str) -> Self {
            let serial = NEXT_TEST_DIR.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "configarc-cardviewer-{label}-{}-{serial}",
                process::id()
            ));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn join(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn detects_supported_image_signatures() {
        assert_eq!(
            detect_image_mime(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]),
            Some("image/png")
        );
        assert_eq!(
            detect_image_mime(&[0xff, 0xd8, 0xff, 0xe0]),
            Some("image/jpeg")
        );
        assert_eq!(detect_image_mime(b"RIFF\0\0\0\0WEBP"), Some("image/webp"));
        assert_eq!(detect_image_mime(b"RIFFshort"), None);
        assert_eq!(detect_image_mime(b"RIFF\0\0\0\0NOPE"), None);
    }

    #[test]
    fn detects_supported_unity_bundle_signatures() {
        for signature in [b"UnityFS".as_slice(), b"UnityWeb", b"UnityRaw"] {
            assert!(is_unity_asset_bundle(signature));
        }
        assert!(!is_unity_asset_bundle(b"Unity"));
        assert!(!is_unity_asset_bundle(b"UnityFZ"));
    }

    #[test]
    fn recognizes_supported_extensions_and_mime_extensions() {
        for extension in ["png", "jpg", "jpeg", "webp"] {
            assert!(is_image_extension(extension));
        }
        assert!(!is_image_extension("PNG"));
        assert!(!is_image_extension("gif"));
        assert_eq!(image_extension_for_mime("image/png"), "png");
        assert_eq!(image_extension_for_mime("image/jpeg"), "jpg");
        assert_eq!(image_extension_for_mime("image/webp"), "webp");
    }

    #[test]
    fn derives_export_names_for_images_and_unity_bundles() {
        let dir = TestDir::new("asset-format-names");
        let image = dir.join("card.PNG");
        let extensionless_png = dir.join("extensionless_png");
        let bundle = dir.join("card_bundle");
        fs::write(&image, b"not inspected when the extension is supported").unwrap();
        fs::write(
            &extensionless_png,
            [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
        )
        .unwrap();
        fs::write(&bundle, b"UnityFS").unwrap();

        assert_eq!(image_export_file_name(&image).unwrap(), "card.PNG");
        assert_eq!(webp_export_file_name(&image).unwrap(), "card.webp");
        assert_eq!(
            image_export_file_name(&extensionless_png).unwrap(),
            "extensionless_png.png"
        );
        assert_eq!(image_export_file_name(&bundle).unwrap(), "card_bundle.png");
        assert_eq!(webp_export_file_name(&bundle).unwrap(), "card_bundle.webp");
    }

    #[test]
    fn classifies_supported_and_unsupported_payloads() {
        let dir = TestDir::new("asset-format-classify");
        let image = dir.join("image_without_extension");
        let bundle = dir.join("bundle_without_extension");
        let unsupported = dir.join("unsupported");
        fs::write(&image, [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]).unwrap();
        fs::write(&bundle, b"UnityRaw").unwrap();
        fs::write(&unsupported, b"not an image").unwrap();

        assert!(matches!(
            classify_export_asset(&image),
            Ok(ExportAssetKind::Image)
        ));
        assert!(matches!(
            classify_export_asset(&bundle),
            Ok(ExportAssetKind::Unity)
        ));
        assert!(matches!(
            classify_export_asset(&unsupported),
            Ok(ExportAssetKind::Unsupported)
        ));
        assert_eq!(
            image_export_file_name(&unsupported).unwrap_err(),
            "unsupported image payload"
        );
        assert_eq!(
            webp_export_file_name(&unsupported).unwrap_err(),
            "unsupported image payload"
        );
    }

    #[test]
    fn derives_thumbnail_names_and_lossless_layer_policy() {
        assert_eq!(thumbnail_file_name("card.png"), "card.webp");
        assert_eq!(thumbnail_file_name("extensionless"), "extensionless.webp");
        assert!(is_lossless_webp_layer(Path::new("UI_CARD_MASK_001.png")));
        assert!(is_lossless_webp_layer(Path::new("ui_card_HOLO_001")));
        assert!(!is_lossless_webp_layer(Path::new("ui_card_base_001.png")));
    }
}
