"""OPPO MotionPhoto muxer.

Combines a JPEG cover image and an MP4 video clip into an OPPO-compatible
"Live Photo" (MotionPhoto) JPEG that the OPPO Photos app recognizes.

File layout produced:
    [JPEG (with EXIF + XMP MotionPhoto + MPF segment)]
    [MP4 video bytes appended]

Required external tools:
    - exiftool (in PATH)
"""
from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
from pathlib import Path

EXIFTOOL_CONFIG_NAME = "exiftool_oppo.config"


def _find_exiftool() -> str:
    exe = shutil.which("exiftool")
    if not exe:
        raise RuntimeError(
            "exiftool not found. Install from https://exiftool.org and add to PATH."
        )
    return exe


def _config_path() -> str:
    """Locate the exiftool config bundled next to this module.

    Supports normal source layout AND PyInstaller --onefile (sys._MEIPASS).
    """
    import sys
    here = Path(__file__).resolve().parent
    candidates = [
        here / EXIFTOOL_CONFIG_NAME,
        here.parent / EXIFTOOL_CONFIG_NAME,
    ]
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidates.insert(0, Path(meipass) / EXIFTOOL_CONFIG_NAME)
    for c in candidates:
        if c.is_file():
            return str(c)
    raise FileNotFoundError(
        f"{EXIFTOOL_CONFIG_NAME} not found near {here}"
    )


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
    while i < n - 1 and jpeg[i] == 0xFF:
        marker = jpeg[i + 1]
        if marker in (0xDA, 0xD9):  # SOS / EOI
            return last_app_end
        # SOF markers (excluding DHT 0xC4, JPG 0xC8, DAC 0xCC)
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            return last_app_end
        if marker in (0xDB, 0xC4):  # DQT / DHT
            return last_app_end
        seg_len = int.from_bytes(jpeg[i + 2 : i + 4], "big")
        i += 2 + seg_len
        last_app_end = i
    return last_app_end


def write_oppo_motionphoto(
    cover_jpg: str | Path,
    video_mp4: str | Path,
    output_path: str | Path,
    *,
    presentation_timestamp_us: int = 0,
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

    # Work on a temp copy so the source cover.jpg stays untouched.
    work_jpg = output_path.with_suffix(".work.jpg")
    shutil.copyfile(cover_jpg, work_jpg)

    try:
        # 1. Strip prior XMP/MPF/Trailer to avoid duplicates
        subprocess.run(
            [
                exiftool, "-config", config, "-overwrite_original",
                "-XMP:all=", "-MPF:all=", "-Trailer:all=",
                str(work_jpg),
            ],
            check=True, capture_output=True,
        )

        # 2. Inject EXIF + XMP metadata expected by OPPO Photos
        ts = int(presentation_timestamp_us)
        subprocess.run(
            [
                exiftool, "-config", config, "-overwrite_original",
                # EXIF: OPPO private user comment marker
                "-EXIF:UserComment=Oplus_8388608",
                # XMP - GCamera (Google MotionPhoto core)
                "-XMP-GCamera:MotionPhoto=1",
                "-XMP-GCamera:MotionPhotoVersion=1",
                f"-XMP-GCamera:MotionPhotoPresentationTimestampUs={ts}",
                # XMP - OpCamera (OPPO private)
                f"-XMP-OpCamera:MotionPhotoPrimaryPresentationTimestampUs={ts}",
                "-XMP-OpCamera:MotionPhotoOwner=oplus",
                "-XMP-OpCamera:OLivePhotoVersion=2",
                f"-XMP-OpCamera:VideoLength={video_size}",
                "-XMP-OpCamera:MotionPhotoFeatureFlag=1",
                # XMP - Container directory: Primary JPEG + MotionPhoto MP4
                "-XMP-Container:Directory+={Item={Mime=image/jpeg,"
                "Semantic=Primary,Length=0,Padding=0}}",
                f"-XMP-Container:Directory+={{Item={{Mime=video/mp4,"
                f"Semantic=MotionPhoto,Length={video_size},Padding=0}}}}",
                str(work_jpg),
            ],
            check=True, capture_output=True,
        )

        photo_bytes = work_jpg.read_bytes()
    finally:
        try:
            work_jpg.unlink()
        except FileNotFoundError:
            pass

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

    return output_path
