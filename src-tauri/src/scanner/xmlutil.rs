use std::collections::HashMap;

pub(crate) fn block(xml: &str, tag_name: &str) -> Option<String> {
    let open = format!("<{tag_name}>");
    let close = format!("</{tag_name}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    Some(xml[start..end].to_string())
}

pub(crate) fn tag(xml: &str, tag_name: &str) -> Option<String> {
    block(xml, tag_name).map(|value| decode_xml_text(value.trim()))
}

pub(crate) fn blocks(xml: &str, tag_name: &str) -> Vec<String> {
    let open = format!("<{tag_name}>");
    let close = format!("</{tag_name}>");
    let mut values = Vec::new();
    let mut cursor = 0;

    while let Some(relative_start) = xml[cursor..].find(&open) {
        let start = cursor + relative_start + open.len();
        let Some(relative_end) = xml[start..].find(&close) else {
            break;
        };
        let end = start + relative_end;
        values.push(xml[start..end].to_string());
        cursor = end + close.len();
    }

    values
}

pub(crate) fn block_any(xml: &str, tag_names: &[&str]) -> Option<String> {
    tag_names.iter().find_map(|tag_name| block(xml, tag_name))
}

pub(crate) fn tag_any(xml: &str, tag_names: &[&str]) -> Option<String> {
    block_any(xml, tag_names).map(|value| decode_xml_text(value.trim()))
}

pub(crate) fn int_tag(xml: &str, tag_name: &str) -> Option<i32> {
    tag(xml, tag_name).and_then(|value| value.parse::<i32>().ok())
}

pub(crate) fn int_tag_any(xml: &str, tag_names: &[&str]) -> Option<i32> {
    tag_any(xml, tag_names).and_then(|value| value.parse::<i32>().ok())
}

pub(crate) fn bool_tag(xml: &str, tag_name: &str) -> Option<bool> {
    tag(xml, tag_name).and_then(|value| match value.to_ascii_lowercase().as_str() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    })
}

pub(crate) fn bool_tag_any(xml: &str, tag_names: &[&str]) -> Option<bool> {
    tag_any(xml, tag_names).and_then(|value| match value.to_ascii_lowercase().as_str() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    })
}

pub(crate) fn decode_xml_text(value: &str) -> String {
    let mut entities = HashMap::new();
    entities.insert("&lt;", "<");
    entities.insert("&gt;", ">");
    entities.insert("&amp;", "&");
    entities.insert("&quot;", "\"");
    entities.insert("&apos;", "'");

    let mut decoded = value.replace("\r\n", "\n");
    for (from, to) in entities {
        decoded = decoded.replace(from, to);
    }
    decoded
}
