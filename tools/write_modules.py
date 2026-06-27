from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src" / "oppo_live_photo"

(ROOT / "jpeg_segment_copy.py").write_text(
    (Path(__file__).parent / "jpeg_segment_copy.py.txt").read_text(encoding="utf-8"),
    encoding="utf-8",
)
print("ok")
