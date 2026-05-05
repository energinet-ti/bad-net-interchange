# Plan: Compare CGMES IGM SSH Net Interchange vs CGMA Net Position

## Goal

Build a simple Python script that compares Danish CGMES IGM SSH files against the inhouse CGMA XML format.

The comparison should:

- Read CGMES IGM SSH ZIP files from `sample-data/igm`
- Read CGMA XML files from `sample-data/cgma`
- Extract `cim:ControlArea.netInterchange` from each SSH file
- Use only the latest SSH version per timestamp and area
- Map:
  - `DKE` → `DK2`
  - `DKW` → `DK1`
- Extract CGMA net position values for DK1 and DK2
- Compare hour by hour
- Classify each difference as `NORMAL`, `WARNING`, or `ERROR`
- Print the result as a table and optionally write it to CSV

---

## Folder layout

```text
project/
  compare_igm_vs_cgma.py
  sample-data/
    igm/
      20260505T0330Z_04_DKE_SSH_001.zip
      20260505T0330Z_04_DKW_SSH_001.zip
      ...
    cgma/
      cgma-file.xml
      ...
```

---

## Comparison logic

### CGMES IGM SSH

Each ZIP contains an SSH XML file.

From the XML, extract:

```xml
<cim:ControlArea.netInterchange>...</cim:ControlArea.netInterchange>
```

From the filename, extract:

```text
20260505T0330Z_04_DKE_SSH_001.zip
^^^^^^^^^^^^^^^ timestamp UTC
                 ^^ version
                    ^^^ area
```

For each timestamp and area, keep only the highest version number.

Example:

```text
20260505T0330Z_00_DKE_SSH_001.zip
20260505T0330Z_01_DKE_SSH_001.zip
20260505T0330Z_04_DKE_SSH_001.zip  <- use this one
```

---

## CGMA logic

The CGMA file contains net position forecast series.

Use series with:

```text
code="NetPositionForecastD-2"
measurementUnit="MW"
```

Relevant series:

```text
NP-DK1-IM-*  -> DK1 import
NP-DK1-EX-*  -> DK1 export
NP-DK2-IM-*  -> DK2 import
NP-DK2-EX-*  -> DK2 export
```

Calculate:

```text
CGMA net position = export - import
```

So:

```text
DK1_CGMA = DK1_export - DK1_import
DK2_CGMA = DK2_export - DK2_import
```

If the first real comparison shows the same magnitude but opposite sign, change this to:

```text
CGMA net position = import - export
```

---

## Status thresholds

Suggested default thresholds:

```text
abs(diff) < 50 MW        -> NORMAL
50 MW <= abs(diff) < 200 -> WARNING
abs(diff) >= 200 MW      -> ERROR
```

These can be adjusted later.

---

## Python script

Save this as:

```text
compare_igm_vs_cgma.py
```

