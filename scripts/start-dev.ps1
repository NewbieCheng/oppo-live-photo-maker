# Start Node backend + Vite frontend together for local development.
param(
    [string]$ListenHost = "127.0.0.1",
    [int]$BackendPort = 28471,
    [int]$FrontendPort = 5173
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$WebDir = Join-Path $Root "web"
$BackendDir = Join-Path $Root "backend"
$BackendUrl = "http://${ListenHost}:${BackendPort}"
$FrontendUrl = "http://localhost:${FrontendPort}"

$script:BackendProc = $null

function Test-TcpPortAvailable {
    param([string]$BindHost, [int]$Port)
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new(
            [System.Net.IPAddress]::Parse($BindHost), $Port)
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($null -ne $listener) {
            try { $listener.Stop() } catch { }
        }
    }
}

function Stop-DevBackend {
    if ($script:BackendProc -and -not $script:BackendProc.HasExited) {
        Write-Host ""
        Write-Host "Stopping backend (PID $($script:BackendProc.Id))..." -ForegroundColor Yellow
        Stop-Process -Id $script:BackendProc.Id -Force -ErrorAction SilentlyContinue
        $script:BackendProc = $null
    }
}

trap {
    Stop-DevBackend
    break
}

Set-Location $Root

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) { throw "npm not found on PATH" }

if (-not (Test-Path (Join-Path $WebDir "package.json"))) {
    throw "web/package.json not found at $WebDir"
}
if (-not (Test-Path (Join-Path $BackendDir "package.json"))) {
    throw "backend/package.json not found at $BackendDir"
}

if (-not (Test-TcpPortAvailable -BindHost $ListenHost -Port $BackendPort)) {
    throw "Backend port $BackendPort is already in use on $ListenHost."
}

$bundledExif = Join-Path $Root "tools\exiftool\exiftool.exe"
if (-not (Get-Command exiftool -ErrorAction SilentlyContinue) -and (Test-Path $bundledExif)) {
    $env:PATH = "$(Split-Path $bundledExif -Parent);$env:PATH"
}

Write-Host ""
Write-Host "OPPO Live Photo — dev (Node backend + frontend)" -ForegroundColor Cyan
Write-Host "  Backend  : $BackendUrl" -ForegroundColor Green
Write-Host "  Frontend : $FrontendUrl" -ForegroundColor Green
Write-Host "  Health   : $BackendUrl/api/health" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Press Ctrl+C to stop both services." -ForegroundColor DarkYellow
Write-Host ""

if (-not (Test-Path (Join-Path $BackendDir "node_modules"))) {
    Write-Host "Installing backend dependencies..." -ForegroundColor DarkGray
    Push-Location $BackendDir
    npm install
    Pop-Location
}

Write-Host "Starting Node backend on port $BackendPort..." -ForegroundColor DarkGray
$env:OPPO_BACKEND_HOST = $ListenHost
$env:OPPO_BACKEND_PORT = "$BackendPort"
$script:BackendProc = Start-Process -FilePath "npm" `
    -ArgumentList @("run", "dev") `
    -WorkingDirectory $BackendDir `
    -PassThru `
    -WindowStyle Hidden

Start-Sleep -Seconds 3

try {
    $health = Invoke-RestMethod -Uri "$BackendUrl/api/health" -TimeoutSec 15 -ErrorAction Stop
    $backendName = $health.gexiv2.backend
    $status = if ($health.gexiv2.available) { "OK ($backendName)" } else { "degraded" }
    Write-Host "Backend ready: $status" -ForegroundColor Green
} catch {
    if ($script:BackendProc.HasExited) {
        Stop-DevBackend
        throw "Backend exited before health check. Run scripts/start-backend.ps1 alone to see errors."
    }
    Write-Host "Backend started; health check pending (exiv2-wasm may still be loading)." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Starting Vite frontend..." -ForegroundColor DarkGray
Write-Host ""

try {
    Push-Location $WebDir
    if (-not (Test-Path "node_modules")) {
        Write-Host "Running npm install (first time)..." -ForegroundColor DarkGray
        npm install
    }
    if (-not (Test-TcpPortAvailable -BindHost "127.0.0.1" -Port $FrontendPort)) {
        Write-Host "Frontend port $FrontendPort is in use; Vite will pick the next free port." -ForegroundColor Yellow
    }
    & npx vite --port $FrontendPort --host
} finally {
    Pop-Location
    Stop-DevBackend
}
