@echo off
setlocal
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0bootstrap-local.ps1"
exit /b %ERRORLEVEL%
