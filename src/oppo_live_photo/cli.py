"""Command-line interface for OPPO Live Photo Maker.

Usage:
    oppo-live VIDEO [-o OUTPUT] [--start S] [--duration S]
                    [--cover-time S] [--long-edge 1920] [--crf 23]

If --output is omitted, writes alongside the source video as
"<name>.live.jpg".
"""
# SPDX-License-Identifier: MIT
from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

from . import __version__, ffmpeg_utils, muxer


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="oppo-live",
        description="Convert a video to an OPPO Live Photo JPEG.",
    )
    p.add_argument("video", help="Input video file (any format ffmpeg reads).")
    p.add_argument("-o", "--output", help="Output JPEG path.")
    p.add_argument("--start", type=float, default=0.0,
                   help="Start time of the clip (seconds). Default: 0.")
    p.add_argument("--duration", type=float, default=3.0,
                   help="Clip duration in seconds. Default: 3.")
    p.add_argument("--cover-time", type=float, default=None,
                   help="Time of the still cover frame (default: same as --start).")
    p.add_argument("--long-edge", type=int, default=1920,
                   help="Longer edge in pixels. Default: 1920.")
    p.add_argument("--crf", type=int, default=23,
                   help="x264 CRF, lower = better quality. Default: 23.")
    p.add_argument("--audio-kbps", type=int, default=128,
                   help="AAC audio bitrate in kbps. Default: 128.")
    p.add_argument("--preset", default="fast",
                   help="x264 preset (ultrafast..veryslow). Default: fast.")
    p.add_argument("-q", "--quiet", action="store_true", help="Suppress progress lines.")
    p.add_argument("-V", "--version", action="version",
                   version=f"%(prog)s {__version__}")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    log = (lambda *_a, **_k: None) if args.quiet else print

    missing = ffmpeg_utils.check_dependencies()
    if missing:
        sys.stderr.write(
            f"Missing required tools: {', '.join(missing)}\n"
            "Install ffmpeg (https://ffmpeg.org) and exiftool (https://exiftool.org).\n"
        )
        return 2

    video = Path(args.video)
    if not video.is_file():
        sys.stderr.write(f"Video not found: {video}\n")
        return 2

    output = Path(args.output) if args.output else video.with_suffix(".live.jpg")
    cover_time = args.cover_time if args.cover_time is not None else args.start

    try:
        info = ffmpeg_utils.probe(video)
    except Exception as e:
        sys.stderr.write(f"Failed to probe video: {e}\n")
        return 1

    with tempfile.TemporaryDirectory(prefix="oppo-live-") as td:
        td_path = Path(td)
        cover = td_path / "cover.jpg"
        clip = td_path / "clip.mp4"

        try:
            log(f"[1/3] Extracting cover frame at t={cover_time:.2f}s ...")
            ffmpeg_utils.extract_cover(
                video, cover, timestamp=cover_time, target_long_edge=args.long_edge
            )

            log(f"[2/3] Encoding {args.duration:.1f}s clip from t={args.start:.2f}s ...")
            ffmpeg_utils.transcode_clip(
                video, clip,
                start=args.start, duration=args.duration,
                target_long_edge=args.long_edge,
                crf=args.crf, audio_bitrate_k=args.audio_kbps,
                preset=args.preset, has_audio=info.has_audio,
            )

            log(f"[3/3] Muxing OPPO MotionPhoto -> {output}")
            muxer.write_oppo_motionphoto(cover, clip, output)
        except Exception as e:
            sys.stderr.write(f"Conversion failed: {e}\n")
            return 1

    size_mb = output.stat().st_size / (1024 * 1024)
    log(f"Done: {output}  ({size_mb:.2f} MB)")
    return 0


def main_entry() -> None:
    """Console-script entry point that exits with the proper status code."""
    raise SystemExit(main())


if __name__ == "__main__":
    main_entry()
