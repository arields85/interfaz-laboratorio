@echo off
setlocal
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0stop-local.ps1"
exit /b %ERRORLEVEL%
