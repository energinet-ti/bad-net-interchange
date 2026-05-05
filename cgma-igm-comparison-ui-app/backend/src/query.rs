use crate::graph_store::GraphStore;
use chrono::{NaiveDateTime, TimeDelta, Timelike};
use oxigraph::sparql::QueryResults;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonRow {
    pub scenario_time: String,
    pub cgma_time: String,
    pub energy_ident_code_eic: String,
    pub name: String,
    pub business_type: String,
    pub net_interchange: f64,
    pub cgma_net_position: f64,
    pub difference: f64,
    pub measurement_unit: String,
    pub resolution: String,
    pub ssh_version: String,
}

/// Intermediate struct for IGM query results
struct IgmRow {
    scenario_time: String,
    energy_ident_code_eic: String,
    name: String,
    net_interchange: f64,
    ssh_version: String,
}

/// Intermediate struct for CGMA query results
struct CgmaRow {
    eic: String,
    period_start: String,
    resolution: String,
    position: i64,
    quantity: f64,
    is_import: bool,
    measurement_unit: String,
    business_type: String,
}

const IGM_QUERY: &str = r#"
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX md: <http://iec.ch/TC57/61970-552/ModelDescription/1#>
PREFIX cim: <http://iec.ch/TC57/2013/CIM-schema-cim16#>
PREFIX entsoe: <http://entsoe.eu/CIM/SchemaExtension/3/1#>
PREFIX cgma: <urn:cgma:>

SELECT
  ?energyIdentCodeEic
  ?name
  ?scenarioTime
  ?netInterchange
  ?sshVersion
WHERE {
  GRAPH ?eqGraph {
    ?eqModel rdf:type md:FullModel .
    FILTER EXISTS {
      ?eqModel md:Model.profile ?eqProfile .
      FILTER(CONTAINS(STR(?eqProfile), "Equipment"))
    }
    ?controlArea rdf:type cim:ControlArea ;
      entsoe:IdentifiedObject.energyIdentCodeEic ?energyIdentCodeEic ;
      cim:IdentifiedObject.name ?name .
  }
  GRAPH ?sshGraph {
    ?sshModel rdf:type md:FullModel ;
      md:Model.scenarioTime ?scenarioTime .
    FILTER EXISTS {
      ?sshModel md:Model.profile ?sshProfile .
      FILTER(CONTAINS(STR(?sshProfile), "SteadyStateHypothesis"))
    }
    ?controlArea cim:ControlArea.netInterchange ?netInterchange .
  }
  OPTIONAL { ?sshGraph cgma:sshVersion ?sshVersion . }
}
ORDER BY ?name ?scenarioTime ?sshVersion
"#;

const CGMA_QUERY: &str = r#"
PREFIX cgma: <https://example.com/cgma#>

SELECT
  ?businessType
  ?inDomain
  ?outDomain
  ?measurementUnit
  ?periodStart
  ?resolution
  ?position
  ?quantity
WHERE {
  GRAPH ?g {
    ?timeSeries a cgma:TimeSeries ;
      cgma:businessType ?businessType ;
      cgma:measurementUnitName ?measurementUnit ;
      cgma:hasPeriod ?period .
    FILTER(?businessType = "B65")
    OPTIONAL { ?timeSeries cgma:inDomainMRID ?inDomain . }
    OPTIONAL { ?timeSeries cgma:outDomainMRID ?outDomain . }
    ?period cgma:start ?periodStart ;
      cgma:resolution ?resolution ;
      cgma:hasPoint ?point .
    ?point cgma:position ?position ;
      cgma:quantity ?quantity .
  }
}
"#;

/// Strip quotes and datatype suffix from SPARQL literal value.
/// e.g. `"987.13"^^<http://...>` -> `987.13`
fn strip_literal(val: &str) -> &str {
    let s = val.strip_prefix('"').unwrap_or(val);
    match s.find('"') {
        Some(i) => &s[..i],
        None => s,
    }
}

/// Truncate IGM scenarioTime (which has :30 minutes) to the hour.
/// "2026-03-05T00:30:00Z" -> "2026-03-05T00:00:00Z"
fn truncate_to_hour(datetime_str: &str) -> Option<String> {
    let clean = datetime_str.trim_end_matches('Z');
    let dt = NaiveDateTime::parse_from_str(clean, "%Y-%m-%dT%H:%M:%S").ok()?;
    let truncated = dt.date().and_hms_opt(dt.time().hour(), 0, 0)?;
    Some(format!("{}Z", truncated.format("%Y-%m-%dT%H:%M:%S")))
}

