@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0copy-img-meta.ps1" %*
exit /b %ERRORLEVEL%
