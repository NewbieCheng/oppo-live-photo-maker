"""GExiv2-style metadata copy (live-photo-conv ``copy-img-meta``).

Uses the ``copy-img-meta`` binary when available, otherwise PyGObject GExiv2.
Falls back to JPEG APP segment transplant via bundled exiftool (preserves II byte order),
then applies server-side post-copy fixes (ColorOS EXIF resync, live.jpg MotionPhoto XMP).
"""
# SPDX-License-Identifier: MIT
from __future__ import annotations

import json
import logging
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from . import jpeg_segment_copy as _jpeg_seg
from . import muxer as _muxer

log = logging.getLogger(__name__)

_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _ensure_writable(path: Path) -> None:
    try:
        mode = path.stat().st_mode
        if not mode & 0o200:
            path.chmod(mode | 0o200)
    except OSError:
        pass


def _write_bytes_writable(path: Path, data: bytes) -> None:
    _ensure_writable(path)
    path.write_bytes(data)


class GExiv2CopyError(RuntimeError):
    """Raised when GExiv2-style copy cannot run."""


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _sibling_live_photo_conv() -> Path:
    return _repo_root().parent / "live-photo-conv"


def _candidate_binaries(name: str) -> list[Path]:
    exe = f"{name}.exe" if sys.platform == "win32" else name
    roots: list[Path] = []
    env_root = os.environ.get("LIVE_PHOTO_CONV_ROOT")
    if env_root:
        roots.append(Path(env_root))
    sibling = _sibling_live_photo_conv()
    if sibling.is_dir():
        roots.append(sibling)

    candidates: list[Path] = []
    env_key = name.upper().replace("-", "_")
    env_path = os.environ.get(env_key)
    if env_path:
        candidates.append(Path(env_path))

    which = shutil.which(name)
    if which:
        candidates.append(Path(which))

    for root in roots:
        candidates.extend(
            [
                root / "build" / "src" / exe,
                root / "build" / exe,
                root / "_build" / "src" / exe,
                root / "_build" / exe,
            ]
        )

    if sys.platform == "win32":
        home = Path.home()
        candidates.extend(
            [
                home / "msys64" / "ucrt64" / "bin" / exe,
                home / "msys64" / "msys64" / "ucrt64" / "bin" / exe,
                Path("C:/msys64/ucrt64/bin") / exe,
            ]
        )
    return candidates


def find_copy_img_meta() -> Path | None:
    """Locate ``copy-img-meta`` from live-photo-conv."""
    for path in _candidate_binaries("copy-img-meta"):
        if path.is_file():
            return path
    return None


def find_live_photo_make() -> Path | None:
    """Locate ``live-photo-make`` / ``live-photo-conv`` binary."""
    for name in ("live-photo-make", "live-photo-conv"):
        for path in _candidate_binaries(name):
            if path.is_file():
                return path
    return None




EXIF_RESYNC_GROUPS = (
    "-IFD0:All",
    "-ExifIFD:All",
    "-InteropIFD:All",
    "-GPS:All",
    "-MakerNotes:All",
)


def _exiftool_available() -> Path | None:
    try:
        return Path(_muxer._find_exiftool())
    except RuntimeError:
        return None


def _build_tags_from_file_args(
    *,
    exclude_exif: bool,
    exclude_xmp: bool,
    exclude_iptc: bool,
) -> list[str]:
    args = ["-All:all"]
    if exclude_xmp:
        args.append("--XMP:all")
    if exclude_iptc:
        args.append("--IPTC:all")
    if exclude_exif:
        args.append("--EXIF:all")
    return args


def _run_exiftool(cmd: list[str]) -> None:
    try:
        subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            creationflags=_CREATE_NO_WINDOW,
        )
    except subprocess.CalledProcessError as e:
        detail = (e.stderr or e.stdout or "").strip() or "(no output)"
        raise GExiv2CopyError(f"exiftool failed: {detail}") from e


