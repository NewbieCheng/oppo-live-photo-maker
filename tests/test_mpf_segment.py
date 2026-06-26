"""Tests for the OPPO MotionPhoto MPF segment builder."""
from __future__ import annotations

import struct

from oppo_live_photo.muxer import _build_mpf_segment


def test_mpf_segment_starts_with_app2_marker():
    seg = _build_mpf_segment(12345)
    assert seg[:2] == b"\xff\xe2"


def test_mpf_segment_length_field_matches_actual_size():
    seg = _build_mpf_segment(12345)
    declared = int.from_bytes(seg[2:4], "big")
    # The length field counts itself but excludes the 0xFFE2 marker bytes.
    assert declared == len(seg) - 2


def test_mpf_segment_contains_signature_and_tiff_header():
    seg = _build_mpf_segment(0)
    body = seg[4:]
    assert body[:4] == b"MPF\x00"
    # Big-endian TIFF header, IFD at offset 8.
    assert body[4:12] == b"MM\x00\x2a\x00\x00\x00\x08"


def test_mpf_segment_size_is_independent_of_image_size():
    a = _build_mpf_segment(0)
    b = _build_mpf_segment(99_999_999)
    assert len(a) == len(b), "MPF segment length must be stable for two-pass mux"


def test_mpf_segment_records_image_size_in_mp_entry():
    size = 0x12345678
    seg = _build_mpf_segment(size)
    # MP entry sits right after the IFD; pull its 16 bytes back out.
    body = seg[4:]
    ifd_start = 12  # after TIFF header
    n_entries = struct.unpack(">H", body[ifd_start : ifd_start + 2])[0]
    assert n_entries == 3
    mp_entry = body[-16:]
    image_attr, recorded_size, _off, _d1, _d2 = struct.unpack(">IIIHH", mp_entry)
    assert recorded_size == size
    assert image_attr == 0x00030000  # Baseline MP Primary
