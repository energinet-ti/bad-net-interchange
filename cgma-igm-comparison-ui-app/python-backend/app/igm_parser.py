from app.graph_store import GraphStore


def load_igm_file(store: GraphStore, xml_content: str, file_path: str) -> None:
    """Load an IGM RDF/XML file into the store under a named graph.

    Graph name derived from file path to keep EQ and SSH data in
    separate named graphs (required for SPARQL GRAPH patterns).
    """
    graph_name = "urn:igm:" + file_path.replace("\\", "/").replace(" ", "/")
    store.load_rdf_xml(xml_content, graph_name)