/// Compute CGMA timestamp from periodStart + (position-1) * resolution.
/// Position is 1-indexed in ENTSO-E: position 1 = interval starting at periodStart.
/// periodStart: "2026-03-04T23:00Z", position: 1, resolution: "PT1H"
/// -> "2026-03-04T23:00:00Z"
fn cgma_timestamp(period_start: &str, position: i64, resolution: &str) -> Option<String> {
    let clean = period_start.trim_end_matches('Z');
    let dt = NaiveDateTime::parse_from_str(clean, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(clean, "%Y-%m-%dT%H:%M"))
        .ok()?;

    let offset = match resolution {
        "PT1H" => TimeDelta::hours(position - 1),
        "PT30M" => TimeDelta::minutes((position - 1) * 30),
        _ => TimeDelta::hours(position - 1),
    };

    let result = dt + offset;
    Some(format!("{}Z", result.format("%Y-%m-%dT%H:%M:%S")))
}

fn parse_igm_results(store: &GraphStore) -> Result<Vec<IgmRow>, String> {
    let igm_results = store.query(IGM_QUERY).map_err(|e| e.to_string())?;
    let mut rows = Vec::new();

    if let QueryResults::Solutions(solutions) = igm_results {
        for solution in solutions {
            let row = solution.map_err(|e| e.to_string())?;
            let scenario_time =
                strip_literal(&row.get("scenarioTime").unwrap().to_string()).to_string();
            let eic =
                strip_literal(&row.get("energyIdentCodeEic").unwrap().to_string()).to_string();
            let name = strip_literal(&row.get("name").unwrap().to_string()).to_string();
            let ni_str = strip_literal(&row.get("netInterchange").unwrap().to_string()).to_string();
            let net_interchange: f64 = ni_str.parse().unwrap_or(0.0);
            let ssh_version = row
                .get("sshVersion")
                .map(|v| strip_literal(&v.to_string()).to_string())
                .unwrap_or_default();

            rows.push(IgmRow {
                scenario_time,
                energy_ident_code_eic: eic,
                name,
                net_interchange,
                ssh_version,
            });
        }
    }

    Ok(rows)
}

fn parse_cgma_results(store: &GraphStore) -> Result<Vec<CgmaRow>, String> {
    let cgma_results = store.query(CGMA_QUERY).map_err(|e| e.to_string())?;
    let mut rows = Vec::new();

    if let QueryResults::Solutions(solutions) = cgma_results {
        for solution in solutions {
            let row = solution.map_err(|e| e.to_string())?;
            let in_domain = row
                .get("inDomain")
                .map(|v| strip_literal(&v.to_string()).to_string())
                .unwrap_or_default();
            let out_domain = row
                .get("outDomain")
                .map(|v| strip_literal(&v.to_string()).to_string())
                .unwrap_or_default();
            let period_start =
                strip_literal(&row.get("periodStart").unwrap().to_string()).to_string();
            let resolution = strip_literal(&row.get("resolution").unwrap().to_string()).to_string();
            let position: i64 = strip_literal(&row.get("position").unwrap().to_string())
                .parse()
                .unwrap_or(0);
            let quantity: f64 = strip_literal(&row.get("quantity").unwrap().to_string())
                .parse()
                .unwrap_or(0.0);
            let measurement_unit =
                strip_literal(&row.get("measurementUnit").unwrap().to_string()).to_string();
            let business_type =
                strip_literal(&row.get("businessType").unwrap().to_string()).to_string();

            // Determine EIC and direction
            let (eic, is_import) = if !in_domain.is_empty() {
                (in_domain, true) // inDomain = flow INTO area = import
            } else {
                (out_domain, false) // outDomain = flow OUT OF area = export
            };

            rows.push(CgmaRow {
                eic,
                period_start,
                resolution,
                position,
                quantity,
                is_import,
                measurement_unit,
                business_type,
            });
        }
    }

    Ok(rows)
}

/// Aggregate CGMA rows by (eic, timestamp) into net positions.
fn aggregate_cgma(cgma_rows: &[CgmaRow]) -> HashMap<(String, String), CgmaAgg> {
    let mut map: HashMap<(String, String), CgmaAgg> = HashMap::new();

    for cr in cgma_rows {
        let ts = match cgma_timestamp(&cr.period_start, cr.position, &cr.resolution) {
            Some(t) => t,
            None => continue,
        };

        let entry = map.entry((cr.eic.clone(), ts)).or_insert(CgmaAgg {
            net_position: 0.0,
            measurement_unit: cr.measurement_unit.clone(),
            resolution: cr.resolution.clone(),
            business_type: cr.business_type.clone(),
        });

        if cr.is_import {
            entry.net_position += cr.quantity;
        } else {
            entry.net_position -= cr.quantity;
        }
    }

    map
}

struct CgmaAgg {
    net_position: f64,
    measurement_unit: String,
    resolution: String,
    business_type: String,
}

