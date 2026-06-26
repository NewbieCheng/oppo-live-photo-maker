"""End-to-end smoke test: synthesize a tiny video with ffmpeg, run the CLI,
verify the output is a JPEG with appended MP4 trailer."""
from __future__ import annotations

import shutil
import subprocess

import pytest

from oppo_live_photo import cli, ffmpeg_utils

# Skip the whole module if any external tool is missing.
pytestmark = pytest.mark.skipif(
    bool(ffmpeg_utils.check_dependencies()),
    reason="ffmpeg / ffprobe / exiftool not on PATH",
)


def _make_test_video(path) -> None:
    """Create a 2-second 320x240 silent test video using ffmpeg's test sources."""
    subprocess.run(
        [
            shutil.which("ffmpeg"), "-y",
            "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10",
            "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-t", "2",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
            "-c:a", "aac", "-b:a", "64k",
            "-shortest",
            str(path),
        ],
        check=True, capture_output=True,
    )


def test_cli_produces_valid_live_photo(tmp_path):
    src = tmp_path / "src.mp4"
    out = tmp_path / "out.live.jpg"
    _make_test_video(src)

    rc = cli.main(
        [
            str(src),
            "-o", str(out),
            "--start", "0",
            "--duration", "1.5",
            "--long-edge", "320",
            "--quiet",
        ]
    )
    assert rc == 0
    assert out.is_file()

    data = out.read_bytes()
    # Must start with JPEG SOI.
    assert data[:2] == b"\xff\xd8"

    # JPEG ends at the first EOI (0xFFD9) we encounter; the MP4 follows.
    eoi = data.find(b"\xff\xd9")
    assert eoi > 0
    trailer = data[eoi + 2 :]
    # MP4 has an `ftyp` box near its very beginning (offset 4 of the file).
    assert b"ftyp" in trailer[:64], "Expected MP4 ftyp box in JPEG trailer"

    # Output should be at least a few KB (JPEG cover + tiny MP4).
    assert out.stat().st_size > 4_000
