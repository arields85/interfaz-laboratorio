[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stateRoot = if ($env:PRISMA_RUNTIME_STATE_DIR) { [IO.Path]::GetFullPath($env:PRISMA_RUNTIME_STATE_DIR) } else { Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'CoreAnalytics\Prisma' }
$python = if ($env:PRISMA_PYTHON) { $env:PRISMA_PYTHON } else { (Get-Command python.exe -ErrorAction Stop).Source }
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$manifestPath = Join-Path $stateRoot 'run\process-manifest.json'
$logs = Join-Path $stateRoot 'logs'
$run = Join-Path $stateRoot 'run'

$telegramToken = if ($env:PRISMA_LOCAL_TELEGRAM_BOT_TOKEN) { $env:PRISMA_LOCAL_TELEGRAM_BOT_TOKEN.Trim() } else { '' }
if (-not $env:GEMINI_API_KEY) { throw 'GEMINI_API_KEY must be provided in the process environment.' }
if ($env:PRISMA_LOCAL_TELEGRAM_ENABLED -eq '1' -and [string]::IsNullOrWhiteSpace($telegramToken)) { throw 'PRISMA_LOCAL_TELEGRAM_BOT_TOKEN must be provided when PRISMA_LOCAL_TELEGRAM_ENABLED=1.' }

$env:PRISMA_RUNTIME_STATE_DIR = $stateRoot
$env:PRISMA_VOICE_CONFIG_FILE = Join-Path $stateRoot 'prisma_voice_config.json'
$env:PRISMA_LOCAL_SNAPSHOT_FILE = Join-Path $stateRoot 'prisma_local_snapshot.json'
$env:PRISMA_LOCAL_STATE_FILE = Join-Path $stateRoot 'prisma_local_state.json'
$env:PRISMA_CONFIG_MODE = 'local'
$env:PRISMA_VOICE_HOST = '127.0.0.1'
$env:TELEGRAM_BOT_TOKEN = if ($env:PRISMA_LOCAL_TELEGRAM_ENABLED -eq '1') { $telegramToken } else { '' }
$env:PYTHONPATH = "$runtimeRoot\src" + $(if ($env:PYTHONPATH) { ";$env:PYTHONPATH" } else { '' })

$script:manifestProcesses = @()
. (Join-Path $PSScriptRoot 'process-ownership.ps1')

function Save-ProcessManifest {
    $payload = [ordered]@{
        schemaVersion = 1
        repositoryRoot = $runtimeRoot
        processes = @($script:manifestProcesses)
    }
    $temporary = "$manifestPath.tmp"
    $payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $manifestPath -Force
}

function New-ProcessRecord {
    param([string]$Service, [int]$Port, [object]$Listener)
    return [ordered]@{
        service = $Service
        port = $Port
        pid = [int]$Listener.pid
        executable = [string]$Listener.executable
        module = [string]$Listener.module
        commandLine = [string]$Listener.commandLine
    }
}

function Wait-VoiceReady {
    param([System.Diagnostics.Process]$Process)
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5056/health' -TimeoutSec 2
            if ($health.ok -eq $true -and $health.ready -eq $true -and $health.service -eq 'prisma-voice' -and $health.mode -eq 'local') { return $true }
        } catch {
            if ($Process.HasExited) { return $false }
        }
    }
    return $false
}

function Wait-PresentationReady {
    param([System.Diagnostics.Process]$Process)
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5057/health' -TimeoutSec 2
            if ($health.ok -eq $true -and $health.ready -eq $true -and $health.service -eq 'prisma-local-presentation' -and $health.mode -eq 'local' -and $health.prismaVoiceReady -eq $true) { return $true }
        } catch {
            if ($Process.HasExited) { return $false }
        }
    }
    return $false
}

function Stop-PrismaLaunchedProcess {
    param([System.Diagnostics.Process]$Process)

    if (-not $Process) { return }
    try {
        if (-not $Process.HasExited) {
            Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
        }
    } catch {
    }
}

New-Item -ItemType Directory -Path $run, $logs -Force | Out-Null
. (Join-Path $PSScriptRoot 'startup-preflight.ps1')
Prune-PrismaProcessManifest -ManifestPath $manifestPath -RepositoryRoot $runtimeRoot
Assert-PrismaLocalPortsAvailable -Ports @(5056, 5057)
& $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'bootstrap-local.ps1')

$stdout = Join-Path $logs 'prisma-voice-stdout.log'
$stderr = Join-Path $logs 'prisma-voice-stderr.log'
$presentationStdout = Join-Path $logs 'prisma-presentation-stdout.log'
$presentationStderr = Join-Path $logs 'prisma-presentation-stderr.log'
Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $presentationStdout, $presentationStderr -Force -ErrorAction SilentlyContinue

$voiceArguments = @('-m', 'prisma_runtime.voice_service')
$presentationArguments = @('-m', 'prisma_runtime.local_presentation')
$voiceProcess = $null
$presentationProcess = $null
$voiceListener = $null
$presentationListener = $null
$startupComplete = $false
try {
    $voiceProcess = Start-Process -FilePath $python -ArgumentList $voiceArguments -WorkingDirectory $runtimeRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    if (-not (Wait-VoiceReady -Process $voiceProcess)) { throw "Prisma voice did not become ready. See $stderr" }
    $voiceListener = Resolve-PrismaVerifiedListener -Port 5056 -ExpectedModule 'prisma_runtime.voice_service'
    if (-not $voiceListener) { throw "Prisma voice listener identity could not be verified. See $stderr" }
    $script:manifestProcesses += New-ProcessRecord -Service 'prisma-voice' -Port 5056 -Listener $voiceListener
    Save-ProcessManifest
    Write-Host 'Prisma voice is ready at http://127.0.0.1:5056.' -ForegroundColor Green
    $presentationProcess = Start-Process -FilePath $python -ArgumentList $presentationArguments -WorkingDirectory $runtimeRoot -WindowStyle Hidden -RedirectStandardOutput $presentationStdout -RedirectStandardError $presentationStderr -PassThru
    if (-not (Wait-PresentationReady -Process $presentationProcess)) { throw "Prisma Local presentation did not become ready. See $presentationStderr" }
    $presentationListener = Resolve-PrismaVerifiedListener -Port 5057 -ExpectedModule 'prisma_runtime.local_presentation'
    if (-not $presentationListener) { throw "Prisma Local presentation listener identity could not be verified. See $presentationStderr" }
    $script:manifestProcesses += New-ProcessRecord -Service 'prisma-local-presentation' -Port 5057 -Listener $presentationListener
    Save-ProcessManifest
    Write-Host 'Starting Prisma Local presentation at http://127.0.0.1:5057.' -ForegroundColor Green
    $startupComplete = $true
    Write-Host 'Prisma Local presentation is ready at http://127.0.0.1:5057.' -ForegroundColor Green
}
finally {
    if (-not $startupComplete) {
        Stop-PrismaLaunchedProcess -Process $presentationProcess
        Stop-PrismaLaunchedProcess -Process $voiceProcess
        & (Join-Path $PSScriptRoot 'stop-local.ps1')
        Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
    }
}