/// Join IGM rows with aggregated CGMA data on (EIC, truncated hour).
///
/// Only matches where both IGM and CGMA have data for the same timestamp.
/// CGMA timestamps are computed from periodStart + (position-1) * resolution,
/// so they naturally span across day boundaries when needed.
fn join_results(
    igm_rows: &[IgmRow],
    cgma_map: &HashMap<(String, String), CgmaAgg>,
) -> Vec<ComparisonRow> {
    let mut result = Vec::new();

    for igm in igm_rows {
        let hour_key = match truncate_to_hour(&igm.scenario_time) {
            Some(k) => k,
            None => continue,
        };

        let key = (igm.energy_ident_code_eic.clone(), hour_key.clone());

        // Direct match only — no D-1 fallback. CGMA timestamps are already
        // correctly computed from periodStart + (position-1) * resolution,
        // so they naturally span across day boundaries when needed.
        if let Some(cgma) = cgma_map.get(&key) {
            let difference = igm.net_interchange - cgma.net_position;
            result.push(ComparisonRow {
                scenario_time: igm.scenario_time.clone(),
                cgma_time: hour_key,
                energy_ident_code_eic: igm.energy_ident_code_eic.clone(),
                name: igm.name.clone(),
                business_type: cgma.business_type.clone(),
                net_interchange: igm.net_interchange,
                cgma_net_position: cgma.net_position,
                difference,
                measurement_unit: cgma.measurement_unit.clone(),
                resolution: cgma.resolution.clone(),
                ssh_version: igm.ssh_version.clone(),
            });
        }
    }

    result.sort_by(|a, b| {
        a.name
            .cmp(&b.name)
            .then(a.scenario_time.cmp(&b.scenario_time))
            .then(a.ssh_version.cmp(&b.ssh_version))
    });
    result
}

