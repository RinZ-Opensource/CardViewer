use std::{fs, path::Path, path::PathBuf};

pub(in crate::scanner) fn python_candidates() -> Vec<String> {
    if let Some(python) = std::env::var_os("CARDVIEWER_PYTHON") {
        return vec![PathBuf::from(python).to_string_lossy().into_owned()];
    }

    vec!["py".into(), "python".into(), "python3".into()]
}

pub(in crate::scanner) fn write_tool_script(
    script_path: &Path,
    content: &str,
    label: &str,
) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    #[test]
    fn tool_scripts_create_parents_and_skip_identical_files() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "cardviewer-tool-script-{}-{unique}",
            std::process::id()
        ));
        let script = root.join("nested").join("tool.py");

        write_tool_script(&script, "print('ok')\n", "test").unwrap();
        assert_eq!(fs::read_to_string(&script).unwrap(), "print('ok')\n");
        let modified = fs::metadata(&script).unwrap().modified().unwrap();

        std::thread::sleep(Duration::from_millis(20));
        write_tool_script(&script, "print('ok')\n", "test").unwrap();
        assert_eq!(fs::metadata(&script).unwrap().modified().unwrap(), modified);

        fs::remove_dir_all(root).unwrap();
    }
}
