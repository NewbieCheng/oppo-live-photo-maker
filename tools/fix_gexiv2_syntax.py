from pathlib import Path
p = Path(r"f:\Dev\Desktop-Projects\livephoto\oppo-live-photo-maker\src\oppo_live_photo\gexiv2_copy.py")
lines = p.read_text(encoding="utf-8").splitlines()
out = []
i = 0
while i < len(lines):
    if lines[i].strip().startswith('raise GExiv2CopyError(f"exiftool failed:'):
        detail_line = lines[i + 1] if i + 1 < len(lines) else ""
        if "{detail}" in detail_line:
            out.append('        raise GExiv2CopyError(f"exiftool failed: {detail}") from e')
            i += 2
            continue
    out.append(lines[i])
    i += 1
p.write_text("\n".join(out) + "\n", encoding="utf-8")
print("fixed lines", len(lines), "->", len(out))