def _materialize_metadata_jpeg(
    exiftool: Path,
    source: Path,
    *,
    exclude_exif: bool,
    exclude_xmp: bool,
    exclude_iptc: bool,
) -> bytes:
    with tempfile.TemporaryDirectory(prefix="oppo-seg-") as td:
        canvas = Path(td) / "canvas.jpg"
        canvas.write_bytes(_jpeg_seg.minimal_jpeg())
        cmd = [
            str(exiftool),
            *_byte_order_api(exiftool, source),
            "-overwrite_original",
            "-TagsFromFile",
            str(source),
            *_build_tags_from_file_args(
                exclude_exif=exclude_exif,
                exclude_xmp=exclude_xmp,
                exclude_iptc=exclude_iptc,
            ),
            str(canvas),
        ]
        _run_exiftool(cmd)
        data = canvas.read_bytes()
    if not exclude_exif:
        data = _sync_full_exif_from_source(exiftool, data, source)
    return data


def _read_tags_json(exiftool: Path, jpeg: bytes) -> dict:
    with tempfile.TemporaryDirectory(prefix="oppo-tags-") as td:
        path = Path(td) / "probe.jpg"
        path.write_bytes(jpeg)
        proc = subprocess.run(
            [str(exiftool), "-j", "-G1", "-U", "-n", str(path)],
            check=True,
            capture_output=True,
            text=True,
            creationflags=_CREATE_NO_WINDOW,
        )
        records = json.loads(proc.stdout or "[]")
        return records[0] if records else {}


def _tag_value(tags: dict, *keys: str) -> object | None:
    for key in keys:
        value = tags.get(key)
        if value is not None and value != "":
            return value
    return None


def _parse_exif_byte_order_label(value: object | None) -> str | None:
    if value is None or value == "":
        return None
    s = str(value).strip().upper()
    if s == "II" or "INTEL" in s or "LITTLE" in s:
        return "II"
    if s == "MM" or "MOTOROLA" in s or "BIG" in s:
        return "MM"
    return None


def _infer_copy_exif_byte_order(source_tags: dict, source_bytes: bytes | None = None) -> str:
    from_tags = _parse_exif_byte_order_label(
        _tag_value(source_tags, "File:ExifByteOrder", "ExifByteOrder")
    )
    if from_tags:
        return from_tags
    if source_bytes is not None:
        from_jpeg = _jpeg_seg.read_exif_byte_order(source_bytes)
        if from_jpeg:
            return from_jpeg
    make = str(_tag_value(source_tags, "IFD0:Make", "EXIF:Make", "Make") or "")
    if "oppo" in make.lower():
        return "MM"
    return "II"


def _byte_order_api(exiftool: Path, source: Path) -> list[str]:
    src_bytes = source.read_bytes()
    tags = _read_tags_json(exiftool, src_bytes)
    order = _infer_copy_exif_byte_order(tags, src_bytes)
    return ["-api", f"ByteOrder={order}"]


def _has_exif_app1(jpeg: bytes) -> bool:
    return any(_jpeg_seg.is_exif_app1(seg) for seg in _jpeg_seg.scan_jpeg_segments(jpeg))


def _has_mpf_app2(jpeg: bytes) -> bool:
    for seg in _jpeg_seg.scan_jpeg_segments(jpeg):
        if seg.marker != 0xE2 or len(seg.payload) < 8:
            continue
        if seg.payload[4:8] == b"MPF\x00":
            return True
    return False


def _has_maker_notes_in_tags(tags: dict) -> bool:
    if _tag_value(tags, "MakerNotes") is not None:
        return True
    return any(
        tags.get(k) not in (None, "")
        and ("MakerNote" in k or k.startswith("MakerNotes:"))
        for k in tags
    )


