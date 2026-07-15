@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-app.ps1"
if errorlevel 1 (
    echo.
    echo [ERROR] Script exited with an error. See messages above.
)
echo.
pause
