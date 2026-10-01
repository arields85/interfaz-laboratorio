[CmdletBinding()]
param(
    [string]$DevelopmentOwnerToken = '',
    [string]$DevelopmentOwnerProcessId = '',
    [string]$DevelopmentReceiptPath = '',
    [string]$DevelopmentCancellationPath = '',
    [int]$LockTimeoutMilliseconds = 10000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'runtime-environment.ps1')
$runtimeRoot = Get-LedaRuntimeRoot
$stateRoot = Get-LedaStateRoot
$manifestPath = Join-Path $stateRoot 'run\process-manifest.json'
$manifestLockPath = Join-Path $stateRoot 'run\process-manifest.lock'
$logs = Join-Path $stateRoot 'logs'

$telegramToken = if ($env:LEDA_LOCAL_TELEGRAM_BOT_TOKEN) { $env:LEDA_LOCAL_TELEGRAM_BOT_TOKEN.Trim() } else { '' }

$env:LEDA_RUNTIME_STATE_DIR = $stateRoot
$env:LEDA_VOICE_CONFIG_FILE = Join-Path $stateRoot 'leda_voice_config.json'
$env:LEDA_LOCAL_SNAPSHOT_FILE = Join-Path $stateRoot 'leda_local_snapshot.json'
$env:LEDA_LOCAL_STATE_FILE = Join-Path $stateRoot 'leda_local_state.json'
$env:LEDA_CONFIG_MODE = 'local'
$env:LEDA_VOICE_HOST = '127.0.0.1'
$env:TELEGRAM_BOT_TOKEN = if ($env:LEDA_LOCAL_TELEGRAM_ENABLED -eq '1') { $telegramToken } else { '' }
$env:PYTHONPATH = "$runtimeRoot\src" + $(if ($env:PYTHONPATH) { ";$env:PYTHONPATH" } else { '' })

. (Join-Path $PSScriptRoot 'process-ownership.ps1')
. (Join-Path $PSScriptRoot 'console-progress.ps1')

function Test-LedaDevelopmentCancellation {
    if ([string]::IsNullOrWhiteSpace($DevelopmentCancellationPath)) { return $false }
    return Test-Path -LiteralPath $DevelopmentCancellationPath -PathType Leaf
}

function Assert-LedaDevelopmentNotCancelled {
    if (Test-LedaDevelopmentCancellation) {
        throw 'Leda Local development acquisition was cancelled.'
    }
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
        creationTimeUtc = ConvertTo-LedaCreationIdentity -Value $Listener.creationTimeUtc
    }
}

function Wait-VoiceReady {
    param([System.Diagnostics.Process]$Process)
    $label = 'Starting Leda voice'
    Start-LedaWaitIndicator -Label $label
    try {
        $tick = 0
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            if (Test-LedaDevelopmentCancellation) { return $false }
            # K1/m1 caret (user request): tick the indicator every 100 ms (10 ticks per 1 s
            # attempt) instead of once per attempt, so the trailing caret blinks smoothly (0.6 s
            # full cycle, see console-progress.ps1). The overall ~30 s health-check budget is
            # unchanged.
            for ($subTick = 0; $subTick -lt 10; $subTick++) {
                Update-LedaWaitIndicator -Label $label -FrameIndex $tick
                Start-Sleep -Milliseconds 100
                $tick++
            }
            try {
                $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5056/health' -TimeoutSec 2
                if ($health.ok -eq $true -and $health.ready -eq $true -and $health.service -eq 'leda-voice' -and $health.mode -eq 'local') { return $true }
            } catch {
                if ($Process.HasExited) { return $false }
            }
        }
        return $false
    }
    finally {
        Clear-LedaWaitIndicator
    }
}

