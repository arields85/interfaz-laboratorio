[CmdletBinding()]
param([switch]$SkipManifestLock)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime-environment.ps1')
$runtimeRoot = Get-PrismaRuntimeRoot
$stateRoot = Get-PrismaStateRoot
$manifestPath = Join-Path $stateRoot 'run\process-manifest.json'
$manifestLockPath = Join-Path $stateRoot 'run\process-manifest.lock'
. (Join-Path $PSScriptRoot 'process-ownership.ps1')

function Invoke-PrismaStopTransaction {
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        Write-Host 'No Prisma Local process manifest found; no process was stopped.'
        return
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifestRoot = [IO.Path]::GetFullPath([string]$manifest.repositoryRoot)
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals($manifestRoot, $runtimeRoot)) {
        throw "Prisma Local process manifest belongs to another repository: $manifestRoot"
    }
    $requireCreationTime = $null -ne $manifest.PSObject.Properties['developmentOwnership']
    $remaining = @()
    foreach ($record in @($manifest.processes)) {
        $recordedPid = 0
        $recordedPort = 0
        try { $recordedPid = [int]$record.pid; $recordedPort = [int]$record.port } catch { $remaining += $record; continue }
        if ($recordedPort -notin @(5056, 5057) -or $recordedPid -le 0) { $remaining += $record; continue }

        $expectedModule = Get-PrismaExpectedModule -Service ([string]$record.service)
        $listener = if ($expectedModule) { Resolve-PrismaVerifiedListener -Port $recordedPort -ExpectedModule $expectedModule } else { $null }
        $identityMatches = $listener -and $listener.pid -eq $recordedPid -and [StringComparer]::OrdinalIgnoreCase.Equals([string]$record.module, $expectedModule) -and (Test-PrismaManifestIdentity -Listener $listener -Record $record -RequireCreationTime:$requireCreationTime)
        if ($identityMatches) {
            try {
                Stop-Process -Id $recordedPid -Force -ErrorAction Stop
                Write-Host "Stopped repository-owned $($record.service) process $recordedPid on port $recordedPort."
            } catch {
                $remaining += $record
            }
        } else {
            $remaining += $record
        }
    }

    if ($remaining.Count -eq 0) {
        Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
    } else {
        $manifest.processes = @($remaining)
        Save-PrismaProcessManifest -ManifestPath $manifestPath -Manifest $manifest
    }
    Write-Host 'Prisma Local owned processes processed.' -ForegroundColor Green
}

if ($SkipManifestLock) {
    Invoke-PrismaStopTransaction
} else {
    Invoke-PrismaManifestLock -LockPath $manifestLockPath -Action { Invoke-PrismaStopTransaction }
}
