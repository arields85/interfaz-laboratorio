function Normalize-PrismaCommandLine {
    [CmdletBinding()]
    param([object]$Value)

    return (([string]$Value -replace '\s+', ' ').Trim())
}

function ConvertTo-PrismaCreationIdentity {
    [CmdletBinding()]
    param([object]$Value)

    if ($null -eq $Value) { return '' }
    if ($Value -is [DateTime]) { return $Value.ToUniversalTime().ToString('o') }
    return ([string]$Value).Trim()
}

function Get-PrismaProcessIdentity {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [int]$ProcessId)

    $processInfo = @(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue)
    if ($processInfo.Count -ne 1) { return $null }
    $creationProperty = $processInfo[0].PSObject.Properties['CreationDate']
    return [pscustomobject]@{
        pid = [int]$processInfo[0].ProcessId
        executable = [string]$processInfo[0].ExecutablePath
        commandLine = Normalize-PrismaCommandLine -Value $processInfo[0].CommandLine
        creationTimeUtc = ConvertTo-PrismaCreationIdentity -Value $(if ($creationProperty) { $creationProperty.Value } else { $null })
    }
}

function Test-PrismaProcessIdentity {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [object]$ProcessIdentity,
        [Parameter(Mandatory = $true)] [string]$ExpectedModule
    )

    $executable = [string]$ProcessIdentity.executable
    $commandLine = Normalize-PrismaCommandLine -Value $ProcessIdentity.commandLine
    $modulePattern = '(^|\s)-m\s+' + [Regex]::Escape($ExpectedModule) + '(?=\s|$)'
    return -not [string]::IsNullOrWhiteSpace($executable) -and [IO.Path]::GetFileName($executable) -match '^python(w)?\.exe$' -and $commandLine -match $modulePattern
}

function Resolve-PrismaVerifiedListener {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [int]$Port,
        [Parameter(Mandatory = $true)] [string]$ExpectedModule
    )

    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -ne 1) { return $null }
    $identity = Get-PrismaProcessIdentity -ProcessId ([int]$listeners[0].OwningProcess)
    if (-not $identity -or -not (Test-PrismaProcessIdentity -ProcessIdentity $identity -ExpectedModule $ExpectedModule)) { return $null }
    return [pscustomobject]@{
        pid = [int]$identity.pid
        executable = [string]$identity.executable
        module = $ExpectedModule
        commandLine = Normalize-PrismaCommandLine -Value $identity.commandLine
        creationTimeUtc = ConvertTo-PrismaCreationIdentity -Value $identity.creationTimeUtc
    }
}

function Get-PrismaExpectedModule {
    param([string]$Service)
    if ($Service -eq 'prisma-voice') { return 'prisma_runtime.voice_service' }
    if ($Service -eq 'prisma-local-presentation') { return 'prisma_runtime.local_presentation' }
    return ''
}

function Test-PrismaManifestIdentity {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [object]$Listener,
        [Parameter(Mandatory = $true)] [object]$Record,
        [switch]$RequireCreationTime
    )

    if (-not $Listener -or [int]$Listener.pid -ne [int]$Record.pid) { return $false }
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath([string]$Listener.executable), [IO.Path]::GetFullPath([string]$Record.executable))) { return $false }
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals([string]$Listener.module, [string]$Record.module)) { return $false }
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals((Normalize-PrismaCommandLine -Value $Listener.commandLine), (Normalize-PrismaCommandLine -Value $Record.commandLine))) { return $false }

    $recordCreationProperty = $Record.PSObject.Properties['creationTimeUtc']
    $listenerCreationProperty = $Listener.PSObject.Properties['creationTimeUtc']
    if ($RequireCreationTime -or $recordCreationProperty) {
        if (-not $recordCreationProperty -or -not $listenerCreationProperty) { return $false }
        $recordCreation = ConvertTo-PrismaCreationIdentity -Value $recordCreationProperty.Value
        $listenerCreation = ConvertTo-PrismaCreationIdentity -Value $listenerCreationProperty.Value
        if ([string]::IsNullOrWhiteSpace($recordCreation) -or -not [StringComparer]::Ordinal.Equals($listenerCreation, $recordCreation)) { return $false }
    }
    return $true
}

