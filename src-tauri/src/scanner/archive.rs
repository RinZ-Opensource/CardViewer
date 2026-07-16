use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

pub(super) fn write_cmpack_archive(
    staging_root: &Path,
    output_path: &Path,
    mut files: Vec<PathBuf>,
) -> Result<(usize, u64), String> {
    files.sort();
    let entries = files
        .into_iter()
        .map(|file| {
            let relative_path = file.strip_prefix(staging_root).map_err(|_| {
                format!("archive source is outside staging root: {}", file.display())
            })?;
            let archive_name = archive_path(relative_path)?;
            Ok((file, archive_name))
        })
        .collect::<Result<Vec<_>, String>>()?;

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create archive directory: {err}"))?;
    }
    let mut output = fs::File::create(output_path).map_err(|err| {
        format!(
            "Failed to create mobile pack {}: {err}",
            output_path.display()
        )
    })?;
    let mut count = 0usize;
    for (file, archive_name) in entries {
        write_ustar_file(&mut output, &archive_name, &file)?;
        count += 1;
    }
    output
        .write_all(&[0u8; 1024])
        .map_err(|err| format!("Failed to finalize mobile pack: {err}"))?;
    output
        .flush()
        .map_err(|err| format!("Failed to flush mobile pack: {err}"))?;
    let size = fs::metadata(output_path)
        .map_err(|err| format!("Failed to inspect mobile pack: {err}"))?
        .len();
    Ok((count, size))
}

fn write_ustar_file(
    output: &mut fs::File,
    archive_name: &str,
    source: &Path,
) -> Result<(), String> {
    let data = fs::read(source)
        .map_err(|err| format!("Failed to read archive source {}: {err}", source.display()))?;
    let header = ustar_header(archive_name, data.len() as u64)?;
    output
        .write_all(&header)
        .map_err(|err| format!("Failed to write archive header for {archive_name}: {err}"))?;
    output
        .write_all(&data)
        .map_err(|err| format!("Failed to write archive data for {archive_name}: {err}"))?;
    let padding = (512 - (data.len() % 512)) % 512;
    if padding > 0 {
        output
            .write_all(&vec![0u8; padding])
            .map_err(|err| format!("Failed to write archive padding for {archive_name}: {err}"))?;
    }
    Ok(())
}

fn ustar_header(archive_name: &str, size: u64) -> Result<[u8; 512], String> {
    let (name, prefix) = split_ustar_name(archive_name)?;
    let mut header = [0u8; 512];
    write_tar_field(&mut header[0..100], name.as_bytes());
    write_tar_octal(&mut header[100..108], 0o644);
    write_tar_octal(&mut header[108..116], 0);
    write_tar_octal(&mut header[116..124], 0);
    write_tar_octal(&mut header[124..136], size);
    write_tar_octal(&mut header[136..148], unix_timestamp_secs());
    for byte in &mut header[148..156] {
        *byte = b' ';
    }
    header[156] = b'0';
    write_tar_field(&mut header[257..263], b"ustar\0");
    write_tar_field(&mut header[263..265], b"00");
    write_tar_field(&mut header[345..500], prefix.as_bytes());
    let checksum: u32 = header.iter().map(|byte| *byte as u32).sum();
    let checksum_text = format!("{checksum:06o}\0 ");
    write_tar_field(&mut header[148..156], checksum_text.as_bytes());
    Ok(header)
}

fn split_ustar_name(archive_name: &str) -> Result<(String, String), String> {
    let normalized = archive_name.replace('\\', "/");
    if normalized.len() <= 100 {
        return Ok((normalized, String::new()));
    }
    let mut best = None;
    for (index, ch) in normalized.char_indices() {
        if ch != '/' {
            continue;
        }
        let prefix = &normalized[..index];
        let name = &normalized[index + 1..];
        if prefix.len() <= 155 && name.len() <= 100 {
            best = Some((name.to_string(), prefix.to_string()));
        }
    }
    best.ok_or_else(|| format!("archive path is too long for cmpack v1: {normalized}"))
}

