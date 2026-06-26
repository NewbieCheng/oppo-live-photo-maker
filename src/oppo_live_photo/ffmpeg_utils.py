"""ffmpeg / ffprobe wrappers for cover-frame extraction and clip transcoding."""
# SPDX-License-Identifier: MIT
from __future__ import annotations

import contextlib
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

# Hide subprocess console windows on Windows when launched from a GUI bundle.
_CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


def _find(tool: str) -> str:
    exe = shutil.which(tool)
    if not exe:
        raise RuntimeError(
            f"{tool} not found. Install ffmpeg (includes ffprobe) and add to PATH."
        )
    return exe


def _run(cmd: list[str], *, text: bool = False) -> subprocess.CompletedProcess:
    """Run a subprocess, surfacing stderr in any raised error."""
    try:
        return subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=text,
            encoding="utf-8" if text else None,
            creationflags=_CREATE_NO_WINDOW,
        )
    except subprocess.CalledProcessError as e:
        err = e.stderr if text else (e.stderr or b"").decode("utf-8", "replace")
        out = e.stdout if text else (e.stdout or b"").decode("utf-8", "replace")
        detail = (err or out or "").strip() or "(no output)"
        raise RuntimeError(
            f"{Path(cmd[0]).name} failed (exit {e.returncode}):\n{detail}"
        ) from e


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
    out = _run(
        [
            ffprobe, "-v", "error", "-print_format", "json",
            "-show_format", "-show_streams",
            str(video),
        ],
        text=True,
    ).stdout
    data = json.loads(out)
    streams = data.get("streams", [])
    vstream = next((s for s in streams if s.get("codec_type") == "video"), None)
    has_audio = any(s.get("codec_type") == "audio" for s in streams)
    if not vstream:
        raise RuntimeError("No video stream found")

    duration = float(
        data.get("format", {}).get("duration") or vstream.get("duration") or 0.0
    )
    width = int(vstream["width"])
    height = int(vstream["height"])

    rotation = 0
    # Old-style tag (ffmpeg < 5).
    tags = vstream.get("tags") or {}
    if "rotate" in tags:
        with contextlib.suppress(ValueError):
            rotation = int(tags["rotate"]) % 360
    # New-style side data: Display Matrix. ffprobe reports the angle the
    # decoder must apply to "undo" the matrix, which is the negative of the
    # capture-time rotation. Negate so we end up with the visual rotation.
    for sd in vstream.get("side_data_list", []) or []:
        if sd.get("side_data_type") == "Display Matrix":
            try:
                rot = float(sd.get("rotation", 0))
                rotation = int(round(-rot)) % 360
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
    _run(
        [
            ffmpeg, "-y",
            "-ss", f"{max(0.0, timestamp):.3f}",
            "-i", str(video),
            "-frames:v", "1",
            "-vf", scale,
            "-q:v", str(quality),
            str(out),
        ]
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
    has_audio: bool | None = None,
    preset: str = "fast",
) -> Path:
    """Transcode a [start, start+duration] segment to H.264 MP4 suitable as
    the OPPO MotionPhoto video chunk.

    Args:
        has_audio: If False, drop the audio track entirely. If None, probe the
            source first.
        preset: x264 preset; "fast" is a good speed/quality trade-off for the
            short clips used in MotionPhoto.
    """
    ffmpeg = _find("ffmpeg")
    out = Path(out_mp4)
    out.parent.mkdir(parents=True, exist_ok=True)

    if has_audio is None:
        try:
            has_audio = probe(video).has_audio
        except Exception:
            has_audio = True  # assume yes; ffmpeg will silently drop if absent

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
        "-preset", preset,
        "-crf", str(crf),
    ]
    if has_audio:
        cmd += ["-c:a", "aac", "-b:a", f"{audio_bitrate_k}k"]
    else:
        cmd += ["-an"]
    # Cut both streams to the requested duration so an overlong audio track
    # cannot extend the clip.
    cmd += ["-shortest"]
    if maxrate_k:
        cmd += ["-maxrate", f"{maxrate_k}k", "-bufsize", f"{maxrate_k * 2}k"]
    cmd.append(str(out))
    _run(cmd)
    return out


def check_dependencies() -> list[str]:
    """Return a list of missing dependency names."""
    return [tool for tool in ("ffmpeg", "ffprobe", "exiftool") if not shutil.which(tool)]
