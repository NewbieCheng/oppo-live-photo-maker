# Verify ffmpeg / ffprobe / exiftool are on PATH (OPPO Live Photo Maker desktop).
$ErrorActionPreference = "Continue"
$required = @("ffmpeg", "ffprobe", "exiftool")
$missing = @()

Write-Host "OPPO Live Photo Maker — environment check" -ForegroundColor Cyan
Write-Host ""

$Root = Split-Path $PSScriptRoot -Parent
$BundledExif = Join-Path $Root "tools\exiftool\exiftool.exe"

foreach ($tool in $required) {
    $cmd = Get-Command $tool -ErrorAction SilentlyContinue
    if (-not $cmd -and $tool -eq "exiftool" -and (Test-Path $BundledExif)) {
        $cmd = Get-Item $BundledExif
    }
    if (-not $cmd) {
        $missing += $tool
        Write-Host "[MISSING] $tool" -ForegroundColor Red
        if ($tool -eq "exiftool") {
            Write-Host "  Run: powershell -ExecutionPolicy Bypass -File scripts/setup-exiftool.ps1" -ForegroundColor Yellow
        }
        continue
    }
    Write-Host "[OK] $tool -> $($cmd.Source)" -ForegroundColor Green
    switch ($tool) {
        "ffmpeg" { & ffmpeg -version 2>$null | Select-Object -First 1 }
        "ffprobe" { & ffprobe -version 2>$null | Select-Object -First 1 }
        "exiftool" { Write-Host "  version $( & $cmd.Source -ver 2>$null )" }
    }
}

Write-Host ""
Write-Host "Optional: full-resolution HEIC reference export" -ForegroundColor Cyan
Write-Host "  pip install -e .[heic]   OR   scripts/setup-heic.ps1"
Write-Host ""
Write-Host "Conv-style workflow (reference + full video append):" -ForegroundColor Cyan
Write-Host "  scripts/conv-workflow.ps1 -ReferenceImage ref.heic -Video clip.mp4"
Write-Host ""
if ($missing.Count -gt 0) {
    Write-Host "Install missing tools:" -ForegroundColor Yellow
    Write-Host "  ffmpeg  -> https://ffmpeg.org/download.html"
    Write-Host "  exiftool -> https://exiftool.org (rename exiftool(-k).exe to exiftool.exe)"
    exit 1
}

Write-Host "All required desktop tools found." -ForegroundColor Green
exit 0
