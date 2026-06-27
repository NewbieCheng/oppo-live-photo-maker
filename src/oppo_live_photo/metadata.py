"""Native photo metadata parse / transplant (live-photo-conv style).

Uses exiftool for block-level EXIF/IPTC copy (``copy-img-meta --exclude-xmp``)
and field overrides before OPPO MotionPhoto muxing.
"""
# SPDX-License-Identifier: MIT
from __future__ import annotations

import contextlib
import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from . import muxer as _muxer

CoverMode = Literal["video", "reference"]

OPPO_USER_COMMENT = "Oplus_8388608"

# Tags used to preserve presentation timestamp from a reference live photo.
_REF_TS_TAGS = (
    "XMP-GCamera:MotionPhotoPresentationTimestampUs",
    "XMP-GCamera:MicroVideoPresentationTimestampUs",
)

# EXIF keys surfaced in GUI / CLI (exiftool group names).
EDITABLE_EXIF_KEYS: tuple[str, ...] = (
    "EXIF:Make",
    "EXIF:Model",
    "EXIF:Software",
    "EXIF:LensModel",
    "EXIF:Orientation",
    "EXIF:DateTimeOriginal",
    "EXIF:CreateDate",
    "EXIF:ModifyDate",
    "EXIF:OffsetTimeOriginal",
    "EXIF:FNumber",
    "EXIF:ExposureTime",
    "EXIF:ISO",
    "EXIF:FocalLength",
    "EXIF:Flash",
    "EXIF:WhiteBalance",
    "Composite:GPSLatitude",
    "Composite:GPSLongitude",
    "Composite:GPSAltitude",
    "EXIF:GPSDateStamp",
)

EDITABLE_IPTC_KEYS: tuple[str, ...] = (
    "IPTC:Keywords",
    "IPTC:Caption-Abstract",
    "IPTC:CopyrightNotice",
)


@dataclass
class NativeMetadataBundle:
    """Editable native metadata carried from reference image to output."""

    exif: dict[str, str] = field(default_factory=dict)
    iptc: dict[str, str] = field(default_factory=dict)
    presentation_timestamp_us: int | None = None
    presentation_timestamp_user_set: bool = False


def compute_presentation_timestamp_us(
    *,
    cover_mode: CoverMode = "video",
    cover_time: float = 0.0,
    start: float = 0.0,
    reference_ts: int | None = None,
    user_override: int | None = None,
    user_set: bool = False,
) -> int:
    """Compute MotionPhoto presentation timestamp in microseconds."""
    if user_set and user_override is not None:
        return max(0, int(user_override))
    if reference_ts is not None:
        return max(0, int(reference_ts))
    if cover_mode == "video":
        return max(0, int(round((cover_time - start) * 1_000_000)))
    return 0


def _run_exiftool_json(args: list[str]) -> list[dict]:
    exiftool = _muxer._find_exiftool()
    cmd = [exiftool, "-j", "-n", "-G1", *args]
    try:
        proc = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            creationflags=_muxer._CREATE_NO_WINDOW,
        )
    except subprocess.CalledProcessError as e:
        detail = (e.stderr or e.stdout or "").strip() or "(no output)"
        raise RuntimeError(f"exiftool failed:\n{detail}") from e
    data = json.loads(proc.stdout or "[]")
    if not isinstance(data, list):
        return []
    return data


def _pick_tags(record: dict, keys: tuple[str, ...]) -> dict[str, str]:
    out: dict[str, str] = {}
    for key in keys:
        if key in record and record[key] is not None:
            out[key] = str(record[key])
    return out


def parse_reference_image(path: str | Path) -> NativeMetadataBundle:
    """Read editable EXIF/IPTC and optional presentation timestamp from a JPEG."""
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(path)

    records = _run_exiftool_json([str(path)])
    record = records[0] if records else {}

    bundle = NativeMetadataBundle(
        exif=_pick_tags(record, EDITABLE_EXIF_KEYS),
        iptc=_pick_tags(record, EDITABLE_IPTC_KEYS),
    )

    for tag in _REF_TS_TAGS:
        raw = record.get(tag)
        if raw is not None and str(raw).strip() not in ("", "-1"):
            with contextlib.suppress(ValueError):
                bundle.presentation_timestamp_us = int(float(str(raw)))
            break

    return bundle


def bundle_from_json(path: str | Path) -> NativeMetadataBundle:
    """Load overrides from a JSON file (CLI ``--metadata-json``)."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    exif = {str(k): str(v) for k, v in (data.get("exif") or {}).items()}
    iptc = {str(k): str(v) for k, v in (data.get("iptc") or {}).items()}
    ts = data.get("presentation_timestamp_us")
    return NativeMetadataBundle(
        exif=exif,
        iptc=iptc,
        presentation_timestamp_us=int(ts) if ts is not None else None,
        presentation_timestamp_user_set=bool(data.get("presentation_timestamp_user_set")),
    )


def apply_native_metadata(
    cover_jpg: str | Path,
    reference_jpg: str | Path | None = None,
    overrides: NativeMetadataBundle | None = None,
    *,
    copy_exif: bool = True,
    copy_iptc: bool = True,
) -> None:
    """Transplant EXIF/IPTC onto *cover_jpg* (in place).

    Mirrors ``copy-img-meta --exclude-xmp``: copy blocks from reference, apply
    user overrides, then force OPPO ``UserComment``.
    """
    cover_jpg = Path(cover_jpg)
    exiftool = _muxer._find_exiftool()

    cmd: list[str] = [exiftool, "-overwrite_original"]

    if reference_jpg is not None:
        ref = Path(reference_jpg)
        if not ref.is_file():
            raise FileNotFoundError(ref)
        tags_from: list[str] = []
        if copy_exif:
            tags_from.extend(["-EXIF:all"])
        if copy_iptc:
            tags_from.extend(["-IPTC:all"])
        if tags_from:
            cmd.extend(["-TagsFromFile", str(ref), *tags_from])

    if overrides:
        for key, value in overrides.exif.items():
            cmd.append(f"-{key}={value}")
        for key, value in overrides.iptc.items():
            cmd.append(f"-{key}={value}")

    cmd.append(f"-EXIF:UserComment={OPPO_USER_COMMENT}")
    cmd.append(str(cover_jpg))

    _muxer._run(cmd)


def merge_bundles(
    base: NativeMetadataBundle,
    edits: NativeMetadataBundle,
) -> NativeMetadataBundle:
    """Merge user edits onto a parsed reference bundle."""
    merged = NativeMetadataBundle(
        exif={**base.exif, **edits.exif},
        iptc={**base.iptc, **edits.iptc},
        presentation_timestamp_us=edits.presentation_timestamp_us
        if edits.presentation_timestamp_user_set
        else base.presentation_timestamp_us,
        presentation_timestamp_user_set=edits.presentation_timestamp_user_set,
    )
    return merged
