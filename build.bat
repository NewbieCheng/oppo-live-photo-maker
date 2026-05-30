@echo off
REM Build a single-file Windows EXE with PyInstaller.
REM Output: dist\OppoLivePhotoMaker.exe (~40-60 MB)
cd /d "%~dp0"

python -m pip install --quiet pyinstaller PySide6 || goto :err

REM Clean previous build
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
if exist OppoLivePhotoMaker.spec del /q OppoLivePhotoMaker.spec

python -m PyInstaller ^
    --name OppoLivePhotoMaker ^
    --onefile ^
    --windowed ^
    --add-data "exiftool_oppo.config;." ^
    --collect-submodules src ^
    main.py || goto :err

echo.
echo Build OK -^> dist\OppoLivePhotoMaker.exe
echo Note: ffmpeg and exiftool still need to be on PATH on the target machine.
goto :eof

:err
echo Build failed.
exit /b 1
