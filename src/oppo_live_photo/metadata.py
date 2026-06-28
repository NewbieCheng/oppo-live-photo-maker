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
    """Compute MotionPhoto presentation timestamp in microseconds.

    Mirrors live-photo-conv when a reference live photo supplies XMP ts; otherwise
    OPPO native exports use ``0`` (Find X7/X8 samples), not ``-1``.
    """
    if user_set and user_override is not None:
        return max(0, int(user_override))
    if reference_ts is not None and reference_ts >= 0:
        return int(reference_ts)
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
        val = _resolve_tag(record, key)
        if val is not None:
            out[key] = val
    return out


def _read_orientation_numeric(path: str | Path) -> int | None:
    """Return EXIF Orientation as integer, or None if absent."""
    records = _run_exiftool_json(["-EXIF:Orientation", str(path)])
    record = records[0] if records else {}
    for key in ("EXIF:Orientation", "IFD0:Orientation", "Orientation"):
        raw = record.get(key)
        if raw is None:
            continue
        with contextlib.suppress(ValueError, TypeError):
            return int(raw)
    return None


def _resolve_tag(record: dict, canonical: str) -> str | None:
    """Map exiftool -G1 keys (IFD0:/ExifIFD:/…) onto canonical EXIF:/Composite: names."""
    bare = canonical.split(":", 1)[-1]
    candidates = [
        canonical,
        f"IFD0:{bare}",
        f"ExifIFD:{bare}",
        f"Composite:{bare}",
        f"GPS:{bare}",
        f"IPTC:{bare}",
        f"XMP:{bare}",
        bare,
    ]
    # HEIC often stores ISO under PhotographicSensitivity / ISOSpeedRatings.
    if bare == "ISO":
        candidates.extend(
            [
                "ExifIFD:PhotographicSensitivity",
                "ExifIFD:ISOSpeedRatings",
                "EXIF:PhotographicSensitivity",
                "EXIF:ISOSpeedRatings",
            ]
        )
    for key in candidates:
        if key not in record or record[key] is None:
            continue
        val = str(record[key]).strip()
        if not val or val.startswith("(Binary data"):
            continue
        return val
    return None


def parse_reference_image(path: str | Path) -> NativeMetadataBundle:
    """Read editable EXIF/IPTC and optional presentation timestamp via exiftool.

    Supports JPEG, HEIC/HEIF, PNG, WebP, and other formats exiftool reads.
    """
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(path)

    records = _run_exiftool_json([str(path)])
    record = records[0] if records else {}

    picked_exif = _pick_tags(record, EDITABLE_EXIF_KEYS)
    picked_iptc = _pick_tags(record, EDITABLE_IPTC_KEYS)

    bundle = NativeMetadataBundle(
        exif=picked_exif,
        iptc=picked_iptc,
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


def copy_img_meta(
    dest_jpg: str | Path,
    source_img: str | Path,
    *,
    exclude_exif: bool = False,
    exclude_xmp: bool = False,
    exclude_iptc: bool = False,
) -> None:
    """Copy image metadata like live-photo-conv ``copy-img-meta``.

    Defaults copy all metadata groups (EXIF, XMP, IPTC). Pass exclude flags to
    omit groups. ``apply_native_metadata`` uses ``exclude_xmp=True`` so MotionPhoto
    XMP is injected fresh during mux.
    """
    dest_jpg = Path(dest_jpg)
    source_img = Path(source_img)
    if not source_img.is_file():
        raise FileNotFoundError(source_img)
    if exclude_exif and exclude_xmp and exclude_iptc:
        raise ValueError("At least one metadata group must be copied (EXIF, XMP, or IPTC)")
    exiftool = _muxer._find_exiftool()
    cmd = [
        exiftool,
        "-api",
        "ByteOrder=II",
        "-overwrite_original",
        "-TagsFromFile",
        str(source_img),
        "-All:all",
    ]
    if exclude_xmp:
        cmd.append("--XMP:all")
    if exclude_iptc:
        cmd.append("--IPTC:all")
    if exclude_exif:
        cmd.append("--EXIF:all")
    cmd.append(str(dest_jpg))
    _muxer._run(cmd)


def apply_native_metadata(
    cover_jpg: str | Path,
    reference_jpg: str | Path | None = None,
    overrides: NativeMetadataBundle | None = None,
    *,
    preserve_orientation: bool = False,
) -> None:
    """Transplant metadata onto *cover_jpg* (in place).

    Step 1 — ``copy_img_meta --exclude-xmp`` (full EXIF/IPTC/GPS block).
    Step 2 — user overrides, OPPO ``UserComment``, optional orientation fix.
    """
    cover_jpg = Path(cover_jpg)
    exiftool = _muxer._find_exiftool()

    if reference_jpg is not None:
        copy_img_meta(cover_jpg, reference_jpg, exclude_xmp=True)

    cmd: list[str] = [exiftool, "-overwrite_original"]

    if overrides:
        for key, value in overrides.exif.items():
            if preserve_orientation and key.endswith("Orientation"):
                continue
            cmd.append(f"-{key}={value}")
        for key, value in overrides.iptc.items():
            cmd.append(f"-{key}={value}")

    if not preserve_orientation:
        # Video-frame covers are rotation-corrected in pixels; plain
        # -Orientation=1 means Rotate 180 — use numeric tag instead.
        cmd.append("-Orientation#=1")
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
