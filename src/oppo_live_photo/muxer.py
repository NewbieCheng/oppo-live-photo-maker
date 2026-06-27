"""OPPO MotionPhoto muxer.

Combines a JPEG cover image and an MP4 video clip into an OPPO-compatible
"Live Photo" (MotionPhoto) JPEG that the OPPO Photos app recognizes.

File layout produced:
    [JPEG (with EXIF + XMP MotionPhoto + MPF segment)]
    [MP4 video bytes appended]

Required external tools:
    - exiftool (in PATH)
"""
# SPDX-License-Identifier: MIT
from __future__ import annotations

import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .metadata import NativeMetadataBundle

EXIFTOOL_CONFIG_NAME = "exiftool_oppo.config"

# Hide subprocess console windows on Windows when launched from a GUI bundle.
_CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


def _repo_tools_exiftool() -> Path | None:
    here = Path(__file__).resolve().parent
    repo_root = here.parent.parent  # src/oppo_live_photo -> repo root
    path = repo_root / "tools" / "exiftool" / "exiftool.exe"
    if path.is_file():
        return path
    return None


def _find_exiftool() -> str:
    exe = shutil.which("exiftool")
    if exe:
        return exe
    bundled = _repo_tools_exiftool()
    if bundled is not None:
        return str(bundled)
    raise RuntimeError(
        "exiftool not found. Run scripts/setup-exiftool.ps1 or install from "
        "https://exiftool.org and add to PATH."
    )


def _config_path() -> str:
    """Locate the bundled exiftool config.

    Search order:
        1. PyInstaller bundle (sys._MEIPASS)
        2. Package data dir (oppo_live_photo/data/)
        3. Repository root next to ``src/`` (legacy/dev layout)
    """
    here = Path(__file__).resolve().parent
    candidates: list[Path] = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidates.append(Path(meipass) / EXIFTOOL_CONFIG_NAME)
        candidates.append(Path(meipass) / "data" / EXIFTOOL_CONFIG_NAME)
    candidates.extend(
        [
            here / "data" / EXIFTOOL_CONFIG_NAME,
            here / EXIFTOOL_CONFIG_NAME,
            here.parent.parent / EXIFTOOL_CONFIG_NAME,  # repo root in src-layout
        ]
    )
    for c in candidates:
        if c.is_file():
            return str(c)
    raise FileNotFoundError(
        f"{EXIFTOOL_CONFIG_NAME} not found. Tried: "
        + ", ".join(str(c) for c in candidates)
    )


def _run(cmd: list[str]) -> None:
    """Run a subprocess, surfacing stderr in any raised error."""
    try:
        subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            creationflags=_CREATE_NO_WINDOW,
        )
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or b"").decode("utf-8", "replace").strip()
        stdout = (e.stdout or b"").decode("utf-8", "replace").strip()
        detail = stderr or stdout or "(no output)"
        raise RuntimeError(
            f"{Path(cmd[0]).name} failed (exit {e.returncode}):\n{detail}"
        ) from e


def _build_mpf_segment(image_size: int) -> bytes:
    """Build a minimal MPF (Multi-Picture Format) APP2 segment.

    Marks the JPEG as a Baseline MP Primary Image with NumberOfImages=1.
    OPPO Photos requires this segment for converted MotionPhoto files.
    """
    # TIFF header big-endian, IFD at offset 8
    tiff = b"MM\x00\x2a\x00\x00\x00\x08"
    # IFD: 3 entries (MPFVersion, NumberOfImages, MPEntry)
    entries = b""
    entries += struct.pack(">HHI", 0xB000, 7, 4) + b"0100"
    entries += struct.pack(">HHI", 0xB001, 4, 1) + struct.pack(">I", 1)
    mpentry_offset = 8 + 2 + 3 * 12 + 4  # right after the IFD
    entries += struct.pack(">HHII", 0xB002, 7, 16, mpentry_offset)
    ifd = struct.pack(">H", 3) + entries + struct.pack(">I", 0)
    # MP entry data (one image, Baseline Primary)
    image_attr = 0x00030000
    mp_entry_data = struct.pack(">IIIHH", image_attr, image_size, 0, 0, 0)
    body = b"MPF\x00" + tiff + ifd + mp_entry_data
    seg_len = len(body) + 2  # length field includes itself
    return b"\xff\xe2" + struct.pack(">H", seg_len) + body


