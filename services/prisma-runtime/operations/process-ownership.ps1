function ConvertTo-PrismaCreationTimeUtc {
    [CmdletBinding()]
    param([object]$Value)

    if ($null -eq $Value) { return '' }
    try {
        if ($Value -is [DateTimeOffset]) {
            $utc = $Value.UtcDateTime
        } elseif ($Value -is [DateTime]) {
            $utc = $Value.ToUniversalTime()
        } else {
            $text = [string]$Value
            if ($text -match '^\d{14}(\.\d+)?[+-]\d{3,4}$') {
                $utc = [System.Management.ManagementDateTimeConverter]::ToDateTime($text).ToUniversalTime()
            } else {
                $utc = [DateTime]::Parse($text, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal)
            }
        }
        return $utc.ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ', [Globalization.CultureInfo]::InvariantCulture)
    } catch {
        return ''
    }
}

function Get-PrismaProcessIdentity {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [int]$ProcessId)

    $processInfo = @(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue)
    if ($processInfo.Count -ne 1) { return $null }
    $parentPid = [int]$processInfo[0].ParentProcessId
    $parentCreatedUtc = ''
    if ($parentPid -gt 0) {
        $parentInfo = @(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $parentPid" -ErrorAction SilentlyContinue)
        if ($parentInfo.Count -eq 1 -and [int]$parentInfo[0].ProcessId -eq $parentPid) { $parentCreatedUtc = ConvertTo-PrismaCreationTimeUtc -Value $parentInfo[0].CreationDate }
    }
    $createdUtc = ConvertTo-PrismaCreationTimeUtc -Value $processInfo[0].CreationDate
    return [pscustomobject]@{
        pid = [int]$processInfo[0].ProcessId
        executable = [string]$processInfo[0].ExecutablePath
        commandLine = [string]$processInfo[0].CommandLine
        parentPid = $parentPid
        creationTimeUtc = $createdUtc
        parentCreationTimeUtc = $parentCreatedUtc
    }
}

