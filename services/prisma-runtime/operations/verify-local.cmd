@echo off
setlocal
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0verify-local.ps1"
exit /b %ERRORLEVEL%
