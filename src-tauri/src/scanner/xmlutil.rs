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
    let normalized = value.replace("\r\n", "\n");
    if !normalized.contains('&') {
        return normalized;
    }

    // Single left-to-right pass: emit text verbatim and expand each `&...;`
    // entity once (so `&amp;lt;` decodes to the literal `&lt;`, not `<`).
    let mut decoded = String::with_capacity(normalized.len());
    let mut rest = normalized.as_str();
    while let Some(amp) = rest.find('&') {
        decoded.push_str(&rest[..amp]);
        let after = &rest[amp..];
        if let Some(semi) = after.find(';') {
            if let Some(expanded) = decode_xml_entity(&after[..=semi]) {
                decoded.push_str(&expanded);
                rest = &after[semi + 1..];
                continue;
            }
        }
        // Unrecognized `&`: keep it literally and continue scanning after it.
        decoded.push('&');
        rest = &after[1..];
    }
    decoded.push_str(rest);
    decoded
}

/// Expands a single XML entity (including the surrounding `&` and `;`), or
/// returns None if it is not a recognized named or numeric character reference.
fn decode_xml_entity(entity: &str) -> Option<String> {
    match entity {
        "&lt;" => Some("<".to_string()),
        "&gt;" => Some(">".to_string()),
        "&amp;" => Some("&".to_string()),
        "&quot;" => Some("\"".to_string()),
        "&apos;" => Some("'".to_string()),
        _ => {
            let body = entity.strip_prefix("&#")?.strip_suffix(';')?;
            let code = match body.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                None => body.parse::<u32>().ok()?,
            };
            char::from_u32(code).map(|ch| ch.to_string())
        }
    }
}
