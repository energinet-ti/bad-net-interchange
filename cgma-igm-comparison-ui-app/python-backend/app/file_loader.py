import os
import zipfile
import io


class FileLoadError(Exception):
    pass


def normalize_path(raw_path: str) -> str:
    """Normalize path separators to OS convention."""
    return raw_path.replace("/", os.sep).replace("\\", os.sep)


def read_file_content(raw_path: str) -> str:
    """Read a file, extracting from ZIP if needed. Returns XML content."""
    path = normalize_path(raw_path)
    with open(path, "rb") as f:
        data = f.read()

    # Try ZIP first
    try:
        return _extract_xml_from_zip(data)
    except (zipfile.BadZipFile, FileLoadError):
        pass

    # Plain XML
    return data.decode("utf-8")


def _extract_xml_from_zip(data: bytes) -> str:
    """Extract first .xml or .rdf file from a ZIP archive."""
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for name in zf.namelist():
            lower = name.lower()
            if lower.endswith(".xml") or lower.endswith(".rdf"):
                return zf.read(name).decode("utf-8")
    raise FileLoadError("No XML file found in ZIP archive")


class FileDeduplicator:
    """Tracks loaded file paths to avoid duplicates."""

    def __init__(self):
        self._loaded: set[str] = set()

    def should_load(self, path: str) -> bool:
        normalized = normalize_path(path)
        if normalized in self._loaded:
            return False
        self._loaded.add(normalized)
        return True