fn write_tar_field(target: &mut [u8], value: &[u8]) {
    let len = target.len().min(value.len());
    target[..len].copy_from_slice(&value[..len]);
}

fn write_tar_octal(target: &mut [u8], value: u64) {
    let text = format!("{value:0width$o}\0", width = target.len() - 1);
    write_tar_field(target, text.as_bytes());
}

pub(super) fn archive_path(path: &Path) -> Result<String, String> {
    let mut parts = Vec::new();
    for component in path.components() {
        let value = component.as_os_str().to_string_lossy();
        if value.is_empty() || value == "." {
            continue;
        }
        if value == ".." {
            return Err(format!("archive path escapes root: {}", path.display()));
        }
        parts.push(value.replace('\\', "/"));
    }
    if parts.is_empty() {
        Err("empty archive path".to_string())
    } else {
        Ok(parts.join("/"))
    }
}

pub(super) fn path_from_archive_path(path: &str) -> PathBuf {
    path.split('/')
        .filter(|part| !part.is_empty())
        .fold(PathBuf::new(), |acc, part| acc.join(part))
}

fn unix_timestamp_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_paths_are_normalized_and_cannot_escape() {
        assert_eq!(
            archive_path(Path::new("assets\\chu/card.png")).unwrap(),
            "assets/chu/card.png"
        );
        assert!(archive_path(Path::new("../outside.png")).is_err());
        assert!(archive_path(Path::new(".")).is_err());
    }

    #[test]
    fn ustar_paths_use_prefix_and_reject_unrepresentable_names() {
        let prefix = "a".repeat(101);
        let archive_name = format!("{prefix}/card.png");
        assert_eq!(
            split_ustar_name(&archive_name).unwrap(),
            ("card.png".to_string(), prefix)
        );

        let too_long_prefix = "a".repeat(156);
        assert!(split_ustar_name(&format!("{too_long_prefix}/card.png")).is_err());
        assert!(split_ustar_name(&"n".repeat(101)).is_err());
    }

    #[test]
    fn cmpack_archive_rejects_sources_outside_staging_root() {
        let root = unique_test_root("outside-root");
        let staging = root.join("staging");
        let outside = root.join("outside.txt");
        let output = root.join("test.cmpack");
        fs::create_dir_all(&staging).unwrap();
        fs::write(&outside, b"outside").unwrap();

        let error = write_cmpack_archive(&staging, &output, vec![outside]).unwrap_err();

        assert!(error.contains("outside staging root"));
        assert!(!output.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cmpack_archive_sorts_files_and_writes_ustar_footer() {
        let root = unique_test_root("layout");
        let staging = root.join("staging");
        let output = root.join("test.cmpack");
        fs::create_dir_all(&staging).unwrap();
        let first = staging.join("a.txt");
        let second = staging.join("b.txt");
        fs::write(&first, b"a").unwrap();
        fs::write(&second, b"b").unwrap();

        let (count, size) = write_cmpack_archive(&staging, &output, vec![second, first]).unwrap();
        let bytes = fs::read(&output).unwrap();

        assert_eq!(count, 2);
        assert_eq!(size, 3072);
        assert_eq!(&bytes[0..5], b"a.txt");
        assert_eq!(&bytes[1024..1029], b"b.txt");
        assert_eq!(&bytes[257..263], b"ustar\0");
        let stored_checksum =
            u32::from_str_radix(std::str::from_utf8(&bytes[148..154]).unwrap().trim(), 8).unwrap();
        let mut checksum_header = bytes[..512].to_vec();
        checksum_header[148..156].fill(b' ');
        let calculated_checksum = checksum_header
            .iter()
            .map(|byte| u32::from(*byte))
            .sum::<u32>();
        assert_eq!(stored_checksum, calculated_checksum);
        assert!(bytes[bytes.len() - 1024..].iter().all(|byte| *byte == 0));

        fs::remove_dir_all(root).unwrap();
    }

    fn unique_test_root(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "cardviewer-archive-{label}-{}-{unique}",
            std::process::id()
        ))
    }
}
