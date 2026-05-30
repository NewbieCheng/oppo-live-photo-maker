"""Command-line interface for OPPO Live Photo Maker.

Usage:
    python -m src.cli VIDEO [-o OUTPUT] [--start S] [--duration S]
                            [--cover-time S] [--long-edge 1920] [--crf 23]

If --output is omitted, writes alongside the source video as
"<name>.live.jpg".
"""
from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

from . import ffmpeg_utils, muxer


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="oppo-live", description="Convert a video to an OPPO Live Photo JPEG."
    )
    p.add_argument("video", help="Input video file (any format ffmpeg reads).")
    p.add_argument("-o", "--output", help="Output JPEG path.")
    p.add_argument("--start", type=float, default=0.0,
                   help="Start time of the 3s clip (seconds). Default: 0.")
    p.add_argument("--duration", type=float, default=3.0,
                   help="Clip duration in seconds. Default: 3.")
    p.add_argument("--cover-time", type=float, default=None,
                   help="Time of the still frame (default: same as --start).")
    p.add_argument("--long-edge", type=int, default=1920,
                   help="Longer edge in pixels. Default: 1920.")
    p.add_argument("--crf", type=int, default=23,
                   help="x264 CRF, lower = better quality. Default: 23.")
    p.add_argument("--audio-kbps", type=int, default=128,
                   help="AAC audio bitrate in kbps. Default: 128.")
    args = p.parse_args(argv)

    missing = ffmpeg_utils.check_dependencies()
    if missing:
        sys.stderr.write(
            f"Missing required tools: {', '.join(missing)}\n"
            f"Install ffmpeg (https://ffmpeg.org) and exiftool (https://exiftool.org).\n"
        )
        return 2

    video = Path(args.video)
    if not video.is_file():
        sys.stderr.write(f"Video not found: {video}\n")
        return 2

    output = Path(args.output) if args.output else video.with_suffix(".live.jpg")
    cover_time = args.cover_time if args.cover_time is not None else args.start

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        cover = td_path / "cover.jpg"
        clip = td_path / "clip.mp4"

        print(f"[1/3] Extracting cover frame at t={cover_time:.2f}s ...")
        ffmpeg_utils.extract_cover(
            video, cover, timestamp=cover_time, target_long_edge=args.long_edge
        )

        print(f"[2/3] Encoding {args.duration:.1f}s clip from t={args.start:.2f}s ...")
        ffmpeg_utils.transcode_clip(
            video, clip,
            start=args.start, duration=args.duration,
            target_long_edge=args.long_edge,
            crf=args.crf, audio_bitrate_k=args.audio_kbps,
        )

        print(f"[3/3] Muxing OPPO MotionPhoto -> {output}")
        muxer.write_oppo_motionphoto(cover, clip, output)

    size_mb = output.stat().st_size / (1024 * 1024)
    print(f"Done: {output}  ({size_mb:.2f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
