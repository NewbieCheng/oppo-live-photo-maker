#!/usr/bin/env bash
# Verify ffmpeg / ffprobe / exiftool are on PATH (OPPO Live Photo Maker desktop).
set -euo pipefail

required=(ffmpeg ffprobe exiftool)
missing=()

echo "OPPO Live Photo Maker — environment check"
echo

for tool in "${required[@]}"; do
  if command -v "$tool" >/dev/null 2>&1; then
    echo "[OK] $tool -> $(command -v "$tool")"
    case "$tool" in
      ffmpeg) ffmpeg -version 2>/dev/null | head -n1 ;;
      ffprobe) ffprobe -version 2>/dev/null | head -n1 ;;
      exiftool) echo "  version $(exiftool -ver 2>/dev/null)" ;;
    esac
  else
    missing+=("$tool")
    echo "[MISSING] $tool"
  fi
done

echo
if ((${#missing[@]} > 0)); then
  echo "Install missing tools:"
  echo "  ffmpeg   -> https://ffmpeg.org/download.html"
  echo "  exiftool -> https://exiftool.org"
  exit 1
fi

echo "All required desktop tools found."
