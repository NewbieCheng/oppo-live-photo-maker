"""Command-line interface for OPPO Live Photo Maker.

Usage:
    oppo-live VIDEO [-o OUTPUT] [--start S] [--duration S]
                    [--cover-time S] [--long-edge 1920] [--crf 23]
                    [--reference-image REF.jpg] [--cover-mode video|reference]

If --output is omitted, writes alongside the source video as
"<name>.live.jpg".
"""
# SPDX-License-Identifier: MIT
from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

from . import __version__, ffmpeg_utils, metadata, muxer


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
    p.add_argument(
        "--reference-image",
        help="Reference native photo; EXIF/IPTC are transplanted (XMP excluded).",
    )
    p.add_argument(
        "--cover-mode",
        choices=("video", "reference"),
        default="reference",
        help="Cover from reference image (default) or a video frame.",
    )
    p.add_argument(
        "--video-mode",
        choices=("full", "clip"),
        default="full",
        help="Embed full original video (default, live-photo-conv) or transcode a clip.",
    )
    p.add_argument(
        "--metadata-json",
        help="JSON file with exif/iptc overrides (see README).",
    )
    p.add_argument("--datetime", help="Override EXIF:DateTimeOriginal.")
    p.add_argument("--make", help="Override EXIF:Make.")
    p.add_argument("--model", help="Override EXIF:Model.")
    p.add_argument(
        "--gps",
        help='Override GPS as "lat,lon" or "lat,lon,alt" (decimal degrees).',
    )
    p.add_argument(
        "--presentation-ts-us",
        type=int,
        default=None,
        help="Override MotionPhoto presentation timestamp (microseconds).",
    )
    p.add_argument("-q", "--quiet", action="store_true", help="Suppress progress lines.")
    p.add_argument("-V", "--version", action="version",
                   version=f"%(prog)s {__version__}")
    return p


def _build_metadata_overrides(args: argparse.Namespace) -> metadata.NativeMetadataBundle | None:
    bundle: metadata.NativeMetadataBundle | None = None
    if args.metadata_json:
        bundle = metadata.bundle_from_json(args.metadata_json)

    quick_exif: dict[str, str] = {}
    if args.datetime:
        quick_exif["EXIF:DateTimeOriginal"] = args.datetime
    if args.make:
        quick_exif["EXIF:Make"] = args.make
    if args.model:
        quick_exif["EXIF:Model"] = args.model
    if args.gps:
        parts = [p.strip() for p in args.gps.split(",")]
        if len(parts) >= 2:
            quick_exif["Composite:GPSLatitude"] = parts[0]
            quick_exif["Composite:GPSLongitude"] = parts[1]
        if len(parts) >= 3:
            quick_exif["Composite:GPSAltitude"] = parts[2]

    if quick_exif or args.presentation_ts_us is not None:
        if bundle is None:
            bundle = metadata.NativeMetadataBundle()
        bundle.exif.update(quick_exif)
        if args.presentation_ts_us is not None:
            bundle.presentation_timestamp_us = args.presentation_ts_us
            bundle.presentation_timestamp_user_set = True

    return bundle


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

    reference = Path(args.reference_image) if args.reference_image else None
    if reference and not reference.is_file():
        sys.stderr.write(f"Reference image not found: {reference}\n")
        return 2

    output = Path(args.output) if args.output else video.with_suffix(".live.jpg")
    cover_time = args.cover_time if args.cover_time is not None else args.start
    cover_mode: metadata.CoverMode = (
        "reference" if reference is not None and args.cover_mode == "reference" else "video"
    )
    video_mode = args.video_mode

    ref_bundle = metadata.parse_reference_image(reference) if reference else None
    overrides = _build_metadata_overrides(args)
    if ref_bundle and overrides:
        meta_for_mux = metadata.merge_bundles(ref_bundle, overrides)
    elif overrides:
        meta_for_mux = overrides
    elif ref_bundle:
        meta_for_mux = ref_bundle
    else:
        meta_for_mux = None

    presentation_ts = metadata.compute_presentation_timestamp_us(
        cover_mode=cover_mode,
        cover_time=cover_time,
        start=args.start,
        reference_ts=ref_bundle.presentation_timestamp_us if ref_bundle else None,
        user_override=meta_for_mux.presentation_timestamp_us if meta_for_mux else None,
        user_set=bool(meta_for_mux and meta_for_mux.presentation_timestamp_user_set),
    )

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
            if cover_mode == "reference" and reference is not None:
                log(f"[1/3] Exporting reference image as cover: {reference.name}")
                ffmpeg_utils.export_main_image(reference, cover)
            else:
                log(f"[1/3] Extracting cover frame at t={cover_time:.2f}s ...")
                ffmpeg_utils.extract_cover(
                    video, cover, timestamp=cover_time, target_long_edge=args.long_edge,
                    rotation=info.rotation,
                )

            if video_mode == "full":
                log(f"[2/3] Embedding original video (stream copy) ...")
                ffmpeg_utils.prepare_video_for_mux(
                    video, clip, mode="full", start=args.start,
                )
            else:
                log(f"[2/3] Encoding {args.duration:.1f}s clip from t={args.start:.2f}s ...")
                ffmpeg_utils.prepare_video_for_mux(
                    video, clip,
                    mode="clip",
                    start=args.start, duration=args.duration,
                    target_long_edge=args.long_edge,
                    crf=args.crf, audio_bitrate_k=args.audio_kbps,
                    preset=args.preset, has_audio=info.has_audio,
                    rotation=info.rotation,
                )

            log(f"[3/3] Muxing OPPO MotionPhoto -> {output}")
            muxer.write_oppo_motionphoto(
                cover,
                clip,
                output,
                presentation_timestamp_us=presentation_ts,
                reference_jpg=reference,
                metadata_overrides=meta_for_mux,
                cover_mode=cover_mode,
            )
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
