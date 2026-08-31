@echo off
setlocal
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0start-local.ps1"
exit /b %ERRORLEVEL%
