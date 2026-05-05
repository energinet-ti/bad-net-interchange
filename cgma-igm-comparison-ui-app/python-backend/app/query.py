import logging
import time
from datetime import datetime, timedelta
from app.graph_store import GraphStore
from app.igm_fast_parser import EqRecord, SshRecord

logger = logging.getLogger(__name__)

IGM_QUERY = """
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX md: <http://iec.ch/TC57/61970-552/ModelDescription/1#>
PREFIX cim: <http://iec.ch/TC57/2013/CIM-schema-cim16#>
PREFIX entsoe: <http://entsoe.eu/CIM/SchemaExtension/3/1#>

SELECT DISTINCT
  ?energyIdentCodeEic
  ?name
  ?scenarioTime
  ?netInterchange
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
ORDER BY ?name ?scenarioTime
"""

CGMA_QUERY = """
PREFIX cgma: <https://example.com/cgma#>

SELECT
  ?businessType
  ?inDomain
  ?outDomain
  ?measurementUnit
  ?periodStart
  ?resolution
  ?position
  ?quantity
WHERE {
  GRAPH ?g {
    ?timeSeries a cgma:TimeSeries ;
      cgma:businessType ?businessType ;
      cgma:measurementUnitName ?measurementUnit ;
      cgma:hasPeriod ?period .
    FILTER(?businessType = "B65")
    OPTIONAL { ?timeSeries cgma:inDomainMRID ?inDomain . }
    OPTIONAL { ?timeSeries cgma:outDomainMRID ?outDomain . }
    ?period cgma:start ?periodStart ;
      cgma:resolution ?resolution ;
      cgma:hasPoint ?point .
    ?point cgma:position ?position ;
      cgma:quantity ?quantity .
  }
}
"""


