"""Local FastAPI backend — GExiv2 metadata copy / live-photo-conv mux."""
# SPDX-License-Identifier: MIT
from __future__ import annotations

import argparse
import json
import logging
import re
import shutil
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import __version__
from .gexiv2_copy import (
    GExiv2CopyError,
    copy_img_meta_gexiv2,
    gexiv2_backend_info,
    mux_live_photo_gexiv2,
)

log = logging.getLogger(__name__)

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 28471
DEFAULT_CORS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]

app = FastAPI(title="OPPO Live Photo Backend", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=DEFAULT_CORS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "X-Source-Make",
        "X-Source-Model",
        "X-Output-Make",
        "X-Output-Model",
        "X-Output-Exif-Count",
        "X-Source-Field-Count",
        "X-Backend",
        "X-Backend-Used",
    ],
)


def _safe_filename(name: str | None, fallback: str) -> str:
    base = (name or fallback).replace("\\", "/").split("/")[-1].strip()
    base = re.sub(r"[^\w.\- ()[\]]+", "_", base)
    return base or fallback


def _output_meta_name(dest_name: str) -> str:
    path = Path(dest_name)
    stem = path.stem or "output"
    suffix = path.suffix or ".jpg"
    return f"{stem}-meta{suffix}"


def _try_tag_stats(path: Path) -> dict[str, str | int]:
    """Best-effort Make/Model/EXIF count via exiftool when available."""
    exiftool = shutil.which("exiftool")
    if not exiftool:
        return {
            "source_make": "",
            "source_model": "",
            "output_make": "",
            "output_model": "",
            "output_exif_count": 0,
            "source_field_count": 0,
        }
    import subprocess

    try:
        proc = subprocess.run(
            [exiftool, "-j", "-G1", "-n", str(path)],
            check=True,
            capture_output=True,
            text=True,
        )
        records = json.loads(proc.stdout or "[]")
        record = records[0] if records else {}
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        record = {}

    def pick_make_model(tags: dict) -> tuple[str, str]:
        make = (
            tags.get("IFD0:Make")
            or tags.get("EXIF:Make")
            or tags.get("Make")
            or ""
        )
        model = (
            tags.get("IFD0:Model")
            or tags.get("EXIF:Model")
            or tags.get("Model")
            or ""
        )
        return str(make), str(model)

    exif_count = sum(
        1
        for key in record
        if key not in ("SourceFile", "ExifToolVersion")
        and (
            key.startswith("EXIF:")
            or key.startswith("IFD0:")
            or key.startswith("GPS:")
            or key.startswith("Composite:")
        )
    )
    field_count = sum(
        1 for key in record if key not in ("SourceFile", "ExifToolVersion")
    )
    make, model = pick_make_model(record)
    return {
        "source_make": make,
        "source_model": model,
        "output_make": make,
        "output_model": model,
        "output_exif_count": exif_count,
        "source_field_count": field_count,
    }


@app.get("/api/health")
def health() -> dict:
    backend = gexiv2_backend_info()
    return {
        "status": "ok" if backend["available"] else "degraded",
        "version": __version__,
        "gexiv2": backend,
    }


@app.post("/api/copy-metadata")
async def copy_metadata(
    source: Annotated[UploadFile, File(description="Metadata source image")],
    dest: Annotated[UploadFile, File(description="Destination image (pixels preserved)")],
    exclude_exif: Annotated[bool, Form()] = False,
    exclude_xmp: Annotated[bool, Form()] = False,
    exclude_iptc: Annotated[bool, Form()] = False,
) -> Response:
    backend = gexiv2_backend_info()
    if not backend["available"]:
        raise HTTPException(
            status_code=503,
            detail=(
                "GExiv2 后端不可用。请编译 live-photo-conv 并将 copy-img-meta 加入 PATH，"
                "或安装 PyGObject + GExiv2。"
            ),
        )

    source_name = _safe_filename(source.filename, "source.jpg")
    dest_name = _safe_filename(dest.filename, "dest.jpg")

    with tempfile.TemporaryDirectory(prefix="oppo-meta-") as tmp:
        tmp_dir = Path(tmp)
        source_path = tmp_dir / source_name
        dest_path = tmp_dir / dest_name
        source_path.write_bytes(await source.read())
        dest_path.write_bytes(await dest.read())

        source_stats = _try_tag_stats(source_path)

        try:
            backend_used = copy_img_meta_gexiv2(
                dest_path,
                source_path,
                exclude_exif=exclude_exif,
                exclude_xmp=exclude_xmp,
                exclude_iptc=exclude_iptc,
            )
        except (GExiv2CopyError, FileNotFoundError, ValueError) as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        log.info(
            "copy-metadata ok backend=%s source=%s dest=%s exclude_xmp=%s",
            backend_used,
            source_name,
            dest_name,
            exclude_xmp,
        )

        output_stats = _try_tag_stats(dest_path)
        body = dest_path.read_bytes()

    out_name = _output_meta_name(dest_name)
    media_type = dest.content_type or "application/octet-stream"
    return Response(
        content=body,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{out_name}"',
            "X-Backend": str(backend.get("backend") or backend_used),
            "X-Backend-Used": backend_used,
            "X-Source-Make": source_stats.get("source_make", ""),
            "X-Source-Model": source_stats.get("source_model", ""),
            "X-Output-Make": output_stats.get("output_make", ""),
            "X-Output-Model": output_stats.get("output_model", ""),
            "X-Output-Exif-Count": str(output_stats.get("output_exif_count", 0)),
            "X-Source-Field-Count": str(source_stats.get("source_field_count", 0)),
        },
    )


@app.post("/api/mux-live-photo")
async def mux_live_photo(
    image: Annotated[UploadFile, File(description="Cover JPEG")],
    video: Annotated[UploadFile, File(description="Video MP4")],
    drop_metadata: Annotated[bool, Form()] = False,
) -> Response:
    image_name = _safe_filename(image.filename, "cover.jpg")
    video_name = _safe_filename(video.filename, "video.mp4")
    stem = Path(image_name).stem or "live"
    out_name = f"{stem}.live.jpg"

    with tempfile.TemporaryDirectory(prefix="oppo-mux-") as tmp:
        tmp_dir = Path(tmp)
        cover_path = tmp_dir / image_name
        video_path = tmp_dir / video_name
        output_path = tmp_dir / out_name
        cover_path.write_bytes(await image.read())
        video_path.write_bytes(await video.read())

        try:
            mux_live_photo_gexiv2(
                cover_path,
                video_path,
                output_path,
                drop_metadata=drop_metadata,
            )
        except (GExiv2CopyError, FileNotFoundError) as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        body = output_path.read_bytes()

    return Response(
        content=body,
        media_type="image/jpeg",
        headers={"Content-Disposition": f'attachment; filename="{out_name}"'},
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="OPPO Live Photo local backend (GExiv2)")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
