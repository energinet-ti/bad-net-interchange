use regex::Regex;
use roxmltree::Document;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::io::{Cursor, Read};
use wasm_bindgen::prelude::*;
use zip::ZipArchive;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IgmRecord {
    pub ssh_timestamp: String,
    pub ssh_created: String,
    pub aligned_timestamp: String,
    pub area: String,
    pub ssh_version: String,
    pub ssh_net_interchange_mw: f64,
    pub ssh_file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CgmaEntry {
    pub timestamp: String,
    pub area: String,
    pub cgma_net_position_mw: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonRow {
    pub ssh_timestamp: String,
    pub ssh_created: String,
    pub aligned_timestamp: String,
    pub area: String,
    pub ssh_version: String,
    pub ssh_net_interchange_mw: f64,
    pub cgma_net_position_mw: f64,
    pub difference_mw: f64,
    pub abs_difference_mw: f64,
    pub status: String,
    pub ssh_file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonOutput {
    pub rows: Vec<ComparisonRow>,
    pub discovered_versions: Vec<String>,
    pub total_rows: usize,
    pub matched_rows: usize,
}

fn normalize_timestamp(input: &str) -> Option<String> {
    let mut s = input.trim().replace(' ', "T");
    if s.is_empty() {
        return None;
    }
    if let Some(idx) = s.find('+') {
        s = s[..idx].to_string();
    }
    if s.ends_with('Z') {
        s.pop();
    }
    if s.len() >= 16 {
        Some(format!("{}Z", &s[..16]))
    } else {
        None
    }
}

fn truncate_hour(ts: &str) -> Option<String> {
    if ts.len() < 16 {
        return None;
    }
    Some(format!("{}:00Z", &ts[..13]))
}

fn version_rank(version: &str) -> i32 {
    version.parse::<i32>().unwrap_or(0)
}

fn area_from_igm_file(area_code: &str) -> &'static str {
    match area_code {
        "DKW" => "DK1",
        "DKE" => "DK2",
        _ => "UNKNOWN",
    }
}

#[wasm_bindgen]
pub fn setup_panic_hook() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn extract_igm_record(file_name: String, zip_bytes: &[u8]) -> Result<JsValue, JsValue> {
    let re = Regex::new(
        r"(?P<timestamp>\d{8}T\d{4}Z)_2D_(?P<area>DKE|DKW)_SSH_(?P<version>\d{3})\.zip$",
    )
    .map_err(|e| JsValue::from_str(&format!("Regex error: {e}")))?;

    let cap = re
        .captures(&file_name)
        .ok_or_else(|| JsValue::from_str("Unsupported SSH filename format"))?;

    let version = cap
        .name("version")
        .map(|v| v.as_str().to_string())
        .ok_or_else(|| JsValue::from_str("Missing version in SSH filename"))?;

    let area_code = cap
        .name("area")
        .map(|v| v.as_str().to_string())
        .ok_or_else(|| JsValue::from_str("Missing area in SSH filename"))?;

    let mut archive =
        ZipArchive::new(Cursor::new(zip_bytes)).map_err(|e| JsValue::from_str(&format!("ZIP open error: {e}")))?;

    let mut xml_content = String::new();
    let mut found = false;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| JsValue::from_str(&format!("ZIP entry read error: {e}")))?;
        if file.name().to_ascii_lowercase().ends_with(".xml") {
            file.read_to_string(&mut xml_content)
                .map_err(|e| JsValue::from_str(&format!("XML read error: {e}")))?;
            found = true;
            break;
        }
    }

    if !found {
        return Err(JsValue::from_str("No XML file found inside SSH ZIP"));
    }

    let doc = Document::parse(&xml_content)
        .map_err(|e| JsValue::from_str(&format!("XML parse error: {e}")))?;

    let scenario_time_raw = doc
        .descendants()
        .find(|n| n.is_element() && n.tag_name().name() == "Model.scenarioTime")
        .and_then(|n| n.text())
        .ok_or_else(|| JsValue::from_str("Model.scenarioTime not found in SSH XML"))?;

    let ssh_timestamp = normalize_timestamp(scenario_time_raw)
        .ok_or_else(|| JsValue::from_str("Invalid scenario timestamp format"))?;

    let ssh_created = doc
        .descendants()
        .find(|n| n.is_element() && n.tag_name().name() == "Model.created")
        .and_then(|n| n.text())
        .map(|v| v.trim().to_string())
        .ok_or_else(|| JsValue::from_str("Model.created not found in SSH XML"))?;

    let aligned_timestamp = truncate_hour(&ssh_timestamp)
        .ok_or_else(|| JsValue::from_str("Failed to align SSH timestamp"))?;

    let mut net_values: Vec<f64> = doc
        .descendants()
        .filter(|n| n.is_element() && n.tag_name().name() == "ControlArea.netInterchange")
        .filter_map(|n| n.text())
        .filter_map(|t| t.trim().parse::<f64>().ok())
        .collect();

    if net_values.is_empty() {
        return Err(JsValue::from_str("No ControlArea.netInterchange values found"));
    }

    net_values.sort_by(|a, b| {
        b.abs()
            .partial_cmp(&a.abs())
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let record = IgmRecord {
        ssh_timestamp,
        ssh_created,
        aligned_timestamp,
        area: area_from_igm_file(&area_code).to_string(),
        ssh_version: version,
        ssh_net_interchange_mw: net_values[0],
        ssh_file: file_name,
    };

    serde_wasm_bindgen::to_value(&record)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
}

#[wasm_bindgen]
pub fn parse_cgma_inhouse(xml_text: String, reverse_sign: bool) -> Result<JsValue, JsValue> {
    let doc = Document::parse(&xml_text)
        .map_err(|e| JsValue::from_str(&format!("CGMA XML parse error: {e}")))?;

    let mut map: HashMap<(String, String), f64> = HashMap::new();

    for ts_node in doc
        .descendants()
        .filter(|n| n.is_element() && n.tag_name().name() == "TimeSeries")
    {
        let ts_id = ts_node.attribute("id").unwrap_or("").to_uppercase();

        let area = if ts_id.contains("NP-DK1") {
            "DK1"
        } else if ts_id.contains("NP-DK2") {
            "DK2"
        } else {
            continue;
        };

        let is_import = ts_id.contains("-IM");
        let is_export = ts_id.contains("-EX");

        if !is_import && !is_export {
            continue;
        }

        let mut sign = if is_import { 1.0 } else { -1.0 };
        if reverse_sign {
            sign *= -1.0;
        }

        for data in ts_node
            .descendants()
            .filter(|n| n.is_element() && n.tag_name().name() == "Data")
        {
            let dt = data.attribute("dt").unwrap_or("");
            let qty = data.attribute("qty").unwrap_or("");

            let timestamp = match normalize_timestamp(dt).and_then(|t| truncate_hour(&t)) {
                Some(v) => v,
                None => continue,
            };

            let quantity = match qty.trim().parse::<f64>() {
                Ok(v) => v,
                Err(_) => continue,
            };

            let key = (timestamp, area.to_string());
            *map.entry(key).or_insert(0.0) += sign * quantity;
        }
    }

    let out: Vec<CgmaEntry> = map
        .into_iter()
        .map(|((timestamp, area), cgma_net_position_mw)| CgmaEntry {
            timestamp,
            area,
            cgma_net_position_mw,
        })
        .collect();

    serde_wasm_bindgen::to_value(&out)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
}

#[wasm_bindgen]
pub fn compare_records(
    igm_records_js: JsValue,
    cgma_entries_js: JsValue,
    selected_version: String,
    warning_limit: f64,
    error_limit: f64,
) -> Result<JsValue, JsValue> {
    let igm_records: Vec<IgmRecord> = serde_wasm_bindgen::from_value(igm_records_js)
        .map_err(|e| JsValue::from_str(&format!("Invalid IGM payload: {e}")))?;
    let cgma_entries: Vec<CgmaEntry> = serde_wasm_bindgen::from_value(cgma_entries_js)
        .map_err(|e| JsValue::from_str(&format!("Invalid CGMA payload: {e}")))?;

    let mut versions = BTreeSet::new();
    for r in &igm_records {
        versions.insert(r.ssh_version.clone());
    }

    let mut cgma_map: HashMap<(String, String), f64> = HashMap::new();
    for c in cgma_entries {
        cgma_map.insert((c.timestamp, c.area), c.cgma_net_position_mw);
    }

    let mut latest_map: HashMap<(String, String), IgmRecord> = HashMap::new();
    for rec in igm_records {
        if selected_version != "latest" && rec.ssh_version != selected_version {
            continue;
        }

        let key = (rec.aligned_timestamp.clone(), rec.area.clone());
        match latest_map.get(&key) {
            Some(existing) if selected_version == "latest" => {
                if version_rank(&rec.ssh_version) > version_rank(&existing.ssh_version) {
                    latest_map.insert(key, rec);
                }
            }
            Some(_) => {}
            None => {
                latest_map.insert(key, rec);
            }
        }
    }

    let mut rows: Vec<ComparisonRow> = Vec::new();

    for ((_timestamp, _area), rec) in latest_map {
        if let Some(cgma) = cgma_map.get(&(rec.aligned_timestamp.clone(), rec.area.clone())) {
            let diff = rec.ssh_net_interchange_mw - *cgma;
            let abs_diff = diff.abs();
            let status = if abs_diff >= error_limit {
                "ERROR"
            } else if abs_diff >= warning_limit {
                "WARNING"
            } else {
                "NORMAL"
            }
            .to_string();

            rows.push(ComparisonRow {
                ssh_timestamp: rec.ssh_timestamp,
                ssh_created: rec.ssh_created,
                aligned_timestamp: rec.aligned_timestamp,
                area: rec.area,
                ssh_version: rec.ssh_version,
                ssh_net_interchange_mw: rec.ssh_net_interchange_mw,
                cgma_net_position_mw: *cgma,
                difference_mw: diff,
                abs_difference_mw: abs_diff,
                status,
                ssh_file: rec.ssh_file,
            });
        }
    }

    rows.sort_by(|a, b| {
        if a.aligned_timestamp == b.aligned_timestamp {
            a.area.cmp(&b.area)
        } else {
            a.aligned_timestamp.cmp(&b.aligned_timestamp)
        }
    });

    let out = ComparisonOutput {
        matched_rows: rows.len(),
        total_rows: rows.len(),
        rows,
        discovered_versions: versions.into_iter().collect(),
    };

    serde_wasm_bindgen::to_value(&out)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
}