def _validate_coloros_exif(
    jpeg: bytes,
    tags: dict | None = None,
    *,
    motion_photo: bool = False,
    trailing_length: int | None = None,
) -> dict:
    tag_map = tags or {}
    issues: list[str] = []
    byte_order = _jpeg_seg.read_exif_byte_order(jpeg)
    if byte_order is None:
        issues.append("缺少 EXIF APP1 或无法读取 ExifByteOrder")
    if _tag_value(tag_map, "EXIF:InteropIndex", "InteropIndex", "ExifIFD:InteropIndex") is None:
        issues.append("缺少 InteropIndex（Interop IFD）")
    if _tag_value(
        tag_map,
        "IFD0:YCbCrPositioning",
        "EXIF:YCbCrPositioning",
        "YCbCrPositioning",
    ) is None:
        issues.append("缺少 YCbCrPositioning")
    if not _has_maker_notes_in_tags(tag_map):
        issues.append("缺少 MakerNotes（ColorOS 机型水印可能失败）")
    comment = _tag_value(tag_map, "EXIF:UserComment", "UserComment")
    if comment and not str(comment).lower().startswith("oplus_"):
        issues.append("UserComment 缺少 oplus_ 前缀")
    if _has_mpf_app2(jpeg):
        issues.append("存在 APP2 MPF 段（OPPO 原片通常无 MPF）")
    if motion_photo:
        motion_photo_tag = _tag_value(tag_map, "XMP-GCamera:MotionPhoto", "MotionPhoto")
        op_video_length = _tag_value(tag_map, "XMP-OpCamera:VideoLength", "VideoLength")
        container_dir = _tag_value(tag_map, "XMP-Container:Directory", "Container:Directory")
        micro_video = _tag_value(tag_map, "XMP-GCamera:MicroVideo", "MicroVideo")
        micro_offset = _tag_value(tag_map, "XMP-GCamera:MicroVideoOffset", "MicroVideoOffset")
        xmp_mode = "compat" if micro_video is not None else "native"

        if motion_photo_tag is None:
            issues.append("缺少 GCamera MotionPhoto XMP")
        if op_video_length is None:
            issues.append("缺少 OpCamera VideoLength XMP")
        if (
            trailing_length is not None
            and op_video_length is not None
            and int(op_video_length) != trailing_length
        ):
            issues.append(
                f"OpCamera VideoLength ({op_video_length}) 与 MP4 尾部 ({trailing_length}) 不一致"
            )
        if xmp_mode == "compat":
            if micro_video is None and micro_offset is None:
                issues.append("compat 模式缺少 GCamera MicroVideo / MicroVideoOffset XMP")
            if (
                trailing_length is not None
                and micro_offset is not None
                and int(micro_offset) != trailing_length
            ):
                issues.append(
                    f"MicroVideoOffset ({micro_offset}) 与 MP4 尾部 ({trailing_length}) 不一致"
                )
        elif container_dir is None:
            issues.append("native 模式缺少 Container:Directory XMP")
    return {"ok": not issues, "issues": issues, "exif_byte_order": byte_order}


def _needs_coloros_exif_resync(
    jpeg: bytes,
    tags: dict | None = None,
    *,
    require_maker_notes: bool = False,
) -> bool:
    tag_map = tags or {}
    if _tag_value(tag_map, "EXIF:InteropIndex", "InteropIndex", "ExifIFD:InteropIndex") is None:
        return True
    if _tag_value(
        tag_map,
        "IFD0:YCbCrPositioning",
        "EXIF:YCbCrPositioning",
        "YCbCrPositioning",
    ) is None:
        return True
    return bool(require_maker_notes and not _has_maker_notes_in_tags(tag_map))


def _tags_from_file_copy(
    exiftool: Path,
    dest_jpeg: bytes,
    source: Path,
    *,
    exclude_exif: bool,
    exclude_xmp: bool,
    exclude_iptc: bool,
) -> bytes:
    with tempfile.TemporaryDirectory(prefix="oppo-tff-") as td:
        td_path = Path(td)
        dest = td_path / "dest.jpg"
        out = td_path / "out.jpg"
        dest.write_bytes(dest_jpeg)
        cmd = [
            str(exiftool),
            *_byte_order_api(exiftool, source),
            "-TagsFromFile",
            str(source),
            *_build_tags_from_file_args(
                exclude_exif=exclude_exif,
                exclude_xmp=exclude_xmp,
                exclude_iptc=exclude_iptc,
            ),
            "-o",
            str(out),
            str(dest),
        ]
        _run_exiftool(cmd)
        result = out.read_bytes()
    if not exclude_exif:
        result = _sync_full_exif_from_source(exiftool, result, source)
    return result