def _find_app_insertion_point(jpeg: bytes) -> int:
    """Find a safe offset to insert an MPF APP2 segment.

    We insert right after the last APPn segment, before any DQT/DHT/SOF/SOS.
    """
    if not jpeg.startswith(b"\xff\xd8"):
        raise ValueError("Not a JPEG: missing SOI marker")
    i = 2
    last_app_end = 2
    n = len(jpeg)
    while i < n - 1:
        # Allow fill bytes 0xFF before a marker (legal padding).
        while i < n and jpeg[i] == 0xFF and i + 1 < n and jpeg[i + 1] == 0xFF:
            i += 1
        if i >= n - 1 or jpeg[i] != 0xFF:
            return last_app_end
        marker = jpeg[i + 1]
        if marker in (0xDA, 0xD9):  # SOS / EOI
            return last_app_end
        # SOF markers (excluding DHT 0xC4, JPG 0xC8, DAC 0xCC)
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            return last_app_end
        if marker in (0xDB, 0xC4):  # DQT / DHT
            return last_app_end
        # Standalone markers without a length field (TEM, RST0..RST7).
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        if i + 4 > n:
            return last_app_end
        seg_len = int.from_bytes(jpeg[i + 2 : i + 4], "big")
        if seg_len < 2 or i + 2 + seg_len > n:
            return last_app_end
        i += 2 + seg_len
        last_app_end = i
    return last_app_end


def write_oppo_motionphoto(
    cover_jpg: str | Path,
    video_mp4: str | Path,
    output_path: str | Path,
    *,
    presentation_timestamp_us: int = 0,
    reference_jpg: str | Path | None = None,
    metadata_overrides: NativeMetadataBundle | None = None,
    cover_mode: str = "video",
) -> Path:
    """Produce an OPPO MotionPhoto JPEG.

    Args:
        cover_jpg: Path to the still cover JPEG.
        video_mp4: Path to the H.264 MP4 clip (AAC audio recommended, <=3s).
        output_path: Where to write the resulting live JPEG.
        presentation_timestamp_us: Microsecond offset of the still frame inside
            the video; OPPO native files use 0, which works fine.

    Returns:
        Path to the written file.
    """
    from .metadata import apply_native_metadata

    cover_jpg = Path(cover_jpg)
    video_mp4 = Path(video_mp4)
    output_path = Path(output_path)

    if not cover_jpg.is_file():
        raise FileNotFoundError(cover_jpg)
    if not video_mp4.is_file():
        raise FileNotFoundError(video_mp4)

    exiftool = _find_exiftool()
    config = _config_path()
    video_size = video_mp4.stat().st_size
    ts = max(0, int(presentation_timestamp_us))

    # Use a private temp dir so concurrent jobs writing to the same output
    # directory cannot clash on a sidecar JPEG.
    with tempfile.TemporaryDirectory(prefix="oppo-live-") as td:
        work_jpg = Path(td) / "work.jpg"
        shutil.copyfile(cover_jpg, work_jpg)

        if reference_jpg is not None or metadata_overrides is not None:
            apply_native_metadata(
                work_jpg,
                reference_jpg,
                metadata_overrides,
                preserve_orientation=(cover_mode == "reference"),
            )

        # Single exiftool invocation: strip-then-inject in one process call.
        _run(
            [
                exiftool, "-config", config, "-overwrite_original",
                # 1. Strip prior XMP/MPF/Trailer to avoid duplicates.
                "-XMP:all=", "-MPF:all=", "-Trailer:all=",
                # 2. Inject EXIF + XMP metadata expected by OPPO Photos.
                "-EXIF:UserComment=Oplus_8388608",
                # XMP - GCamera (Google MotionPhoto core + legacy MicroVideo)
                "-XMP-GCamera:MotionPhoto=1",
                "-XMP-GCamera:MotionPhotoVersion=1",
                f"-XMP-GCamera:MotionPhotoPresentationTimestampUs={ts}",
                "-XMP-GCamera:MicroVideo=1",
                "-XMP-GCamera:MicroVideoVersion=1",
                f"-XMP-GCamera:MicroVideoOffset={video_size}",
                f"-XMP-GCamera:MicroVideoPresentationTimestampUs={ts}",
                # XMP - OpCamera (OPPO private)
                f"-XMP-OpCamera:MotionPhotoPrimaryPresentationTimestampUs={ts}",
                "-XMP-OpCamera:MotionPhotoOwner=oplus",
                "-XMP-OpCamera:OLivePhotoVersion=2",
                f"-XMP-OpCamera:VideoLength={video_size}",
                "-XMP-OpCamera:MotionPhotoFeatureFlag=1",
                # XMP - Container directory: Primary JPEG + MotionPhoto MP4.
                "-XMP-Container:Directory+={Item={Mime=image/jpeg,"
                "Semantic=Primary,Length=0,Padding=0}}",
                f"-XMP-Container:Directory+={{Item={{Mime=video/mp4,"
                f"Semantic=MotionPhoto,Length={video_size},Padding=0}}}}",
                str(work_jpg),
            ]
        )

        photo_bytes = work_jpg.read_bytes()

    # 3. Insert MPF APP2 segment (NumberOfImages=1)
    test_seg = _build_mpf_segment(0)
    final_jpeg_size = len(photo_bytes) + len(test_seg)
    mpf_seg = _build_mpf_segment(final_jpeg_size)
    if len(mpf_seg) != len(test_seg):
        raise RuntimeError("MPF segment size shifted during build")

    ins_pos = _find_app_insertion_point(photo_bytes)
    new_jpeg = photo_bytes[:ins_pos] + mpf_seg + photo_bytes[ins_pos:]

    # 4. Append MP4 and write final file
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as fo:
        fo.write(new_jpeg)
        fo.write(video_mp4.read_bytes())

    # #region agent log
    from .metadata import _agent_debug

    from .metadata import _read_orientation_numeric

    _agent_debug(
        "M3",
        "muxer.py:write_oppo_motionphoto",
        "motion photo written",
        {
            "output": str(output_path),
            "jpegBytes": len(new_jpeg),
            "mp4Bytes": video_size,
            "totalBytes": output_path.stat().st_size,
            "microVideoOffset": video_size,
            "presentationTsUs": ts,
            "hasReference": reference_jpg is not None,
            "orientation": _read_orientation_numeric(output_path),
            "hasMpf": b"MPF\x00" in new_jpeg,
            "hasMotionXmp": b"GCamera:MotionPhoto" in new_jpeg,
        },
    )
    # #endregion

    return output_path