def truncate_to_hour(datetime_str: str) -> str | None:
    """Truncate IGM scenarioTime (which has :30 minutes) to the hour.
    '2026-03-05T00:30:00Z' -> '2026-03-05T00:00:00Z'
    """
    clean = datetime_str.rstrip("Z")
    try:
        dt = datetime.strptime(clean, "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return None
    truncated = dt.replace(minute=0, second=0)
    return truncated.strftime("%Y-%m-%dT%H:%M:%SZ")


def cgma_timestamp(period_start: str, position: int, resolution: str) -> str | None:
    """Compute CGMA timestamp from periodStart + (position-1) * resolution.
    Position is 1-indexed in ENTSO-E: position 1 = interval starting at periodStart.
    periodStart: '2026-03-04T23:00Z', position: 1, resolution: 'PT1H'
    -> '2026-03-04T23:00:00Z'
    """
    clean = period_start.rstrip("Z")
    try:
        dt = datetime.strptime(clean, "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        try:
            dt = datetime.strptime(clean, "%Y-%m-%dT%H:%M")
        except ValueError:
            return None

    if resolution == "PT1H":
        offset = timedelta(hours=position - 1)
    elif resolution == "PT30M":
        offset = timedelta(minutes=(position - 1) * 30)
    else:
        offset = timedelta(hours=position - 1)

    result = dt + offset
    return result.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_igm_results(store: GraphStore) -> list[dict]:
    """Execute IGM SPARQL query and return structured rows."""
    results = store.query(IGM_QUERY)
    rows = []
    for row in results:
        rows.append({
            "scenarioTime": str(row["scenarioTime"]),
            "energyIdentCodeEic": str(row["energyIdentCodeEic"]),
            "name": str(row["name"]),
            "netInterchange": float(str(row["netInterchange"])),
        })
    logger.info("IGM parsed: %d rows", len(rows))
    return rows


def _parse_cgma_results(store: GraphStore) -> list[dict]:
    """Execute CGMA SPARQL query and return structured rows."""
    results = store.query(CGMA_QUERY)
    rows = []
    for row in results:
        in_domain = str(row["inDomain"]) if row.get("inDomain") else ""
        out_domain = str(row["outDomain"]) if row.get("outDomain") else ""

        if in_domain:
            eic = in_domain
            is_import = True
        else:
            eic = out_domain
            is_import = False

        rows.append({
            "eic": eic,
            "periodStart": str(row["periodStart"]),
            "resolution": str(row["resolution"]),
            "position": int(str(row["position"])),
            "quantity": float(str(row["quantity"])),
            "isImport": is_import,
            "measurementUnit": str(row["measurementUnit"]),
            "businessType": str(row["businessType"]),
        })
    return rows


def _aggregate_cgma(cgma_rows: list[dict]) -> dict[tuple[str, str], dict]:
    """Aggregate CGMA rows by (eic, timestamp) into net positions."""
    agg: dict[tuple[str, str], dict] = {}

    for cr in cgma_rows:
        ts = cgma_timestamp(cr["periodStart"], cr["position"], cr["resolution"])
        if ts is None:
            continue

        key = (cr["eic"], ts)
        if key not in agg:
            agg[key] = {
                "netPosition": 0.0,
                "measurementUnit": cr["measurementUnit"],
                "resolution": cr["resolution"],
                "businessType": cr["businessType"],
            }

        if cr["isImport"]:
            agg[key]["netPosition"] += cr["quantity"]
        else:
            agg[key]["netPosition"] -= cr["quantity"]

    return agg


def _join_results(igm_rows: list[dict], cgma_map: dict) -> list[dict]:
    """Join IGM rows with aggregated CGMA data on (EIC, truncated hour).

    Only matches where both IGM and CGMA have data for the same timestamp.
    CGMA timestamps are computed from periodStart + (position-1) * resolution,
    so they naturally span across day boundaries when needed.

    The output row carries `sshVersion` copied from the IGM row when present
    (fast path); it defaults to `""` when absent (e.g. SPARQL slow path).
    """
    result = []

    for igm in igm_rows:
        hour_key = truncate_to_hour(igm["scenarioTime"])
        if hour_key is None:
            continue

        key = (igm["energyIdentCodeEic"], hour_key)
        cgma = cgma_map.get(key)

        if cgma is None:
            continue

        difference = igm["netInterchange"] - cgma["netPosition"]
        result.append({
            "scenarioTime": igm["scenarioTime"],
            "cgmaTime": hour_key,
            "energyIdentCodeEic": igm["energyIdentCodeEic"],
            "name": igm["name"],
            "businessType": cgma["businessType"],
            "netInterchange": igm["netInterchange"],
            "cgmaNetPosition": cgma["netPosition"],
            "difference": difference,
            "measurementUnit": cgma["measurementUnit"],
            "resolution": cgma["resolution"],
            "sshVersion": igm.get("sshVersion", ""),
        })

    result.sort(key=lambda r: (r["name"], r["scenarioTime"], r["sshVersion"]))
    return result


def run_comparison_query(store: GraphStore) -> list[dict]:
    """Run IGM + CGMA queries, aggregate CGMA, join, return comparison rows."""
    t_total = time.time()

    t0 = time.time()
    igm_rows = _parse_igm_results(store)
    logger.info("IGM query: %.2fs (%d rows)", time.time() - t0, len(igm_rows))

    t0 = time.time()
    cgma_rows = _parse_cgma_results(store)
    logger.info("CGMA query: %.2fs (%d rows)", time.time() - t0, len(cgma_rows))

    t0 = time.time()
    cgma_map = _aggregate_cgma(cgma_rows)
    logger.info("CGMA aggregation: %.2fs (%d groups)", time.time() - t0, len(cgma_map))

    t0 = time.time()
    result = _join_results(igm_rows, cgma_map)
    logger.info("Join: %.2fs (%d result rows)", time.time() - t0, len(result))

    logger.info("Total query: %.2fs", time.time() - t_total)
    return result


def run_comparison_fast(
    eq_records: list[EqRecord],
    ssh_records: list[SshRecord],
    cgma_store: GraphStore,
) -> list[dict]:
    """Fast comparison: Python dict join for IGM, SPARQL for CGMA only."""
    t_total = time.time()

    # Build EQ lookup by control_area_id
    t0 = time.time()
    eq_map: dict[str, EqRecord] = {}
    for eq in eq_records:
        if eq.control_area_id not in eq_map:
            eq_map[eq.control_area_id] = eq
    logger.info("EQ index: %.2fs (%d areas)", time.time() - t0, len(eq_map))

    # Join SSH with EQ to build IGM rows
    t0 = time.time()
    igm_rows = []
    for ssh in ssh_records:
        eq = eq_map.get(ssh.control_area_id)
        if eq is None:
            continue
        igm_rows.append({
            "scenarioTime": ssh.scenario_time,
            "energyIdentCodeEic": eq.energy_ident_code_eic,
            "name": eq.name,
            "netInterchange": ssh.net_interchange,
            "sshVersion": ssh.ssh_version,
        })
    logger.info("IGM join: %.2fs (%d rows)", time.time() - t0, len(igm_rows))

    # CGMA: still use SPARQL (it's fast)
    t0 = time.time()
    cgma_rows = _parse_cgma_results(cgma_store)
    logger.info("CGMA query: %.2fs (%d rows)", time.time() - t0, len(cgma_rows))

    t0 = time.time()
    cgma_map = _aggregate_cgma(cgma_rows)
    logger.info("CGMA aggregation: %.2fs (%d groups)", time.time() - t0, len(cgma_map))

    t0 = time.time()
    result = _join_results(igm_rows, cgma_map)
    logger.info("Final join: %.2fs (%d result rows)", time.time() - t0, len(result))

    logger.info("Total fast query: %.2fs", time.time() - t_total)
    return result