def _post_copy_pipeline(
    dest: Path,
    source: Path,
    *,
    exclude_exif: bool,
    exclude_xmp: bool,
    exclude_iptc: bool,
    backend: str,
) -> None:
    """Mirror web exiftoolCopy post-steps: EXIF fallback, ColorOS resync, live.jpg XMP."""
    exiftool = _exiftool_available()
    raw = dest.read_bytes()
    jpeg_part, trailing = _jpeg_seg.split_jpeg_and_appended_tail(raw)
    motion = len(trailing) > 0 and _jpeg_seg.has_likely_appended_mp4(trailing)
    dest_jpeg = jpeg_part if motion else raw
    if not _jpeg_seg.is_jpeg_bytes(dest_jpeg):
        log.info("post-copy skip (not JPEG): backend=%s dest=%s", backend, dest.name)
        return

    working = dest_jpeg
    log.info(
        "post-copy start backend=%s dest=%s motion=%s exclude_xmp=%s",
        backend,
        dest.name,
        motion,
        exclude_xmp,
    )

    if not exclude_exif and exiftool is not None:
        if not _has_exif_app1(working):
            log.info("post-copy EXIF APP1 missing → TagsFromFile fallback")
            working = _tags_from_file_copy(
                exiftool,
                working,
                source,
                exclude_exif=exclude_exif,
                exclude_xmp=exclude_xmp,
                exclude_iptc=exclude_iptc,
            )

        tags = _read_tags_json(exiftool, working)
        if _needs_coloros_exif_resync(working, tags, require_maker_notes=True):
            log.info(
                "post-copy ColorOS EXIF resync byte_order=%s interop=%s",
                _jpeg_seg.read_exif_byte_order(working),
                _tag_value(tags, "EXIF:InteropIndex", "InteropIndex"),
            )
            working = _sync_full_exif_from_source(exiftool, working, source)
            tags = _read_tags_json(exiftool, working)

        source_bytes = source.read_bytes()
        source_tags = _read_tags_json(exiftool, source_bytes)
        if _jpeg_seg.is_jpeg_bytes(source_bytes):
            desired = _infer_copy_exif_byte_order(source_tags, source_bytes)
            current = _jpeg_seg.read_exif_byte_order(working)
            if current is not None and current != desired:
                working = _realign_exif_from_jpeg_source(
                    working,
                    source_bytes,
                    exclude_exif=exclude_exif,
                    exclude_xmp=exclude_xmp,
                    exclude_iptc=exclude_iptc,
                )
                tags = _read_tags_json(exiftool, working)

        working = _supplement_coloros_exif(
            exiftool, working, tags, source_tags, source_bytes
        )
        tags = _read_tags_json(exiftool, working)

    if motion and exiftool is not None:
        with tempfile.TemporaryDirectory(prefix="oppo-xmp-") as td:
            live_jpeg = Path(td) / "live.jpg"
            live_jpeg.write_bytes(working)
            _muxer.rebuild_motionphoto_xmp_in_jpeg(live_jpeg, video_length=len(trailing))
            working = live_jpeg.read_bytes()
        log.info("post-copy rebuilt MotionPhoto XMP video_length=%d", len(trailing))

    out = working + trailing if motion else working
    if out != raw:
        _write_bytes_writable(dest, out)
        log.info("post-copy wrote dest=%s bytes=%d", dest.name, len(out))
    else:
        log.info("post-copy unchanged dest=%s", dest.name)

    if not exclude_exif and exiftool is not None:
        tags = _read_tags_json(exiftool, working)
        validation = _validate_coloros_exif(
            working,
            tags,
            motion_photo=motion,
            trailing_length=len(trailing) if motion else None,
        )
        if not validation["ok"]:
            log.warning("post-copy ColorOS validation issues: %s", "; ".join(validation["issues"]))
        else:
            log.info("post-copy ColorOS validation ok byte_order=%s", validation["exif_byte_order"])


def _sync_full_exif_from_source(exiftool: Path, dest_jpeg: bytes, source: Path) -> bytes:
    with tempfile.TemporaryDirectory(prefix="oppo-resync-") as td:
        td_path = Path(td)
        dest = td_path / "dest.jpg"
        out = td_path / "out.jpg"
        dest.write_bytes(dest_jpeg)
        cmd = [
            str(exiftool),
            *_byte_order_api(exiftool, source),
            "-TagsFromFile",
            str(source),
            *EXIF_RESYNC_GROUPS,
            "-m",
            "-o",
            str(out),
            str(dest),
        ]
        _run_exiftool(cmd)
        return out.read_bytes()


