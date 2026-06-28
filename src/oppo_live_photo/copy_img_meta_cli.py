"""CLI compatible with live-photo-conv ``copy-img-meta``."""
# SPDX-License-Identifier: MIT
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .gexiv2_copy import (
    GExiv2CopyError,
    _run_copy_img_meta_binary,
    copy_img_meta_gexiv2,
    find_copy_img_meta,
)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="copy-img-meta",
        description="Copy metadata from source image onto dest image (dest pixels preserved).",
        epilog="Same semantics as live-photo-conv copy-img-meta / GExiv2 save_file.",
    )
    parser.add_argument("-v", "--version", action="store_true", help="Show version and exit")
    parser.add_argument("--exclude-exif", action="store_true", help="Do not copy EXIF")
    parser.add_argument("--exclude-xmp", action="store_true", help="Do not copy XMP")
    parser.add_argument("--exclude-iptc", action="store_true", help="Do not copy IPTC")
    parser.add_argument("source", nargs="?", help="Source image (metadata donor)")
    parser.add_argument("dest", nargs="?", help="Destination image (pixels kept, metadata overwritten)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    if args.version:
        binary = find_copy_img_meta()
        print(f"copy-img-meta (oppo-live-photo-maker {__version__})")
        if binary:
            print(f"native binary: {binary}")
        else:
            print("native binary: (not found — using Python fallback)")
        return 0

    if not args.source or not args.dest:
        _build_parser().print_help()
        return 1

    source = Path(args.source)
    dest = Path(args.dest)
    if not source.is_file():
        print(f"copy-img-meta: source not found: {source}", file=sys.stderr)
        return 1
    if not dest.is_file():
        print(f"copy-img-meta: dest not found: {dest}", file=sys.stderr)
        return 1

    binary = find_copy_img_meta()
    try:
        if binary is not None:
            _run_copy_img_meta_binary(
                binary,
                source,
                dest,
                exclude_exif=args.exclude_exif,
                exclude_xmp=args.exclude_xmp,
                exclude_iptc=args.exclude_iptc,
            )
            backend = "copy-img-meta"
        else:
            backend = copy_img_meta_gexiv2(
                dest,
                source,
                exclude_exif=args.exclude_exif,
                exclude_xmp=args.exclude_xmp,
                exclude_iptc=args.exclude_iptc,
            )
        print(f"Metadata copied ({backend}): {source} -> {dest}", file=sys.stderr)
        return 0
    except (GExiv2CopyError, FileNotFoundError, ValueError) as e:
        print(f"copy-img-meta: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
