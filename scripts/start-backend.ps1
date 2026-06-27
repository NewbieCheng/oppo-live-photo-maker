# Start Node.js exiv2-wasm metadata backend for web UI (Feature 2).
param(
    [string]$ListenHost = "127.0.0.1",
    [int]$Port = 28471
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$BackendDir = Join-Path $Root "backend"
Set-Location $BackendDir

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) { throw "npm not found on PATH" }

$bundledExif = Join-Path $Root "tools\exiftool\exiftool.exe"
if (-not (Get-Command exiftool -ErrorAction SilentlyContinue) -and (Test-Path $bundledExif)) {
    $env:PATH = "$(Split-Path $bundledExif -Parent);$env:PATH"
}

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing backend dependencies..." -ForegroundColor DarkGray
    npm install
}

Write-Host "OPPO Live Photo - Node backend (exiv2-wasm)" -ForegroundColor Cyan
Write-Host "  URL: http://${ListenHost}:${Port}" -ForegroundColor Green
Write-Host "  Health: http://${ListenHost}:${Port}/api/health" -ForegroundColor DarkGray
Write-Host ""

$env:OPPO_BACKEND_HOST = $ListenHost
$env:OPPO_BACKEND_PORT = "$Port"
npm run dev
