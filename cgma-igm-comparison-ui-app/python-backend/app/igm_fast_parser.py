import xml.etree.ElementTree as ET
from dataclasses import dataclass

NS = {
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "cim": "http://iec.ch/TC57/2013/CIM-schema-cim16#",
    "entsoe": "http://entsoe.eu/CIM/SchemaExtension/3/1#",
    "md": "http://iec.ch/TC57/61970-552/ModelDescription/1#",
}


@dataclass
class EqRecord:
    control_area_id: str
    energy_ident_code_eic: str
    name: str


@dataclass
class SshRecord:
    control_area_id: str
    scenario_time: str
    net_interchange: float
    ssh_version: str = ""


def parse_eq(xml_content: str) -> list[EqRecord]:
    """Extract ControlArea records from an EQ RDF/XML file.

    Pulls only: rdf:ID, energyIdentCodeEic, IdentifiedObject.name
    from <cim:ControlArea> elements.
    """
    root = ET.fromstring(xml_content)
    records = []

    for ca in root.findall("cim:ControlArea", NS):
        ca_id = ca.get(f"{{{NS['rdf']}}}ID", "")
        eic_elem = ca.find("entsoe:IdentifiedObject.energyIdentCodeEic", NS)
        name_elem = ca.find("cim:IdentifiedObject.name", NS)

        eic_text = eic_elem.text if eic_elem is not None else None
        name_text = name_elem.text if name_elem is not None else None

        if ca_id and eic_text and name_text:
            records.append(EqRecord(
                control_area_id=ca_id,
                energy_ident_code_eic=eic_text.strip(),
                name=name_text.strip(),
            ))

    return records


def parse_ssh(xml_content: str, ssh_version: str = "") -> list[SshRecord]:
    """Extract ControlArea net interchange from an SSH RDF/XML file.

    Pulls: scenarioTime from FullModel, plus rdf:about and netInterchange
    from each <cim:ControlArea> element.

    The ``ssh_version`` argument does not come from the XML itself — it is
    supplied by the caller from the IGM API response metadata and stamped
    onto each returned ``SshRecord`` so downstream code can filter rows by
    version. Default ``""`` means "no version info available" (e.g. when
    only EQ files are loaded, or the caller does not know the version).
    """
    root = ET.fromstring(xml_content)

    # Extract scenarioTime from FullModel
    scenario_time = ""
    for fm in root.findall("md:FullModel", NS):
        st_elem = fm.find("md:Model.scenarioTime", NS)
        if st_elem is not None and st_elem.text:
            scenario_time = st_elem.text.strip()
            break

    records = []
    for ca in root.findall("cim:ControlArea", NS):
        about = ca.get(f"{{{NS['rdf']}}}about", "")
        # Strip leading "#" from rdf:about to match rdf:ID in EQ files
        ca_id = about.removeprefix("#")

        ni_elem = ca.find("cim:ControlArea.netInterchange", NS)
        if ca_id and ni_elem is not None and ni_elem.text:
            records.append(SshRecord(
                control_area_id=ca_id,
                scenario_time=scenario_time,
                net_interchange=float(ni_elem.text.strip()),
                ssh_version=ssh_version,
            ))

    return records
