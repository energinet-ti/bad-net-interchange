from __future__ import annotations

import argparse
import csv
from datetime import UTC, datetime, timedelta
import re
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
import xml.etree.ElementTree as ET


DEFAULT_IGM_DIR = Path("sample-data/igm")
DEFAULT_CGMA_DIR = Path("sample-data/cgma")
DEFAULT_OUTPUT_CSV = Path("comparison_result.csv")
DEFAULT_OUTPUT_MD = Path("comparison_result.md")

WARNING_LIMIT_MW = 50.0
ERROR_LIMIT_MW = 200.0

AREA_MAP = {
    "DKE": "DK2",
    "DKW": "DK1",
}

EIC_TO_AREA = {
    "10YDK-1--------W": "DK1",
    "10YDK-2--------M": "DK2",
}

SSH_FILENAME_RE = re.compile(
    r"(?P<timestamp>\d{8}T\d{4}Z)_(?P<version>\w+)_(?P<area>DKE|DKW)_SSH_\d+\.zip$"
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
    aligned_timestamp: str
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


def normalize_ssh_scenario_time(value: str) -> Optional[str]:
    """
    Normalizes SSH scenarioTime like 2026-05-05T03:30:00Z to 2026-05-05T03:30Z.
    """
    value = value.strip().replace("+00:00", "Z")
    match = re.match(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2})?Z", value)
    if match:
        return match.group(1) + "Z"
    return None


def classify_difference(diff_mw: float, warning_limit_mw: float, error_limit_mw: float) -> str:
    abs_diff = abs(diff_mw)

    if abs_diff >= error_limit_mw:
        return "ERROR"
    if abs_diff >= warning_limit_mw:
        return "WARNING"
    return "NORMAL"


def find_xml_inside_zip(zip_file: zipfile.ZipFile) -> str:
    xml_files = [name for name in zip_file.namelist() if name.lower().endswith(".xml")]

    if not xml_files:
        raise ValueError("ZIP contains no XML file")

    if len(xml_files) > 1:
        return xml_files[0]

    return xml_files[0]


def extract_ssh_metadata_from_zip(zip_path: Path) -> tuple[Optional[str], Optional[float]]:
    """
    Opens the ZIP in memory and extracts:
    - md:Model.scenarioTime (if present)
    - cim:ControlArea.netInterchange (largest absolute value if multiple)

    Does not unzip to disk.
    """
    with zipfile.ZipFile(zip_path) as zf:
        xml_name = find_xml_inside_zip(zf)
        with zf.open(xml_name) as xml_file:
            tree = ET.parse(xml_file)

    root = tree.getroot()
    scenario_time: Optional[str] = None
    net_values: list[float] = []

    for elem in root.iter():
        local_tag = elem.tag.split("}")[-1]

        if local_tag == "Model.scenarioTime" and elem.text and scenario_time is None:
            scenario_time = normalize_ssh_scenario_time(elem.text)

        if elem.tag.endswith("ControlArea.netInterchange"):
            if elem.text is None:
                continue
            parsed = try_float(elem.text)
            if parsed is not None:
                net_values.append(parsed)

    if not net_values:
        return scenario_time, None

    net_interchange = max(net_values, key=lambda v: abs(v))
    return scenario_time, net_interchange


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
        filename_timestamp = parse_timestamp_from_filename(raw_timestamp)
        version_str = match.group("version")
        # Handle both numeric versions (00, 01, etc.) and scenario types (2D, etc.)
        version = 999 if version_str == "2D" else int(version_str)
        igm_area = match.group("area")
        area = AREA_MAP[igm_area]

        scenario_time, net_interchange = extract_ssh_metadata_from_zip(zip_path)
        if net_interchange is None:
            print(f"WARNING: No ControlArea.netInterchange found in {zip_path.name}")
            continue

        timestamp = scenario_time or filename_timestamp

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


