from rdflib import Dataset, URIRef, Literal, BNode, Namespace


class GraphStore:
    """Wraps rdflib Dataset for named-graph SPARQL support."""

    def __init__(self):
        self._graph = Dataset()

    def load_rdf_xml(self, xml_content: str, graph_name: str) -> None:
        """Load RDF/XML content into a named graph.

        Uses base IRI 'urn:cim:' so relative references across EQ and SSH
        files resolve to the same absolute IRIs (enabling cross-graph joins).
        """
        named_graph = self._graph.get_context(URIRef(graph_name))
        named_graph.parse(
            data=xml_content,
            format="xml",
            publicID="urn:cim:",
        )

    def insert_triple(self, graph_name: str, subject, predicate, obj) -> None:
        """Insert a single triple into a named graph."""
        named_graph = self._graph.get_context(URIRef(graph_name))
        named_graph.add((subject, predicate, obj))

    def query(self, sparql: str) -> list[dict]:
        """Run a SPARQL SELECT query. Returns list of dicts."""
        results = self._graph.query(sparql)
        rows = []
        for row in results:
            d = {}
            for var in results.vars:
                d[str(var)] = row[var]
            rows.append(d)
        return rows

    def clear(self) -> None:
        """Remove all triples from the store."""
        self._graph.remove((None, None, None))
        for g in list(self._graph.graphs()):
            self._graph.remove_graph(g)

    def len(self) -> int:
        """Return total triple count across all named graphs."""
        return len(self._graph)
