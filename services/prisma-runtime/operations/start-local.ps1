[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stateRoot = if ($env:PRISMA_RUNTIME_STATE_DIR) { [IO.Path]::GetFullPath($env:PRISMA_RUNTIME_STATE_DIR) } else { Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'CoreAnalytics\Prisma' }
. (Join-Path $PSScriptRoot 'startup-preflight.ps1')
Assert-PrismaLocalPortsAvailable -Ports @(5056, 5057)
$python = if ($env:PRISMA_PYTHON) { $env:PRISMA_PYTHON } else { (Get-Command python.exe -ErrorAction Stop).Source }
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

if (-not $env:GEMINI_API_KEY) { throw 'GEMINI_API_KEY must be provided in the process environment.' }
if (-not $env:PRISMA_LOCAL_TELEGRAM_BOT_TOKEN) { throw 'PRISMA_LOCAL_TELEGRAM_BOT_TOKEN must be provided in the process environment.' }

& $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'bootstrap-local.ps1')
$env:PRISMA_RUNTIME_STATE_DIR = $stateRoot
$env:PRISMA_VOICE_CONFIG_FILE = Join-Path $stateRoot 'prisma_voice_config.json'
$env:PRISMA_LOCAL_SNAPSHOT_FILE = Join-Path $stateRoot 'prisma_local_snapshot.json'
$env:PRISMA_LOCAL_STATE_FILE = Join-Path $stateRoot 'prisma_local_state.json'
$env:PRISMA_CONFIG_MODE = 'local'
$env:PRISMA_VOICE_HOST = '127.0.0.1'
$env:TELEGRAM_BOT_TOKEN = $env:PRISMA_LOCAL_TELEGRAM_BOT_TOKEN
$env:PYTHONPATH = "$runtimeRoot\src" + $(if ($env:PYTHONPATH) { ";$env:PYTHONPATH" } else { '' })

$logs = Join-Path $stateRoot 'logs'
$stdout = Join-Path $logs 'prisma-voice-stdout.log'
$stderr = Join-Path $logs 'prisma-voice-stderr.log'
Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue

$voiceProcess = Start-Process -FilePath $python -ArgumentList @('-m', 'prisma_runtime.voice_service') -WorkingDirectory $runtimeRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5056/health' -TimeoutSec 2
            $ownedListener = @(Get-NetTCPConnection -LocalPort 5056 -State Listen -OwningProcess $voiceProcess.Id -ErrorAction SilentlyContinue)
            if ($health.ok -eq $true -and $health.ready -eq $true -and $health.service -eq 'prisma-voice' -and $health.mode -eq 'local' -and $ownedListener.Count -gt 0) { $ready = $true; break }
        } catch {
            if ($voiceProcess.HasExited) { break }
        }
    }
    if (-not $ready) { throw "Prisma voice did not become ready. See $stderr" }
    Write-Host 'Prisma voice is ready at http://127.0.0.1:5056.' -ForegroundColor Green
    Write-Host 'Starting Prisma Local presentation at http://127.0.0.1:5057.' -ForegroundColor Green
    & $python -m prisma_runtime.local_presentation
}
finally {
    if ($voiceProcess -and -not $voiceProcess.HasExited) { Stop-Process -Id $voiceProcess.Id -Force -ErrorAction SilentlyContinue }
}
