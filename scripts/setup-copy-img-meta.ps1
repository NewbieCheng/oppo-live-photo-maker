# Optional: install copy-img-meta via MSYS2 (Windows, user-local or C:\msys64).
param(
    [string]$MsysRoot = "$env:USERPROFILE\msys64"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$SiblingConv = Join-Path (Split-Path $Root -Parent) "live-photo-conv"

function Find-MsysPacman {
    param([string]$RootPath)
    $candidates = @(
        (Join-Path $RootPath "ucrt64\bin\pacman.exe"),
        (Join-Path $RootPath "usr\bin\pacman.exe"),
        "C:\msys64\ucrt64\bin\pacman.exe",
        "C:\msys64\usr\bin\pacman.exe"
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

Write-Host "OPPO Live Photo - setup copy-img-meta (MSYS2)" -ForegroundColor Cyan
Write-Host ""

$pacman = Find-MsysPacman -RootPath $MsysRoot
if (-not $pacman) {
    Write-Host "MSYS2 not found at $MsysRoot or C:\msys64." -ForegroundColor Yellow
    Write-Host "Install: https://www.msys2.org/ (or: choco install msys2 -y as Administrator)" -ForegroundColor Yellow
    Write-Host "Then re-run this script." -ForegroundColor Yellow
    exit 1
}

Write-Host "Using pacman: $pacman" -ForegroundColor Green
& $pacman -Sy --noconfirm mingw-w64-ucrt-x86_64-live-photo-conv
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$copyMeta = Join-Path (Split-Path (Split-Path $pacman -Parent) -Parent) "bin\copy-img-meta.exe"
if (-not (Test-Path $copyMeta)) {
    $copyMeta = Get-ChildItem (Split-Path $pacman -Parent) -Filter "copy-img-meta.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}

if ($copyMeta) {
    Write-Host ""
    Write-Host "Installed: $copyMeta" -ForegroundColor Green
    Write-Host "Set for this session:" -ForegroundColor DarkGray
    Write-Host "  `$env:COPY_IMG_META = '$copyMeta'" -ForegroundColor White
    if (Test-Path $SiblingConv) {
        Write-Host "  `$env:LIVE_PHOTO_CONV_ROOT = '$SiblingConv'" -ForegroundColor White
    }
} else {
    Write-Host "Package installed but copy-img-meta.exe not found; check MSYS2 ucrt64 bin." -ForegroundColor Yellow
    exit 1
}
