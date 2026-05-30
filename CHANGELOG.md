# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-31

First public release.

### Added

- **OPPO MotionPhoto muxer** — produces `.live.jpg` files recognized by the
  OPPO Photos app on ColorOS 14+ (verified on Find X7 Ultra). Writes the
  required EXIF (`Oplus_8388608` user comment), XMP fields
  (`GCamera:MotionPhoto`, `OpCamera:MotionPhotoOwner`, `Container:Directory`,
  etc.), and a hand-crafted MPF (Multi-Picture Format) APP2 segment with
  `NumberOfImages=1` / Baseline MP Primary.
- **PySide6 GUI** with two tabs:
  - *Single video*: visual preview, scrub to choose clip start and cover
    frame, configurable advanced parameters (long-edge, CRF, audio bitrate).
  - *Batch*: drag-and-drop or browse to enqueue many videos, runs them
    sequentially with a progress bar, **stop** button, and an end-of-run
    summary that lists failures without per-file modal popups.
- **Command-line interface** (`oppo-live`) with `--start`, `--duration`,
  `--cover-time`, `--long-edge`, `--crf`, `--audio-kbps`, `--preset`,
  `--quiet`, and `--version` flags.
- **Custom exiftool config** declaring the OpCamera / Container XMP
  namespaces.
- **Pre-built Windows EXE** (PyInstaller, single-file) attached to GitHub
  Releases — still requires `ffmpeg` and `exiftool` on `PATH`.

### Engineering

- `pyproject.toml` (hatchling) drives build, dependencies, ruff, pytest, and
  console / GUI script entry points.
- `src/`-layout package `oppo_live_photo`.
- Subprocess wrapper surfaces `ffmpeg` / `exiftool` stderr in errors instead
  of an empty `CalledProcessError`.
- Hides Windows console windows for `subprocess` calls (`CREATE_NO_WINDOW`)
  so the GUI bundle stays flicker-free.
- Single combined `exiftool` invocation for strip + inject, halving process
  startup overhead.
- x264 `preset=fast`, `-shortest`, audio track auto-disabled when the source
  has none, no `-faststart` (useless once muxed into a JPEG).
- Display-Matrix rotation sign correction for ffprobe ≥ 5.
- Hardened JPEG marker scanner: handles `0xFF` padding, RST/TEM markers,
  truncated or oversize segment lengths.
- 13 unit + e2e tests; CI runs `ruff` + `pytest` on Linux / macOS / Windows
  with Python 3.9 / 3.11 / 3.12.
- GitHub Actions release workflow auto-builds the Windows EXE on `v*` tags
  and marks tags containing a hyphen (e.g. `v0.2.0-rc1`) as prereleases.

[Unreleased]: https://github.com/Young-Spark/oppo-live-photo-maker/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Young-Spark/oppo-live-photo-maker/releases/tag/v0.1.0
