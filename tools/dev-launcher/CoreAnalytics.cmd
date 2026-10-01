@echo off
rem tools/dev-launcher/CoreAnalytics.cmd -- in-repo replacement for the old Desktop launcher.
rem See README.md in this folder for setup and for how to point a desktop shortcut at this file.
rem
rem The project path is derived from this script's own location (%~dp0), never hardcoded, so it
rem keeps working regardless of where the repository is cloned.
title HMI - Servidor de desarrollo

set "PORT=5173"
set "URL=http://127.0.0.1:%PORT%"
for %%I in ("%~dp0..\..") do set "PROJECT_PATH=%%~fI\hmi-app"

rem Same default as the previous Desktop launcher; set this yourself before running the script to
rem override it.
if not defined LEDA_CREDENTIAL_MASTER_KEY_FILE set "LEDA_CREDENTIAL_MASTER_KEY_FILE=%LOCALAPPDATA%\CoreAnalytics\LedaCredentialKey\master.key"

rem Opt-in for hmi-app/scripts/dev.mjs's readiness-triggered browser open: it opens the dedicated
rem CONTROL Chrome profile (see README.md) only once Leda and Vite are actually ready, instead
rem of the previous fixed 3-second delay. Plain `npm run dev` without this variable never opens a
rem browser.
set "LEDA_DEV_AUTO_OPEN=1"

if not exist "%PROJECT_PATH%" (
    echo Could not find hmi-app at "%PROJECT_PATH%".
    echo This script must stay inside tools\dev-launcher of the interfaz-HMI repository.
    exit /b 1
)

cd /d "%PROJECT_PATH%"
echo Starting the HMI dev server. It will open %URL% in the CONTROL Chrome once ready.
start "Servidor HMI" cmd /k npm run dev -- --host 127.0.0.1 --port %PORT%
exit
