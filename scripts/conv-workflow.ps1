# live-photo-conv equivalent workflow for OPPO Live Photo Maker (desktop).
# Requires: ffmpeg, ffprobe, exiftool (bundled tools/exiftool/exiftool.exe OK)
param(
    [Parameter(Mandatory = $true)][string]$ReferenceImage,
    [Parameter(Mandatory = $true)][string]$Video,
    [string]$Output = "",
    [ValidateSet("full", "clip")][string]$VideoMode = "full"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { throw "python not found on PATH" }

& powershell -ExecutionPolicy Bypass -File "$Root\scripts\check-env.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not (Test-Path $ReferenceImage)) { throw "Reference not found: $ReferenceImage" }
if (-not (Test-Path $Video)) { throw "Video not found: $Video" }
if (-not $Output) {
    $Output = [IO.Path]::ChangeExtension($Video, ".live.jpg")
}

Write-Host ""
Write-Host "OPPO maker — live-photo-conv style pipeline" -ForegroundColor Cyan
Write-Host "  Reference : $ReferenceImage"
Write-Host "  Video     : $Video"
Write-Host "  Output    : $Output"
Write-Host "  VideoMode : $VideoMode (full = append entire MP4)"
Write-Host ""

$args = @(
    "-m", "oppo_live_photo.cli",
    $Video,
    "-o", $Output,
    "--reference-image", $ReferenceImage,
    "--cover-mode", "reference",
    "--video-mode", $VideoMode
)
if ($VideoMode -eq "clip") {
    $args += @("--duration", "3")
}

python @args
exit $LASTEXITCODE
