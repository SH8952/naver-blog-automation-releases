@echo off
chcp 65001 > nul
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0get-latest-code.ps1"
if errorlevel 1 (
    echo.
    echo [ERROR] Script exited with an error. See messages above.
)
echo.
pause
