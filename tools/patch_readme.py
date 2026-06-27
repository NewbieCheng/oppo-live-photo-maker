# Patch README: add Windows GExiv2 backend note after start-backend section
from pathlib import Path
readme = Path(r"f:\Dev\Desktop-Projects\livephoto\oppo-live-photo-maker\README.md")
text = readme.read_text(encoding="utf-8")
needle = "python -m oppo_live_photo.server"
insert = """python -m oppo_live_photo.server
```

**Windows GExiv2 backend（无需 MSYS2 即可开发）**：若未安装 `copy-img-meta`，后端会自动使用项目内 `tools/exiftool/exiftool.exe` 做 **JPEG APP 段移植**（与网页 WASM 相同思路，保留 II 字节序）。可选：MSYS2 安装原生工具后优先使用 `copy-img-meta`：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-copy-img-meta.ps1
# 或手动: pacman -S mingw-w64-ucrt-x86_64-live-photo-conv
```

验证：`Invoke-RestMethod http://127.0.0.1:28471/api/health` → `gexiv2.available` 应为 `true`。

```cmd"""
if "jpeg-segment-transplant" not in text and needle in text:
    text = text.replace(
        needle + "\n```",
        insert,
        1,
    )
    readme.write_text(text, encoding="utf-8")
    print("README updated")
else:
    print("README skip", "jpeg-segment-transplant" in text)
