"""Tests for Motion Photo JPEG / MP4 tail splitting."""
from __future__ import annotations

from pathlib import Path

import pytest

from oppo_live_photo import jpeg_segment_copy as js

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "output2.jpg"


def test_split_simple_jpeg_plus_mp4():
    jpeg = b"\xff\xd8\xff\xd9"
    mp4 = b"\x00\x00\x00\x20ftypisom" + b"\xab" * 32
    data = jpeg + mp4
    head, tail = js.split_jpeg_and_appended_tail(data)
    assert head == jpeg
    assert tail == mp4


def test_split_ignores_false_eoi_inside_mp4():
    jpeg = b"\xff\xd8\xff\xd9"
    mp4 = b"\x00\x00\x00\x20ftypisom" + b"\x00" * 5000
    mp4 = mp4[:-2] + b"\xff\xd9"
    data = jpeg + mp4
    naive_head, _ = js.split_after_last_jpeg_eoi(data)
    assert len(naive_head) > len(jpeg)
    head, tail = js.split_jpeg_and_appended_tail(data)
    assert head == jpeg
    assert len(tail) == len(mp4)


@pytest.mark.skipif(not FIXTURE.is_file(), reason="output2.jpg fixture not present")
def test_output2_fixture_split_matches_micro_video_offset():
    data = FIXTURE.read_bytes()
    head, tail = js.split_jpeg_and_appended_tail(data)
    assert head.startswith(b"\xff\xd8")
    assert head.endswith(b"\xff\xd9")
    assert js.has_likely_appended_mp4(tail)
    assert len(head) + len(tail) == len(data)
    assert len(head) < 200_000
    assert len(tail) > 5_000_000
