use crate::scanner::{CardRecord, PrintField};

pub(in crate::scanner) fn game_asset_group(game: &str) -> String {
    match game {
        "CHU" => "chu".to_string(),
        "MAI" => "mai".to_string(),
        "MU3" => "mu3".to_string(),
        other => other.to_ascii_lowercase(),
    }
}

pub(in crate::scanner) fn is_web_asset_path(path: &str) -> bool {
    path.starts_with('/')
        || path.starts_with("http://")
        || path.starts_with("https://")
        || path.starts_with("data:")
}

pub(in crate::scanner) fn set_print_field_value(
    card: &mut CardRecord,
    key: &str,
    label: &str,
    field_type: &str,
    value: impl Into<String>,
) {
    let value = value.into();
    if let Some(field) = card.print_fields.iter_mut().find(|field| field.key == key) {
        field.value = value;
    } else {
        card.print_fields.push(PrintField {
            key: key.to_string(),
            label: label.to_string(),
            field_type: field_type.to_string(),
            value,
            options: Vec::new(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card_with_fields(print_fields: Vec<PrintField>) -> CardRecord {
        CardRecord {
            id: "test".to_string(),
            game: "MAI".to_string(),
            record_type: "Card".to_string(),
            data_name: "test".to_string(),
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
            print_fields,
        }
    }

    #[test]
    fn maps_known_and_fallback_game_asset_groups() {
        assert_eq!(game_asset_group("CHU"), "chu");
        assert_eq!(game_asset_group("MAI"), "mai");
        assert_eq!(game_asset_group("MU3"), "mu3");
        assert_eq!(game_asset_group("CustomGame"), "customgame");
    }

    #[test]
    fn recognizes_only_public_web_asset_paths() {
        for path in [
            "/official/generated/card.webp",
            "http://example.test/card.webp",
            "https://example.test/card.webp",
            "data:image/png;base64,AA==",
        ] {
            assert!(is_web_asset_path(path), "expected web path: {path}");
        }
        for path in ["assets/card.webp", "C:\\cards\\card.webp", ""] {
            assert!(!is_web_asset_path(path), "expected local path: {path}");
        }
    }

    #[test]
    fn updates_or_adds_print_fields_without_changing_existing_metadata() {
        let existing = PrintField {
            key: "maiAssetRoot".to_string(),
            label: "Existing label".to_string(),
            field_type: "existing-type".to_string(),
            value: "old".to_string(),
            options: Vec::new(),
        };
        let mut card = card_with_fields(vec![existing]);

        set_print_field_value(
            &mut card,
            "maiAssetRoot",
            "Replacement label",
            "metadata",
            "new",
        );
        assert_eq!(card.print_fields.len(), 1);
        assert_eq!(card.print_fields[0].value, "new");
        assert_eq!(card.print_fields[0].label, "Existing label");
        assert_eq!(card.print_fields[0].field_type, "existing-type");

        set_print_field_value(&mut card, "newField", "New field", "text", "value");
        let added = card
            .print_fields
            .iter()
            .find(|field| field.key == "newField")
            .unwrap();
        assert_eq!(added.label, "New field");
        assert_eq!(added.field_type, "text");
        assert_eq!(added.value, "value");
        assert!(added.options.is_empty());
    }
}
