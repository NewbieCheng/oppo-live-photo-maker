from pathlib import Path

path = Path(r"f:\Dev\Desktop-Projects\livephoto\oppo-live-photo-maker\src\oppo_live_photo\gexiv2_copy.py")
text = path.read_text(encoding="utf-8")

# Update module docstring
text = text.replace(
    "Does **not** use exiftool ``-TagsFromFile`` (avoids big-endian / MM byte order).",
    "Falls back to JPEG APP segment transplant via bundled exiftool (preserves II byte order).",
)

insert_imports = '''import tempfile

from . import jpeg_segment_copy as _jpeg_seg
from . import muxer as _muxer

'''
if "jpeg_segment_copy" not in text:
    text = text.replace("from pathlib import Path\n\n", "from pathlib import Path\n\n" + insert_imports)

helper = '''

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
        raise GExiv2CopyError(f"exiftool failed:\n{detail}") from e


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
            "-api",
            "ByteOrder=II",
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


def _sync_full_exif_from_source(exiftool: Path, dest_jpeg: bytes, source: Path) -> bytes:
    with tempfile.TemporaryDirectory(prefix="oppo-resync-") as td:
        td_path = Path(td)
        dest = td_path / "dest.jpg"
        out = td_path / "out.jpg"
        dest.write_bytes(dest_jpeg)
        cmd = [
            str(exiftool),
            "-api",
            "ByteOrder=II",
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
    jpeg_part, trailing = _jpeg_seg.split_after_last_jpeg_eoi(raw)
    motion = len(trailing) > 0 and _jpeg_seg.has_likely_appended_mp4(trailing)
    dest_jpeg = jpeg_part if motion else raw
    if not _jpeg_seg.is_jpeg_bytes(dest_jpeg):
        raise GExiv2CopyError("Destination must be JPEG for segment transplant fallback")

    source_bytes = source.read_bytes()
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
    dest.write_bytes(out)

'''

if "_copy_via_segment_transplant" not in text:
    anchor = "def gexiv2_backend_info()"
    text = text.replace(anchor, helper + anchor)

# Update gexiv2_backend_info
old_info = '''    if _gexiv2_bindings_available():
        return {
            "available": True,
            "backend": "pygobject-gexiv2",
            "path": None,
        }
    return {
        "available": False,
        "backend": None,
        "path": None,
    }'''

new_info = '''    if _gexiv2_bindings_available():
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
    }'''

text = text.replace(old_info, new_info)

# Update copy_img_meta_gexiv2 fallback
old_tail = '''    raise GExiv2CopyError(
        "GExiv2 backend unavailable. Build live-photo-conv (copy-img-meta) and add to PATH, "
        "set COPY_IMG_META / LIVE_PHOTO_CONV_ROOT, or install PyGObject + GExiv2."
    )'''

new_tail = '''    _copy_via_segment_transplant(
        source,
        dest,
        exclude_exif=exclude_exif,
        exclude_xmp=exclude_xmp,
        exclude_iptc=exclude_iptc,
    )
    return'''

text = text.replace(old_tail, new_tail)

path.write_text(text, encoding="utf-8")
print("patched", path)
