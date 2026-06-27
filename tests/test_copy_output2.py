"""Integration test: copy output2.jpg metadata onto itself preserves size and Make/Model."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from oppo_live_photo.gexiv2_copy import copy_img_meta_gexiv2

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "output2.jpg"
EXIFTOOL = Path(__file__).resolve().parents[1] / "tools" / "exiftool" / "exiftool.exe"
_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _exiftool_json(path: Path) -> dict:
    proc = subprocess.run(
        [
            str(EXIFTOOL),
            "-j",
            "-G1",
            "-ExifByteOrder",
            "-InteropIndex",
            "-YCbCrPositioning",
            "-Make",
            "-Model",
            "-UserComment",
            "-MicroVideoOffset",
            "-Trailer",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
        creationflags=_CREATE_NO_WINDOW,
    )
    records = json.loads(proc.stdout or "[]")
    return records[0] if records else {}


def _micro_video_offset(tags: dict) -> int:
    for key in ("EXIF:MicroVideoOffset", "XMP-GCamera:MicroVideoOffset", "MicroVideoOffset"):
        value = tags.get(key)
        if value is not None:
            return int(str(value))
    return 0


@pytest.mark.skipif(not FIXTURE.is_file(), reason="output2.jpg fixture not present")
@pytest.mark.skipif(not EXIFTOOL.is_file(), reason="bundled exiftool not present")
def test_copy_output2_self_preserves_live_photo(tmp_path: Path) -> None:
    dest = tmp_path / "dest.jpg"
    shutil.copy2(FIXTURE, dest)
    before = _exiftool_json(dest)
    before_size = dest.stat().st_size

    copy_img_meta_gexiv2(dest, FIXTURE, exclude_xmp=True)

    after = _exiftool_json(dest)
    after_size = dest.stat().st_size

    assert after_size >= before_size * 0.95
    assert after.get("IFD0:Make") == before.get("IFD0:Make") == "OPPO"
    assert after.get("IFD0:Model") or after.get("EXIF:Model")
    assert before.get("IFD0:Model") or before.get("EXIF:Model")
    assert after.get("EXIF:UserComment") == before.get("EXIF:UserComment")
    assert after.get("File:ExifByteOrder") == "Little-endian (Intel, II)"
    assert after.get("ExifIFD:InteropIndex") or after.get("EXIF:InteropIndex")
    assert after.get("IFD0:YCbCrPositioning") or after.get("EXIF:YCbCrPositioning")
    assert _micro_video_offset(after) > 1_000_000
    assert _micro_video_offset(after) == _micro_video_offset(before)
