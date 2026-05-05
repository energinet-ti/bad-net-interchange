import os
from app.graph_store import GraphStore
from app.igm_parser import load_igm_file

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def test_igm_loading_produces_triples():
    store = GraphStore()
    eq_xml = open(os.path.join(FIXTURES, "eq_example.xml")).read()
    ssh_xml = open(os.path.join(FIXTURES, "ssh_example.xml")).read()
    load_igm_file(store, eq_xml, "test/eq")
    load_igm_file(store, ssh_xml, "test/ssh")
    assert store.len() > 0


def test_igm_control_area_query():
    store = GraphStore()
    eq_xml = open(os.path.join(FIXTURES, "eq_example.xml")).read()
    ssh_xml = open(os.path.join(FIXTURES, "ssh_example.xml")).read()
    load_igm_file(store, eq_xml, "test/eq")
    load_igm_file(store, ssh_xml, "test/ssh")

    query = """
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
                ?sshModel rdf:type md:FullModel ;
                    md:Model.scenarioTime ?scenarioTime .
                FILTER EXISTS {
                    ?sshModel md:Model.profile ?sshProfile .
                    FILTER(CONTAINS(STR(?sshProfile), "SteadyStateHypothesis"))
                }
                ?controlArea cim:ControlArea.netInterchange ?netInterchange .
            }
        }
    """
    results = store.query(query)
    dk1_rows = [r for r in results if "DK1" in str(r.get("name", ""))]
    assert len(dk1_rows) > 0, "Should find DK1 ControlArea"
    row = dk1_rows[0]
    assert "10YDK-1--------W" in str(row["energyIdentCodeEic"])
