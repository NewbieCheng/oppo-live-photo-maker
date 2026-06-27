"""Tests for GExiv2 backend API."""
# SPDX-License-Identifier: MIT
from __future__ import annotations

import io
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from oppo_live_photo.server import app


def _write_minimal_jpeg(path: Path) -> None:
    def seg(marker: int, payload: bytes) -> bytes:
        seg_len = len(payload) + 2
        return bytes([0xFF, marker]) + seg_len.to_bytes(2, "big") + payload

    app0 = seg(0xE0, b"JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00")
    dqt = seg(0xDB, bytes([16] * 64))
    path.write_bytes(b"\xff\xd8" + app0 + dqt + b"\xff\xd9")


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_health_endpoint(client: TestClient) -> None:
    with patch(
        "oppo_live_photo.server.gexiv2_backend_info",
        return_value={"available": True, "backend": "copy-img-meta", "path": "/bin/copy-img-meta"},
    ):
        res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["gexiv2"]["available"] is True


def test_copy_metadata_requires_gexiv2(client: TestClient) -> None:
    with patch(
        "oppo_live_photo.server.gexiv2_backend_info",
        return_value={"available": False, "backend": None, "path": None},
    ):
        res = client.post(
            "/api/copy-metadata",
            files={
                "source": ("src.jpg", io.BytesIO(b"jpeg"), "image/jpeg"),
                "dest": ("dest.jpg", io.BytesIO(b"jpeg"), "image/jpeg"),
            },
            data={"exclude_xmp": "true"},
        )
    assert res.status_code == 503


def test_copy_metadata_success(client: TestClient, tmp_path: Path) -> None:
    source = tmp_path / "src.jpg"
    dest = tmp_path / "dest.jpg"
    _write_minimal_jpeg(source)
    _write_minimal_jpeg(dest)

    def fake_copy(dest_img, source_img, **kwargs):
        assert kwargs["exclude_xmp"] is True
        dest_path = Path(dest_img)
        dest_path.write_bytes(source.read_bytes())
        return "copy-img-meta"

    with patch(
        "oppo_live_photo.server.gexiv2_backend_info",
        return_value={"available": True, "backend": "copy-img-meta", "path": "/bin/copy-img-meta"},
    ), patch("oppo_live_photo.server.copy_img_meta_gexiv2", side_effect=fake_copy):
        res = client.post(
            "/api/copy-metadata",
            files={
                "source": ("src.jpg", source.read_bytes(), "image/jpeg"),
                "dest": ("dest.jpg", dest.read_bytes(), "image/jpeg"),
            },
            data={"exclude_xmp": "true"},
        )

    assert res.status_code == 200
    assert res.headers.get("content-disposition", "").endswith('dest-meta.jpg"')
    assert res.headers.get("X-Backend-Used") == "copy-img-meta"
    assert res.content.startswith(b"\xff\xd8")


def test_gexiv2_backend_info_structure() -> None:
    from oppo_live_photo.gexiv2_copy import gexiv2_backend_info

    info = gexiv2_backend_info()
    assert "available" in info
    assert "backend" in info
