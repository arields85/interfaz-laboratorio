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
    param([string]$Service, [int]$Port, [System.Diagnostics.Process]$Process, [string]$Arguments)
    return [ordered]@{
        service = $Service
        port = $Port
        pid = [int]$Process.Id
        executable = [IO.Path]::GetFullPath($python)
        arguments = $Arguments
        workingDirectory = $runtimeRoot
    }
}

function Test-OwnedListener {
    param([int]$Port, [int]$ProcessId)
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    return @($listeners | Where-Object { [int]$_.OwningProcess -eq $ProcessId }).Count -gt 0
}

function Wait-VoiceReady {
    param([System.Diagnostics.Process]$Process)
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5056/health' -TimeoutSec 2
            if ($health.ok -eq $true -and $health.ready -eq $true -and $health.service -eq 'prisma-voice' -and $health.mode -eq 'local' -and (Test-OwnedListener -Port 5056 -ProcessId $Process.Id)) { return $true }
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
            if ($health.ok -eq $true -and $health.ready -eq $true -and $health.service -eq 'prisma-local-presentation' -and $health.mode -eq 'local' -and $health.prismaVoiceReady -eq $true -and (Test-OwnedListener -Port 5057 -ProcessId $Process.Id)) { return $true }
        } catch {
            if ($Process.HasExited) { return $false }
        }
    }
    return $false
}

New-Item -ItemType Directory -Path $run, $logs -Force | Out-Null
. (Join-Path $PSScriptRoot 'startup-preflight.ps1')
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
$startupComplete = $false
try {
    $voiceProcess = Start-Process -FilePath $python -ArgumentList $voiceArguments -WorkingDirectory $runtimeRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $script:manifestProcesses += New-ProcessRecord -Service 'prisma-voice' -Port 5056 -Process $voiceProcess -Arguments ($voiceArguments -join ' ')
    Save-ProcessManifest
    if (-not (Wait-VoiceReady -Process $voiceProcess)) { throw "Prisma voice did not become ready. See $stderr" }
    Write-Host 'Prisma voice is ready at http://127.0.0.1:5056.' -ForegroundColor Green
    $presentationProcess = Start-Process -FilePath $python -ArgumentList $presentationArguments -WorkingDirectory $runtimeRoot -WindowStyle Hidden -RedirectStandardOutput $presentationStdout -RedirectStandardError $presentationStderr -PassThru
    $script:manifestProcesses += New-ProcessRecord -Service 'prisma-local-presentation' -Port 5057 -Process $presentationProcess -Arguments ($presentationArguments -join ' ')
    Save-ProcessManifest
    Write-Host 'Starting Prisma Local presentation at http://127.0.0.1:5057.' -ForegroundColor Green
    if (-not (Wait-PresentationReady -Process $presentationProcess)) { throw "Prisma Local presentation did not become ready. See $presentationStderr" }
    $startupComplete = $true
    Write-Host 'Prisma Local presentation is ready at http://127.0.0.1:5057.' -ForegroundColor Green
}
finally {
    if (-not $startupComplete) {
        & (Join-Path $PSScriptRoot 'stop-local.ps1')
    }
}