```python
from __future__ import annotations

import csv
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
import xml.etree.ElementTree as ET


IGM_DIR = Path("sample-data/igm")
CGMA_DIR = Path("sample-data/cgma")
OUTPUT_CSV = Path("comparison_result.csv")

WARNING_LIMIT_MW = 50.0
ERROR_LIMIT_MW = 200.0

AREA_MAP = {
    "DKE": "DK2",
    "DKW": "DK1",
}

SSH_FILENAME_RE = re.compile(
    r"(?P<timestamp>\d{8}T\d{4}Z)_(?P<version>\d+)_(?P<area>DKE|DKW)_SSH_\d+\.zip$"
)


@dataclass
class SshRecord:
    timestamp: str
    version: int
    igm_area: str
    area: str
    net_interchange: float
    filename: str


@dataclass
class ComparisonRecord:
    timestamp: str
    area: str
    ssh_version: int
    ssh_net_interchange: float
    cgma_net_position: float
    difference_mw: float
    abs_difference_mw: float
    status: str
    ssh_file: str


def parse_timestamp_from_filename(value: str) -> str:
    """
    Converts 20260505T0330Z to 2026-05-05T03:30Z.
    Kept as a string to avoid timezone dependency.
    """
    return f"{value[0:4]}-{value[4:6]}-{value[6:8]}T{value[9:11]}:{value[11:13]}Z"


def classify_difference(diff_mw: float) -> str:
    abs_diff = abs(diff_mw)

    if abs_diff >= ERROR_LIMIT_MW:
        return "ERROR"
    if abs_diff >= WARNING_LIMIT_MW:
        return "WARNING"
    return "NORMAL"


def find_xml_inside_zip(zip_file: zipfile.ZipFile) -> str:
    xml_files = [name for name in zip_file.namelist() if name.lower().endswith(".xml")]

    if not xml_files:
        raise ValueError("ZIP contains no XML file")

    if len(xml_files) > 1:
        # Usually there is only one. If there are multiple, use the first.
        # This can be tightened later if needed.
        return xml_files[0]

    return xml_files[0]


def extract_net_interchange_from_zip(zip_path: Path) -> Optional[float]:
    """
    Opens the ZIP in memory and extracts cim:ControlArea.netInterchange.
    Does not unzip to disk.
    """
    with zipfile.ZipFile(zip_path) as zf:
        xml_name = find_xml_inside_zip(zf)
        with zf.open(xml_name) as xml_file:
            tree = ET.parse(xml_file)

    root = tree.getroot()

    # Namespace-independent search: ElementTree expands names to {namespace}tag.
    for elem in root.iter():
        if elem.tag.endswith("ControlArea.netInterchange"):
            if elem.text is None:
                return None
            return float(elem.text.strip())

    return None


def read_latest_ssh_records(igm_dir: Path) -> list[SshRecord]:
    """
    Reads all DKE/DKW SSH ZIP files and keeps only the latest version
    per timestamp and area.
    """
    latest: dict[tuple[str, str], SshRecord] = {}

    for zip_path in sorted(igm_dir.glob("*.zip")):
        match = SSH_FILENAME_RE.match(zip_path.name)
        if not match:
            continue

        raw_timestamp = match.group("timestamp")
        timestamp = parse_timestamp_from_filename(raw_timestamp)
        version = int(match.group("version"))
        igm_area = match.group("area")
        area = AREA_MAP[igm_area]

        net_interchange = extract_net_interchange_from_zip(zip_path)
        if net_interchange is None:
            print(f"WARNING: No ControlArea.netInterchange found in {zip_path.name}")
            continue

        record = SshRecord(
            timestamp=timestamp,
            version=version,
            igm_area=igm_area,
            area=area,
            net_interchange=net_interchange,
            filename=zip_path.name,
        )

        key = (timestamp, area)
        current = latest.get(key)

        if current is None or record.version > current.version:
            latest[key] = record

    return sorted(latest.values(), key=lambda r: (r.timestamp, r.area))


def get_attr_case_insensitive(elem: ET.Element, wanted_name: str) -> Optional[str]:
    wanted_name = wanted_name.lower()
    for key, value in elem.attrib.items():
        if key.lower().endswith(wanted_name):
            return value
    return None


def elem_text(elem: ET.Element) -> str:
    return " ".join(text.strip() for text in elem.itertext() if text and text.strip())


def detect_cgma_series_type(elem: ET.Element) -> Optional[tuple[str, str]]:
    """
    Tries to detect whether an XML element describes one of these series:

    NP-DK1-IM, NP-DK1-EX, NP-DK2-IM, NP-DK2-EX

    Returns:
        (area, direction)
        example: ("DK1", "IM")
    """
    haystack_parts = []
    haystack_parts.append(elem.tag)
    haystack_parts.append(elem_text(elem))
    haystack_parts.extend(str(v) for v in elem.attrib.values())
    haystack = " ".join(haystack_parts)

    match = re.search(r"NP-(DK1|DK2)-(IM|EX)", haystack)
    if not match:
        return None

    return match.group(1), match.group(2)


def looks_like_net_position_series(elem: ET.Element) -> bool:
    haystack_parts = []
    haystack_parts.append(elem.tag)
    haystack_parts.append(elem_text(elem))
    haystack_parts.extend(str(v) for v in elem.attrib.values())
    haystack = " ".join(haystack_parts)

    return "NetPositionForecastD-2" in haystack and "MW" in haystack


def extract_points_from_series(series_elem: ET.Element) -> list[tuple[str, float]]:
    """
    Generic CGMA point extractor.

    Because the CGMA format is custom, this function is intentionally tolerant.
    It looks for child elements containing both:

    - a timestamp-like value
    - a numeric MW value

    You may need to adjust timestamp/value attribute names after checking your exact XML.
    """
    points: list[tuple[str, float]] = []

    timestamp_names = {
        "timestamp",
        "time",
        "datetime",
        "dateTime",
        "startTime",
        "utcTime",
        "validTime",
    }
    value_names = {
        "value",
        "quantity",
        "mw",
        "amount",
    }

    for elem in series_elem.iter():
        timestamp = None
        value = None

        for key, attr_value in elem.attrib.items():
            local_key = key.split("}")[-1]

            if local_key in timestamp_names:
                timestamp = normalize_cgma_timestamp(attr_value)

            if local_key in value_names:
                value = try_float(attr_value)

        # Fallback: inspect child tags such as <timestamp>...</timestamp><value>...</value>
        child_values = {}
        for child in list(elem):
            local_tag = child.tag.split("}")[-1]
            text = child.text.strip() if child.text else None
            if text:
                child_values[local_tag] = text

        if timestamp is None:
            for name in timestamp_names:
                if name in child_values:
                    timestamp = normalize_cgma_timestamp(child_values[name])
                    break

        if value is None:
            for name in value_names:
                if name in child_values:
                    value = try_float(child_values[name])
                    break

        if timestamp is not None and value is not None:
            points.append((timestamp, value))

    return points


def normalize_cgma_timestamp(value: str) -> str:
    """
    Normalizes common timestamp formats to 2026-05-05T03:30Z.

    Adjust this if your CGMA timestamps use local time or interval notation.
    """
    value = value.strip()

    # Already close to ISO UTC.
    value = value.replace("+00:00", "Z")

    # 2026-05-05T03:30:00Z -> 2026-05-05T03:30Z
    match = re.match(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2})?Z", value)
    if match:
        return match.group(1) + "Z"

    # 20260505T0330Z -> 2026-05-05T03:30Z
    match = re.match(r"(\d{8}T\d{4}Z)", value)
    if match:
        return parse_timestamp_from_filename(match.group(1))

    return value


def try_float(value: str) -> Optional[float]:
    try:
        return float(value.strip())
    except Exception:
        return None


def read_cgma_net_positions(cgma_dir: Path) -> dict[tuple[str, str], float]:
    """
    Reads CGMA XML files and returns:

        {(timestamp, area): net_position_mw}

    where area is DK1 or DK2.

    Net position is calculated as:

        export - import
    """
    raw: dict[tuple[str, str, str], float] = {}

    for xml_path in sorted(cgma_dir.glob("*.xml")):
        tree = ET.parse(xml_path)
        root = tree.getroot()

        for elem in root.iter():
            series_type = detect_cgma_series_type(elem)
            if series_type is None:
                continue

            if not looks_like_net_position_series(elem):
                continue

            area, direction = series_type
            points = extract_points_from_series(elem)

            for timestamp, value in points:
                raw[(timestamp, area, direction)] = value

    net_positions: dict[tuple[str, str], float] = {}

    all_keys = set((timestamp, area) for timestamp, area, _direction in raw.keys())

    for timestamp, area in all_keys:
        import_value = raw.get((timestamp, area, "IM"), 0.0)
        export_value = raw.get((timestamp, area, "EX"), 0.0)
        net_positions[(timestamp, area)] = export_value - import_value

    return net_positions


def compare(ssh_records: list[SshRecord], cgma_values: dict[tuple[str, str], float]) -> list[ComparisonRecord]:
    results: list[ComparisonRecord] = []

    for ssh in ssh_records:
        key = (ssh.timestamp, ssh.area)
        cgma_value = cgma_values.get(key)

        if cgma_value is None:
            print(f"WARNING: No CGMA value found for {ssh.timestamp} {ssh.area}")
            continue

        diff = ssh.net_interchange - cgma_value

        results.append(
            ComparisonRecord(
                timestamp=ssh.timestamp,
                area=ssh.area,
                ssh_version=ssh.version,
                ssh_net_interchange=ssh.net_interchange,
                cgma_net_position=cgma_value,
                difference_mw=diff,
                abs_difference_mw=abs(diff),
                status=classify_difference(diff),
                ssh_file=ssh.filename,
            )
        )

    return sorted(results, key=lambda r: (r.timestamp, r.area))


def print_results(results: list[ComparisonRecord]) -> None:
    if not results:
        print("No comparison results found.")
        return

    header = (
        f"{'Timestamp':<18} "
        f"{'Area':<4} "
        f"{'Ver':>3} "
        f"{'SSH MW':>12} "
        f"{'CGMA MW':>12} "
        f"{'Diff MW':>12} "
        f"{'Status':<8}"
    )
    print(header)
    print("-" * len(header))

    for r in results:
        print(
            f"{r.timestamp:<18} "
            f"{r.area:<4} "
            f"{r.ssh_version:>3} "
            f"{r.ssh_net_interchange:>12.1f} "
            f"{r.cgma_net_position:>12.1f} "
            f"{r.difference_mw:>12.1f} "
            f"{r.status:<8}"
        )


def write_csv(results: list[ComparisonRecord], output_path: Path) -> None:
    with output_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "timestamp",
            "area",
            "ssh_version",
            "ssh_net_interchange_mw",
            "cgma_net_position_mw",
            "difference_mw",
            "abs_difference_mw",
            "status",
            "ssh_file",
        ])

        for r in results:
            writer.writerow([
                r.timestamp,
                r.area,
                r.ssh_version,
                r.ssh_net_interchange,
                r.cgma_net_position,
                r.difference_mw,
                r.abs_difference_mw,
                r.status,
                r.ssh_file,
            ])


def main() -> None:
    ssh_records = read_latest_ssh_records(IGM_DIR)
    cgma_values = read_cgma_net_positions(CGMA_DIR)
    results = compare(ssh_records, cgma_values)

    print_results(results)
    write_csv(results, OUTPUT_CSV)

    print()
    print(f"Wrote CSV report to: {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
```