def rebuild_motionphoto_xmp_in_jpeg(
    jpeg_path: str | Path,
    *,
    video_length: int,
    presentation_timestamp_us: int = 0,
) -> Path:
    """Re-write MotionPhoto XMP/MPF on an existing JPEG (keep EXIF/IPTC).

    Used after ``copy_img_meta`` on live.jpg so VideoLength matches appended MP4.
    """
    jpeg_path = Path(jpeg_path)
    if not jpeg_path.is_file():
        raise FileNotFoundError(jpeg_path)

    exiftool = _find_exiftool()
    config = _config_path()
    video_size = max(0, int(video_length))
    ts = max(0, int(presentation_timestamp_us))

    _run(
        [
            exiftool,
            "-config",
            config,
            "-overwrite_original",
            "-XMP:all=",
            "-MPF:all=",
            "-Trailer:all=",
            "-XMP-GCamera:MotionPhoto=1",
            "-XMP-GCamera:MotionPhotoVersion=1",
            f"-XMP-GCamera:MotionPhotoPresentationTimestampUs={-1 if ts == 0 else ts}",
            "-XMP-GCamera:MicroVideo=1",
            "-XMP-GCamera:MicroVideoVersion=1",
            f"-XMP-GCamera:MicroVideoOffset={video_size}",
            f"-XMP-GCamera:MicroVideoPresentationTimestampUs={-1 if ts == 0 else ts}",
            "-XMP-Container:Directory+={Item={Mime=image/jpeg,"
            "Semantic=Primary,Length=0,Padding=0}}",
            f"-XMP-Container:Directory+={{Item={{Mime=video/mp4,"
            f"Semantic=MotionPhoto,Length={video_size},Padding=0}}}}",
            str(jpeg_path),
        ]
    )

    return jpeg_path