def elem_text(elem: ET.Element) -> str:
    return " ".join(text.strip() for text in elem.itertext() if text and text.strip())


def detect_cgma_series_type(elem: ET.Element) -> Optional[tuple[str, str]]:
    """
    Detects NP-DKx-IM/EX from a TimeSeries id attribute.
    """
    series_id = elem.attrib.get("id", "")
    match = re.search(r"NP-(DK1|DK2)-(IM|EX)", series_id)
    if not match:
        return None
    return match.group(1), match.group(2)


def looks_like_net_position_series(elem: ET.Element) -> bool:
    return (
        elem.attrib.get("code") == "NetPositionForecastD-2"
        and elem.attrib.get("measurementUnit") == "MW"
    )


def extract_points_from_series(series_elem: ET.Element) -> list[tuple[str, float]]:
    """
    Extracts points from Inhouse XML TimeSeries/Data rows.
    Expected shape:
      <TimeSeries ...>
        <Data dt="..." qty="..." />
      </TimeSeries>
    """
    points: list[tuple[str, float]] = []

    for elem in series_elem.iter():
        local_tag = elem.tag.split("}")[-1]
        if local_tag != "Data":
            continue

        dt = elem.attrib.get("dt")
        qty = elem.attrib.get("qty")
        if dt is None or qty is None:
            continue

        timestamp = normalize_cgma_timestamp(dt)
        value = try_float(qty)
        if value is None:
            continue

        points.append((timestamp, value))

    return points


def normalize_cgma_timestamp(value: str) -> str:
    """
    Normalizes common timestamp formats to 2026-05-05T03:30Z.

    Adjust this if your CGMA timestamps use local time or interval notation.
    """
    value = value.strip()

    value = value.replace("+00:00", "Z")

    match = re.match(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2})?Z", value)
    if match:
        return match.group(1) + "Z"

    match = re.match(r"(\d{8}T\d{4}Z)", value)
    if match:
        return parse_timestamp_from_filename(match.group(1))

    return value


def shift_timestamp_minutes(timestamp: str, shift_minutes: int) -> str:
    """
    Shift normalized timestamp strings like 2026-05-05T03:30Z by minutes.
    """
    dt = datetime.strptime(timestamp, "%Y-%m-%dT%H:%MZ").replace(tzinfo=UTC)
    shifted = dt.timestamp() + (shift_minutes * 60)
    return datetime.fromtimestamp(shifted, tz=UTC).strftime("%Y-%m-%dT%H:%MZ")


def truncate_timestamp_to_hour(timestamp: str) -> str:
    dt = datetime.strptime(timestamp, "%Y-%m-%dT%H:%MZ").replace(tzinfo=UTC)
    return dt.replace(minute=0).strftime("%Y-%m-%dT%H:%MZ")


def align_ssh_timestamp(timestamp: str, mode: str, shift_minutes: int) -> str:
    if mode == "truncate-hour":
        return truncate_timestamp_to_hour(timestamp)
    return shift_timestamp_minutes(timestamp, shift_minutes)


def timestamp_to_dt(timestamp: str) -> datetime:
    return datetime.strptime(timestamp, "%Y-%m-%dT%H:%MZ").replace(tzinfo=UTC)


