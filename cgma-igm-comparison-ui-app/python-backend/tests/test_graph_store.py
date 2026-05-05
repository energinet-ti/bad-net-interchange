from app.graph_store import GraphStore


def test_new_store_is_empty():
    store = GraphStore()
    assert store.len() == 0


def test_load_rdf_xml_adds_triples():
    store = GraphStore()
    # Minimal RDF/XML
    xml = """<?xml version="1.0"?>
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
             xmlns:ex="http://example.org/">
      <rdf:Description rdf:about="http://example.org/thing">
        <ex:name>Test</ex:name>
      </rdf:Description>
    </rdf:RDF>"""
    store.load_rdf_xml(xml, "urn:test:graph1")
    assert store.len() > 0


def test_sparql_query():
    store = GraphStore()
    xml = """<?xml version="1.0"?>
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
             xmlns:ex="http://example.org/">
      <rdf:Description rdf:about="http://example.org/thing">
        <ex:name>Test</ex:name>
      </rdf:Description>
    </rdf:RDF>"""
    store.load_rdf_xml(xml, "urn:test:graph1")
    results = store.query("""
        SELECT ?name WHERE {
            GRAPH ?g { ?s <http://example.org/name> ?name }
        }
    """)
    assert len(results) == 1
    assert str(results[0]["name"]) == "Test"


def test_clear_empties_store():
    store = GraphStore()
    xml = """<?xml version="1.0"?>
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
             xmlns:ex="http://example.org/">
      <rdf:Description rdf:about="http://example.org/thing">
        <ex:name>Test</ex:name>
      </rdf:Description>
    </rdf:RDF>"""
    store.load_rdf_xml(xml, "urn:test:graph1")
    store.clear()
    assert store.len() == 0
