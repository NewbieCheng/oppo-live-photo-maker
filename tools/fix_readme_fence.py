from pathlib import Path
readme = Path(r"f:\Dev\Desktop-Projects\livephoto\oppo-live-photo-maker\README.md")
text = readme.read_text(encoding="utf-8")
broken = "验证：`Invoke-RestMethod http://127.0.0.1:28471/api/health` → `gexiv2.available` 应为 `true`。\n\n```cmd\n\n前端"
fixed = "验证：`Invoke-RestMethod http://127.0.0.1:28471/api/health` → `gexiv2.available` 应为 `true`。\n\n前端"
if broken in text:
    text = text.replace(broken, fixed)
    readme.write_text(text, encoding="utf-8")
    print("fixed readme fence")
else:
    print("pattern not found, trying ascii")