---

## Run it

From the project folder:

```bash
python compare_igm_vs_cgma.py
```

Expected output:

```text
Timestamp          Area Ver       SSH MW      CGMA MW      Diff MW Status
-------------------------------------------------------------------------
2026-05-05T00:30Z DK1   01       -120.0       -118.5         -1.5 NORMAL
2026-05-05T00:30Z DK2   01        640.0        710.0        -70.0 WARNING
2026-05-05T01:30Z DK1   02       -100.0       -350.0        250.0 ERROR
...
```

It will also write:

```text
comparison_result.csv
```

---

## Notes

The IGM SSH parsing should work as-is, because the required value is clearly defined:

```xml
cim:ControlArea.netInterchange
```

The CGMA parser is intentionally generic because the CGMA XML is an inhouse format. If the script does not find CGMA points, the function most likely needing adjustment is:

```python
extract_points_from_series()
```

Usually the only thing to adjust is the timestamp and value element/attribute names.

---

## Validation checklist

Before using the result operationally:

1. Confirm `DKE -> DK2` and `DKW -> DK1`.
2. Confirm SSH timestamps and CGMA timestamps are both UTC.
3. Manually check one hour.
4. Confirm sign convention:
   - expected: `CGMA = export - import`
   - fallback: `CGMA = import - export`
5. Confirm you want the latest SSH version per hour, not version `00`.
6. Tune thresholds if needed.

---

## Possible improvements later

- Add command-line arguments for folders and thresholds.
- Export Excel instead of CSV.
- Plot DK1/DK2 differences over 24 hours.
- Show only `WARNING` and `ERROR` rows.
- Compare both latest version and version `00`.
- Add a sign auto-detection check.
