# Optional HEIC full-resolution decode (pillow-heif) for live-photo-conv style cover export.
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

Write-Host "Installing optional HEIC support (pillow-heif)..." -ForegroundColor Cyan
python -m pip install -e ".[heic]"
Write-Host "Done. HEIC reference images will export at full resolution." -ForegroundColor Green
