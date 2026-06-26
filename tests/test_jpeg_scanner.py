"""Tests for the JPEG insertion-point scanner used to splice the MPF segment."""
from __future__ import annotations

import pytest

from oppo_live_photo.muxer import _find_app_insertion_point


def _jpeg_with_segments(*segments: bytes, trailer: bytes = b"") -> bytes:
    """Return a synthetic JPEG: SOI + segments + (optional) trailer + EOI."""
    return b"\xff\xd8" + b"".join(segments) + trailer + b"\xff\xd9"


def _seg(marker: int, payload: bytes) -> bytes:
    seg_len = len(payload) + 2
    return bytes([0xFF, marker]) + seg_len.to_bytes(2, "big") + payload


def test_rejects_non_jpeg():
    with pytest.raises(ValueError):
        _find_app_insertion_point(b"PNG\x89data")


def test_inserts_after_soi_when_no_app_segments():
    # SOI immediately followed by SOS would be invalid, but the scanner must
    # at least return a sensible offset right after SOI.
    jpeg = b"\xff\xd8\xff\xda\x00\x02\xff\xd9"
    assert _find_app_insertion_point(jpeg) == 2


def test_inserts_after_last_app_segment():
    app0 = _seg(0xE0, b"JFIF\x00content")
    app1 = _seg(0xE1, b"Exif\x00\x00more")
    sos = b"\xff\xda\x00\x02"
    jpeg = b"\xff\xd8" + app0 + app1 + sos + b"\xff\xd9"
    pos = _find_app_insertion_point(jpeg)
    assert pos == 2 + len(app0) + len(app1)


def test_stops_before_dqt():
    app0 = _seg(0xE0, b"JFIF\x00")
    dqt = _seg(0xDB, b"\x00" * 64)
    jpeg = b"\xff\xd8" + app0 + dqt + b"\xff\xd9"
    pos = _find_app_insertion_point(jpeg)
    assert pos == 2 + len(app0)


def test_handles_ff_padding_between_markers():
    app0 = _seg(0xE0, b"JFIF")
    padding = b"\xff\xff\xff"  # legal fill before the next marker
    app1 = _seg(0xE1, b"Exif")
    jpeg = b"\xff\xd8" + app0 + padding + app1 + b"\xff\xda\x00\x02\xff\xd9"
    pos = _find_app_insertion_point(jpeg)
    # Insertion should land after APP1, not crash on the padding.
    assert pos >= 2 + len(app0) + len(app1)


def test_returns_safely_on_truncated_length_field():
    # APPn marker but length bytes missing.
    jpeg = b"\xff\xd8\xff\xe1"
    pos = _find_app_insertion_point(jpeg)
    assert pos == 2  # falls back to last good offset


def test_returns_safely_on_oversize_segment_length():
    # APPn declares a length far beyond the buffer.
    jpeg = b"\xff\xd8\xff\xe1\xff\xfe" + b"\x00" * 4
    pos = _find_app_insertion_point(jpeg)
    assert pos == 2
