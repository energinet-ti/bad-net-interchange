use cgma_igm_backend::cgma_parser::load_cgma_file;
use cgma_igm_backend::graph_store::GraphStore;
use cgma_igm_backend::igm_parser::load_igm_file;
use oxigraph::sparql::QueryResults;

#[test]
fn test_cgma_loading_produces_triples() {
    let store = GraphStore::new().unwrap();
    let xml = std::fs::read_to_string("tests/fixtures/cgma_example.xml").unwrap();
    load_cgma_file(&store, &xml, "test/cgma").unwrap();
    assert!(
        store.len() > 0,
        "Store should contain triples after CGMA load"
    );
}

#[test]
fn test_cgma_b65_query_returns_results() {
    let store = GraphStore::new().unwrap();
    let xml = std::fs::read_to_string("tests/fixtures/cgma_example.xml").unwrap();
    load_cgma_file(&store, &xml, "test/cgma").unwrap();

    let query = r#"
        PREFIX cgma: <https://example.com/cgma#>
        SELECT ?seriesMrid ?businessType ?position ?quantity
        WHERE {
            GRAPH ?g {
                ?ts a cgma:TimeSeries ;
                    cgma:mRID ?seriesMrid ;
                    cgma:businessType ?businessType ;
                    cgma:hasPeriod ?period .
                FILTER(?businessType = "B65")
                ?period cgma:hasPoint ?point .
                ?point cgma:position ?position ;
                       cgma:quantity ?quantity .
            }
        }
        ORDER BY ?position
    "#;

    let results = store.query(query).unwrap();
    let mut count = 0;
    if let QueryResults::Solutions(solutions) = results {
        for solution in solutions {
            let row = solution.unwrap();
            let bt = row.get("businessType").unwrap().to_string();
            assert!(bt.contains("B65"), "businessType should be B65, got {bt}");
            count += 1;
        }
    }
    // Real fixture has 4 B65 TimeSeries with 24 points each = 96 data points
    assert!(count > 0, "Should find B65 data points, found {count}");
}

#[test]
fn test_cgma_non_b65_excluded_by_filter() {
    let store = GraphStore::new().unwrap();
    let xml = std::fs::read_to_string("tests/fixtures/cgma_example.xml").unwrap();
    load_cgma_file(&store, &xml, "test/cgma").unwrap();

    // The real fixture has A66 flow TimeSeries (not A03)
    let query = r#"
        PREFIX cgma: <https://example.com/cgma#>
        SELECT ?seriesMrid ?businessType
        WHERE {
            GRAPH ?g {
                ?ts a cgma:TimeSeries ;
                    cgma:mRID ?seriesMrid ;
                    cgma:businessType ?businessType .
                FILTER(?businessType = "A66")
            }
        }
    "#;

    let results = store.query(query).unwrap();
    let mut count = 0;
    if let QueryResults::Solutions(solutions) = results {
        for solution in solutions {
            let _ = solution.unwrap();
            count += 1;
        }
    }
    assert!(count > 0, "Should find A66 flow TimeSeries in the fixture");
}

#[test]
fn test_igm_loading_produces_triples() {
    let store = GraphStore::new().unwrap();
    let eq_xml = std::fs::read_to_string("tests/fixtures/eq_example.xml").unwrap();
    let ssh_xml = std::fs::read_to_string("tests/fixtures/ssh_example.xml").unwrap();

    load_igm_file(&store, &eq_xml, "test/eq", None).unwrap();
    load_igm_file(&store, &ssh_xml, "test/ssh", Some("001")).unwrap();

    assert!(
        store.len() > 0,
        "Store should contain triples after IGM load"
    );
}

#[test]
fn test_igm_control_area_query() {
    let store = GraphStore::new().unwrap();
    let eq_xml = std::fs::read_to_string("tests/fixtures/eq_example.xml").unwrap();
    let ssh_xml = std::fs::read_to_string("tests/fixtures/ssh_example.xml").unwrap();

    load_igm_file(&store, &eq_xml, "test/eq", None).unwrap();
    load_igm_file(&store, &ssh_xml, "test/ssh", Some("001")).unwrap();

    let query = r#"
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX md: <http://iec.ch/TC57/61970-552/ModelDescription/1#>
        PREFIX cim: <http://iec.ch/TC57/2013/CIM-schema-cim16#>
        PREFIX entsoe: <http://entsoe.eu/CIM/SchemaExtension/3/1#>

        SELECT ?name ?energyIdentCodeEic ?netInterchange
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
                ?sshModel rdf:type md:FullModel .
                FILTER EXISTS {
                    ?sshModel md:Model.profile ?sshProfile .
                    FILTER(CONTAINS(STR(?sshProfile), "SteadyStateHypothesis"))
                }
                ?controlArea cim:ControlArea.netInterchange ?netInterchange .
            }
        }
    "#;

    let results = store.query(query).unwrap();
    let mut found_dk1 = false;
    if let QueryResults::Solutions(solutions) = results {
        for solution in solutions {
            let row = solution.unwrap();
            let name = row.get("name").unwrap().to_string();
            if name.contains("DK1") {
                let eic = row.get("energyIdentCodeEic").unwrap().to_string();
                let ni = row.get("netInterchange").unwrap().to_string();
                assert!(
                    eic.contains("10YDK-1--------W"),
                    "Expected EIC code, got {eic}"
                );
                assert!(ni.contains("987"), "Expected netInterchange ~987, got {ni}");
                found_dk1 = true;
            }
        }
    }
    assert!(found_dk1, "Should find DK1 ControlArea with netInterchange");
}