def _read_jpeg_dimensions(jpeg: bytes) -> tuple[int, int] | None:
    i = 2
    n = len(jpeg)
    while i < n - 1:
        if jpeg[i] != 0xff:
            i += 1
            continue
        m = jpeg[i + 1]
        if m in (0xd9, 0xda):
            break
        if m == 0x01 or (0xd0 <= m <= 0xd7):
            i += 2
            continue
        if (
            0xc0 <= m <= 0xc3
            or 0xc5 <= m <= 0xc7
            or 0xc9 <= m <= 0xcb
            or 0xcd <= m <= 0xcf
        ):
            if i + 8 >= n:
                return None
            height = (jpeg[i + 5] << 8) | jpeg[i + 6]
            width = (jpeg[i + 7] << 8) | jpeg[i + 8]
            if width > 0 and height > 0:
                return width, height
            return None
        if i + 3 >= n:
            break
        length = (jpeg[i + 2] << 8) | jpeg[i + 3]
        if length < 2:
            break
        i += 2 + length
    return None


def _plan_coloros_exif_supplement(
    jpeg: bytes,
    dest_tags: dict,
    source_tags: dict | None = None,
    source_bytes: bytes | None = None,
) -> dict[str, object]:
    plan: dict[str, object] = {}
    src = source_tags or {}
    desired = _infer_copy_exif_byte_order(src, source_bytes)
    current = _jpeg_seg.read_exif_byte_order(jpeg)
    if current is not None and current != desired or current is None and desired:
        plan["byte_order"] = desired

    if _tag_value(
        dest_tags,
        "InteropIFD:InteropIndex",
        "EXIF:InteropIndex",
        "InteropIndex",
        "ExifIFD:InteropIndex",
    ) is None:
        src_interop = _tag_value(
            src,
            "InteropIFD:InteropIndex",
            "EXIF:InteropIndex",
            "InteropIndex",
            "ExifIFD:InteropIndex",
        )
        plan["interop_index"] = (
            "R98"
            if src_interop is not None and str(src_interop).startswith("R98")
            else (str(src_interop) if src_interop is not None else "R98")
        )
        src_ver = _tag_value(
            src,
            "InteropIFD:InteropVersion",
            "EXIF:InteropVersion",
            "InteropVersion",
        )
        plan["interop_version"] = str(src_ver) if src_ver is not None else "0100"
    elif _tag_value(dest_tags, "InteropIFD:InteropVersion", "EXIF:InteropVersion", "InteropVersion") is None:
        src_ver = _tag_value(
            src,
            "InteropIFD:InteropVersion",
            "EXIF:InteropVersion",
            "InteropVersion",
        )
        plan["interop_version"] = str(src_ver) if src_ver is not None else "0100"
    if _tag_value(dest_tags, "IFD0:YCbCrPositioning", "EXIF:YCbCrPositioning", "YCbCrPositioning") is None:
        plan["ycbcr_positioning"] = 1
    dims = _read_jpeg_dimensions(jpeg)
    if dims:
        width, height = dims
        exif_w = _tag_value(
            dest_tags,
            "ExifIFD:ExifImageWidth",
            "EXIF:ExifImageWidth",
            "ExifImageWidth",
        )
        exif_h = _tag_value(
            dest_tags,
            "ExifIFD:ExifImageHeight",
            "EXIF:ExifImageHeight",
            "ExifImageHeight",
        )
        try:
            if exif_w is None or int(exif_w) <= 0 or int(exif_w) != width:
                plan["exif_image_width"] = width
            if exif_h is None or int(exif_h) <= 0 or int(exif_h) != height:
                plan["exif_image_height"] = height
        except (TypeError, ValueError):
            plan["exif_image_width"] = width
            plan["exif_image_height"] = height
    return plan


def _supplement_coloros_exif(
    exiftool: Path,
    dest_jpeg: bytes,
    dest_tags: dict | None = None,
    source_tags: dict | None = None,
    source_bytes: bytes | None = None,
) -> bytes:
    tag_map = dest_tags or _read_tags_json(exiftool, dest_jpeg)
    plan = _plan_coloros_exif_supplement(dest_jpeg, tag_map, source_tags, source_bytes)
    if not plan:
        return dest_jpeg
    with tempfile.TemporaryDirectory(prefix="oppo-supp-") as td:
        td_path = Path(td)
        dest = td_path / "dest.jpg"
        dest.write_bytes(dest_jpeg)
        cmd = [str(exiftool), "-m"]
        if "byte_order" in plan:
            cmd.extend(["-api", f"ByteOrder={plan['byte_order']}"])
        if "interop_index" in plan:
            cmd.append(f"-InteropIndex={plan['interop_index']}")
        if "interop_version" in plan:
            cmd.append(f"-InteropVersion={plan['interop_version']}")
        if "ycbcr_positioning" in plan:
            cmd.append(f"-YCbCrPositioning={plan['ycbcr_positioning']}")
        if "exif_image_width" in plan:
            cmd.append(f"-ExifImageWidth={plan['exif_image_width']}")
        if "exif_image_height" in plan:
            cmd.append(f"-ExifImageHeight={plan['exif_image_height']}")
        cmd.extend(["-overwrite_original", str(dest)])
        _run_exiftool(cmd)
        return dest.read_bytes()


