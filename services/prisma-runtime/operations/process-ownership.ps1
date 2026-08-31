function Test-PrismaProcessIdentity {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [object]$ProcessInfo,
        [Parameter(Mandatory = $true)] [string]$ExpectedModule,
        [Parameter(Mandatory = $true)] [string]$RepositoryRoot
    )

    $executable = [string]$ProcessInfo.ExecutablePath
    $commandLine = [string]$ProcessInfo.CommandLine
    if ([string]::IsNullOrWhiteSpace($executable) -or [string]::IsNullOrWhiteSpace($commandLine)) { return $false }
    if ([IO.Path]::GetFileName($executable) -notmatch '^python(w)?\.exe$') { return $false }
    return $commandLine.IndexOf("-m $ExpectedModule", [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $commandLine.IndexOf($RepositoryRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Resolve-PrismaVerifiedListener {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [int]$Port,
        [Parameter(Mandatory = $true)] [string]$ExpectedModule,
        [Parameter(Mandatory = $true)] [string]$RepositoryRoot
    )

    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -ne 1) { return $null }
    $listenerPid = [int]$listeners[0].OwningProcess
    $processInfo = @(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $listenerPid" -ErrorAction SilentlyContinue)
    if ($processInfo.Count -ne 1 -or -not (Test-PrismaProcessIdentity -ProcessInfo $processInfo[0] -ExpectedModule $ExpectedModule -RepositoryRoot $RepositoryRoot)) { return $null }
    return [pscustomobject]@{
        pid = $listenerPid
        executable = [string]$processInfo[0].ExecutablePath
        commandLine = [string]$processInfo[0].CommandLine
    }
}

function Stop-PrismaWrapperIfSeparate {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [int]$WrapperProcessId,
        [Parameter(Mandatory = $true)] [int]$ListenerProcessId,
        [Parameter(Mandatory = $true)] [string]$ExpectedModule,
        [Parameter(Mandatory = $true)] [string]$RepositoryRoot
    )

    if ($WrapperProcessId -le 0 -or $WrapperProcessId -eq $ListenerProcessId) { return }
    $processInfo = @(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $WrapperProcessId" -ErrorAction SilentlyContinue)
    if ($processInfo.Count -eq 1 -and (Test-PrismaProcessIdentity -ProcessInfo $processInfo[0] -ExpectedModule $ExpectedModule -RepositoryRoot $RepositoryRoot)) {
        Stop-Process -Id $WrapperProcessId -Force -ErrorAction Stop
    }
}

function Prune-PrismaProcessManifest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string]$ManifestPath,
        [Parameter(Mandatory = $true)] [string]$RepositoryRoot
    )

    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { return }
    try {
        $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
        $manifestRoot = [IO.Path]::GetFullPath([string]$manifest.repositoryRoot)
        if (-not [StringComparer]::OrdinalIgnoreCase.Equals($manifestRoot, [IO.Path]::GetFullPath($RepositoryRoot))) { return }
        $remaining = @()
        foreach ($record in @($manifest.processes)) {
            $expectedModule = if ($record.service -eq 'prisma-voice') { 'prisma_runtime.voice_service' } elseif ($record.service -eq 'prisma-local-presentation') { 'prisma_runtime.local_presentation' } else { '' }
            $listener = if ($expectedModule) { Resolve-PrismaVerifiedListener -Port ([int]$record.port) -ExpectedModule $expectedModule -RepositoryRoot $RepositoryRoot } else { $null }
            if ($listener -and $listener.pid -eq [int]$record.pid -and [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath([string]$listener.executable), [IO.Path]::GetFullPath([string]$record.executable))) { $remaining += $record }
        }
        if ($remaining.Count -eq 0) {
            Remove-Item -LiteralPath $ManifestPath -Force -ErrorAction SilentlyContinue
        } else {
            $manifest.processes = @($remaining)
            $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8
        }
    } catch {
        Remove-Item -LiteralPath $ManifestPath -Force -ErrorAction SilentlyContinue
    }
}
