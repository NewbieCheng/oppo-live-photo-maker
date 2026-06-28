# Start Node.js metadata backend (Feature 2/3 local service).
# Optionally wire live-photo-conv tools via -LivePhotoConvRoot or $env:LIVE_PHOTO_CONV_ROOT.
param(
    [string]$ListenHost = "127.0.0.1",
    [int]$Port = 28471,
    [string]$LivePhotoConvRoot = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$BackendDir = Join-Path $Root "backend"
$SiblingConv = Join-Path (Split-Path $Root -Parent) "live-photo-conv"

function Resolve-ConvRoot {
    param([string]$Candidate)
    if (-not $Candidate) { return $null }
    $p = $Candidate.Trim().Trim('"')
    if (-not (Test-Path $p)) {
        throw "live-photo-conv path not found: $p"
    }
    return (Resolve-Path $p).Path
}

function Add-ToolDirToPath {
    param([string]$Dir)
    if (-not $Dir -or -not (Test-Path $Dir)) { return }
    $resolved = (Resolve-Path $Dir).Path
    if ($env:PATH -notlike "*$resolved*") {
        $env:PATH = "$resolved;$env:PATH"
    }
}

function Resolve-Msys2Root {
    foreach ($c in @(
        "$env:USERPROFILE\msys64",
        "$env:USERPROFILE\msys64\msys64",
        "C:\msys64"
    )) {
        if (Test-Path (Join-Path $c "usr\bin\bash.exe")) { return (Resolve-Path $c).Path }
    }
    return $null
}

function Wire-LivePhotoConv {
    param([string]$ConvRoot)

    if ($ConvRoot) {
        $env:LIVE_PHOTO_CONV_ROOT = $ConvRoot
        Write-Host "  LIVE_PHOTO_CONV_ROOT : $ConvRoot" -ForegroundColor DarkGray

        $toolRelPaths = @(
            "build\src\copy-img-meta.exe",
            "build\copy-img-meta.exe",
            "_build\src\copy-img-meta.exe",
            "_build\copy-img-meta.exe",
            "build\src\live-photo-make.exe",
            "build\live-photo-make.exe",
            "build\src\live-photo-conv.exe",
            "build\live-photo-conv.exe"
        )

        foreach ($rel in $toolRelPaths) {
            $full = Join-Path $ConvRoot $rel
            if (-not (Test-Path $full)) { continue }
            Add-ToolDirToPath (Split-Path $full -Parent)
            if ($rel -like "*copy-img-meta.exe" -and -not $env:COPY_IMG_META) {
                $env:COPY_IMG_META = (Resolve-Path $full).Path
            }
        }
    }

    if (-not $env:COPY_IMG_META) {
        $msysRoot = Resolve-Msys2Root
        if ($msysRoot) {
            $msysExe = Join-Path $msysRoot "ucrt64\bin\copy-img-meta.exe"
            if (Test-Path $msysExe) { $env:COPY_IMG_META = (Resolve-Path $msysExe).Path }
        }
    }

    if ($env:COPY_IMG_META) {
        Write-Host "  copy-img-meta         : $($env:COPY_IMG_META)" -ForegroundColor Green
    } else {
        Write-Host "  copy-img-meta         : (未找到；运行 scripts/install-copy-img-meta.ps1)" -ForegroundColor Yellow
    }
}

if ($LivePhotoConvRoot) {
    Wire-LivePhotoConv (Resolve-ConvRoot $LivePhotoConvRoot)
} elseif ($env:LIVE_PHOTO_CONV_ROOT) {
    Wire-LivePhotoConv (Resolve-ConvRoot $env:LIVE_PHOTO_CONV_ROOT)
} elseif (Test-Path $SiblingConv) {
    Wire-LivePhotoConv (Resolve-Path $SiblingConv).Path
} else {
    Wire-LivePhotoConv ""
}

$bundledExif = Join-Path $Root "tools\exiftool\exiftool.exe"
if (-not (Get-Command exiftool -ErrorAction SilentlyContinue) -and (Test-Path $bundledExif)) {
    $env:PATH = "$(Split-Path $bundledExif -Parent);$env:PATH"
}

Set-Location $BackendDir

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) { throw "npm not found on PATH" }

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing backend dependencies..." -ForegroundColor DarkGray
    npm install
}

Write-Host ""
Write-Host "OPPO Live Photo — backend only (Node exiv2-wasm + ExifTool)" -ForegroundColor Cyan
Write-Host "  URL    : http://${ListenHost}:${Port}" -ForegroundColor Green
Write-Host "  Health : http://${ListenHost}:${Port}/api/health" -ForegroundColor DarkGray
Write-Host ""
Write-Host "换源示例:" -ForegroundColor DarkYellow
Write-Host "  powershell -File scripts/start-backend.ps1 -LivePhotoConvRoot 'D:\path\to\live-photo-conv'" -ForegroundColor DarkGray
Write-Host "  `$env:LIVE_PHOTO_CONV_ROOT='D:\path\to\live-photo-conv'; powershell -File scripts/start-backend.ps1" -ForegroundColor DarkGray
Write-Host ""

$env:OPPO_BACKEND_HOST = $ListenHost
$env:OPPO_BACKEND_PORT = "$Port"
npm run dev