def _realign_exif_from_jpeg_source(
    dest_jpeg: bytes,
    source_jpeg: bytes,
    *,
    exclude_exif: bool,
    exclude_xmp: bool,
    exclude_iptc: bool,
) -> bytes:
    segments = _jpeg_seg.extract_metadata_segments(
        source_jpeg,
        exclude_exif=exclude_exif,
        exclude_xmp=exclude_xmp,
        exclude_iptc=exclude_iptc,
    )
    if not segments:
        return dest_jpeg
    working = _jpeg_seg.strip_metadata_for_copy(
        dest_jpeg,
        exclude_exif=exclude_exif,
        exclude_xmp=exclude_xmp,
        exclude_iptc=exclude_iptc,
    )
    return _jpeg_seg.insert_after_app_segments(working, segments)


def _copy_via_segment_transplant(
    source: Path,
    dest: Path,
    *,
    exclude_exif: bool,
    exclude_xmp: bool,
    exclude_iptc: bool,
) -> None:
    exiftool = _exiftool_available()
    if exiftool is None:
        raise GExiv2CopyError("exiftool not found for segment transplant fallback")

    raw = dest.read_bytes()
    jpeg_part, trailing = _jpeg_seg.split_jpeg_and_appended_tail(raw)
    motion = len(trailing) > 0 and _jpeg_seg.has_likely_appended_mp4(trailing)
    dest_jpeg = jpeg_part if motion else raw
    if not _jpeg_seg.is_jpeg_bytes(dest_jpeg):
        raise GExiv2CopyError("Destination must be JPEG for segment transplant fallback")

    source_bytes = source.read_bytes()
    source_jpeg, _ = _jpeg_seg.split_jpeg_and_appended_tail(source_bytes)
    if _jpeg_seg.is_jpeg_bytes(source_jpeg):
        source_bytes = source_jpeg
    if _jpeg_seg.is_jpeg_bytes(source_bytes):
        segments = _jpeg_seg.extract_metadata_segments(
            source_bytes,
            exclude_exif=exclude_exif,
            exclude_xmp=exclude_xmp,
            exclude_iptc=exclude_iptc,
        )
        source_is_jpeg = True
    else:
        canvas = _materialize_metadata_jpeg(
            exiftool,
            source,
            exclude_exif=exclude_exif,
            exclude_xmp=exclude_xmp,
            exclude_iptc=exclude_iptc,
        )
        segments = _jpeg_seg.extract_metadata_segments(
            canvas,
            exclude_exif=exclude_exif,
            exclude_xmp=exclude_xmp,
            exclude_iptc=exclude_iptc,
        )
        source_is_jpeg = False

    if not segments:
        return

    working = _jpeg_seg.strip_metadata_for_copy(
        dest_jpeg,
        exclude_exif=exclude_exif,
        exclude_xmp=exclude_xmp,
        exclude_iptc=exclude_iptc,
    )
    working = _jpeg_seg.insert_after_app_segments(working, segments)

    if not exclude_exif and (
        not source_is_jpeg or _jpeg_seg.read_exif_byte_order(working) == "MM"
    ):
        working = _sync_full_exif_from_source(exiftool, working, source)

    out = working + trailing if motion else working
    _write_bytes_writable(dest, out)

def gexiv2_backend_info() -> dict[str, str | bool | None]:
    """Report which GExiv2 backend is available."""
    binary = find_copy_img_meta()
    if binary is not None:
        return {
            "available": True,
            "backend": "copy-img-meta",
            "path": str(binary),
        }
    if _gexiv2_bindings_available():
        return {
            "available": True,
            "backend": "pygobject-gexiv2",
            "path": None,
        }
    exiftool = _exiftool_available()
    if exiftool is not None:
        return {
            "available": True,
            "backend": "jpeg-segment-transplant",
            "path": str(exiftool),
        }
    return {
        "available": False,
        "backend": None,
        "path": None,
    }


