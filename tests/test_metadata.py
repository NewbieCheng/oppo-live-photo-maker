"""Tests for native metadata parse / transplant."""
# SPDX-License-Identifier: MIT
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from oppo_live_photo import metadata, muxer


def _exiftool_available() -> bool:
    return shutil.which("exiftool") is not None


pytestmark = pytest.mark.skipif(
    not _exiftool_available(),
    reason="exiftool not in PATH",
)


def _write_minimal_jpeg(path: Path) -> None:
    """Write a tiny valid JPEG (no metadata)."""

    def seg(marker: int, payload: bytes) -> bytes:
        seg_len = len(payload) + 2
        return bytes([0xFF, marker]) + seg_len.to_bytes(2, "big") + payload

    app0 = seg(0xE0, b"JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00")
    dqt = seg(0xDB, bytes([16] * 64))
    path.write_bytes(b"\xff\xd8" + app0 + dqt + b"\xff\xd9")


@pytest.fixture
def reference_with_make(tmp_path: Path) -> Path:
    ref = tmp_path / "ref.jpg"
    _write_minimal_jpeg(ref)
    subprocess.run(
        ["exiftool", "-overwrite_original", "-EXIF:Make=TestMake", "-EXIF:Model=M1", str(ref)],
        check=True,
        capture_output=True,
    )
    return ref


def test_parse_reference_image(reference_with_make: Path) -> None:
    bundle = metadata.parse_reference_image(reference_with_make)
    assert bundle.exif.get("EXIF:Make") == "TestMake"
    assert bundle.exif.get("EXIF:Model") == "M1"


def test_apply_native_metadata_copies_exif(reference_with_make: Path, tmp_path: Path) -> None:
    cover = tmp_path / "cover.jpg"
    _write_minimal_jpeg(cover)
    metadata.apply_native_metadata(cover, reference_with_make, None)
    out = subprocess.run(
        ["exiftool", "-j", "-EXIF:Make", "-EXIF:UserComment", str(cover)],
        check=True,
        capture_output=True,
        text=True,
    )
    import json

    tags = json.loads(out.stdout)[0]
    assert tags.get("Make") == "TestMake"
    assert tags.get("UserComment") == metadata.OPPO_USER_COMMENT


def test_compute_presentation_timestamp_from_cover() -> None:
    ts = metadata.compute_presentation_timestamp_us(
        cover_mode="video",
        cover_time=2.5,
        start=0.5,
    )
    assert ts == 2_000_000


def test_write_motionphoto_with_reference_metadata(
    reference_with_make: Path, tmp_path: Path
) -> None:
    cover = tmp_path / "cover.jpg"
    _write_minimal_jpeg(cover)
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"\x00" * 8 + b"ftypmp42" + b"\x00" * 8)
    out = tmp_path / "out.live.jpg"
    muxer.write_oppo_motionphoto(
        cover,
        clip,
        out,
        reference_jpg=reference_with_make,
        presentation_timestamp_us=100,
    )
    assert out.is_file()
    probe = subprocess.run(
        ["exiftool", "-j", "-EXIF:Make", "-XMP-GCamera:MicroVideo", str(out)],
        check=True,
        capture_output=True,
        text=True,
    )
    import json

    tags = json.loads(probe.stdout)[0]
    assert tags.get("Make") == "TestMake"
    assert tags.get("MicroVideo") == "1"
