use oxigraph::model::*;
use quick_xml::events::Event;
use quick_xml::reader::Reader;

use crate::graph_store::{GraphStore, StoreError};

const CGMA_NS: &str = "https://example.com/cgma#";

/// Parse CGMA plain XML and load as RDF triples into the store.
///
/// Creates triples matching the pattern used by the CGMA SPARQL query:
///   ?timeSeries a cgma:TimeSeries ;
///     cgma:mRID ?mrid ; cgma:businessType ?bt ; ...
///     cgma:hasPeriod ?period .
///   ?period cgma:start ?s ; cgma:end ?e ; cgma:hasPoint ?point .
///   ?point cgma:position ?pos ; cgma:quantity ?qty .
pub fn load_cgma_file(
    store: &GraphStore,
    xml_content: &str,
    source_path: &str,
) -> Result<(), StoreError> {
    let graph_name = GraphName::NamedNode(
        NamedNode::new(format!(
            "urn:cgma:{}",
            source_path.replace(['\\', ' '], "/")
        ))
        .expect("invalid graph IRI"),
    );

    let rdf_type = NamedNode::new("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").unwrap();
    let cgma_timeseries = NamedNode::new(format!("{CGMA_NS}TimeSeries")).unwrap();
    let cgma_mrid = NamedNode::new(format!("{CGMA_NS}mRID")).unwrap();
    let cgma_business_type = NamedNode::new(format!("{CGMA_NS}businessType")).unwrap();
    let cgma_in_domain = NamedNode::new(format!("{CGMA_NS}inDomainMRID")).unwrap();
    let cgma_out_domain = NamedNode::new(format!("{CGMA_NS}outDomainMRID")).unwrap();
    let cgma_measurement_unit = NamedNode::new(format!("{CGMA_NS}measurementUnitName")).unwrap();
    let cgma_has_period = NamedNode::new(format!("{CGMA_NS}hasPeriod")).unwrap();
    let cgma_start = NamedNode::new(format!("{CGMA_NS}start")).unwrap();
    let cgma_end = NamedNode::new(format!("{CGMA_NS}end")).unwrap();
    let cgma_resolution = NamedNode::new(format!("{CGMA_NS}resolution")).unwrap();
    let cgma_has_point = NamedNode::new(format!("{CGMA_NS}hasPoint")).unwrap();
    let cgma_position = NamedNode::new(format!("{CGMA_NS}position")).unwrap();
    let cgma_quantity = NamedNode::new(format!("{CGMA_NS}quantity")).unwrap();

    // Parse XML using a state machine approach
    let mut reader = Reader::from_str(xml_content);
    reader.config_mut().trim_text(true);

    let mut series_idx: usize = 0;
    let mut period_idx: usize = 0;
    let mut point_idx: usize = 0;
    let mut depth_stack: Vec<String> = Vec::new();
    let mut current_text = String::new();

    let mut series_node: Option<BlankNode> = None;
    let mut period_node: Option<BlankNode> = None;

    #[allow(unused_assignments)]
    let mut field_name: Option<String> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let local = local_name(e.name().as_ref());
                depth_stack.push(local.clone());
                current_text.clear();

                match local.as_str() {
                    "TimeSeries" => {
                        let node = BlankNode::new(format!("ts_{series_idx}")).unwrap();
                        store.insert_quad(QuadRef::new(
                            node.as_ref(),
                            rdf_type.as_ref(),
                            cgma_timeseries.as_ref(),
                            graph_name.as_ref(),
                        ))?;
                        series_node = Some(node);
                        period_idx = 0;
                    }
                    "Period" if series_node.is_some() => {
                        let node =
                            BlankNode::new(format!("ts_{series_idx}_p_{period_idx}")).unwrap();
                        let sn = series_node.as_ref().unwrap();
                        store.insert_quad(QuadRef::new(
                            sn.as_ref(),
                            cgma_has_period.as_ref(),
                            node.as_ref(),
                            graph_name.as_ref(),
                        ))?;
                        period_node = Some(node);
                        point_idx = 0;
                    }
                    "Point" if period_node.is_some() => {
                        // Point fields handled on End event
                    }
                    _ => {
                        field_name = Some(local);
                    }
                }
            }
            Ok(Event::Text(e)) => {
                current_text = e.unescape().unwrap_or_default().to_string();
            }
            Ok(Event::End(e)) => {
                let local = local_name(e.name().as_ref());

                match local.as_str() {
                    "TimeSeries" => {
                        series_idx += 1;
                        series_node = None;
                    }
                    "Period" => {
                        period_idx += 1;
                        period_node = None;
                    }
                    "Point" => {
                        point_idx += 1;
                    }
                    "mRID" if series_node.is_some() && period_node.is_none() => {
                        add_literal(
                            store,
                            series_node.as_ref().unwrap(),
                            &cgma_mrid,
                            &current_text,
                            &graph_name,
                        )?;
                    }
                    "businessType" if series_node.is_some() => {
                        add_literal(
                            store,
                            series_node.as_ref().unwrap(),
                            &cgma_business_type,
                            &current_text,
                            &graph_name,
                        )?;
                    }
                    "in_Domain.mRID" => {
                        if let Some(sn) = series_node.as_ref() {
                            add_literal(store, sn, &cgma_in_domain, &current_text, &graph_name)?;
                        }
                    }
                    "out_Domain.mRID" => {
                        if let Some(sn) = series_node.as_ref() {
                            add_literal(store, sn, &cgma_out_domain, &current_text, &graph_name)?;
                        }
                    }
                    "measurement_Unit.name" => {
                        if let Some(sn) = series_node.as_ref() {
                            add_literal(
                                store,
                                sn,
                                &cgma_measurement_unit,
                                &current_text,
                                &graph_name,
                            )?;
                        }
                    }
                    "resolution" if period_node.is_some() => {
                        add_literal(
                            store,
                            period_node.as_ref().unwrap(),
                            &cgma_resolution,
                            &current_text,
                            &graph_name,
                        )?;
                    }
                    "start" if period_node.is_some() => {
                        add_literal(
                            store,
                            period_node.as_ref().unwrap(),
                            &cgma_start,
                            &current_text,
                            &graph_name,
                        )?;
                    }
                    "end" if period_node.is_some() => {
                        add_literal(
                            store,
                            period_node.as_ref().unwrap(),
                            &cgma_end,
                            &current_text,
                            &graph_name,
                        )?;
                    }
                    "position" if period_node.is_some() => {
                        let pn = BlankNode::new(format!(
                            "ts_{series_idx}_p_{period_idx}_pt_{point_idx}"
                        ))
                        .unwrap();
                        if let Some(per) = period_node.as_ref() {
                            store.insert_quad(QuadRef::new(
                                per.as_ref(),
                                cgma_has_point.as_ref(),
                                pn.as_ref(),
                                graph_name.as_ref(),
                            ))?;
                        }
                        add_literal(store, &pn, &cgma_position, &current_text, &graph_name)?;
                    }
                    "quantity" if period_node.is_some() => {
                        let pn = BlankNode::new(format!(
                            "ts_{series_idx}_p_{period_idx}_pt_{point_idx}"
                        ))
                        .unwrap();
                        add_literal(store, &pn, &cgma_quantity, &current_text, &graph_name)?;
                    }
                    _ => {}
                }

                depth_stack.pop();
                current_text.clear();
                field_name = None;
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                tracing::warn!("XML parse error in {source_path}: {e}");
                break;
            }
            _ => {}
        }
    }

    Ok(())
}

fn local_name(name: &[u8]) -> String {
    let s = String::from_utf8_lossy(name);
    if let Some(pos) = s.rfind('}') {
        s[pos + 1..].to_string()
    } else {
        s.to_string()
    }
}

fn add_literal(
    store: &GraphStore,
    subject: &BlankNode,
    predicate: &NamedNode,
    value: &str,
    graph_name: &GraphName,
) -> Result<(), StoreError> {
    if value.is_empty() {
        return Ok(());
    }
    let literal = Literal::new_simple_literal(value);
    store.insert_quad(QuadRef::new(
        subject.as_ref(),
        predicate.as_ref(),
        literal.as_ref(),
        graph_name.as_ref(),
    ))
}
