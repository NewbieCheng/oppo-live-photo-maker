"""JPEG APP segment transplant (GExiv2 / copy-img-meta semantics on Windows)."""
# SPDX-License-Identifier: MIT
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class JpegSegment:
    marker: int
    payload: bytes
    start: int
    end: int


def scan_jpeg_segments(jpeg: bytes) -> list[JpegSegment]:
    if len(jpeg) < 2 or jpeg[0] != 0xFF or jpeg[1] != 0xD8:
        raise ValueError("Not a JPEG: missing SOI marker")
    segments: list[JpegSegment] = []
    i = 2
    n = len(jpeg)
    while i < n - 1:
        while i < n and jpeg[i] == 0xFF and i + 1 < n and jpeg[i + 1] == 0xFF:
            i += 1
        if i >= n - 1 or jpeg[i] != 0xFF:
            break
        marker = jpeg[i + 1]
        start = i
        if marker in (0xDA, 0xD9):
            segments.append(JpegSegment(marker, jpeg[i:], start, n))
            break
        if marker == 0x01 or (0xD0 <= marker <= 0xD7):
            segments.append(JpegSegment(marker, bytes([0xFF, marker]), start, i + 2))
            i += 2
            continue
        if i + 4 > n:
            break
        seg_len = (jpeg[i + 2] << 8) | jpeg[i + 3]
        if seg_len < 2 or i + 2 + seg_len > n:
            break
        end = i + 2 + seg_len
        segments.append(JpegSegment(marker, jpeg[i:end], start, end))
        i = end
    return segments


def is_exif_app1(seg: JpegSegment) -> bool:
    if seg.marker != 0xE1 or len(seg.payload) < 6:
        return False
    return seg.payload[4:10].startswith(b"Exif")


def _is_iptc_app13(seg: JpegSegment) -> bool:
    if seg.marker != 0xED or len(seg.payload) < 16:
        return False
    return seg.payload[4:18].startswith(b"Photoshop 3.0")


def _is_xmp_app1(seg: JpegSegment) -> bool:
    if seg.marker != 0xE1 or len(seg.payload) < 30:
        return False
    return b"http://ns.adobe.com/xap/1.0/" in seg.payload


def _is_mpf_app2(seg: JpegSegment) -> bool:
    if seg.marker != 0xE2 or len(seg.payload) < 8:
        return False
    return seg.payload[4:8] == b"MPF\x00"


def should_replace_segment(
    seg: JpegSegment,
    *,
    exclude_exif: bool,
    exclude_xmp: bool,
    exclude_iptc: bool,
) -> bool:
    if is_exif_app1(seg) or _is_mpf_app2(seg):
        return not exclude_exif
    if _is_iptc_app13(seg):
        return not exclude_iptc
    if _is_xmp_app1(seg):
        return not exclude_xmp
    return False


def extract_metadata_segments(
    reference_jpeg: bytes,
    *,
    exclude_exif: bool = False,
    exclude_xmp: bool = False,
    exclude_iptc: bool = False,
) -> list[bytes]:
    out: list[bytes] = []
    for seg in scan_jpeg_segments(reference_jpeg):
        if should_replace_segment(
            seg,
            exclude_exif=exclude_exif,
            exclude_xmp=exclude_xmp,
            exclude_iptc=exclude_iptc,
        ):
            out.append(seg.payload)
    return out


def strip_metadata_for_copy(
    jpeg: bytes,
    *,
    exclude_exif: bool = False,
    exclude_xmp: bool = False,
    exclude_iptc: bool = False,
) -> bytes:
    if jpeg[0] != 0xFF or jpeg[1] != 0xD8:
        raise ValueError("Not a JPEG: missing SOI marker")
    out = bytearray([0xFF, 0xD8])
    for seg in scan_jpeg_segments(jpeg):
        if seg.marker in (0xDA, 0xD9):
            out.extend(jpeg[seg.start :])
            return bytes(out)
        if should_replace_segment(
            seg,
            exclude_exif=exclude_exif,
            exclude_xmp=exclude_xmp,
            exclude_iptc=exclude_iptc,
        ):
            continue
        out.extend(jpeg[seg.start : seg.end])
    return jpeg


def insert_after_app_segments(jpeg: bytes, insert: list[bytes]) -> bytes:
    segments = scan_jpeg_segments(jpeg)
    insert_at = 2
    for seg in segments:
        if 0xE0 <= seg.marker <= 0xEF:
            insert_at = seg.end
        else:
            break
    parts = [jpeg[:insert_at], *insert, jpeg[insert_at:]]
    return b"".join(parts)


def read_exif_byte_order(jpeg: bytes) -> str | None:
    for seg in scan_jpeg_segments(jpeg):
        if not is_exif_app1(seg):
            continue
        payload = seg.payload
        if len(payload) < 12:
            return None
        if payload[10:12] == b"II":
            return "II"
        if payload[10:12] == b"MM":
            return "MM"
        return None
    return None


def minimal_jpeg() -> bytes:
    def seg(marker: int, payload: bytes) -> bytes:
        seg_len = len(payload) + 2
        return bytes([0xFF, marker]) + seg_len.to_bytes(2, "big") + payload

    app0 = seg(0xE0, b"JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00")
    dqt = seg(0xDB, bytes([16] * 64))
    return b"\xff\xd8" + app0 + dqt + b"\xff\xd9"


def _has_mp4_ftyp_near(data: bytes, offset: int) -> bool:
    scan_end = min(offset + 64, len(data) - 4)
    return any(data[i:i + 4] == b"ftyp" for i in range(offset, scan_end + 1))


def split_after_last_jpeg_eoi(data: bytes) -> tuple[bytes, bytes]:
    for i in range(len(data) - 2, -1, -1):
        if data[i] == 0xFF and data[i + 1] == 0xD9:
            return data[: i + 2], data[i + 2 :]
    return data, b""


def split_jpeg_and_appended_tail(data: bytes) -> tuple[bytes, bytes]:
    """Split JPEG from appended MP4 (Motion Photo / live.jpg).

    OPPO originals append MP4 right after the first real EOI. The MP4 bitstream
    often contains false 0xFFD9 markers, so the last EOI in the file is wrong.
    """
    i = 2
    n = len(data)
    while i < n - 1:
        if data[i] == 0xFF and data[i + 1] == 0xD9:
            after_eoi = i + 2
            if after_eoi < n and _has_mp4_ftyp_near(data, after_eoi):
                return data[:after_eoi], data[after_eoi:]
        i += 1
    return split_after_last_jpeg_eoi(data)


def has_likely_appended_mp4(trailing: bytes) -> bool:
    if len(trailing) < 8:
        return False
    scan = trailing[: min(64, len(trailing))]
    for i in range(len(scan) - 3):
        if scan[i : i + 4] == b"ftyp":
            return True
    return len(trailing) > 4096


def is_jpeg_bytes(data: bytes) -> bool:
    return len(data) >= 2 and data[0] == 0xFF and data[1] == 0xD8
