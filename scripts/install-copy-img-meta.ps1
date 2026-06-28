# Install native copy-img-meta via user-local MSYS2 UCRT64 (no admin).
param(
    [string]$Version = "0.40.4-1",
    [string]$MsysRoot = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent

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

function Invoke-MsysBash {
    param(
        [string]$Root,
        [string]$Command
    )
    $env:MSYSTEM = "UCRT64"
    & (Join-Path $Root "usr\bin\bash.exe") --login -lc $Command
    if ($LASTEXITCODE -ne 0) { throw "MSYS command failed ($LASTEXITCODE): $Command" }
}

Write-Host "Installing native copy-img-meta ($Version)..." -ForegroundColor Cyan

$msysRoot = Resolve-Msys2Root -Preferred $MsysRoot
$tmpDir = Join-Path $env:TEMP "copy-img-meta-install"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

if (-not $msysRoot) {
    Write-Host "  Bootstrapping MSYS2 to $env:USERPROFILE\msys64 ..." -ForegroundColor DarkGray
    $baseUrl = "https://repo.msys2.org/distrib/msys2-x86_64-latest.tar.zst"
    $baseArchive = Join-Path $tmpDir "msys2-base.tar.zst"
    if (-not (Test-Path $baseArchive)) {
        Invoke-WebRequest -Uri $baseUrl -OutFile $baseArchive -UseBasicParsing
    }
    $extractTo = $env:USERPROFILE
    tar -xf $baseArchive -C $extractTo
    $msysRoot = Resolve-Msys2Root
    if (-not $msysRoot) { throw "MSYS2 bootstrap failed: bash.exe not found" }
    Write-Host "  MSYS2 root: $msysRoot" -ForegroundColor Green
}

$ucrtBin = Join-Path $msysRoot "ucrt64\bin"
$exe = Join-Path $ucrtBin "copy-img-meta.exe"

Write-Host "  MSYS2 root: $msysRoot" -ForegroundColor DarkGray

if (-not (Test-Path (Join-Path $ucrtBin "libgexiv2-2.dll"))) {
    Write-Host "  Installing gexiv2 dependencies (pacman)..." -ForegroundColor DarkGray
    Invoke-MsysBash -Root $msysRoot -Command "pacman -Sy --noconfirm mingw-w64-ucrt-x86_64-gexiv2"
}

$pkgName = "mingw-w64-ucrt-x86_64-live-photo-conv-$Version-any.pkg.tar.zst"
$pkgUrl = "https://github.com/wszqkzqk/live-photo-conv/releases/download/0.40.4/$pkgName"
$pkgPath = Join-Path $tmpDir $pkgName

if (-not (Test-Path $pkgPath)) {
    Write-Host "  Downloading $pkgName ..." -ForegroundColor DarkGray
    Invoke-WebRequest -Uri $pkgUrl -OutFile $pkgPath -UseBasicParsing
}

Write-Host "  Extracting live-photo-conv binaries..." -ForegroundColor DarkGray
tar -xf $pkgPath -C $tmpDir
$pkgBin = Join-Path $tmpDir "ucrt64\bin"
if (-not (Test-Path $pkgBin)) { throw "Package layout unexpected: $pkgBin not found" }

foreach ($name in @("copy-img-meta.exe", "liblivephototools-0.dll")) {
    $src = Join-Path $pkgBin $name
    if (-not (Test-Path $src)) { throw "$name missing in package" }
    Copy-Item $src (Join-Path $ucrtBin $name) -Force
}

Write-Host "  Verifying..." -ForegroundColor DarkGray
$verOut = & {
    $env:MSYSTEM = "UCRT64"
    & (Join-Path $msysRoot "usr\bin\bash.exe") --login -lc "copy-img-meta --version 2>&1"
}
if ($LASTEXITCODE -ne 0) { throw "copy-img-meta --version failed: $verOut" }

Write-Host ""
Write-Host "Installed: $exe" -ForegroundColor Green
Write-Host $verOut -ForegroundColor DarkGray
Write-Host ""
Write-Host "用法 (Windows 请用 wrapper，不要直接双击 exe):" -ForegroundColor Yellow
Write-Host "  scripts\copy-img-meta.cmd --exclude-xmp source.jpg dest.jpg" -ForegroundColor White
Write-Host ""
Write-Host "当前会话:" -ForegroundColor Yellow
Write-Host "  `$env:COPY_IMG_META = '$exe'" -ForegroundColor White

$env:COPY_IMG_META = $exe
try {
    [Environment]::SetEnvironmentVariable("COPY_IMG_META", $exe, "User")
    Write-Host ""
    Write-Host "User env updated: COPY_IMG_META (new terminals)" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "Could not write user env vars; set COPY_IMG_META manually." -ForegroundColor Yellow
}

Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
