# Download portable ExifTool into tools/exiftool/ (no admin required).
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$Dest = Join-Path $Root "tools\exiftool"
$Zip = Join-Path $env:TEMP "exiftool-13.59_64.zip"
$Url = "https://sourceforge.net/projects/exiftool/files/exiftool-13.59_64.zip/download"

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$Exe = Join-Path $Dest "exiftool.exe"
if (Test-Path $Exe) {
    Write-Host "ExifTool already present: $Exe" -ForegroundColor Green
    & $Exe -ver
    exit 0
}

Write-Host "Downloading ExifTool ..."
curl.exe -L -o $Zip $Url
Expand-Archive -Path $Zip -DestinationPath $Dest -Force
Remove-Item $Zip -Force

$Nested = Get-ChildItem -Path $Dest -Recurse -Filter "exiftool(-k).exe" | Select-Object -First 1
if (-not $Nested) {
    Write-Error "exiftool(-k).exe not found in archive"
}
$NestedDir = $Nested.Directory.FullName
Copy-Item $Nested.FullName $Exe -Force
$FilesDir = Join-Path $NestedDir "exiftool_files"
if (Test-Path $FilesDir) {
    Copy-Item $FilesDir (Join-Path $Dest "exiftool_files") -Recurse -Force
}
Write-Host "Installed: $Exe" -ForegroundColor Green
& $Exe -ver