def _gexiv2_bindings_available() -> bool:
    try:
        import gi  # noqa: PLC0415

        for version in ("0.16", "0.14", "0.12", "0.10"):
            try:
                gi.require_version("GExiv2", version)
                break
            except ValueError:
                continue
        else:
            return False
        from gi.repository import GExiv2  # noqa: F401, PLC0415

        return True
    except (ImportError, ValueError):
        return False


def _msys_root_from_ucrt_binary(binary: Path) -> Path | None:
    parts = binary.parts
    for idx, part in enumerate(parts):
        if part.lower() == "ucrt64":
            return Path(*parts[:idx])
    return None


def _win_to_msys(path: Path) -> str:
    resolved = str(path.resolve())
    if len(resolved) >= 2 and resolved[1] == ":":
        return f"/{resolved[0].lower()}/{resolved[2:].replace(chr(92), '/')}"
    return resolved.replace("\\", "/")


def _run_copy_img_meta_binary(
    binary: Path,
    source: Path,
    dest: Path,
    *,
    exclude_exif: bool,
    exclude_xmp: bool,
    exclude_iptc: bool,
) -> None:
    flags: list[str] = []
    if exclude_exif:
        flags.append("--exclude-exif")
    if exclude_xmp:
        flags.append("--exclude-xmp")
    if exclude_iptc:
        flags.append("--exclude-iptc")

    msys_root = _msys_root_from_ucrt_binary(binary) if sys.platform == "win32" else None
    bash = (msys_root / "usr" / "bin" / "bash.exe") if msys_root else None
    if bash is not None and bash.is_file():
        cli_args = flags + [_win_to_msys(source), _win_to_msys(dest)]
        bash_cmd = "copy-img-meta " + " ".join(shlex.quote(a) for a in cli_args)
        env = os.environ.copy()
        env["MSYSTEM"] = "UCRT64"
        cmd = [str(bash), "--login", "-lc", bash_cmd]
    else:
        cmd = [str(binary), *flags, str(source), str(dest)]

    try:
        proc = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            creationflags=_CREATE_NO_WINDOW,
            env=env if bash is not None and bash.is_file() else None,
        )
    except subprocess.CalledProcessError as e:
        detail = (e.stderr or e.stdout or "").strip() or "(no output)"
        raise GExiv2CopyError(f"copy-img-meta failed:\n{detail}") from e
    if proc.stderr.strip():
        # copy-img-meta logs to stderr on success too
        pass


def _copy_via_gexiv2_bindings(
    source: Path,
    dest: Path,
    *,
    exclude_exif: bool,
    exclude_xmp: bool,
    exclude_iptc: bool,
) -> None:
    import gi  # noqa: PLC0415

    for version in ("0.16", "0.14", "0.12", "0.10"):
        try:
            gi.require_version("GExiv2", version)
            break
        except ValueError:
            continue
    else:
        raise GExiv2CopyError("PyGObject GExiv2 bindings not found")

    from gi.repository import GExiv2  # noqa: PLC0415

    metadata = GExiv2.Metadata()
    try:
        metadata.open_path(str(source))
        if exclude_exif:
            metadata.clear_exif()
        if exclude_xmp:
            metadata.clear_xmp()
        if exclude_iptc:
            metadata.clear_iptc()
        metadata.save_file(str(dest))
    except Exception as e:
        raise GExiv2CopyError(str(e)) from e


