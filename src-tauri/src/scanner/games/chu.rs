use rayon::prelude::*;
use std::{
    fs,
    path::{Path, PathBuf},
};

use super::super::{
    fsutil::{find_named_files, path_string, resolve_sibling},
    print_bool, print_field, print_metadata_bool, print_metadata_number, print_number,
    types::{CardRecord, ScanStats},
    xmlutil::{block, int_tag, tag},
};
use super::common::game_data_leaf_roots;

pub(in crate::scanner) fn scan_chu_cards(
    content_root: &Path,
    cards: &mut Vec<CardRecord>,
    stats: &mut ScanStats,
    warnings: &mut Vec<String>,
) {
    let xml_paths: Vec<PathBuf> = game_data_leaf_roots(content_root, "CHU", "card")
        .into_iter()
        .flat_map(|card_root| find_named_files(&card_root, "Card.xml"))
        .collect();
    // Read + parse XMLs in parallel; merge sequentially to preserve order.
    let results: Vec<Result<Option<CardRecord>, String>> = xml_paths
        .par_iter()
        .map(|xml_path| match fs::read_to_string(xml_path) {
            Ok(xml) => Ok(parse_chu_card(xml_path, &xml)),
            Err(err) => Err(format!("Failed to read {}: {err}", xml_path.display())),
        })
        .collect();
    for result in results {
        match result {
            Ok(Some(card)) => {
                stats.chu_cards += 1;
                cards.push(card);
            }
            Ok(None) => {}
            Err(warning) => warnings.push(warning),
        }
    }
}

fn parse_chu_card(xml_path: &Path, xml: &str) -> Option<CardRecord> {
    let data_name = tag(xml, "dataName")?;
    let name_block = block(xml, "name").unwrap_or_default();
    let name_id = tag(&name_block, "id").unwrap_or_default();
    let image = block(xml, "image").and_then(|value| tag(&value, "path"));
    let image_small = block(xml, "imageSmall").and_then(|value| tag(&value, "path"));

    let image_path = image.and_then(|rel| resolve_sibling(xml_path, &rel));
    let thumbnail_path = image_small.and_then(|rel| resolve_sibling(xml_path, &rel));
    let chara_name = tag(xml, "charaName")
        .or_else(|| block(xml, "chuniCharaName").and_then(|value| tag(&value, "str")))
        .unwrap_or_else(|| data_name.clone());
    let skill_name = tag(xml, "skillName").unwrap_or_default();
    let skill_text = tag(xml, "skillText").unwrap_or_default();
    let rare_type = int_tag(xml, "rareType");
    let label_type = int_tag(xml, "labelType");
    let dif_type = int_tag(xml, "difType");
    let miss = int_tag(xml, "miss");
    let combo = int_tag(xml, "combo");
    let chain = int_tag(xml, "chain");

    Some(CardRecord {
        id: if name_id.is_empty() {
            data_name.clone()
        } else {
            name_id.clone()
        },
        game: "CHU".to_string(),
        record_type: "Card".to_string(),
        data_name: data_name.clone(),
        display_name: chara_name.clone(),
        character_name: chara_name.clone(),
        skill_name: skill_name.clone(),
        skill_text: skill_text.clone(),
        rare_type,
        label_type,
        dif_type,
        miss,
        combo,
        chain,
        image_path,
        thumbnail_path,
        asset_layers: Vec::new(),
        source_xml: path_string(xml_path),
        editable_fields: vec![
            "characterName".into(),
            "skillName".into(),
            "skillText".into(),
            "rareType".into(),
            "labelType".into(),
            "difType".into(),
            "miss".into(),
            "combo".into(),
            "chain".into(),
        ],
        print_fields: vec![
            print_field("characterName", "Character name", "text", chara_name),
            print_field("skillName", "Skill name", "text", skill_name),
            print_field("skillText", "Skill description", "multiline", skill_text),
            print_field("serialId", "Serial ID", "text", ""),
            print_metadata_number("rareType", "Rare type", rare_type),
            print_number("labelType", "Label type", label_type),
            print_number("difType", "Difficulty type", dif_type),
            print_number("miss", "MISS count", miss),
            print_number("combo", "COMBO count", combo),
            print_number("chain", "CHAIN count", chain),
            print_metadata_bool("holo", "Holographic print", false),
            print_bool("hideParam", "Hide score parameters", false),
            print_bool("hideSerialId", "Hide serial", false),
            print_bool("hideBackGround", "Hide background label", false),
            print_bool("hideChara", "Hide character", false),
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_root(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "cardviewer-chu-{label}-{}-{unique}",
            std::process::id()
        ))
    }

    #[test]
    fn parses_chu_card_fields() {
        let xml = r#"
<CardData>
  <dataName>card00001002</dataName>
  <name><id>1002</id><str>card00001002</str><data /></name>
  <image><path>CHU_card_00001002.png</path></image>
  <charaName>シズマ・クロサキ</charaName>
  <rareType>2</rareType>
  <skillName>テクニカル</skillName>
  <skillText>COMBO &amp; CHAIN</skillText>
</CardData>"#;

        let card = parse_chu_card(Path::new("Card.xml"), xml).unwrap();
        assert_eq!(card.id, "1002");
        assert_eq!(card.data_name, "card00001002");
        assert_eq!(card.character_name, "シズマ・クロサキ");
        assert_eq!(card.rare_type, Some(2));
        assert_eq!(card.skill_text, "COMBO & CHAIN");
        assert!(card
            .print_fields
            .iter()
            .any(|field| field.key == "serialId"));
        assert!(card
            .print_fields
            .iter()
            .any(|field| field.key == "hideParam"));
    }

    #[test]
    fn scan_preserves_content_path_order_and_updates_stats() {
        let root = test_root("scan-order");
        let primary = root
            .join("CHU")
            .join("Data")
            .join("A000")
            .join("card")
            .join("primary");
        let legacy = root.join("CHU").join("card").join("legacy");
        fs::create_dir_all(&primary).unwrap();
        fs::create_dir_all(&legacy).unwrap();
        fs::write(
            primary.join("Card.xml"),
            "<CardData><dataName>primary</dataName><name><id>1</id></name></CardData>",
        )
        .unwrap();
        fs::write(
            legacy.join("Card.xml"),
            "<CardData><dataName>legacy</dataName><name><id>2</id></name></CardData>",
        )
        .unwrap();

        let mut cards = Vec::new();
        let mut stats = ScanStats::default();
        let mut warnings = Vec::new();
        scan_chu_cards(&root, &mut cards, &mut stats, &mut warnings);

        assert_eq!(
            cards
                .iter()
                .map(|card| card.data_name.as_str())
                .collect::<Vec<_>>(),
            vec!["primary", "legacy"]
        );
        assert_eq!(stats.chu_cards, 2);
        assert!(warnings.is_empty());

        fs::remove_dir_all(root).unwrap();
    }
}
