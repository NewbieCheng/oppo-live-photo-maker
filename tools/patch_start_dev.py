from pathlib import Path
p = Path(r"f:\Dev\Desktop-Projects\livephoto\oppo-live-photo-maker\scripts\start-dev.ps1")
t = p.read_text(encoding="utf-8")
block = """
$bundledExif = Join-Path $Root \"tools\\exiftool\\exiftool.exe\"
if (-not (Get-Command exiftool -ErrorAction SilentlyContinue) -and (Test-Path $bundledExif)) {
    $env:PATH = \"$(Split-Path $bundledExif -Parent);$env:PATH\"
}

$copyNames = @(\"build\\src\\copy-img-meta.exe\", \"build\\copy-img-meta.exe\")
foreach ($rel in $copyNames) {
    if (-not $env:COPY_IMG_META -and $env:LIVE_PHOTO_CONV_ROOT) {
        $c = Join-Path $env:LIVE_PHOTO_CONV_ROOT $rel
        if (Test-Path $c) { $env:COPY_IMG_META = (Resolve-Path $c).Path; break }
    }
}

"""
if "bundledExif" not in t:
    t = t.replace("if (Test-Path $SiblingConv) {", block + "if (Test-Path $SiblingConv) {")
    p.write_text(t, encoding="utf-8")
    print("patched start-dev")
else:
    print("skip")