def copy_img_meta_gexiv2(
    dest_img: str | Path,
    source_img: str | Path,
    *,
    exclude_exif: bool = False,
    exclude_xmp: bool = False,
    exclude_iptc: bool = False,
) -> str:
    """Copy metadata like live-photo-conv ``copy-img-meta`` via GExiv2.

    *dest_img* must already exist (pixels preserved); metadata is written in place.
    Returns the backend identifier actually used for the copy step.
    """
    dest = Path(dest_img)
    source = Path(source_img)
    if not source.is_file():
        raise FileNotFoundError(source)
    if not dest.is_file():
        raise FileNotFoundError(dest)
    if exclude_exif and exclude_xmp and exclude_iptc:
        raise ValueError("At least one metadata group must be copied (EXIF, XMP, or IPTC)")

    raw_before = dest.read_bytes()
    jpeg_part, trailing = _jpeg_seg.split_jpeg_and_appended_tail(raw_before)
    motion = len(trailing) > 0 and _jpeg_seg.has_likely_appended_mp4(trailing)
    if motion:
        _write_bytes_writable(dest, jpeg_part)

    source_raw = source.read_bytes()
    source_jpeg, _ = _jpeg_seg.split_jpeg_and_appended_tail(source_raw)
    source_for_copy = source
    tmp_source: Path | None = None
    if (
        motion
        and _jpeg_seg.is_jpeg_bytes(source_jpeg)
        and len(source_jpeg) != len(source_raw)
    ):
        tmp_source = dest.parent / f".{source.name}.jpeg-only"
        tmp_source.write_bytes(source_jpeg)
        source_for_copy = tmp_source

    binary = find_copy_img_meta()
    if binary is not None:
        backend = "copy-img-meta"
        log.info("copy via %s binary=%s", backend, binary)
        _run_copy_img_meta_binary(
            binary,
            source_for_copy,
            dest,
            exclude_exif=exclude_exif,
            exclude_xmp=exclude_xmp,
            exclude_iptc=exclude_iptc,
        )
    elif _gexiv2_bindings_available():
        backend = "pygobject-gexiv2"
        log.info("copy via %s", backend)
        _copy_via_gexiv2_bindings(
            source_for_copy,
            dest,
            exclude_exif=exclude_exif,
            exclude_xmp=exclude_xmp,
            exclude_iptc=exclude_iptc,
        )
    else:
        backend = "jpeg-segment-transplant"
        log.info("copy via %s (exiftool segment transplant)", backend)
        _copy_via_segment_transplant(
            source_for_copy,
            dest,
            exclude_exif=exclude_exif,
            exclude_xmp=exclude_xmp,
            exclude_iptc=exclude_iptc,
        )

    if motion:
        post = dest.read_bytes()
        post_jpeg, post_trailing = _jpeg_seg.split_jpeg_and_appended_tail(post)
        if len(post_trailing) == 0 and len(trailing) > 0:
            _write_bytes_writable(dest, post_jpeg + trailing)

    if tmp_source is not None:
        try:
            _post_copy_pipeline(
                dest,
                source,
                exclude_exif=exclude_exif,
                exclude_xmp=exclude_xmp,
                exclude_iptc=exclude_iptc,
                backend=backend,
            )
        finally:
            tmp_source.unlink(missing_ok=True)
    else:
        _post_copy_pipeline(
            dest,
            source,
            exclude_exif=exclude_exif,
            exclude_xmp=exclude_xmp,
            exclude_iptc=exclude_iptc,
            backend=backend,
        )
    return backend


def mux_live_photo_gexiv2(
    cover_jpg: str | Path,
    video_path: str | Path,
    output_jpg: str | Path,
    *,
    drop_metadata: bool = False,
) -> None:
    """Mux cover + video like live-photo-conv ``live-photo-make``."""
    cover = Path(cover_jpg)
    video = Path(video_path)
    output = Path(output_jpg)
    if not cover.is_file():
        raise FileNotFoundError(cover)
    if not video.is_file():
        raise FileNotFoundError(video)

    binary = find_live_photo_make()
    if binary is None:
        raise GExiv2CopyError(
            "live-photo-make not found. Build live-photo-conv and add to PATH "
            "or set LIVE_PHOTO_CONV_ROOT."
        )

    name = binary.name.lower()
    cmd: list[str]
    if "live-photo-conv" in name:
        cmd = [
            str(binary),
            "--make",
            "--image",
            str(cover),
            "--video",
            str(video),
            "--live-photo",
            str(output),
        ]
    else:
        cmd = [
            str(binary),
            "-i",
            str(cover),
            "-m",
            str(video),
            "-o",
            str(output),
        ]
    if drop_metadata:
        cmd.append("--drop-metadata")

    try:
        proc = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            creationflags=_CREATE_NO_WINDOW,
        )
    except subprocess.CalledProcessError as e:
        detail = (e.stderr or e.stdout or "").strip() or "(no output)"
        raise GExiv2CopyError(f"live-photo-make failed:\n{detail}") from e
    if proc.stderr.strip():
        pass