function Wait-PresentationReady {
    param([System.Diagnostics.Process]$Process)
    $label = 'Starting Leda'
    Start-LedaWaitIndicator -Label $label
    try {
        $tick = 0
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            if (Test-LedaDevelopmentCancellation) { return $false }
            # K1/m1 caret (user request): tick the indicator every 100 ms (10 ticks per 1 s
            # attempt) instead of once per attempt, so the trailing caret blinks smoothly (0.6 s
            # full cycle, see console-progress.ps1). The overall ~30 s health-check budget is
            # unchanged.
            for ($subTick = 0; $subTick -lt 10; $subTick++) {
                Update-LedaWaitIndicator -Label $label -FrameIndex $tick
                Start-Sleep -Milliseconds 100
                $tick++
            }
            try {
                $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5057/health' -TimeoutSec 2
                if ($health.ok -eq $true -and $health.ready -eq $true -and $health.service -eq 'leda-local-presentation' -and $health.mode -eq 'local' -and $health.ledaVoiceReady -eq $true) { return $true }
            } catch {
                if ($Process.HasExited) { return $false }
            }
        }
        return $false
    }
    finally {
        Clear-LedaWaitIndicator
    }
}

function Stop-LedaLaunchedProcess {
    param([System.Diagnostics.Process]$Process)

    if (-not $Process) { return }
    try {
        if (-not $Process.HasExited) {
            Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
        }
    } catch {
    }
}

