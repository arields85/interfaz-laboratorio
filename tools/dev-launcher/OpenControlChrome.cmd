@echo off
rem tools/dev-launcher/OpenControlChrome.cmd -- opens only the CONTROL Chrome on the HMI URL, for
rem when the dev server is already running elsewhere. See README.md in this folder.
rem Optional first argument overrides the port (default 5173), e.g. OpenControlChrome.cmd 4173
node "%~dp0open-control-chrome.mjs" %*
