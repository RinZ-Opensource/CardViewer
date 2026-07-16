use crate::scanner::{CardRecord, ScanResult, ScanStats};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestIndex<'a> {
    package_root: &'a str,
    streaming_assets: &'a str,
    stats: &'a ScanStats,
    warnings: &'a [String],
    total_cards: usize,
    shards: Vec<ManifestShardInfo>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestShardInfo {
    key: String,
    game: String,
    href: String,
    card_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestShard<'a> {
    key: &'a str,
    game: &'a str,
    cards: Vec<&'a CardRecord>,
}

fn group_cards_by_game(cards: &[CardRecord]) -> BTreeMap<String, Vec<&CardRecord>> {
    let mut grouped = BTreeMap::new();
    for card in cards {
        grouped
            .entry(card.game.clone())
            .or_insert_with(Vec::new)
            .push(card);
    }
    grouped
}

pub(in crate::scanner) fn write_manifest_shards<F>(
    scan: &ScanResult,
    output_root: &Path,
    progress: &mut F,
) -> Result<(PathBuf, usize), String>
where
    F: FnMut(String),
{
    let grouped = group_cards_by_game(&scan.cards);

    let mut shards = Vec::new();
    for (game, cards) in &grouped {
        let key = game.to_ascii_lowercase();
        let href = format!("cards.{key}.json");
        let path = output_root.join(&href);
        let shard = ManifestShard {
            key: &key,
            game,
            cards: cards.clone(),
        };
        progress(format!(
            "Writing manifest shard: {} ({} records)",
            path.display(),
            cards.len()
        ));
        let body = serde_json::to_string(&shard)
            .map_err(|err| format!("Failed to serialize online manifest shard: {err}"))?;
        fs::write(&path, body)
            .map_err(|err| format!("Failed to write online manifest shard: {err}"))?;
        shards.push(ManifestShardInfo {
            key,
            game: game.clone(),
            href,
            card_count: cards.len(),
        });
    }

    let index = ManifestIndex {
        package_root: &scan.package_root,
        streaming_assets: &scan.streaming_assets,
        stats: &scan.stats,
        warnings: &scan.warnings,
        total_cards: scan.cards.len(),
        shards,
    };
    let index_path = output_root.join("cards.index.json");
    progress(format!("Writing manifest index: {}", index_path.display()));
    let body = serde_json::to_string_pretty(&index)
        .map_err(|err| format!("Failed to serialize online manifest index: {err}"))?;
    fs::write(&index_path, body)
        .map_err(|err| format!("Failed to write online manifest index: {err}"))?;

    Ok((index_path, index.shards.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(game: &str, id: &str) -> CardRecord {
        CardRecord {
            id: id.to_string(),
            game: game.to_string(),
            record_type: "Card".to_string(),
            data_name: id.to_string(),
            display_name: String::new(),
            character_name: String::new(),
            skill_name: String::new(),
            skill_text: String::new(),
            rare_type: None,
            label_type: None,
            dif_type: None,
            miss: None,
            combo: None,
            chain: None,
            image_path: None,
            thumbnail_path: None,
            asset_layers: Vec::new(),
            source_xml: String::new(),
            editable_fields: Vec::new(),
            print_fields: Vec::new(),
        }
    }

    #[test]
    fn groups_shards_by_game_in_stable_order() {
        let cards = vec![
            card("MU3", "mu3-second"),
            card("CHU", "chu-first"),
            card("MU3", "mu3-first"),
            card("MAI", "mai-first"),
        ];

        let grouped = group_cards_by_game(&cards);
        assert_eq!(
            grouped.keys().map(String::as_str).collect::<Vec<_>>(),
            ["CHU", "MAI", "MU3"]
        );
        assert_eq!(
            grouped["MU3"]
                .iter()
                .map(|card| card.id.as_str())
                .collect::<Vec<_>>(),
            ["mu3-second", "mu3-first"]
        );
    }
}