function Save-PrismaJsonFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string]$Path,
        [Parameter(Mandatory = $true)] [object]$Value,
        [int]$Depth = 8
    )

    $temporary = "$Path.$PID.tmp"
    try {
        $json = $Value | ConvertTo-Json -Depth $Depth
        $encoding = New-Object System.Text.UTF8Encoding($false)
        [IO.File]::WriteAllText($temporary, $json, $encoding)
        Move-Item -LiteralPath $temporary -Destination $Path -Force
    }
    finally {
        Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    }
}

function Save-PrismaProcessManifest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string]$ManifestPath,
        [Parameter(Mandatory = $true)] [object]$Manifest
    )

    Save-PrismaJsonFile -Path $ManifestPath -Value $Manifest -Depth 8
}

function Invoke-PrismaManifestLock {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string]$LockPath,
        [Parameter(Mandatory = $true)] [scriptblock]$Action,
        [int]$TimeoutMilliseconds = 10000
    )

    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    $stream = $null
    while (-not $stream) {
        try {
            $stream = [IO.File]::Open($LockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        }
        catch [IO.IOException] {
            if ([DateTime]::UtcNow -ge $deadline) {
                throw "Timed out waiting for the Prisma Local manifest lock at $LockPath."
            }
            Start-Sleep -Milliseconds 50
        }
    }
    try {
        & $Action
    }
    finally {
        $stream.Dispose()
    }
}

function Get-PrismaCanonicalManifest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string]$ManifestPath,
        [Parameter(Mandatory = $true)] [string]$RepositoryRoot,
        [switch]$RequireCompleteRuntime
    )

    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { return $null }
    try {
        $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
        if (-not $manifest.repositoryRoot) { return $null }
        $manifestRoot = [IO.Path]::GetFullPath([string]$manifest.repositoryRoot)
        if (-not [StringComparer]::OrdinalIgnoreCase.Equals($manifestRoot, [IO.Path]::GetFullPath($RepositoryRoot))) { return $null }
        if (-not $RequireCompleteRuntime) { return $manifest }

        $records = @($manifest.processes)
        if ($records.Count -ne 2) { return $null }
        foreach ($expected in @(
            @{ service = 'prisma-voice'; port = 5056 },
            @{ service = 'prisma-local-presentation'; port = 5057 }
        )) {
            $matches = @($records | Where-Object { [string]$_.service -eq $expected.service -and [int]$_.port -eq $expected.port })
            if ($matches.Count -ne 1) { return $null }
            $module = Get-PrismaExpectedModule -Service $expected.service
            $listener = Resolve-PrismaVerifiedListener -Port $expected.port -ExpectedModule $module
            if (-not $listener -or -not (Test-PrismaManifestIdentity -Listener $listener -Record $matches[0])) { return $null }
        }
        return $manifest
    }
    catch {
        return $null
    }
}

function Add-PrismaDevelopmentOwner {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [object]$Manifest,
        [Parameter(Mandatory = $true)] [string]$OwnerToken,
        [Parameter(Mandatory = $true)] [string]$ExpectedGeneration
    )

    $ownership = $Manifest.PSObject.Properties['developmentOwnership']
    if (-not $ownership -or [string]$ownership.Value.generation -ne $ExpectedGeneration) {
        throw 'Prisma Local development generation changed before owner registration.'
    }
    $owners = @($ownership.Value.owners | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    if ($OwnerToken -notin $owners) { $owners += $OwnerToken }
    $ownership.Value.owners = @($owners)
}

function Remove-PrismaDevelopmentOwner {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [object]$Manifest,
        [Parameter(Mandatory = $true)] [string]$OwnerToken,
        [Parameter(Mandatory = $true)] [string]$ExpectedGeneration
    )

    $ownership = $Manifest.PSObject.Properties['developmentOwnership']
    if (-not $ownership -or [string]$ownership.Value.generation -ne $ExpectedGeneration) { return $false }
    $owners = @($ownership.Value.owners)
    if ($OwnerToken -notin $owners) { return $false }
    $ownership.Value.owners = @($owners | Where-Object { [string]$_ -ne $OwnerToken })
    return @($ownership.Value.owners).Count -eq 0
}

