use oxigraph::io::{RdfFormat, RdfParser};
use oxigraph::model::*;
use oxigraph::sparql::QueryResults;
use oxigraph::store::Store;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum StoreError {
    #[error("Store error: {0}")]
    Store(#[from] oxigraph::store::StorageError),
    #[error("Loader error: {0}")]
    Loader(#[from] oxigraph::store::LoaderError),
    #[error("SPARQL evaluation error: {0}")]
    Evaluation(#[from] oxigraph::sparql::QueryEvaluationError),
}

pub struct GraphStore {
    store: Store,
}

impl GraphStore {
    pub fn new() -> Result<Self, StoreError> {
        Ok(Self {
            store: Store::new()?,
        })
    }

    /// Load RDF/XML content into a named graph.
    ///
    /// Uses a shared base IRI so relative references (rdf:ID, rdf:about="#...")
    /// across EQ and SSH files resolve to the same absolute IRIs, enabling
    /// cross-graph SPARQL joins.
    pub fn load_rdf_xml(&self, xml_content: &str, graph_name: &str) -> Result<(), StoreError> {
        let graph = NamedNode::new(graph_name).expect("invalid graph name IRI");
        let parser = RdfParser::from_format(RdfFormat::RdfXml)
            .with_base_iri("urn:cim:")
            .expect("valid base IRI")
            .without_named_graphs()
            .with_default_graph(graph);
        self.store
            .load_from_reader(parser, xml_content.as_bytes())?;
        Ok(())
    }

    /// Insert individual quads (used for CGMA parsed data).
    pub fn insert_quad(&self, quad: QuadRef<'_>) -> Result<(), StoreError> {
        self.store.insert(quad)?;
        Ok(())
    }

    /// Run a SPARQL SELECT query.
    #[allow(deprecated)]
    pub fn query(&self, sparql: &str) -> Result<QueryResults<'_>, StoreError> {
        Ok(self.store.query(sparql)?)
    }

    /// Clear all data from the store.
    pub fn clear(&self) -> Result<(), StoreError> {
        self.store.clear()?;
        Ok(())
    }

    /// Get triple count.
    pub fn len(&self) -> usize {
        self.store.len().unwrap_or(0)
    }
}
