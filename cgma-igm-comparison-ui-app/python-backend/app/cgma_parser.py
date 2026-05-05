import xml.etree.ElementTree as ET
from rdflib import URIRef, Literal, BNode, Namespace, RDF
from app.graph_store import GraphStore

CGMA = Namespace("https://example.com/cgma#")


def load_cgma_file(store: GraphStore, xml_content: str, source_path: str) -> None:
    """Parse CGMA XML and load as RDF triples into the store.

    Creates triples matching the pattern used by the CGMA SPARQL query:
      ?timeSeries a cgma:TimeSeries ;
        cgma:mRID ?mrid ; cgma:businessType ?bt ; ...
        cgma:hasPeriod ?period .
      ?period cgma:start ?s ; cgma:resolution ?r ; cgma:hasPoint ?point .
      ?point cgma:position ?pos ; cgma:quantity ?qty .
    """
    graph_name = "urn:cgma:" + source_path.replace("\\", "/").replace(" ", "/")

    root = ET.fromstring(xml_content)

    for ts_idx, ts_elem in enumerate(_find_all_local(root, "TimeSeries")):
        ts_node = BNode(f"ts_{ts_idx}")
        store.insert_triple(graph_name, ts_node, RDF.type, CGMA.TimeSeries)

        _add_text_field(store, graph_name, ts_node, ts_elem, "mRID", CGMA.mRID)
        _add_text_field(store, graph_name, ts_node, ts_elem, "businessType", CGMA.businessType)
        _add_text_field(store, graph_name, ts_node, ts_elem, "in_Domain.mRID", CGMA.inDomainMRID)
        _add_text_field(store, graph_name, ts_node, ts_elem, "out_Domain.mRID", CGMA.outDomainMRID)
        _add_text_field(store, graph_name, ts_node, ts_elem, "measurement_Unit.name", CGMA.measurementUnitName)

        for p_idx, period_elem in enumerate(_find_all_local(ts_elem, "Period")):
            period_node = BNode(f"ts_{ts_idx}_p_{p_idx}")
            store.insert_triple(graph_name, ts_node, CGMA.hasPeriod, period_node)

            _add_text_field(store, graph_name, period_node, period_elem, "resolution", CGMA.resolution)

            # start/end are nested inside <timeInterval>
            for ti_elem in _find_all_local(period_elem, "timeInterval"):
                _add_text_field(store, graph_name, period_node, ti_elem, "start", CGMA.start)
                _add_text_field(store, graph_name, period_node, ti_elem, "end", CGMA.end)

            for pt_idx, point_elem in enumerate(_find_all_local(period_elem, "Point")):
                point_node = BNode(f"ts_{ts_idx}_p_{p_idx}_pt_{pt_idx}")
                store.insert_triple(graph_name, period_node, CGMA.hasPoint, point_node)

                _add_text_field(store, graph_name, point_node, point_elem, "position", CGMA.position)
                _add_text_field(store, graph_name, point_node, point_elem, "quantity", CGMA.quantity)


def _find_all_local(elem, local_name: str):
    """Find child elements by local name, ignoring namespace prefixes."""
    results = []
    for child in elem:
        tag = child.tag
        # Strip namespace: {http://...}localname -> localname
        if "}" in tag:
            tag = tag.split("}", 1)[1]
        if tag == local_name:
            results.append(child)
    return results


def _get_text_local(elem, local_name: str) -> str | None:
    """Get text content of a child element by local name."""
    for child in _find_all_local(elem, local_name):
        if child.text and child.text.strip():
            return child.text.strip()
    return None


def _add_text_field(store, graph_name, subject, elem, local_name, predicate) -> None:
    """Add a literal triple if the element has text content."""
    text = _get_text_local(elem, local_name)
    if text:
        store.insert_triple(graph_name, subject, predicate, Literal(text))