function Test-PrismaDevelopmentRuntimeIdentity {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [object]$Manifest)

    foreach ($record in @($Manifest.processes)) {
        $module = Get-PrismaExpectedModule -Service ([string]$record.service)
        $listener = if ($module) { Resolve-PrismaVerifiedListener -Port ([int]$record.port) -ExpectedModule $module } else { $null }
        if (-not $listener -or -not (Test-PrismaManifestIdentity -Listener $listener -Record $record -RequireCreationTime)) { return $false }
    }
    return $true
}

function Invoke-PrismaDevelopmentReleaseTransaction {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string]$ManifestPath,
        [Parameter(Mandatory = $true)] [string]$RepositoryRoot,
        [Parameter(Mandatory = $true)] [string]$OwnerToken,
        [string]$ExpectedGeneration = '',
        [switch]$RecoverRegisteredOwner
    )

    $manifest = Get-PrismaCanonicalManifest -ManifestPath $ManifestPath -RepositoryRoot $RepositoryRoot -RequireCompleteRuntime
    if (-not $manifest) {
        Write-Warning 'Prisma Local development release found no complete canonical runtime; foreign or replaced state was left untouched.'
        return
    }
    $ownership = $manifest.PSObject.Properties['developmentOwnership']
    if (-not $ownership) {
        Write-Warning 'Prisma Local has no development ownership record; manual or legacy state was left untouched.'
        return
    }

    $generation = [string]$ownership.Value.generation
    if ($RecoverRegisteredOwner) {
        if ($OwnerToken -notin @($ownership.Value.owners)) { return }
    }
    elseif ([string]::IsNullOrWhiteSpace($ExpectedGeneration) -or $generation -ne $ExpectedGeneration) {
        Write-Warning 'Prisma Local development generation changed; replacement state was left untouched.'
        return
    }
    if (-not (Test-PrismaDevelopmentRuntimeIdentity -Manifest $manifest)) {
        Write-Warning 'Prisma Local development process identity changed; replacement state was left untouched.'
        return
    }

    $shouldStop = Remove-PrismaDevelopmentOwner -Manifest $manifest -OwnerToken $OwnerToken -ExpectedGeneration $generation
    if (-not $shouldStop) {
        Save-PrismaProcessManifest -ManifestPath $ManifestPath -Manifest $manifest
        return
    }

    $remaining = @()
    foreach ($record in @($manifest.processes)) {
        $module = Get-PrismaExpectedModule -Service ([string]$record.service)
        $listener = Resolve-PrismaVerifiedListener -Port ([int]$record.port) -ExpectedModule $module
        if (-not $listener -or -not (Test-PrismaManifestIdentity -Listener $listener -Record $record -RequireCreationTime)) {
            $remaining += $record
            continue
        }
        try {
            Stop-Process -Id ([int]$record.pid) -Force -ErrorAction Stop
        }
        catch {
            $remaining += $record
        }
    }
    if ($remaining.Count -eq 0) {
        Remove-Item -LiteralPath $ManifestPath -Force -ErrorAction SilentlyContinue
    }
    else {
        $manifest.processes = @($remaining)
        Save-PrismaProcessManifest -ManifestPath $ManifestPath -Manifest $manifest
        Write-Warning 'One or more Prisma Local development processes could not be proven or stopped; their records were preserved.'
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
            $expectedModule = Get-PrismaExpectedModule -Service ([string]$record.service)
            $listener = if ($expectedModule) { Resolve-PrismaVerifiedListener -Port ([int]$record.port) -ExpectedModule $expectedModule } else { $null }
            if ($listener -and [StringComparer]::OrdinalIgnoreCase.Equals([string]$record.module, $expectedModule) -and (Test-PrismaManifestIdentity -Listener $listener -Record $record)) { $remaining += $record }
        }
        if ($remaining.Count -eq 0) {
            Remove-Item -LiteralPath $ManifestPath -Force -ErrorAction SilentlyContinue
        } else {
            $manifest.processes = @($remaining)
            Save-PrismaProcessManifest -ManifestPath $ManifestPath -Manifest $manifest
        }
    } catch {
        Remove-Item -LiteralPath $ManifestPath -Force -ErrorAction SilentlyContinue
    }
}
