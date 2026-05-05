import os
from app.graph_store import GraphStore
from app.cgma_parser import load_cgma_file

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def test_cgma_loading_produces_triples():
    store = GraphStore()
    xml = open(os.path.join(FIXTURES, "cgma_example.xml")).read()
    load_cgma_file(store, xml, "test/cgma")
    assert store.len() > 0


def test_cgma_b65_query_returns_results():
    store = GraphStore()
    xml = open(os.path.join(FIXTURES, "cgma_example.xml")).read()
    load_cgma_file(store, xml, "test/cgma")

    query = """
        PREFIX cgma: <https://example.com/cgma#>
        SELECT ?businessType ?position ?quantity
        WHERE {
            GRAPH ?g {
                ?ts a cgma:TimeSeries ;
                    cgma:businessType ?businessType ;
                    cgma:hasPeriod ?period .
                FILTER(?businessType = "B65")
                ?period cgma:hasPoint ?point .
                ?point cgma:position ?position ;
                       cgma:quantity ?quantity .
            }
        }
        ORDER BY ?position
    """
    results = store.query(query)
    assert len(results) > 0, "Should find B65 data points"
    for row in results:
        assert str(row["businessType"]) == "B65"


def test_cgma_non_b65_exists():
    store = GraphStore()
    xml = open(os.path.join(FIXTURES, "cgma_example.xml")).read()
    load_cgma_file(store, xml, "test/cgma")

    query = """
        PREFIX cgma: <https://example.com/cgma#>
        SELECT ?businessType
        WHERE {
            GRAPH ?g {
                ?ts a cgma:TimeSeries ;
                    cgma:businessType ?businessType .
                FILTER(?businessType = "A66")
            }
        }
    """
    results = store.query(query)
    assert len(results) > 0, "Should find A66 flow TimeSeries"
