# Dev launcher

A dev-only, Windows desktop launcher for the HMI's local development server. It replaces the old
launcher that used to live on the Desktop (`CoreAnalitycs.bat`, outside the repository, with a
hardcoded absolute project path and a fixed 3-second delay before opening a browser). This folder
is not part of the HMI application and is not built, packaged or deployed with it (see
"Not part of the build" below).

## Usage

1. Run `npm ci` once inside `hmi-app/` (this launcher does not install dependencies for you).
2. Double-click `CoreAnalytics.cmd`, or point a desktop shortcut at it (see below).

`CoreAnalytics.cmd` derives the project path from its own location (`%~dp0`), so it keeps working
regardless of where the repository is cloned -- it never hardcodes an absolute path. It starts the
dev server (`npm run dev`) in its own window and, once Prisma's local runtime and the Vite dev
server are both actually ready, opens the HMI in a dedicated **CONTROL Chrome** window (see below).
If readiness fails or times out, no browser window opens and the dev server's own window prints a
clear message instead.

If the dev server is already running (started from another shortcut, a terminal, or a previous
run) and you only need the browser window, use `OpenControlChrome.cmd` instead -- it does not start
or manage the dev server, it only opens the CONTROL Chrome on the HMI URL. It accepts an optional
port argument, e.g. `OpenControlChrome.cmd 4173`.

## Why a CONTROL Chrome, not your regular Chrome

The launcher opens Chrome with its own profile directory (`--user-data-dir`) instead of your
default Chrome profile, plus a debugging port bound to `127.0.0.1` only. Two reasons:

- **Chrome 136 and later ignore `--remote-debugging-port` entirely when it is launched against the
  default user-data-dir.** A dedicated profile is required for the debugging port to work at all,
  not just a privacy nicety.
- **Isolation.** The CONTROL Chrome profile only ever holds HMI-related browsing data (cookies,
  local storage, history for the dev server's URL). It never touches your personal Chrome profile,
  your bookmarks, or your browsing history, and the debugging port is not reachable from outside
  the machine (`127.0.0.1` only).

If a CONTROL Chrome window is already open (same `--user-data-dir`), Chrome's own single-instance
behavior simply opens the HMI URL in it -- the launcher does not need to detect that itself.

## Configuration (environment variables)

All of these have sensible defaults and can be overridden by setting the variable before running
either `.cmd` file:

| Variable | Default | Meaning |
|---|---|---|
| `PRISMA_CREDENTIAL_MASTER_KEY_FILE` | `%LOCALAPPDATA%\CoreAnalytics\PrismaCredentialKey\master.key` | Same default the previous Desktop launcher used. |
| `PRISMA_DEV_CHROME_PATH` | `%ProgramFiles%\Google\Chrome\Application\chrome.exe` | Path to the Chrome executable. Override for a per-user install (typically under `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`) or a non-standard location. |
| `PRISMA_DEV_CHROME_USER_DATA_DIR` | `%LOCALAPPDATA%\CoreAnalytics\ChromeControl` | The CONTROL Chrome's own profile directory. |
| `PRISMA_DEV_CHROME_DEBUG_PORT` | `9222` | The localhost-only remote debugging port. |
| `PRISMA_DEV_HOST` (`OpenControlChrome.cmd` only) | `127.0.0.1` | Host used to build the URL when opening the browser standalone. |
| `PRISMA_DEV_PORT` (`OpenControlChrome.cmd` only) | `5173` | Port used to build the URL when opening the browser standalone (or pass it as the first argument instead). |

None of these defaults hardcode a machine-specific absolute path in the repository -- they are all
built from standard Windows environment variables (`%ProgramFiles%`, `%LOCALAPPDATA%`) at run time.

`CoreAnalytics.cmd` itself always sets `PRISMA_DEV_AUTO_OPEN=1` before starting the dev server; this
is the opt-in flag `hmi-app/scripts/dev.mjs` checks before opening a browser at all. Running
`npm run dev` directly (without this launcher) never opens a browser, exactly as before.

## Pointing a desktop shortcut at this launcher

1. Right-click the Desktop, choose New > Shortcut.
2. Target: the full path to `CoreAnalytics.cmd` inside your clone of this repository, e.g.
   `D:\Proyectos\Interfaz-HMI\Interfaz-HMI\tools\dev-launcher\CoreAnalytics.cmd`.
3. Start in: leave it as the folder containing the target (the script does not depend on the
   working directory it was launched from).
4. Icon: Properties > Change Icon… > browse to `prisma-pyramid.ico` in this folder (the monochrome
   Lucide pyramid the viewer topbar uses for Prisma; `prisma-pyramid.svg` is its editable source).

Or create it in one step from PowerShell (run from this folder):

```powershell
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'CoreAnalytics.lnk'))
$lnk.TargetPath = (Resolve-Path .\CoreAnalytics.cmd).Path
$lnk.WorkingDirectory = (Get-Location).Path
$lnk.IconLocation = (Resolve-Path .\prisma-pyramid.ico).Path + ',0'
$lnk.Save()
```

Replace the old `CoreAnalitycs.bat` Desktop launcher with this shortcut.

## Not part of the build

`tools/dev-launcher/` is marked `export-ignore` in the repository's `.gitattributes`, so it is
excluded from `git archive` exports. It is also never referenced by the HMI application build
(`hmi-app`'s `vite build` only ever reads from `hmi-app/src`) or by Prisma's own runtime
bootstrap/packaging scripts (`services/prisma-runtime/operations/bootstrap-local.*`) -- this
folder exists purely as a local development convenience.