#[test]
fn test_combined_store_holds_both_datasets() {
    let store = GraphStore::new().unwrap();

    // Load CGMA
    let cgma_xml = std::fs::read_to_string("tests/fixtures/cgma_example.xml").unwrap();
    load_cgma_file(&store, &cgma_xml, "test/cgma").unwrap();
    let cgma_triples = store.len();

    // Load IGM
    let eq_xml = std::fs::read_to_string("tests/fixtures/eq_example.xml").unwrap();
    let ssh_xml = std::fs::read_to_string("tests/fixtures/ssh_example.xml").unwrap();
    load_igm_file(&store, &eq_xml, "test/eq", None).unwrap();
    load_igm_file(&store, &ssh_xml, "test/ssh", Some("001")).unwrap();

    assert!(
        store.len() > cgma_triples,
        "Adding IGM data should increase triple count"
    );
}

#[test]
fn test_comparison_query_returns_joined_rows() {
    let store = GraphStore::new().unwrap();

    // Load both datasets
    let cgma_xml = std::fs::read_to_string("tests/fixtures/cgma_example.xml").unwrap();
    load_cgma_file(&store, &cgma_xml, "test/cgma").unwrap();
    let eq_xml = std::fs::read_to_string("tests/fixtures/eq_example.xml").unwrap();
    let ssh_xml = std::fs::read_to_string("tests/fixtures/ssh_example.xml").unwrap();
    load_igm_file(&store, &eq_xml, "test/eq", None).unwrap();
    load_igm_file(&store, &ssh_xml, "test/ssh", Some("001")).unwrap();

    let rows = cgma_igm_backend::query::run_comparison_query(&store).unwrap();

    // Should find at least one comparison row for DK1
    assert!(!rows.is_empty(), "Should have comparison rows");

    let dk1_row = rows.iter().find(|r| r.name == "DK1");
    assert!(dk1_row.is_some(), "Should have a DK1 row");

    let row = dk1_row.unwrap();
    assert_eq!(row.energy_ident_code_eic, "10YDK-1--------W");
    assert_eq!(row.business_type, "B65");
    // netInterchange from fixture is ~987
    assert!(row.net_interchange > 900.0, "netInterchange should be ~987");
    // difference = netInterchange - cgmaNetPosition
    let expected_diff = row.net_interchange - row.cgma_net_position;
    assert!((row.difference - expected_diff).abs() < 0.01);
    // sshVersion should round-trip from load_igm_file through SPARQL OPTIONAL
    // binding into join_results and out on ComparisonRow.
    assert_eq!(row.ssh_version, "001");
}

#[test]
fn test_igm_load_with_version_inserts_version_triple() {
    use cgma_igm_backend::graph_store::GraphStore;
    use cgma_igm_backend::igm_parser::load_igm_file;
    use oxigraph::sparql::QueryResults;

    let store = GraphStore::new().unwrap();
    let xml = std::fs::read_to_string("tests/fixtures/ssh_example.xml").unwrap();
    load_igm_file(&store, &xml, "test/ssh/path_001.zip", Some("001")).unwrap();

    let query = r#"
        PREFIX cgma: <urn:cgma:>
        SELECT ?g ?v WHERE {
            ?g cgma:sshVersion ?v .
        }
    "#;

    let results = store.query(query).unwrap();
    let mut found = false;
    if let QueryResults::Solutions(solutions) = results {
        for solution in solutions {
            let row = solution.unwrap();
            let v = row.get("v").unwrap().to_string();
            assert!(
                v.contains("001"),
                "version literal should contain 001, got {v}"
            );
            found = true;
        }
    }
    assert!(
        found,
        "Expected at least one sshVersion triple in the store"
    );
}

#[test]
fn test_igm_load_without_version_inserts_no_version_triple() {
    use cgma_igm_backend::graph_store::GraphStore;
    use cgma_igm_backend::igm_parser::load_igm_file;
    use oxigraph::sparql::QueryResults;

    let store = GraphStore::new().unwrap();
    let xml = std::fs::read_to_string("tests/fixtures/ssh_example.xml").unwrap();
    load_igm_file(&store, &xml, "test/ssh/path_noversion.zip", None).unwrap();

    let query = r#"
        PREFIX cgma: <urn:cgma:>
        SELECT ?v WHERE { ?g cgma:sshVersion ?v . }
    "#;

    let results = store.query(query).unwrap();
    let mut count = 0;
    if let QueryResults::Solutions(solutions) = results {
        for _ in solutions {
            count += 1;
        }
    }
    assert_eq!(
        count, 0,
        "Expected no sshVersion triples when version is None"
    );
}

#[test]
fn test_comparison_row_has_ssh_version_field() {
    use cgma_igm_backend::query::ComparisonRow;

    let row = ComparisonRow {
        scenario_time: "2026-04-09T23:30:00Z".to_string(),
        cgma_time: "2026-04-09T23:00:00Z".to_string(),
        energy_ident_code_eic: "10YDK-1--------W".to_string(),
        name: "DK1".to_string(),
        business_type: "B65".to_string(),
        net_interchange: 100.0,
        cgma_net_position: 90.0,
        difference: 10.0,
        measurement_unit: "MAW".to_string(),
        resolution: "PT1H".to_string(),
        ssh_version: "003".to_string(),
    };
    let json = serde_json::to_string(&row).unwrap();
    assert!(
        json.contains("\"sshVersion\":\"003\""),
        "Expected serialized JSON to contain sshVersion camelCase field, got {json}"
    );
}
