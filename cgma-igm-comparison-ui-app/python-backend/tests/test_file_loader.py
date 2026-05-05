import os
import pytest
from app.file_loader import read_file_content, FileDeduplicator

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def test_read_plain_xml():
    content = read_file_content(os.path.join(FIXTURES, "cgma_example.xml"))
    assert "<TimeSeries>" in content or "TimeSeries" in content


def test_deduplicator_prevents_reload():
    dedup = FileDeduplicator()
    assert dedup.should_load("some/path.xml") is True
    assert dedup.should_load("some/path.xml") is False


def test_deduplicator_normalizes_slashes():
    dedup = FileDeduplicator()
    assert dedup.should_load("some/path.xml") is True
    assert dedup.should_load("some\\path.xml") is False  # same after normalization
