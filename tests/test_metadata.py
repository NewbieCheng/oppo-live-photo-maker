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


def _ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


pytestmark = pytest.mark.skipif(
    not _exiftool_available() or not _ffmpeg_available(),
    reason="exiftool and ffmpeg not in PATH",
)


def _write_test_jpeg(path: Path) -> None:
    """Write a tiny valid JPEG cover (ffmpeg lavfi), suitable for exiftool edits."""
    subprocess.run(
        [
            shutil.which("ffmpeg"),
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=white:s=8x8",
            "-frames:v",
            "1",
            str(path),
        ],
        check=True,
        capture_output=True,
    )


@pytest.fixture
def reference_with_make(tmp_path: Path) -> Path:
    ref = tmp_path / "ref.jpg"
    _write_test_jpeg(ref)
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
    _write_test_jpeg(cover)
    metadata.apply_native_metadata(cover, reference_with_make, None)
    out = subprocess.run(
        ["exiftool", "-j", "-n", "-EXIF:Make", "-EXIF:UserComment", "-EXIF:Orientation", str(cover)],
        check=True,
        capture_output=True,
        text=True,
    )
    import json

    tags = json.loads(out.stdout)[0]
    assert tags.get("Make") == "TestMake"
    assert tags.get("UserComment") == metadata.OPPO_USER_COMMENT
    assert tags.get("Orientation") == 1


def test_apply_native_metadata_forces_orientation_one(
    reference_with_make: Path, tmp_path: Path
) -> None:
    """TagsFromFile + -Orientation=1 wrongly sets Rotate 180; #=1 forces numeric 1."""
    cover = tmp_path / "cover.jpg"
    _write_test_jpeg(cover)
    subprocess.run(
        [
            "exiftool", "-overwrite_original",
            "-TagsFromFile", str(reference_with_make), "-EXIF:all", "--Orientation",
            str(cover),
        ],
        check=True,
        capture_output=True,
    )
    metadata.apply_native_metadata(cover, reference_with_make, None)
    orient = metadata._read_orientation_numeric(cover)
    assert orient == 1


def test_compute_presentation_timestamp_from_cover() -> None:
    ts = metadata.compute_presentation_timestamp_us(
        cover_mode="video",
        cover_time=2.5,
        start=0.5,
    )
    assert ts == 2_000_000


def test_compute_presentation_timestamp_reference_default() -> None:
    ts = metadata.compute_presentation_timestamp_us(cover_mode="reference")
    assert ts == 0


def test_copy_img_meta_excludes_xmp(reference_with_make: Path, tmp_path: Path) -> None:
    cover = tmp_path / "cover.jpg"
    _write_test_jpeg(cover)
    metadata.copy_img_meta(cover, reference_with_make, exclude_xmp=True)
    out = subprocess.run(
        ["exiftool", "-j", "-EXIF:Make", "-XMP:Make", str(cover)],
        check=True,
        capture_output=True,
        text=True,
    )
    import json

    tags = json.loads(out.stdout)[0]
    assert tags.get("Make") == "TestMake"


def test_copy_img_meta_excludes_exif(reference_with_make: Path, tmp_path: Path) -> None:
    cover = tmp_path / "cover.jpg"
    _write_test_jpeg(cover)
    subprocess.run(
        ["exiftool", "-overwrite_original", "-EXIF:Make=DestMake", str(cover)],
        check=True,
        capture_output=True,
    )
    metadata.copy_img_meta(cover, reference_with_make, exclude_exif=True)
    out = subprocess.run(
        ["exiftool", "-j", "-EXIF:Make", str(cover)],
        check=True,
        capture_output=True,
        text=True,
    )
    import json

    tags = json.loads(out.stdout)[0]
    assert tags.get("Make") == "DestMake"


def test_copy_img_meta_excludes_iptc(reference_with_make: Path, tmp_path: Path) -> None:
    ref = tmp_path / "ref_iptc.jpg"
    _write_test_jpeg(ref)
    subprocess.run(
        [
            "exiftool",
            "-overwrite_original",
            "-EXIF:Make=TestMake",
            "-IPTC:Keywords=keyword",
            str(ref),
        ],
        check=True,
        capture_output=True,
    )
    cover = tmp_path / "cover.jpg"
    _write_test_jpeg(cover)
    metadata.copy_img_meta(cover, ref, exclude_iptc=True)
    out = subprocess.run(
        ["exiftool", "-j", "-EXIF:Make", "-IPTC:Keywords", str(cover)],
        check=True,
        capture_output=True,
        text=True,
    )
    import json

    tags = json.loads(out.stdout)[0]
    assert tags.get("Make") == "TestMake"
    assert "Keywords" not in tags


def test_copy_img_meta_rejects_all_excluded(reference_with_make: Path, tmp_path: Path) -> None:
    cover = tmp_path / "cover.jpg"
    _write_test_jpeg(cover)
    with pytest.raises(ValueError, match="At least one metadata"):
        metadata.copy_img_meta(
            cover,
            reference_with_make,
            exclude_exif=True,
            exclude_xmp=True,
            exclude_iptc=True,
        )


def test_write_motionphoto_with_reference_metadata(
    reference_with_make: Path, tmp_path: Path
) -> None:
    cover = tmp_path / "cover.jpg"
    _write_test_jpeg(cover)
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"\x00" * 8 + b"ftypmp42" + b"\x00" * 8)
    out = tmp_path / "out.live.jpg"
    muxer.write_oppo_motionphoto(
        cover,
        clip,
        out,
        reference_jpg=reference_with_make,
        presentation_timestamp_us=100,
        cover_mode="video",
    )
    assert out.is_file()
    probe = subprocess.run(
        [
            "exiftool",
            "-j",
            "-EXIF:Make",
            "-XMP-GCamera:MotionPhoto",
            "-XMP-OpCamera:VideoLength",
            str(out),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    import json

    tags = json.loads(probe.stdout)[0]
    assert tags.get("Make") == "TestMake"
    assert tags.get("MotionPhoto") == "1"
    assert int(tags.get("VideoLength", 0)) == clip.stat().st_size
