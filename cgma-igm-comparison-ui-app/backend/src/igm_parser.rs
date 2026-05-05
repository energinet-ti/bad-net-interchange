use oxigraph::model::{GraphName, Literal, NamedNode, Quad};

use crate::graph_store::GraphStore;

/// Load an IGM RDF/XML file into the store under a named graph.
///
/// Graph name is derived from the file path to keep EQ and SSH
/// data in separate named graphs (required for the IGM SPARQL query
/// which uses GRAPH patterns).
///
/// If `ssh_version` is `Some`, a `<graph> <urn:cgma:sshVersion> "<version>"`
/// triple is inserted into the **default** graph so the downstream SPARQL
/// query can correlate a named graph with its SSH version. Pass `None`
/// for EQ files (no version concept) or when loading without version info.
pub fn load_igm_file(
    store: &GraphStore,
    xml_content: &str,
    file_path: &str,
    ssh_version: Option<&str>,
) -> Result<(), crate::graph_store::StoreError> {
    let graph_name_str = format!("urn:igm:{}", file_path.replace(['\\', ' '], "/"));
    store.load_rdf_xml(xml_content, &graph_name_str)?;

    if let Some(version) = ssh_version {
        let graph_iri = NamedNode::new(&graph_name_str).expect("valid graph IRI");
        let predicate = NamedNode::new("urn:cgma:sshVersion").expect("valid predicate IRI");
        let literal = Literal::new_simple_literal(version);
        let quad = Quad::new(graph_iri, predicate, literal, GraphName::DefaultGraph);
        store.insert_quad(quad.as_ref())?;
    }

    Ok(())
}
