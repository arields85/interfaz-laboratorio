[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stateRoot = if ($env:PRISMA_RUNTIME_STATE_DIR) { [IO.Path]::GetFullPath($env:PRISMA_RUNTIME_STATE_DIR) } else { Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'CoreAnalytics\Prisma' }
$manifestPath = Join-Path $stateRoot 'run\process-manifest.json'
. (Join-Path $PSScriptRoot 'process-ownership.ps1')
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    Write-Host 'No Prisma Local process manifest found; no process was stopped.'
    exit 0
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$manifestRoot = [IO.Path]::GetFullPath([string]$manifest.repositoryRoot)
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($manifestRoot, $runtimeRoot)) {
    throw "Prisma Local process manifest belongs to another repository: $manifestRoot"
}
$remaining = @()
foreach ($record in @($manifest.processes)) {
    $recordedPid = 0
    $recordedPort = 0
    try { $recordedPid = [int]$record.pid; $recordedPort = [int]$record.port } catch { $remaining += $record; continue }
    if ($recordedPort -notin @(5056, 5057) -or $recordedPid -le 0) { $remaining += $record; continue }

    $expectedModule = if ($record.module) { [string]$record.module } elseif ($record.service -eq 'prisma-voice') { 'prisma_runtime.voice_service' } elseif ($record.service -eq 'prisma-local-presentation') { 'prisma_runtime.local_presentation' } else { '' }
    $listener = if ($expectedModule) { Resolve-PrismaVerifiedListener -Port $recordedPort -ExpectedModule $expectedModule -ExpectedExecutableName ([IO.Path]::GetFileName([string]$record.executable)) } else { $null }
    $identityMatches = $listener -and $listener.pid -eq $recordedPid -and (Test-PrismaManifestIdentity -Listener $listener -Record $record)
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
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
}
Write-Host 'Prisma Local owned processes processed.' -ForegroundColor Green
