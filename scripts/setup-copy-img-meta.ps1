# Optional: install copy-img-meta via MSYS2 (Windows, user-local or C:\msys64).
param(
    [string]$MsysRoot = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$SiblingConv = Join-Path (Split-Path $Root -Parent) "live-photo-conv"

function Resolve-Msys2Root {
    param([string]$Preferred = "")
    if ($Preferred -and (Test-Path (Join-Path $Preferred "usr\bin\bash.exe"))) {
        return (Resolve-Path $Preferred).Path
    }
    foreach ($c in @(
        "$env:USERPROFILE\msys64",
        "$env:USERPROFILE\msys64\msys64",
        "C:\msys64"
    )) {
        if (Test-Path (Join-Path $c "usr\bin\bash.exe")) { return (Resolve-Path $c).Path }
    }
    return $null
}

function Find-MsysPacman {
    param([string]$RootPath)
    $candidates = @(
        (Join-Path $RootPath "ucrt64\bin\pacman.exe"),
        (Join-Path $RootPath "usr\bin\pacman.exe")
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

Write-Host "OPPO Live Photo - setup copy-img-meta (MSYS2)" -ForegroundColor Cyan
Write-Host ""

$resolvedRoot = Resolve-Msys2Root -Preferred $MsysRoot
if (-not $resolvedRoot) {
    Write-Host "MSYS2 not found. Run scripts/install-copy-img-meta.ps1 first." -ForegroundColor Yellow
    Write-Host "Or install: https://www.msys2.org/" -ForegroundColor Yellow
    exit 1
}

$pacman = Find-MsysPacman -RootPath $resolvedRoot
if (-not $pacman) {
    Write-Host "pacman not found under $resolvedRoot" -ForegroundColor Yellow
    exit 1
}

Write-Host "Using pacman: $pacman" -ForegroundColor Green
& $pacman -Sy --noconfirm mingw-w64-ucrt-x86_64-live-photo-conv
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$copyMeta = Join-Path $resolvedRoot "ucrt64\bin\copy-img-meta.exe"
if (-not (Test-Path $copyMeta)) {
    $copyMeta = Get-ChildItem $resolvedRoot -Filter "copy-img-meta.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
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
