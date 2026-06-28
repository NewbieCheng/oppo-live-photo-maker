# live-photo-conv compatible: copy-img-meta [--exclude-xmp] <source> <dest>
# Uses native copy-img-meta.exe when available; otherwise Python fallback (exiftool/GExiv2).
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Passthrough
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$SiblingConv = Join-Path (Split-Path $Root -Parent) "live-photo-conv"

function Resolve-Msys2Root {
    $candidates = @(
        "$env:USERPROFILE\msys64",
        "$env:USERPROFILE\msys64\msys64",
        "C:\msys64"
    )
    foreach ($c in $candidates) {
        $bash = Join-Path $c "usr\bin\bash.exe"
        if (Test-Path $bash) { return (Resolve-Path $c).Path }
    }
    return $null
}

function ConvertTo-MsysPath {
    param([string]$WinPath)
    $full = (Resolve-Path $WinPath).Path
    if ($full -match '^([A-Za-z]):\\(.*)$') {
        $drive = $Matches[1].ToLower()
        $rest = $Matches[2] -replace '\\', '/'
        return "/$drive/$rest"
    }
    return ($full -replace '\\', '/')
}

function Test-MsysUcrtBinary {
    param([string]$ExePath)
    return ($ExePath -match '\\ucrt64\\bin\\copy-img-meta\.exe$')
}

function Invoke-MsysCopyImgMeta {
    param(
        [string]$MsysRoot,
        [string[]]$CliArgs
    )
    $msysArgs = foreach ($arg in $CliArgs) {
        if ($arg -match '^--') { $arg }
        elseif ((Test-Path -LiteralPath $arg)) { ConvertTo-MsysPath $arg }
        else { $arg }
    }
    $quoted = ($msysArgs | ForEach-Object {
        if ($_ -match '[\s''"]') { "'$($_ -replace "'", "'\\''")'" }
        else { $_ }
    }) -join ' '
    $env:MSYSTEM = "UCRT64"
    & (Join-Path $MsysRoot "usr\bin\bash.exe") --login -lc "copy-img-meta $quoted"
    return $LASTEXITCODE
}

function Find-CopyImgMetaExe {
    if ($env:COPY_IMG_META -and (Test-Path -LiteralPath $env:COPY_IMG_META)) {
        return (Resolve-Path -LiteralPath $env:COPY_IMG_META).Path
    }

    $roots = @()
    if ($env:LIVE_PHOTO_CONV_ROOT) { $roots += $env:LIVE_PHOTO_CONV_ROOT }
    if (Test-Path $SiblingConv) { $roots += (Resolve-Path $SiblingConv).Path }

    $msysRoot = Resolve-Msys2Root
    if ($msysRoot) {
        $msysExe = Join-Path $msysRoot "ucrt64\bin\copy-img-meta.exe"
        if (Test-Path $msysExe) { return (Resolve-Path $msysExe).Path }
    }

    $relPaths = @(
        "build\src\copy-img-meta.exe",
        "build\copy-img-meta.exe",
        "_build\src\copy-img-meta.exe"
    )
    foreach ($root in $roots) {
        foreach ($rel in $relPaths) {
            $full = Join-Path $root $rel
            if (Test-Path $full) { return (Resolve-Path $full).Path }
        }
    }

    $bundled = Join-Path $Root "tools\copy-img-meta\copy-img-meta.exe"
    if (Test-Path $bundled) { return (Resolve-Path $bundled).Path }

    $which = Get-Command copy-img-meta.exe -ErrorAction SilentlyContinue
    if ($which) { return $which.Source }

    return $null
}

if (-not $Passthrough -or $Passthrough.Count -eq 0) {
    Write-Host "Usage: copy-img-meta [--exclude-exif] [--exclude-xmp] [--exclude-iptc] <source> <dest>" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Examples:" -ForegroundColor Cyan
    Write-Host "  copy-img-meta --exclude-xmp vendor.jpg cover.jpg"
    Write-Host "  copy-img-meta --exclude-xmp --exclude-iptc source.heic dest.jpg"
    Write-Host ""
    Write-Host "Native binary search: COPY_IMG_META, LIVE_PHOTO_CONV_ROOT, MSYS2, PATH" -ForegroundColor DarkGray
    exit 1
}

$native = Find-CopyImgMetaExe
if ($native) {
    if (Test-MsysUcrtBinary $native) {
        $msysRoot = Resolve-Msys2Root
        if (-not $msysRoot) {
            Write-Error "MSYS2 UCRT64 required to run $native (install via scripts/install-copy-img-meta.ps1)"
        }
        exit (Invoke-MsysCopyImgMeta -MsysRoot $msysRoot -CliArgs $Passthrough)
    }
    & $native @Passthrough
    exit $LASTEXITCODE
}

$bundledExif = Join-Path $Root "tools\exiftool\exiftool.exe"
if (-not (Get-Command exiftool -ErrorAction SilentlyContinue) -and (Test-Path $bundledExif)) {
    $env:PATH = "$(Split-Path $bundledExif -Parent);$env:PATH"
}

Push-Location $Root
try {
    python -m oppo_live_photo.copy_img_meta_cli @Passthrough
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
