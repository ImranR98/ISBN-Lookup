"""Tests for the desktop XLSX subproject's non-GUI core logic.

The Tkinter window itself is not exercised here (CI is headless); these tests
cover ISBN normalization, API response handling, file-change detection, and the
input/output workbook pipeline with a fake HTTP session.
"""

import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import isbn_lookup_excel_desktop_ui as ui  # noqa: E402


class FakeResponse:
    def __init__(self, status_code=200, payload=None, invalid_json=False):
        self.status_code = status_code
        self._payload = payload
        self._invalid_json = invalid_json

    def json(self):
        if self._invalid_json:
            raise ValueError("invalid json")
        return self._payload


class FakeSession:
    """Minimal requests.Session stand-in keyed by the ISBN in the URL."""

    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def get(self, url, headers=None, timeout=None):
        isbn = url.rstrip("/").split("/")[-2]
        self.calls.append(SimpleNamespace(url=url, headers=headers or {}, timeout=timeout))
        response = self.responses[isbn]
        if isinstance(response, Exception):
            raise response
        return response


def write_input(path, isbns, extra=None):
    data = {"isbn": isbns}
    if extra:
        data.update(extra)
    pd.DataFrame(data).to_excel(path, index=False)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, ""),
        (float("nan"), ""),
        (pd.NA, ""),
        ("  9780345409461  ", "9780345409461"),
        (9780345409461, "9780345409461"),
        (9780345409461.0, "9780345409461"),
        ("9780345409461.0", "9780345409461"),
    ],
)
def test_normalize_isbn_string(value, expected):
    assert ui.normalize_isbn_string(value) == expected


def test_find_isbn_column_is_case_insensitive():
    df = pd.DataFrame({"Title": ["Dune"], "iSbN": ["9780441013593"]})

    assert ui.find_isbn_column_in_dataframe(df) == "iSbN"


def test_find_isbn_column_returns_none_when_missing():
    df = pd.DataFrame({"code": ["9780441013593"]})

    assert ui.find_isbn_column_in_dataframe(df) is None


def test_fetch_book_title_returns_first_result_and_sends_api_key():
    session = FakeSession({
        "9780441013593": FakeResponse(payload=[{"title": "Dune"}, {"title": "Dune Messiah"}])
    })

    title = ui.fetch_book_title_from_api(
        "9780441013593", "http://server:8080", "secret", session
    )

    assert title == "Dune"
    assert session.calls[0].url == "http://server:8080/9780441013593/title"
    assert session.calls[0].headers == {"ISBNDB_API_KEY": "secret"}
    assert session.calls[0].timeout == 300


@pytest.mark.parametrize(
    ("response", "expected"),
    [
        (FakeResponse(status_code=404), "not found (404)"),
        (FakeResponse(payload=[]), "not found"),
        (FakeResponse(payload={"error": "unexpected"}), "not found"),
        (FakeResponse(invalid_json=True), "not found"),
        (RuntimeError("connection reset"), "not found (error)"),
    ],
)
def test_fetch_book_title_handles_bad_responses(response, expected):
    session = FakeSession({"9780441013593": response})

    assert ui.fetch_book_title_from_api("9780441013593", "http://server:8080", None, session) == expected


def test_fetch_book_title_handles_empty_isbn():
    session = FakeSession({})

    assert ui.fetch_book_title_from_api(float("nan"), "http://server:8080", None, session) == "not found (empty)"
    assert session.calls == []


def test_has_file_changed_compares_mtime(tmp_path):
    path = tmp_path / "input.xlsx"
    path.write_bytes(b"x")
    os.utime(path, (1000, 1000))

    changed, mtime = ui.has_file_changed(str(path), None)
    assert changed is True
    assert mtime == 1000

    changed, mtime = ui.has_file_changed(str(path), 1000.0)
    assert changed is False
    assert mtime == 1000.0

    os.utime(path, (2000, 2000))
    changed, mtime = ui.has_file_changed(str(path), 1000.0)
    assert changed is True
    assert mtime == 2000


