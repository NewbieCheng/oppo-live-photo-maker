"""ffmpeg / ffprobe wrappers for cover-frame extraction and clip transcoding."""
from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


def _find(tool: str) -> str:
    exe = shutil.which(tool)
    if not exe:
        raise RuntimeError(
            f"{tool} not found. Install ffmpeg (includes ffprobe) and add to PATH."
        )
    return exe


@dataclass
class VideoInfo:
    duration: float       # seconds
    width: int
    height: int
    rotation: int         # degrees, 0/90/180/270
    has_audio: bool

    @property
    def display_width(self) -> int:
        return self.height if self.rotation in (90, 270) else self.width

    @property
    def display_height(self) -> int:
        return self.width if self.rotation in (90, 270) else self.height


def probe(video: str | Path) -> VideoInfo:
    """Return basic info about a video file."""
    ffprobe = _find("ffprobe")
    out = subprocess.run(
        [
            ffprobe, "-v", "error", "-print_format", "json",
            "-show_format", "-show_streams",
            str(video),
        ],
        check=True, capture_output=True, text=True, encoding="utf-8",
    ).stdout
    data = json.loads(out)
    streams = data.get("streams", [])
    vstream = next((s for s in streams if s.get("codec_type") == "video"), None)
    has_audio = any(s.get("codec_type") == "audio" for s in streams)
    if not vstream:
        raise RuntimeError("No video stream found")

    duration = float(data.get("format", {}).get("duration") or vstream.get("duration") or 0.0)
    width = int(vstream["width"])
    height = int(vstream["height"])

    rotation = 0
    # Old-style tag
    tags = vstream.get("tags") or {}
    if "rotate" in tags:
        try:
            rotation = int(tags["rotate"]) % 360
        except ValueError:
            pass
    # New-style side data: Display Matrix
    for sd in vstream.get("side_data_list", []) or []:
        if sd.get("side_data_type") == "Display Matrix":
            try:
                # ffprobe reports rotation; sign convention is opposite for some
                # versions. Normalize to positive degrees.
                rotation = int(round(float(sd.get("rotation", 0)))) % 360
            except (TypeError, ValueError):
                pass

    return VideoInfo(
        duration=duration,
        width=width,
        height=height,
        rotation=rotation,
        has_audio=has_audio,
    )


def extract_cover(
    video: str | Path,
    out_jpg: str | Path,
    *,
    timestamp: float = 0.0,
    target_long_edge: int = 1920,
    quality: int = 2,
) -> Path:
    """Extract a single still frame as JPEG.

    Args:
        timestamp: Seconds into the video.
        target_long_edge: Resize so the longer side equals this value.
        quality: ffmpeg -q:v (2..5 typical, lower is better).
    """
    ffmpeg = _find("ffmpeg")
    out = Path(out_jpg)
    out.parent.mkdir(parents=True, exist_ok=True)
    # scale filter: keep aspect, longer side = target_long_edge.
    scale = (
        f"scale='if(gt(iw,ih),{target_long_edge},-2)':'"
        f"if(gt(iw,ih),-2,{target_long_edge})'"
    )
    subprocess.run(
        [
            ffmpeg, "-y",
            "-ss", f"{max(0.0, timestamp):.3f}",
            "-i", str(video),
            "-frames:v", "1",
            "-vf", scale,
            "-q:v", str(quality),
            str(out),
        ],
        check=True, capture_output=True,
    )
    return out


def transcode_clip(
    video: str | Path,
    out_mp4: str | Path,
    *,
    start: float = 0.0,
    duration: float = 3.0,
    target_long_edge: int = 1920,
    crf: int = 23,
    audio_bitrate_k: int = 128,
    maxrate_k: int | None = None,
) -> Path:
    """Transcode a [start, start+duration] segment to H.264 MP4 suitable as
    the OPPO MotionPhoto video chunk."""
    ffmpeg = _find("ffmpeg")
    out = Path(out_mp4)
    out.parent.mkdir(parents=True, exist_ok=True)
    scale = (
        f"scale='if(gt(iw,ih),{target_long_edge},-2)':'"
        f"if(gt(iw,ih),-2,{target_long_edge})',format=yuv420p"
    )
    cmd = [
        ffmpeg, "-y",
        "-ss", f"{max(0.0, start):.3f}",
        "-i", str(video),
        "-t", f"{max(0.1, duration):.3f}",
        "-vf", scale,
        "-c:v", "libx264",
        "-profile:v", "high",
        "-pix_fmt", "yuv420p",
        "-preset", "medium",
        "-crf", str(crf),
        "-c:a", "aac",
        "-b:a", f"{audio_bitrate_k}k",
        "-movflags", "+faststart",
    ]
    if maxrate_k:
        cmd += ["-maxrate", f"{maxrate_k}k", "-bufsize", f"{maxrate_k * 2}k"]
    cmd.append(str(out))
    subprocess.run(cmd, check=True, capture_output=True)
    return out


def check_dependencies() -> list[str]:
    """Return a list of missing dependency names."""
    missing = []
    for tool in ("ffmpeg", "ffprobe", "exiftool"):
        if not shutil.which(tool):
            missing.append(tool)
    return missing