pub fn run_comparison_query(store: &GraphStore) -> Result<Vec<ComparisonRow>, String> {
    let igm_rows = parse_igm_results(store)?;
    let cgma_rows = parse_cgma_results(store)?;
    let cgma_map = aggregate_cgma(&cgma_rows);
    Ok(join_results(&igm_rows, &cgma_map))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_truncate_to_hour() {
        assert_eq!(
            truncate_to_hour("2026-03-05T00:30:00Z"),
            Some("2026-03-05T00:00:00Z".to_string())
        );
        assert_eq!(
            truncate_to_hour("2026-03-05T14:30:00Z"),
            Some("2026-03-05T14:00:00Z".to_string())
        );
    }

    #[test]
    fn test_cgma_timestamp_pt1h() {
        // position 1: start + 0h (position is 1-indexed)
        assert_eq!(
            cgma_timestamp("2026-03-04T23:00Z", 1, "PT1H"),
            Some("2026-03-04T23:00:00Z".to_string())
        );
        // position 10: start + 9h
        assert_eq!(
            cgma_timestamp("2026-03-04T23:00Z", 10, "PT1H"),
            Some("2026-03-05T08:00:00Z".to_string())
        );
    }

    #[test]
    fn test_cgma_timestamp_with_seconds() {
        assert_eq!(
            cgma_timestamp("2026-03-04T23:00:00Z", 1, "PT1H"),
            Some("2026-03-04T23:00:00Z".to_string())
        );
    }

    #[test]
    fn test_cgma_timestamp_summer_time() {
        // Summer: period starts at 22:00Z (midnight CEST)
        assert_eq!(
            cgma_timestamp("2026-04-13T22:00Z", 1, "PT1H"),
            Some("2026-04-13T22:00:00Z".to_string())
        );
        assert_eq!(
            cgma_timestamp("2026-04-13T22:00Z", 3, "PT1H"),
            Some("2026-04-14T00:00:00Z".to_string())
        );
    }

    #[test]
    fn test_cgma_timestamp_winter_time() {
        // Winter: period starts at 23:00Z (midnight CET)
        assert_eq!(
            cgma_timestamp("2026-03-16T23:00Z", 1, "PT1H"),
            Some("2026-03-16T23:00:00Z".to_string())
        );
        assert_eq!(
            cgma_timestamp("2026-03-16T23:00Z", 2, "PT1H"),
            Some("2026-03-17T00:00:00Z".to_string())
        );
    }

    #[test]
    fn test_join_direct_match_only() {
        // Without D-1 fallback, only direct timestamp matches work
        let igm_rows = vec![
            IgmRow {
                scenario_time: "2026-03-05T22:30:00Z".to_string(),
                energy_ident_code_eic: "10YDK-1--------W".to_string(),
                name: "DK1".to_string(),
                net_interchange: 100.0,
                ssh_version: "".to_string(),
            },
            IgmRow {
                scenario_time: "2026-03-05T23:30:00Z".to_string(),
                energy_ident_code_eic: "10YDK-1--------W".to_string(),
                name: "DK1".to_string(),
                net_interchange: 200.0,
                ssh_version: "".to_string(),
            },
        ];

        let mut cgma_map = HashMap::new();
        // This is on D-1 — should NOT match any IGM row (no D-1 fallback)
        cgma_map.insert(
            (
                "10YDK-1--------W".to_string(),
                "2026-03-04T23:00:00Z".to_string(),
            ),
            CgmaAgg {
                net_position: 50.0,
                measurement_unit: "MAW".to_string(),
                resolution: "PT1H".to_string(),
                business_type: "B65".to_string(),
            },
        );
        // This is on D — matches IGM 22:30 directly
        cgma_map.insert(
            (
                "10YDK-1--------W".to_string(),
                "2026-03-05T22:00:00Z".to_string(),
            ),
            CgmaAgg {
                net_position: 80.0,
                measurement_unit: "MAW".to_string(),
                resolution: "PT1H".to_string(),
                business_type: "B65".to_string(),
            },
        );

        let result = join_results(&igm_rows, &cgma_map);
        // Only 1 match: 22:30 -> 22:00 (direct). 23:30 has no direct match.
        assert_eq!(
            result.len(),
            1,
            "Expected 1 row (direct match only), got {}",
            result.len()
        );
        assert_eq!(result[0].scenario_time, "2026-03-05T22:30:00Z");
        assert_eq!(result[0].cgma_time, "2026-03-05T22:00:00Z");
    }

    #[test]
    fn test_join_cgma_spanning_day_boundary() {
        // CGMA period starts at 22:00 D-1, positions span into D.
        // Direct matching works because cgma_timestamp correctly computes
        // timestamps across day boundaries.
        let igm_rows = vec![
            IgmRow {
                scenario_time: "2026-04-14T22:30:00Z".to_string(),
                energy_ident_code_eic: "10YDK-1--------W".to_string(),
                name: "DK1".to_string(),
                net_interchange: 100.0,
                ssh_version: "".to_string(),
            },
            IgmRow {
                scenario_time: "2026-04-14T23:30:00Z".to_string(),
                energy_ident_code_eic: "10YDK-1--------W".to_string(),
                name: "DK1".to_string(),
                net_interchange: 200.0,
                ssh_version: "".to_string(),
            },
            IgmRow {
                scenario_time: "2026-04-15T00:30:00Z".to_string(),
                energy_ident_code_eic: "10YDK-1--------W".to_string(),
                name: "DK1".to_string(),
                net_interchange: 300.0,
                ssh_version: "".to_string(),
            },
        ];

        let mut cgma_map = HashMap::new();
        // CGMA positions computed from periodStart 2026-04-14T22:00Z:
        // pos 1 = 22:00 on 2026-04-14 (D)
        cgma_map.insert(
            (
                "10YDK-1--------W".to_string(),
                "2026-04-14T22:00:00Z".to_string(),
            ),
            CgmaAgg {
                net_position: 50.0,
                measurement_unit: "MAW".to_string(),
                resolution: "PT1H".to_string(),
                business_type: "B65".to_string(),
            },
        );
        // pos 2 = 23:00 on 2026-04-14 (D)
        cgma_map.insert(
            (
                "10YDK-1--------W".to_string(),
                "2026-04-14T23:00:00Z".to_string(),
            ),
            CgmaAgg {
                net_position: 60.0,
                measurement_unit: "MAW".to_string(),
                resolution: "PT1H".to_string(),
                business_type: "B65".to_string(),
            },
        );
        // pos 3 = 00:00 on 2026-04-15 (D+1)
        cgma_map.insert(
            (
                "10YDK-1--------W".to_string(),
                "2026-04-15T00:00:00Z".to_string(),
            ),
            CgmaAgg {
                net_position: 70.0,
                measurement_unit: "MAW".to_string(),
                resolution: "PT1H".to_string(),
                business_type: "B65".to_string(),
            },
        );

        let result = join_results(&igm_rows, &cgma_map);
        // All 3 match directly: 22:30->22:00, 23:30->23:00, 00:30->00:00
        assert_eq!(
            result.len(),
            3,
            "Expected 3 rows (all direct matches), got {}",
            result.len()
        );
    }

    #[test]
    fn test_strip_literal() {
        assert_eq!(strip_literal("\"987.13\""), "987.13");
        assert_eq!(strip_literal("\"DK1\""), "DK1");
        assert_eq!(
            strip_literal("\"987.13\"^^<http://www.w3.org/2001/XMLSchema#double>"),
            "987.13"
        );
        assert_eq!(strip_literal("plain"), "plain");
    }
}