function Invoke-LedaStartTransaction {
    Assert-LedaDevelopmentNotCancelled
    $isDevelopment = -not [string]::IsNullOrWhiteSpace($DevelopmentOwnerToken)
    $ownerIdentity = $null
    if ($isDevelopment -and -not [string]::IsNullOrWhiteSpace($DevelopmentOwnerProcessId)) {
        $ownerIdentity = Get-LedaDevelopmentOwnerRegistrationIdentity -ProcessId $DevelopmentOwnerProcessId
    }
    elseif ($isDevelopment) {
        Write-Warning 'Leda Local development owner process identity was omitted; this legacy owner cannot be reaped automatically.' -WarningAction Continue
    }

    if ($isDevelopment) {
        # T18 (user decision, 2026-09-24; supersedes T1b/T1c's warm-reuse branches above,
        # which used to return here with an "(already running)" message): the dev launcher
        # must ALWAYS start Leda clean. A previously running runtime of this repository on
        # 5056/5057 is never reused anymore -- not a healthy dev-owned one (the old warm-reuse
        # branch) and not a manually started one (the old manual-reuse branch,
        # start-local.cmd run by hand outside the launcher): both are verified and stopped the
        # SAME way via Resolve-LedaPortState below (path + "-m <module>" command line,
        # independent of any developmentOwnership manifest field), then a fresh start is
        # attempted. Only a listener VERIFIED as this repository's own Leda module is ever
        # stopped; a foreign process holding a port blocks the attempt with a clear terminal
        # message and a structured receipt failure instead. Owner liveness and manifest
        # health are no longer consulted at all before stopping -- every case recovers
        # instead of reusing or refusing.
        $portChecks = @(
            [pscustomobject]@{ port = 5056; module = (Get-LedaExpectedModule -Service 'leda-voice') }
            [pscustomobject]@{ port = 5057; module = (Get-LedaExpectedModule -Service 'leda-local-presentation') }
        )
        $portStates = foreach ($check in $portChecks) {
            [pscustomobject]@{ port = $check.port; result = (Resolve-LedaPortState -Port $check.port -ExpectedModule $check.module) }
        }
        $foreign = $portStates | Where-Object { $_.result.state -eq 'foreign' } | Select-Object -First 1
        if ($foreign) {
            $occupantName = if ([string]::IsNullOrWhiteSpace([string]$foreign.result.processName)) { 'another program' } else { '"' + $foreign.result.processName + '"' }
            $message = "Leda could not start: port $($foreign.port) is in use by $occupantName (PID $($foreign.result.pid)). Close it and run the launcher again."
            # Minimal, documented receipt-on-failure schema so dev.mjs (T4b) can read it even
            # though this transaction throws: { registered: false, failure: { reason:
            # 'port_in_use', port, processName (string or null), pid } }.
            Save-LedaDevelopmentReceipt -Receipt ([ordered]@{
                registered = $false
                failure = [ordered]@{
                    reason = 'port_in_use'
                    port = [int]$foreign.port
                    processName = $(if ([string]::IsNullOrWhiteSpace([string]$foreign.result.processName)) { $null } else { [string]$foreign.result.processName })
                    pid = [int]$foreign.result.pid
                }
            })
            # T4d: this is a normal, expected outcome (another program owns the port), not an
            # unexpected failure -- the top-level handler recognizes this exact flag and prints
            # exactly one clean line instead of the default uncaught-error record.
            $script:portInUseTerminalMessage = $message
            throw $message
        }

        $stoppedProcesses = @()
        foreach ($entry in $portStates) {
            if ($entry.result.state -ne 'ours') { continue }
            try {
                Stop-Process -Id ([int]$entry.result.pid) -Force -ErrorAction Stop
                $stoppedProcesses += [pscustomobject]@{ port = $entry.port; pid = $entry.result.pid }
            }
            catch {
            }
        }
        foreach ($entry in $stoppedProcesses) {
            for ($attempt = 0; $attempt -lt 20; $attempt++) {
                if (@(Get-NetTCPConnection -LocalPort $entry.port -State Listen -ErrorAction SilentlyContinue).Count -eq 0) { break }
                Start-Sleep -Milliseconds 100
            }
            # T18: replaces the old silent-until-recovery messaging with an explicit,
            # per-process announcement, printed BEFORE the fresh start begins, so the
            # terminal never again shows only Vite with no indication Leda was touched.
            Write-Host "Stopped previous Leda runtime (pid $($entry.pid)) to start clean." -ForegroundColor Yellow
        }

        $hadManifest = Test-Path -LiteralPath $manifestPath -PathType Leaf
        if ($hadManifest) { Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue }
        if ($hadManifest -and $stoppedProcesses.Count -eq 0) {
            # No verified listener needed stopping (both ports were already free), but a
            # manifest file was left behind (Ctrl+C, the window closed, or a crash): this is
            # genuine abrupt-shutdown recovery, not a clean-restart stop, so it keeps its own
            # distinct message instead of the "Stopped previous Leda runtime" one above.
            Write-Warning 'Recovered Leda Local development state left by an abrupt shutdown.' -WarningAction Continue
        }
    }

    Prune-LedaProcessManifest -ManifestPath $manifestPath -RepositoryRoot $runtimeRoot
    Assert-LedaLocalPortsAvailable -Ports @(5056, 5057)
    $python = Resolve-LedaPython -RuntimeRoot $runtimeRoot
    Assert-LedaOwnedInterpreter -Interpreter $python -RuntimeRoot $runtimeRoot
    Assert-LedaRuntimeDependencies -Interpreter $python
    Assert-LedaDevelopmentNotCancelled

    $stdout = Join-Path $logs 'leda-voice-stdout.log'
    $stderr = Join-Path $logs 'leda-voice-stderr.log'
    $presentationStdout = Join-Path $logs 'leda-presentation-stdout.log'
    $presentationStderr = Join-Path $logs 'leda-presentation-stderr.log'
    Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $presentationStdout, $presentationStderr -Force -ErrorAction SilentlyContinue

    $voiceProcess = $null
    $presentationProcess = $null
    $manifestProcesses = @()
    $startupComplete = $false
    try {
        $voiceProcess = Start-Process -FilePath $python -ArgumentList @('-m', 'leda_runtime.voice_service') -WorkingDirectory $runtimeRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
        if (-not (Wait-VoiceReady -Process $voiceProcess)) { throw "Leda voice did not become ready or acquisition was cancelled. See $stderr" }
        $voiceListener = Resolve-LedaVerifiedListener -Port 5056 -ExpectedModule 'leda_runtime.voice_service'
        if (-not $voiceListener) { throw "Leda voice listener identity could not be verified. See $stderr" }
        $manifestProcesses += New-ProcessRecord -Service 'leda-voice' -Port 5056 -Listener $voiceListener
        $partialManifest = [ordered]@{ schemaVersion = 2; repositoryRoot = $runtimeRoot; processes = @($manifestProcesses) }
        Save-LedaProcessManifest -ManifestPath $manifestPath -Manifest $partialManifest
        Write-Host 'Leda voice is ready at http://127.0.0.1:5056.' -ForegroundColor Green

        Assert-LedaDevelopmentNotCancelled
        $presentationProcess = Start-Process -FilePath $python -ArgumentList @('-m', 'leda_runtime.local_presentation') -WorkingDirectory $runtimeRoot -WindowStyle Hidden -RedirectStandardOutput $presentationStdout -RedirectStandardError $presentationStderr -PassThru
        if (-not (Wait-PresentationReady -Process $presentationProcess)) { throw "Leda Local presentation did not become ready or acquisition was cancelled. See $presentationStderr" }
        $presentationListener = Resolve-LedaVerifiedListener -Port 5057 -ExpectedModule 'leda_runtime.local_presentation'
        if (-not $presentationListener) { throw "Leda Local presentation listener identity could not be verified. See $presentationStderr" }
        $manifestProcesses += New-ProcessRecord -Service 'leda-local-presentation' -Port 5057 -Listener $presentationListener
        Assert-LedaDevelopmentNotCancelled

        $manifest = [ordered]@{ schemaVersion = 2; repositoryRoot = $runtimeRoot; processes = @($manifestProcesses) }
        $generation = ''
        if ($isDevelopment) {
            $generation = [guid]::NewGuid().ToString('D')
            $manifest.developmentOwnership = [pscustomobject][ordered]@{
                generation = $generation
                owners = @($DevelopmentOwnerToken)
                ownerIdentities = [ordered]@{}
            }
            if ($null -ne $ownerIdentity) {
                Set-LedaDevelopmentOwnerIdentity -Ownership $manifest.developmentOwnership -OwnerToken $DevelopmentOwnerToken -OwnerIdentity $ownerIdentity
            }
        }
        Save-LedaProcessManifest -ManifestPath $manifestPath -Manifest $manifest
        $startupComplete = $true
        Write-Host 'Leda is ready at http://127.0.0.1:5057.' -ForegroundColor Green
        return [ordered]@{ registered = $isDevelopment; generation = $generation; reused = $false }
    }
    finally {
        if (-not $startupComplete) {
            Stop-LedaLaunchedProcess -Process $presentationProcess
            Stop-LedaLaunchedProcess -Process $voiceProcess
            & (Join-Path $PSScriptRoot 'stop-local.ps1') -SkipManifestLock
            Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Save-LedaDevelopmentReceipt {
    param([object]$Receipt)

    if ([string]::IsNullOrWhiteSpace($DevelopmentReceiptPath)) { return }
    Save-LedaJsonFile -Path $DevelopmentReceiptPath -Value $Receipt -Depth 4
}

$template = Get-LedaConfigurationTemplate -RuntimeRoot $runtimeRoot
# One-time Prisma -> Leda copy of the old state and credential key, before any read of either.
Invoke-LedaLegacyLocalMigration | Out-Null
Initialize-LedaRuntimeState -StateRoot $stateRoot -Template $template | Out-Null
. (Join-Path $PSScriptRoot 'startup-preflight.ps1')
$script:developmentReceipt = $null
$script:portInUseTerminalMessage = $null
try {
    Invoke-LedaManifestLock -LockPath $manifestLockPath -TimeoutMilliseconds $LockTimeoutMilliseconds -Action {
        $script:developmentReceipt = Invoke-LedaStartTransaction
        try {
            Assert-LedaDevelopmentNotCancelled
            Save-LedaDevelopmentReceipt -Receipt $script:developmentReceipt
        }
        catch {
            if ($script:developmentReceipt.registered -eq $true) {
                Invoke-LedaDevelopmentReleaseTransaction -ManifestPath $manifestPath -RepositoryRoot $runtimeRoot -OwnerToken $DevelopmentOwnerToken -ExpectedGeneration ([string]$script:developmentReceipt.generation)
            }
            throw
        }
    }
}
catch {
    # T4d: a port_in_use failure is a normal, expected outcome (another program owns the
    # port) that already exited through the ordinary exception path above -- unlike every
    # other failure, it does not need the default uncaught-error record (message, "At line
    # X char Y", CategoryInfo, FullyQualifiedErrorId). Print exactly the one clean line
    # already prepared and exit non-zero directly, so dev.mjs still sees a failed launch.
    if ($null -ne $script:portInUseTerminalMessage) {
        Write-Host $script:portInUseTerminalMessage -ForegroundColor Red
        exit 1
    }
    throw
}