def suggest_shift_minutes(
    ssh_timestamps: set[str],
    cgma_timestamps: set[str],
) -> tuple[int, int]:
    """
    Find the minute shift that maximizes timestamp overlap.
    Returns (best_shift_minutes, overlap_count_at_best_shift).
    """
    if not ssh_timestamps or not cgma_timestamps:
        return 0, 0

    counts: dict[int, int] = {}
    ssh_dts = [timestamp_to_dt(t) for t in ssh_timestamps]
    cg_dts = [timestamp_to_dt(t) for t in cgma_timestamps]

    for sdt in ssh_dts:
        for cdt in cg_dts:
            diff_min = int((cdt - sdt).total_seconds() // 60)
            counts[diff_min] = counts.get(diff_min, 0) + 1

    best_shift = 0
    best_overlap = -1
    for shift_min, count in counts.items():
        if count > best_overlap:
            best_shift = shift_min
            best_overlap = count
        elif count == best_overlap and abs(shift_min) < abs(best_shift):
            best_shift = shift_min

    shifted = {shift_timestamp_minutes(t, best_shift) for t in ssh_timestamps}
    return best_shift, len(shifted.intersection(cgma_timestamps))


def print_time_alignment_diagnostics(
    ssh_records: list[SshRecord],
    cgma_values: dict[tuple[str, str], float],
    align_mode: str,
    applied_shift_minutes: int,
) -> tuple[int, int, int]:
    """
    Prints range and overlap diagnostics.
    Returns (direct_overlap, applied_overlap, suggested_shift).
    """
    ssh_ts = {r.timestamp for r in ssh_records}
    cgma_ts = {timestamp for (timestamp, _area) in cgma_values.keys()}

    if not ssh_ts or not cgma_ts:
        print("TIME ALIGNMENT: Cannot evaluate overlap because one side has no timestamps.")
        return 0, 0, 0

    direct_overlap = len(ssh_ts.intersection(cgma_ts))
    shifted = {align_ssh_timestamp(t, align_mode, applied_shift_minutes) for t in ssh_ts}
    applied_overlap = len(shifted.intersection(cgma_ts))
    suggested_shift, suggested_overlap = suggest_shift_minutes(ssh_ts, cgma_ts)

    print(
        "TIME ALIGNMENT: SSH range "
        f"{min(ssh_ts)} to {max(ssh_ts)} ({len(ssh_ts)} timestamps)"
    )
    print(
        "TIME ALIGNMENT: CGMA range "
        f"{min(cgma_ts)} to {max(cgma_ts)} ({len(cgma_ts)} timestamps)"
    )
    print(f"TIME ALIGNMENT: Direct overlap (no shift) = {direct_overlap}")
    if align_mode == "truncate-hour":
        print(f"TIME ALIGNMENT: Overlap with truncate-hour mode = {applied_overlap}")
    else:
        print(
            "TIME ALIGNMENT: Overlap with applied shift "
            f"({applied_shift_minutes:+d} min) = {applied_overlap}"
        )
    print(
        "TIME ALIGNMENT: Suggested shift = "
        f"{suggested_shift:+d} min (overlap {suggested_overlap})"
    )

    return direct_overlap, applied_overlap, suggested_shift


def try_float(value: str) -> Optional[float]:
    try:
        return float(value.strip())
    except Exception:
        return None


def parse_resolution_to_timedelta(resolution: str) -> timedelta:
    if resolution == "PT1H":
        return timedelta(hours=1)
    if resolution == "PT30M":
        return timedelta(minutes=30)
    return timedelta(hours=1)


def parse_reference_period_start(period_start: str) -> Optional[datetime]:
    clean = period_start.strip().replace("+00:00", "Z").rstrip("Z")
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"):
        try:
            return datetime.strptime(clean, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


def read_cgma_net_positions_reference(cgma_dir: Path) -> dict[tuple[str, str], float]:
    """
    Parser compatible with cgma-igm-comparison-ui-app logic:
    - businessType B65
    - in_Domain.mRID / out_Domain.mRID
    - timeInterval.start + Point.position + resolution
    - net position = import - export
    """
    net_positions: dict[tuple[str, str], float] = {}

    for xml_path in sorted(cgma_dir.glob("*.xml")):
        tree = ET.parse(xml_path)
        root = tree.getroot()

        for series in root.iter():
            if series.tag.split("}")[-1] != "TimeSeries":
                continue

            business_type = None
            in_domain = None
            out_domain = None
            period_start = None
            resolution = None

            for child in list(series):
                local_tag = child.tag.split("}")[-1]
                text = child.text.strip() if child.text else None

                if local_tag == "businessType":
                    business_type = text
                elif local_tag == "in_Domain.mRID":
                    in_domain = text
                elif local_tag == "out_Domain.mRID":
                    out_domain = text
                elif local_tag == "Period":
                    for period_child in list(child):
                        period_tag = period_child.tag.split("}")[-1]
                        period_text = period_child.text.strip() if period_child.text else None
                        if period_tag == "resolution":
                            resolution = period_text
                        elif period_tag == "timeInterval":
                            for ti_child in list(period_child):
                                if ti_child.tag.split("}")[-1] == "start" and ti_child.text:
                                    period_start = ti_child.text.strip()

            if business_type != "B65":
                continue
            if period_start is None or resolution is None:
                continue

            start_dt = parse_reference_period_start(period_start)
            if start_dt is None:
                continue
            step = parse_resolution_to_timedelta(resolution)

            import_area = EIC_TO_AREA.get(in_domain or "")
            export_area = EIC_TO_AREA.get(out_domain or "")

            for period in list(series):
                if period.tag.split("}")[-1] != "Period":
                    continue

                for point in list(period):
                    if point.tag.split("}")[-1] != "Point":
                        continue

                    position = None
                    quantity = None
                    for point_child in list(point):
                        ptag = point_child.tag.split("}")[-1]
                        ptext = point_child.text.strip() if point_child.text else None
                        if ptext is None:
                            continue
                        if ptag == "position":
                            try:
                                position = int(ptext)
                            except ValueError:
                                position = None
                        elif ptag == "quantity":
                            quantity = try_float(ptext)

                    if position is None or quantity is None:
                        continue

                    ts_dt = start_dt + (position - 1) * step
                    ts = ts_dt.strftime("%Y-%m-%dT%H:%MZ")

                    if import_area is not None:
                        key = (ts, import_area)
                        net_positions[key] = net_positions.get(key, 0.0) + quantity

                    if export_area is not None:
                        key = (ts, export_area)
                        net_positions[key] = net_positions.get(key, 0.0) - quantity

    return net_positions


def read_cgma_net_positions_inhouse(cgma_dir: Path, reverse_sign: bool) -> dict[tuple[str, str], float]:
    """
    Inhouse parser for NP-DKx-IM/EX TimeSeries with Data dt/qty.
    """
    raw: dict[tuple[str, str, str], float] = {}

    for xml_path in sorted(cgma_dir.glob("*.xml")):
        tree = ET.parse(xml_path)
        root = tree.getroot()

        for elem in root.iter():
            if elem.tag.split("}")[-1] != "TimeSeries":
                continue

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
        if reverse_sign:
            net_positions[(timestamp, area)] = import_value - export_value
        else:
            net_positions[(timestamp, area)] = export_value - import_value

    return net_positions


def read_cgma_net_positions(
    cgma_dir: Path,
    reverse_sign: bool,
    parser_mode: str,
) -> dict[tuple[str, str], float]:
    """
    Reads CGMA XML files and returns:

        {(timestamp, area): net_position_mw}

    where area is DK1 or DK2.

    Net position is calculated as:

        export - import

    or reverse if requested.
    """
    if parser_mode == "inhouse":
        inhouse_values = read_cgma_net_positions_inhouse(cgma_dir, reverse_sign=reverse_sign)
        print(f"CGMA PARSER: inhouse NP path found {len(inhouse_values)} points")
        return inhouse_values

    if parser_mode == "reference":
        reference_values = read_cgma_net_positions_reference(cgma_dir)
        print(f"CGMA PARSER: reference B65 path found {len(reference_values)} points")
        return reference_values

    reference_values = read_cgma_net_positions_reference(cgma_dir)
    inhouse_values = read_cgma_net_positions_inhouse(cgma_dir, reverse_sign=reverse_sign)

    if reference_values:
        print(f"CGMA PARSER: reference B65 path found {len(reference_values)} points")
    if inhouse_values:
        print(f"CGMA PARSER: inhouse NP path found {len(inhouse_values)} points")

    if reference_values and inhouse_values:
        merged = dict(reference_values)
        merged.update(inhouse_values)
        return merged

    if reference_values:
        return reference_values

    return inhouse_values


def shift_cgma_values(
    cgma_values: dict[tuple[str, str], float],
    shift_minutes: int,
) -> dict[tuple[str, str], float]:
    if shift_minutes == 0:
        return cgma_values

    shifted: dict[tuple[str, str], float] = {}
    for (timestamp, area), value in cgma_values.items():
        shifted_ts = shift_timestamp_minutes(timestamp, shift_minutes)
        shifted[(shifted_ts, area)] = value
    return shifted


def compare(
    ssh_records: list[SshRecord],
    cgma_values: dict[tuple[str, str], float],
    warning_limit_mw: float,
    error_limit_mw: float,
    align_mode: str,
    ssh_time_shift_minutes: int,
) -> list[ComparisonRecord]:
    results: list[ComparisonRecord] = []

    for ssh in ssh_records:
        shifted_timestamp = align_ssh_timestamp(ssh.timestamp, align_mode, ssh_time_shift_minutes)
        key = (shifted_timestamp, ssh.area)
        cgma_value = cgma_values.get(key)

        if cgma_value is None:
            print(
                "WARNING: No CGMA value found for "
                f"{ssh.timestamp} (lookup {shifted_timestamp}) {ssh.area}"
            )
            continue

        diff = ssh.net_interchange - cgma_value

        results.append(
            ComparisonRecord(
                timestamp=ssh.timestamp,
                aligned_timestamp=shifted_timestamp,
                area=ssh.area,
                ssh_version=ssh.version,
                ssh_net_interchange=ssh.net_interchange,
                cgma_net_position=cgma_value,
                difference_mw=diff,
                abs_difference_mw=abs(diff),
                status=classify_difference(diff, warning_limit_mw, error_limit_mw),
                ssh_file=ssh.filename,
            )
        )

    return sorted(results, key=lambda r: (r.timestamp, r.area))


def print_results(results: list[ComparisonRecord]) -> None:
    if not results:
        print("No comparison results found.")
        return

    header = (
        f"{'SSH Time':<18} "
        f"{'Aligned UTC':<18} "
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
            f"{r.aligned_timestamp:<18} "
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
            "ssh_timestamp",
            "aligned_timestamp",
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
                r.aligned_timestamp,
                r.area,
                r.ssh_version,
                r.ssh_net_interchange,
                r.cgma_net_position,
                r.difference_mw,
                r.abs_difference_mw,
                r.status,
                r.ssh_file,
            ])


def write_markdown_report(results: list[ComparisonRecord], output_path: Path) -> None:
    lines: list[str] = []
    lines.append("# IGM vs CGMA Comparison Report")
    lines.append("")

    if not results:
        lines.append("No comparison results found.")
        output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return

    areas = sorted({r.area for r in results})
    for area in areas:
        area_rows = [r for r in results if r.area == area]
        area_rows.sort(key=lambda r: r.abs_difference_mw, reverse=True)

        lines.append(f"## {area}")
        lines.append("")
        lines.append(f"{len(area_rows)} rows · sorted by |Difference| descending")
        lines.append("")
        lines.append("| Time UTC | IGM | CGMA | Difference | Status |")
        lines.append("|---|---:|---:|---:|---|")
        for r in area_rows:
            lines.append(
                "| "
                f"{r.aligned_timestamp} | "
                f"{r.ssh_net_interchange:.2f} | "
                f"{r.cgma_net_position:.2f} | "
                f"{r.difference_mw:.2f} | "
                f"{r.status} |"
            )
        lines.append("")

    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def export_plots(results: list[ComparisonRecord], plots_dir: Path) -> None:
    if not results:
        print("No comparison results found. Skipping plot export.")
        return

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.dates as mdates
        import matplotlib.pyplot as plt
    except ImportError as exc:
        print(f"WARNING: Plot export failed while importing matplotlib: {exc}")
        print("Install or repair it with: /usr/local/bin/python3 -m pip install matplotlib")
        return

    plots_dir.mkdir(parents=True, exist_ok=True)

    for area in sorted({r.area for r in results}):
        area_rows = [r for r in results if r.area == area]
        if not area_rows:
            continue

        times = [datetime.strptime(r.timestamp, "%Y-%m-%dT%H:%MZ") for r in area_rows]
        ssh_values = [r.ssh_net_interchange for r in area_rows]
        cgma_values = [r.cgma_net_position for r in area_rows]
        diffs = [r.difference_mw for r in area_rows]
        status_colors = [
            "#2e7d32" if r.status == "NORMAL" else "#f9a825" if r.status == "WARNING" else "#c62828"
            for r in area_rows
        ]

        fig, (ax_top, ax_bottom) = plt.subplots(
            2,
            1,
            figsize=(14, 8),
            sharex=True,
            gridspec_kw={"height_ratios": [2, 1]},
        )

        ax_top.plot(times, ssh_values, marker="o", linewidth=2, label="SSH net interchange")
        ax_top.plot(times, cgma_values, marker="o", linewidth=2, label="CGMA net position")
        ax_top.set_ylabel("MW")
        ax_top.set_title(f"IGM SSH vs CGMA - {area}")
        ax_top.grid(True, alpha=0.3)
        ax_top.legend()

        ax_bottom.bar(times, diffs, width=0.03, color=status_colors)
        ax_bottom.axhline(0.0, color="black", linewidth=1)
        ax_bottom.set_ylabel("Diff MW")
        ax_bottom.set_xlabel("Timestamp (UTC)")
        ax_bottom.grid(True, alpha=0.3)

        ax_bottom.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d %H:%M"))
        fig.autofmt_xdate()
        fig.tight_layout()

        output_path = plots_dir / f"comparison_{area}.png"
        fig.savefig(output_path, dpi=150)
        plt.close(fig)
        print(f"Wrote plot to: {output_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare CGMES IGM SSH net interchange against CGMA net position."
    )
    parser.add_argument("--igm-dir", type=Path, default=DEFAULT_IGM_DIR)
    parser.add_argument("--cgma-dir", type=Path, default=DEFAULT_CGMA_DIR)
    parser.add_argument("--output-csv", type=Path, default=DEFAULT_OUTPUT_CSV)
    parser.add_argument("--no-csv", action="store_true", help="Skip writing CSV output.")
    parser.add_argument("--warning-limit", type=float, default=WARNING_LIMIT_MW)
    parser.add_argument("--error-limit", type=float, default=ERROR_LIMIT_MW)
    parser.add_argument(
        "--cgma-sign",
        choices=("export-minus-import", "import-minus-export"),
        default="import-minus-export",
    )
    parser.add_argument(
        "--cgma-parser",
        choices=("inhouse", "reference", "auto"),
        default="inhouse",
        help=(
            "CGMA parsing mode: inhouse uses NP-DKx-IM/EX series (no EQ-style mapping), "
            "reference uses B65 in/out domain logic, auto tries both and merges."
        ),
    )
    parser.add_argument(
        "--ssh-time-shift-minutes",
        type=str,
        default="auto",
        help="Shift SSH timestamps before lookup (for example -30), or 'auto'.",
    )
    parser.add_argument(
        "--ssh-time-align",
        choices=("auto-shift", "truncate-hour"),
        default="auto-shift",
        help=(
            "SSH timestamp alignment mode: auto-shift (search best minute shift) or "
            "truncate-hour (reference style: minute -> 00, no date shift)."
        ),
    )
    parser.add_argument(
        "--cgma-time-shift-minutes",
        type=int,
        default=0,
        help="Shift CGMA timestamps before comparison (for example -1440 for one day back).",
    )
    parser.add_argument(
        "--export-plots",
        action="store_true",
        help="Export PNG charts for each area.",
    )
    parser.add_argument(
        "--plots-dir",
        type=Path,
        default=Path("plots"),
        help="Output directory for exported chart PNG files.",
    )
    parser.add_argument(
        "--output-md",
        type=Path,
        default=DEFAULT_OUTPUT_MD,
        help="Output markdown report path.",
    )
    parser.add_argument(
        "--no-md",
        action="store_true",
        help="Skip writing markdown report.",
    )
    parser.add_argument(
        "--allow-zero-overlap",
        action="store_true",
        help="Continue even if timestamp overlap after shift is zero.",
    )
    return parser.parse_args()


def resolve_shift_minutes(
    raw_shift: str,
    ssh_records: list[SshRecord],
    cgma_values: dict[tuple[str, str], float],
    align_mode: str,
) -> int:
    if align_mode == "truncate-hour":
        print("TIME ALIGNMENT: Using truncate-hour mode (no minute shift search).")
        return 0

    if raw_shift.lower() != "auto":
        try:
            return int(raw_shift)
        except ValueError as exc:
            raise ValueError(
                "--ssh-time-shift-minutes must be an integer or 'auto'"
            ) from exc

    ssh_ts = {r.timestamp for r in ssh_records}
    cgma_ts = {timestamp for (timestamp, _area) in cgma_values.keys()}
    suggested_shift, suggested_overlap = suggest_shift_minutes(ssh_ts, cgma_ts)
    print(
        "TIME ALIGNMENT: Auto-selected SSH shift "
        f"{suggested_shift:+d} min (overlap {suggested_overlap})"
    )
    return suggested_shift


def main() -> None:
    args = parse_args()

    reverse_sign = args.cgma_sign == "import-minus-export"

    ssh_records = read_latest_ssh_records(args.igm_dir)
    cgma_values = read_cgma_net_positions(
        args.cgma_dir,
        reverse_sign=reverse_sign,
        parser_mode=args.cgma_parser,
    )

    if args.cgma_time_shift_minutes != 0:
        cgma_values = shift_cgma_values(cgma_values, args.cgma_time_shift_minutes)
        print(
            "TIME ALIGNMENT: Applied CGMA timestamp shift "
            f"{args.cgma_time_shift_minutes:+d} min"
        )

    resolved_shift_minutes = resolve_shift_minutes(
        args.ssh_time_shift_minutes,
        ssh_records,
        cgma_values,
        align_mode=args.ssh_time_align,
    )

    _direct_overlap, applied_overlap, suggested_shift = print_time_alignment_diagnostics(
        ssh_records,
        cgma_values,
        args.ssh_time_align,
        resolved_shift_minutes,
    )

    if applied_overlap == 0 and not args.allow_zero_overlap:
        print()
        print("ERROR: Zero timestamp overlap with current settings; comparison would be misleading.")
        if args.ssh_time_align == "auto-shift":
            print(
                "Try running with: "
                f"--ssh-time-shift-minutes {suggested_shift}"
            )
        else:
            print("Try running with: --ssh-time-align auto-shift")
        print("Use --allow-zero-overlap to override this safety stop.")
        sys.exit(2)

    results = compare(
        ssh_records,
        cgma_values,
        warning_limit_mw=args.warning_limit,
        error_limit_mw=args.error_limit,
        align_mode=args.ssh_time_align,
        ssh_time_shift_minutes=resolved_shift_minutes,
    )

    print_results(results)

    if not args.no_csv:
        write_csv(results, args.output_csv)
        print()
        print(f"Wrote CSV report to: {args.output_csv}")

    if not args.no_md:
        write_markdown_report(results, args.output_md)
        print(f"Wrote markdown report to: {args.output_md}")

    if args.export_plots:
        export_plots(results, args.plots_dir)


if __name__ == "__main__":
    main()
