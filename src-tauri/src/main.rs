mod scanner;

use scanner::{
    export_mobile_pack_impl, export_online_package_impl, read_image_data_url_impl,
    save_edit_session_impl, scan_package_impl, MobilePackResult, OnlineExportResult, ScanResult,
};

#[tauri::command]
fn scan_package(package_root: String) -> Result<ScanResult, String> {
    scan_package_impl(package_root)
}

#[tauri::command]
fn read_image_data_url(path: String) -> Result<String, String> {
    read_image_data_url_impl(path)
}

#[tauri::command]
fn save_edit_session(package_root: String, edits_json: String) -> Result<String, String> {
    save_edit_session_impl(package_root, edits_json)
}

#[tauri::command]
fn export_online_package(
    package_root: String,
    output_root: String,
    public_base_url: String,
) -> Result<OnlineExportResult, String> {
    export_online_package_impl(package_root, output_root, public_base_url)
}

#[tauri::command]
fn export_mobile_pack(
    package_root: String,
    output_path: String,
) -> Result<MobilePackResult, String> {
    export_mobile_pack_impl(package_root, output_path)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_package,
            read_image_data_url,
            save_edit_session,
            export_online_package,
            export_mobile_pack
        ])
        .run(tauri::generate_context!())
        .expect("failed to run ConfigArc Card Viewer");
}