def test_process_isbn_file_writes_titles_and_stats(tmp_path):
    input_path = tmp_path / "input.xlsx"
    output_path = tmp_path / "output.xlsx"
    write_input(
        input_path,
        ["9780345409461", None, "9781416594789", "0000000000"],
        {"note": ["a", "b", "c", "d"]},
    )
    session = FakeSession({
        "9780345409461": FakeResponse(payload=[{"title": "Dune"}]),
        "9781416594789": FakeResponse(payload=[{"title": "Mistborn"}]),
        "0000000000": FakeResponse(status_code=404),
    })
    config = ui.ProcessingConfig(
        input_file=str(input_path),
        output_file=str(output_path),
        monitor_file_changes=False,
    )

    _, stats = ui.process_isbn_file(config, session, None)

    assert stats.total_rows == 4
    assert stats.titles_fetched == 2
    assert stats.titles_failed == 1
    assert len(session.calls) == 3
    output = pd.read_excel(output_path, dtype=str)
    assert output["title"].tolist() == [
        "Dune",
        "not found (empty)",
        "Mistborn",
        "not found (404)",
    ]
    assert output["note"].tolist() == ["a", "b", "c", "d"]


def test_process_isbn_file_reuses_titles_from_existing_output(tmp_path):
    input_path = tmp_path / "input.xlsx"
    output_path = tmp_path / "output.xlsx"
    write_input(input_path, ["9780345409461", "9781416594789"])
    pd.DataFrame({
        "isbn": ["9780345409461"],
        "title": ["Cached Title"],
    }).to_excel(output_path, index=False)
    session = FakeSession({
        "9781416594789": FakeResponse(payload=[{"title": "Fetched Title"}]),
    })
    config = ui.ProcessingConfig(
        input_file=str(input_path),
        output_file=str(output_path),
        monitor_file_changes=False,
    )

    _, stats = ui.process_isbn_file(config, session, None)

    assert [call.url for call in session.calls] == [
        "http://localhost:8080/9781416594789/title"
    ]
    assert stats.titles_fetched == 1
    output = pd.read_excel(output_path, dtype=str)
    assert output["title"].tolist() == ["Cached Title", "Fetched Title"]


def test_process_isbn_file_skips_unchanged_file(tmp_path):
    input_path = tmp_path / "input.xlsx"
    output_path = tmp_path / "output.xlsx"
    write_input(input_path, ["9780345409461"])
    os.utime(input_path, (3000, 3000))
    session = FakeSession({})
    config = ui.ProcessingConfig(
        input_file=str(input_path),
        output_file=str(output_path),
        monitor_file_changes=True,
    )

    mtime, stats = ui.process_isbn_file(config, session, 3000.0)

    assert mtime == 3000.0
    assert stats.total_rows == 0
    assert session.calls == []
    assert output_path.exists() is False


def test_process_isbn_file_requires_an_isbn_column(tmp_path):
    input_path = tmp_path / "input.xlsx"
    output_path = tmp_path / "output.xlsx"
    pd.DataFrame({"code": ["9780345409461"]}).to_excel(input_path, index=False)
    session = FakeSession({})
    config = ui.ProcessingConfig(
        input_file=str(input_path),
        output_file=str(output_path),
        monitor_file_changes=False,
    )

    _, stats = ui.process_isbn_file(config, session, None)

    assert stats.total_rows == 0
    assert session.calls == []
    assert output_path.exists() is False


def test_processor_creates_a_missing_input_workbook(tmp_path):
    input_path = tmp_path / "input.xlsx"
    config = ui.ProcessingConfig(
        input_file=str(input_path),
        output_file=str(tmp_path / "output.xlsx"),
    )

    ui.ISBNProcessor(config)

    assert input_path.exists()
    assert pd.read_excel(input_path).columns.tolist() == ["isbn"]