function Test-PrismaProcessIdentity {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [object]$ProcessIdentity,
        [Parameter(Mandatory = $true)] [string]$ExpectedModule,
        [string]$ExpectedExecutableName = 'python.exe'
    )

    $executable = [string]$ProcessIdentity.executable
    $commandLine = [string]$ProcessIdentity.commandLine
    if ([string]::IsNullOrWhiteSpace($executable) -or [string]::IsNullOrWhiteSpace($commandLine) -or [string]::IsNullOrWhiteSpace([string]$ProcessIdentity.creationTimeUtc)) { return $false }
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFileName($executable), $ExpectedExecutableName)) { return $false }
    return $commandLine.IndexOf("-m $ExpectedModule", [StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Test-PrismaCreationAtOrAfter {
    param([string]$Candidate, [string]$Reference)
    try {
        $candidateTime = [DateTime]::Parse($Candidate, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
        $referenceTime = [DateTime]::Parse($Reference, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
        return $candidateTime.ToUniversalTime() -ge $referenceTime.ToUniversalTime()
    } catch {
        return $false
    }
}

function Resolve-PrismaVerifiedListener {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [int]$Port,
        [object]$WrapperIdentity,
        [Parameter(Mandatory = $true)] [string]$ExpectedModule,
        [string]$ExpectedExecutableName = 'python.exe'
    )

    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -ne 1) { return $null }
    $listenerIdentity = Get-PrismaProcessIdentity -ProcessId ([int]$listeners[0].OwningProcess)
    if (-not $listenerIdentity -or -not (Test-PrismaProcessIdentity -ProcessIdentity $listenerIdentity -ExpectedModule $ExpectedModule -ExpectedExecutableName $ExpectedExecutableName)) { return $null }

    if ($WrapperIdentity) {
        if ([int]$listenerIdentity.pid -eq [int]$WrapperIdentity.pid) {
            if (-not [StringComparer]::OrdinalIgnoreCase.Equals([string]$listenerIdentity.creationTimeUtc, [string]$WrapperIdentity.creationTimeUtc)) { return $null }
        } else {
            if ([int]$listenerIdentity.parentPid -ne [int]$WrapperIdentity.pid) { return $null }
            if (-not (Test-PrismaCreationAtOrAfter -Candidate $listenerIdentity.creationTimeUtc -Reference $WrapperIdentity.creationTimeUtc)) { return $null }
            if ([string]::IsNullOrWhiteSpace([string]$listenerIdentity.parentCreationTimeUtc) -or -not [StringComparer]::OrdinalIgnoreCase.Equals([string]$listenerIdentity.parentCreationTimeUtc, [string]$WrapperIdentity.creationTimeUtc)) { return $null }
        }
    }
    return [pscustomobject]@{
        pid = [int]$listenerIdentity.pid
        executable = [string]$listenerIdentity.executable
        module = $ExpectedModule
        commandLine = [string]$listenerIdentity.commandLine
        creationIdentity = [pscustomobject]@{
            pid = [int]$listenerIdentity.pid
            createdUtc = [string]$listenerIdentity.creationTimeUtc
            parentPid = [int]$listenerIdentity.parentPid
            parentCreatedUtc = [string]$listenerIdentity.parentCreationTimeUtc
        }
        parentPid = [int]$listenerIdentity.parentPid
        creationTimeUtc = [string]$listenerIdentity.creationTimeUtc
        parentCreationTimeUtc = [string]$listenerIdentity.parentCreationTimeUtc
    }
}

function Test-PrismaManifestIdentity {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [object]$Listener,
        [Parameter(Mandatory = $true)] [object]$Record
    )

    $creation = $Record.creationIdentity
    return $creation -and [int]$Listener.pid -eq [int]$creation.pid -and [StringComparer]::OrdinalIgnoreCase.Equals([string]$Listener.executable, [string]$Record.executable) -and [StringComparer]::OrdinalIgnoreCase.Equals([string]$Listener.module, [string]$Record.module) -and [StringComparer]::OrdinalIgnoreCase.Equals([string]$Listener.commandLine, [string]$Record.commandLine) -and [StringComparer]::OrdinalIgnoreCase.Equals([string]$Listener.creationIdentity.createdUtc, [string]$creation.createdUtc) -and [int]$Listener.creationIdentity.parentPid -eq [int]$creation.parentPid
}

function Stop-PrismaWrapperIfSeparate {
    [CmdletBinding()]
    param(
        [object]$WrapperIdentity,
        [int]$WrapperProcessId = 0,
        [Parameter(Mandatory = $true)] [int]$ListenerProcessId,
        [Parameter(Mandatory = $true)] [string]$ExpectedModule,
        [string]$ExpectedExecutableName = 'python.exe'
    )

    if (-not $WrapperIdentity -and $WrapperProcessId -gt 0) { $WrapperIdentity = Get-PrismaProcessIdentity -ProcessId $WrapperProcessId }
    if (-not $WrapperIdentity -or [int]$WrapperIdentity.pid -le 0 -or [int]$WrapperIdentity.pid -eq $ListenerProcessId) { return }
    $currentWrapper = Get-PrismaProcessIdentity -ProcessId ([int]$WrapperIdentity.pid)
    if (-not $currentWrapper) { return }
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals([string]$currentWrapper.creationTimeUtc, [string]$WrapperIdentity.creationTimeUtc)) { return }
    if (Test-PrismaProcessIdentity -ProcessIdentity $currentWrapper -ExpectedModule $ExpectedModule -ExpectedExecutableName $ExpectedExecutableName) { Stop-Process -Id ([int]$currentWrapper.pid) -Force -ErrorAction Stop }
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
            $expectedModule = if ($record.module) { [string]$record.module } elseif ($record.service -eq 'prisma-voice') { 'prisma_runtime.voice_service' } elseif ($record.service -eq 'prisma-local-presentation') { 'prisma_runtime.local_presentation' } else { '' }
            $listener = if ($expectedModule) { Resolve-PrismaVerifiedListener -Port ([int]$record.port) -ExpectedModule $expectedModule -ExpectedExecutableName ([IO.Path]::GetFileName([string]$record.executable)) } else { $null }
            if ($listener -and (Test-PrismaManifestIdentity -Listener $listener -Record $record)) { $remaining += $record }
        }
        if ($remaining.Count -eq 0) {
            Remove-Item -LiteralPath $ManifestPath -Force -ErrorAction SilentlyContinue
        } else {
            $manifest.processes = @($remaining)
            $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8
        }
    } catch {
        Remove-Item -LiteralPath $ManifestPath -Force -ErrorAction SilentlyContinue
    }
}
