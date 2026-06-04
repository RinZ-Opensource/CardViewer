use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub package_root: String,
    pub streaming_assets: String,
    pub cards: Vec<CardRecord>,
    pub stats: ScanStats,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineExportResult {
    pub package_root: String,
    pub output_root: String,
    pub manifest_path: String,
    pub index_manifest_path: String,
    pub public_manifest_url: String,
    pub public_index_manifest_url: String,
    pub public_base_url: String,
    pub card_count: usize,
    pub shard_count: usize,
    pub asset_count: usize,
    pub reused_asset_count: usize,
    pub skipped_asset_count: usize,
    pub pruned_asset_count: usize,
    pub thumbnail_count: usize,
    pub reused_thumbnail_count: usize,
    pub skipped_thumbnail_count: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobilePackResult {
    pub package_root: String,
    pub output_path: String,
    pub staging_root: String,
    pub manifest_path: String,
    pub cards_manifest_path: String,
    pub index_manifest_path: String,
    pub card_count: usize,
    pub shard_count: usize,
    pub asset_count: usize,
    pub reused_asset_count: usize,
    pub skipped_asset_count: usize,
    pub raw_file_count: usize,
    pub bundle_count: usize,
    pub bundle_object_count: usize,
    pub pack_file_count: usize,
    pub pack_size_bytes: u64,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStats {
    pub chu_cards: usize,
    pub mai_cards: usize,
    pub mai_card_types: usize,
    pub mai_card_charas: usize,
    pub mu3_asset_cards: usize,
    pub mu3_xml_records: usize,
    pub png_assets: usize,
    pub unity_bundles: usize,
    pub unity_bundle_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardRecord {
    pub id: String,
    pub game: String,
    pub record_type: String,
    pub data_name: String,
    pub display_name: String,
    pub character_name: String,
    pub skill_name: String,
    pub skill_text: String,
    pub rare_type: Option<i32>,
    pub label_type: Option<i32>,
    pub dif_type: Option<i32>,
    pub miss: Option<i32>,
    pub combo: Option<i32>,
    pub chain: Option<i32>,
    pub image_path: Option<String>,
    pub thumbnail_path: Option<String>,
    pub asset_layers: Vec<AssetLayer>,
    // Local build-machine path; cleared for the online manifest (privacy + size),
    // so omit it when empty rather than emitting a useless "".
    #[serde(skip_serializing_if = "String::is_empty")]
    pub source_xml: String,
    pub editable_fields: Vec<String>,
    pub print_fields: Vec<PrintField>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetLayer {
    pub key: String,
    pub label: String,
    pub path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintField {
    pub key: String,
    pub label: String,
    pub field_type: String,
    pub value: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<PrintOption>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintOption {
    pub value: String,
    pub label: String,
}
