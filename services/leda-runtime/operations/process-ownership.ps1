function Normalize-LedaCommandLine {
    [CmdletBinding()]
    param([object]$Value)

    return (([string]$Value -replace '\s+', ' ').Trim())
}

function ConvertTo-LedaCreationIdentity {
    [CmdletBinding()]
    param([object]$Value)

    if ($null -eq $Value) { return '' }
    if ($Value -is [DateTime]) { return $Value.ToUniversalTime().ToString('o') }
    return ([string]$Value).Trim()
}

function ConvertTo-LedaOwnerCreationTime {
    [CmdletBinding()]
    param([object]$Value)

    if ($null -eq $Value) { return '' }
    $parsed = [DateTime]::MinValue
    if ($Value -is [DateTime]) {
        $parsed = [DateTime]$Value
    }
    elseif (-not [DateTime]::TryParse(
        ([string]$Value).Trim(),
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::RoundtripKind,
        [ref]$parsed
    )) {
        return ''
    }
    return $parsed.ToUniversalTime().ToString('o', [Globalization.CultureInfo]::InvariantCulture)
}

function ConvertTo-LedaOwnerProcessId {
    [CmdletBinding()]
    param([object]$Value)

    if ($null -eq $Value -or $Value -is [bool]) { return 0 }
    $parsed = 0
    if (-not [int]::TryParse(
        ([string]$Value).Trim(),
        [Globalization.NumberStyles]::None,
        [Globalization.CultureInfo]::InvariantCulture,
        [ref]$parsed
    ) -or $parsed -le 0) {
        return 0
    }
    return $parsed
}

function Get-LedaDevelopmentOwnerState {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [object]$OwnerIdentity)

    if ($null -eq $OwnerIdentity) { return 'unknown' }
    if ($OwnerIdentity -is [Collections.IDictionary]) {
        if (-not $OwnerIdentity.Contains('pid') -or -not $OwnerIdentity.Contains('creationTimeUtc')) { return 'unknown' }
        $storedPid = $OwnerIdentity['pid']
        $storedCreationValue = $OwnerIdentity['creationTimeUtc']
    }
    else {
        $pidProperty = $OwnerIdentity.PSObject.Properties['pid']
        $creationProperty = $OwnerIdentity.PSObject.Properties['creationTimeUtc']
        if (-not $pidProperty -or -not $creationProperty) { return 'unknown' }
        $storedPid = $pidProperty.Value
        $storedCreationValue = $creationProperty.Value
    }
    $pidValue = ConvertTo-LedaOwnerProcessId -Value $storedPid
    $storedCreation = ConvertTo-LedaOwnerCreationTime -Value $storedCreationValue
    if ($pidValue -eq 0 -or [string]::IsNullOrWhiteSpace($storedCreation) -or
        -not [StringComparer]::Ordinal.Equals($storedCreation, ([string]$storedCreationValue).Trim())) {
        return 'unknown'
    }

    try {
        $matches = @(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction Stop)
    }
    catch {
        return 'unknown'
    }
    if ($matches.Count -eq 0) { return 'dead' }
    if ($matches.Count -ne 1 -or (ConvertTo-LedaOwnerProcessId -Value $matches[0].ProcessId) -ne $pidValue) { return 'unknown' }

    $creationProperty = $matches[0].PSObject.Properties['CreationDate']
    $currentCreation = ConvertTo-LedaOwnerCreationTime -Value $(if ($creationProperty) { $creationProperty.Value } else { $null })
    if ([string]::IsNullOrWhiteSpace($currentCreation)) { return 'unknown' }
    if ([StringComparer]::Ordinal.Equals($currentCreation, $storedCreation)) { return 'alive' }
    return 'dead'
}

function Get-LedaProcessIdentity {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [int]$ProcessId)

    $processInfo = @(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue)
    if ($processInfo.Count -ne 1) { return $null }
    $creationProperty = $processInfo[0].PSObject.Properties['CreationDate']
    return [pscustomobject]@{
        pid = [int]$processInfo[0].ProcessId
        executable = [string]$processInfo[0].ExecutablePath
        commandLine = Normalize-LedaCommandLine -Value $processInfo[0].CommandLine
        creationTimeUtc = ConvertTo-LedaCreationIdentity -Value $(if ($creationProperty) { $creationProperty.Value } else { $null })
    }
}

function Test-LedaProcessIdentity {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [object]$ProcessIdentity,
        [Parameter(Mandatory = $true)] [string]$ExpectedModule
    )

    $executable = [string]$ProcessIdentity.executable
    $commandLine = Normalize-LedaCommandLine -Value $ProcessIdentity.commandLine
    $modulePattern = '(^|\s)-m\s+' + [Regex]::Escape($ExpectedModule) + '(?=\s|$)'
    return -not [string]::IsNullOrWhiteSpace($executable) -and [IO.Path]::GetFileName($executable) -match '^python(w)?\.exe$' -and $commandLine -match $modulePattern
}

function Resolve-LedaVerifiedListener {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [int]$Port,
        [Parameter(Mandatory = $true)] [string]$ExpectedModule
    )

    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -ne 1) { return $null }
    $identity = Get-LedaProcessIdentity -ProcessId ([int]$listeners[0].OwningProcess)
    if (-not $identity -or -not (Test-LedaProcessIdentity -ProcessIdentity $identity -ExpectedModule $ExpectedModule)) { return $null }
    return [pscustomobject]@{
        pid = [int]$identity.pid
        executable = [string]$identity.executable
        module = $ExpectedModule
        commandLine = Normalize-LedaCommandLine -Value $identity.commandLine
        creationTimeUtc = ConvertTo-LedaCreationIdentity -Value $identity.creationTimeUtc
    }
}

function Get-LedaExpectedModule {
    param([string]$Service)
    if ($Service -eq 'leda-voice') { return 'leda_runtime.voice_service' }
    if ($Service -eq 'leda-local-presentation') { return 'leda_runtime.local_presentation' }
    return ''
}

function Test-LedaManifestIdentity {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [object]$Listener,
        [Parameter(Mandatory = $true)] [object]$Record,
        [switch]$RequireCreationTime
    )

    if (-not $Listener -or [int]$Listener.pid -ne [int]$Record.pid) { return $false }
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath([string]$Listener.executable), [IO.Path]::GetFullPath([string]$Record.executable))) { return $false }
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals([string]$Listener.module, [string]$Record.module)) { return $false }
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals((Normalize-LedaCommandLine -Value $Listener.commandLine), (Normalize-LedaCommandLine -Value $Record.commandLine))) { return $false }

    $recordCreationProperty = $Record.PSObject.Properties['creationTimeUtc']
    $listenerCreationProperty = $Listener.PSObject.Properties['creationTimeUtc']
    if ($RequireCreationTime -or $recordCreationProperty) {
        if (-not $recordCreationProperty -or -not $listenerCreationProperty) { return $false }
        $recordCreation = ConvertTo-LedaCreationIdentity -Value $recordCreationProperty.Value
        $listenerCreation = ConvertTo-LedaCreationIdentity -Value $listenerCreationProperty.Value
        if ([string]::IsNullOrWhiteSpace($recordCreation) -or -not [StringComparer]::Ordinal.Equals($listenerCreation, $recordCreation)) { return $false }
    }
    return $true
}

function Save-LedaJsonFile {
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

function Save-LedaProcessManifest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string]$ManifestPath,
        [Parameter(Mandatory = $true)] [object]$Manifest
    )

    Save-LedaJsonFile -Path $ManifestPath -Value $Manifest -Depth 8
}

function Invoke-LedaManifestLock {
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
                throw "Timed out waiting for the Leda Local manifest lock at $LockPath."
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

function Get-LedaCanonicalManifest {
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
            @{ service = 'leda-voice'; port = 5056 },
            @{ service = 'leda-local-presentation'; port = 5057 }
        )) {
            $matches = @($records | Where-Object { [string]$_.service -eq $expected.service -and [int]$_.port -eq $expected.port })
            if ($matches.Count -ne 1) { return $null }
            $module = Get-LedaExpectedModule -Service $expected.service
            $listener = Resolve-LedaVerifiedListener -Port $expected.port -ExpectedModule $module
            if (-not $listener -or -not (Test-LedaManifestIdentity -Listener $listener -Record $matches[0])) { return $null }
        }
        return $manifest
    }
    catch {
        return $null
    }
}

function Test-LedaOwnerTokenEqual {
    param([object]$Left, [object]$Right)
    return [StringComparer]::OrdinalIgnoreCase.Equals([string]$Left, [string]$Right)
}

function Get-LedaOwnerIdentityEntries {
    param(
        [Parameter(Mandatory = $true)] [object]$Ownership,
        [Parameter(Mandatory = $true)] [string]$OwnerToken
    )

    $mapProperty = $Ownership.PSObject.Properties['ownerIdentities']
    if (-not $mapProperty -or $null -eq $mapProperty.Value) { return @() }
    $map = $mapProperty.Value
    $entries = @()
    if ($map -is [Collections.IDictionary]) {
        foreach ($key in @($map.Keys)) {
            if (Test-LedaOwnerTokenEqual -Left $key -Right $OwnerToken) {
                $entries += [pscustomobject]@{ name = [string]$key; value = $map[$key] }
            }
        }
    }
    else {
        foreach ($property in @($map.PSObject.Properties)) {
            if (Test-LedaOwnerTokenEqual -Left $property.Name -Right $OwnerToken) {
                $entries += [pscustomobject]@{ name = [string]$property.Name; value = $property.Value }
            }
        }
    }
    return @($entries)
}

function Get-LedaDevelopmentOwnerIdentity {
    param(
        [Parameter(Mandatory = $true)] [object]$Ownership,
        [Parameter(Mandatory = $true)] [string]$OwnerToken
    )

    $entries = @(Get-LedaOwnerIdentityEntries -Ownership $Ownership -OwnerToken $OwnerToken)
    if ($entries.Count -ne 1) { return $null }
    $identity = $entries[0].value
    if ($null -eq $identity) { return $null }
    if ($identity -is [Collections.IDictionary]) {
        if (-not $identity.Contains('pid') -or -not $identity.Contains('creationTimeUtc')) { return $null }
        $storedPid = $identity['pid']
        $storedCreation = $identity['creationTimeUtc']
    }
    else {
        $pidProperty = $identity.PSObject.Properties['pid']
        $creationProperty = $identity.PSObject.Properties['creationTimeUtc']
        if (-not $pidProperty -or -not $creationProperty) { return $null }
        $storedPid = $pidProperty.Value
        $storedCreation = $creationProperty.Value
    }
    $pidValue = ConvertTo-LedaOwnerProcessId -Value $storedPid
    $creation = ConvertTo-LedaOwnerCreationTime -Value $storedCreation
    if ($pidValue -eq 0 -or [string]::IsNullOrWhiteSpace($creation) -or
        -not [StringComparer]::Ordinal.Equals($creation, ([string]$storedCreation).Trim())) {
        return $null
    }
    return [ordered]@{ pid = $pidValue; creationTimeUtc = $creation }
}

function Remove-LedaDevelopmentOwnerIdentity {
    param(
        [Parameter(Mandatory = $true)] [object]$Ownership,
        [Parameter(Mandatory = $true)] [string]$OwnerToken
    )

    $mapProperty = $Ownership.PSObject.Properties['ownerIdentities']
    if (-not $mapProperty -or $null -eq $mapProperty.Value) { return }
    $map = $mapProperty.Value
    foreach ($entry in @(Get-LedaOwnerIdentityEntries -Ownership $Ownership -OwnerToken $OwnerToken)) {
        if ($map -is [Collections.IDictionary]) { $map.Remove($entry.name) }
        else { $map.PSObject.Properties.Remove($entry.name) }
    }
}

function Set-LedaDevelopmentOwnerIdentity {
    param(
        [Parameter(Mandatory = $true)] [object]$Ownership,
        [Parameter(Mandatory = $true)] [string]$OwnerToken,
        [Parameter(Mandatory = $true)] [object]$OwnerIdentity
    )

    if (@(Get-LedaOwnerIdentityEntries -Ownership $Ownership -OwnerToken $OwnerToken).Count -gt 0) {
        throw 'Leda Local development owner identity metadata collides with the registering token.'
    }
    $mapProperty = $Ownership.PSObject.Properties['ownerIdentities']
    if (-not $mapProperty) {
        $Ownership | Add-Member -NotePropertyName ownerIdentities -NotePropertyValue ([ordered]@{})
        $mapProperty = $Ownership.PSObject.Properties['ownerIdentities']
    }
    if ($mapProperty.Value -is [Collections.IDictionary]) {
        $mapProperty.Value[$OwnerToken] = $OwnerIdentity
    }
    else {
        $mapProperty.Value | Add-Member -NotePropertyName $OwnerToken -NotePropertyValue $OwnerIdentity
    }
}

function Invoke-LedaDevelopmentOwnerReap {
    param(
        [Parameter(Mandatory = $true)] [object]$Ownership,
        [string]$ExcludedOwnerToken = ''
    )

    $owners = @($Ownership.owners | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    $dead = @()
    $warnings = @()
    $visited = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($owner in $owners) {
        $ownerToken = [string]$owner
        if (-not $visited.Add($ownerToken) -or
            (-not [string]::IsNullOrWhiteSpace($ExcludedOwnerToken) -and (Test-LedaOwnerTokenEqual -Left $ownerToken -Right $ExcludedOwnerToken))) {
            continue
        }
        $identity = Get-LedaDevelopmentOwnerIdentity -Ownership $Ownership -OwnerToken $ownerToken
        if (-not $identity) {
            $warnings += "Leda Local development owner '$ownerToken' has unknown identity metadata and was retained."
            continue
        }
        $state = Get-LedaDevelopmentOwnerState -OwnerIdentity $identity
        if ($state -eq 'dead') { $dead += $ownerToken }
        elseif ($state -eq 'unknown') { $warnings += "Leda Local development owner '$ownerToken' liveness is unknown and was retained." }
    }
    foreach ($ownerToken in $dead) {
        $owners = @($owners | Where-Object { -not (Test-LedaOwnerTokenEqual -Left $_ -Right $ownerToken) })
        Remove-LedaDevelopmentOwnerIdentity -Ownership $Ownership -OwnerToken $ownerToken
    }
    $Ownership.owners = @($owners)
    return [pscustomobject]@{ warnings = @($warnings) }
}

function Write-LedaDevelopmentOwnerWarnings {
    param([string[]]$Messages)
    foreach ($message in @($Messages)) { Write-Warning $message -WarningAction Continue }
}

function Get-LedaDevelopmentOwnerRegistrationIdentity {
    param([Parameter(Mandatory = $true)] [object]$ProcessId)

    $pidValue = ConvertTo-LedaOwnerProcessId -Value $ProcessId
    if ($pidValue -eq 0) { throw 'Leda Local development owner process id is invalid.' }
    try {
        $matches = @(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction Stop)
    }
    catch {
        throw 'Leda Local development owner process identity could not be proven.'
    }
    if ($matches.Count -ne 1 -or (ConvertTo-LedaOwnerProcessId -Value $matches[0].ProcessId) -ne $pidValue) {
        throw 'Leda Local development owner process identity could not be proven.'
    }
    $creationProperty = $matches[0].PSObject.Properties['CreationDate']
    $creation = ConvertTo-LedaOwnerCreationTime -Value $(if ($creationProperty) { $creationProperty.Value } else { $null })
    if ([string]::IsNullOrWhiteSpace($creation)) {
        throw 'Leda Local development owner process creation time could not be proven.'
    }
    return [ordered]@{ pid = $pidValue; creationTimeUtc = $creation }
}

function Add-LedaDevelopmentOwner {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [object]$Manifest,
        [Parameter(Mandatory = $true)] [string]$OwnerToken,
        [Parameter(Mandatory = $true)] [string]$ExpectedGeneration,
        [object]$OwnerIdentity = $null
    )

    $ownership = $Manifest.PSObject.Properties['developmentOwnership']
    if (-not $ownership -or [string]$ownership.Value.generation -ne $ExpectedGeneration) {
        throw 'Leda Local development generation changed before owner registration.'
    }
    $owners = @($ownership.Value.owners | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    if ($owners | Where-Object { Test-LedaOwnerTokenEqual -Left $_ -Right $OwnerToken }) {
        if ($null -eq $OwnerIdentity) { return }
        throw 'Leda Local development owner token is already registered.'
    }
    $owners += $OwnerToken
    $ownership.Value.owners = @($owners)
    if ($null -ne $OwnerIdentity) {
        Set-LedaDevelopmentOwnerIdentity -Ownership $ownership.Value -OwnerToken $OwnerToken -OwnerIdentity $OwnerIdentity
    }
}

function Remove-LedaDevelopmentOwner {
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
    $ownership.Value.owners = @($owners | Where-Object { -not (Test-LedaOwnerTokenEqual -Left $_ -Right $OwnerToken) })
    Remove-LedaDevelopmentOwnerIdentity -Ownership $ownership.Value -OwnerToken $OwnerToken
    return @($ownership.Value.owners).Count -eq 0
}

function Test-LedaDevelopmentRuntimeIdentity {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [object]$Manifest)

    foreach ($record in @($Manifest.processes)) {
        $module = Get-LedaExpectedModule -Service ([string]$record.service)
        $listener = if ($module) { Resolve-LedaVerifiedListener -Port ([int]$record.port) -ExpectedModule $module } else { $null }
        if (-not $listener -or -not (Test-LedaManifestIdentity -Listener $listener -Record $record -RequireCreationTime)) { return $false }
    }
    return $true
}

function Invoke-LedaDevelopmentReleaseTransaction {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string]$ManifestPath,
        [Parameter(Mandatory = $true)] [string]$RepositoryRoot,
        [Parameter(Mandatory = $true)] [string]$OwnerToken,
        [string]$ExpectedGeneration = '',
        [switch]$RecoverRegisteredOwner
    )

    $manifest = Get-LedaCanonicalManifest -ManifestPath $ManifestPath -RepositoryRoot $RepositoryRoot -RequireCompleteRuntime
    if (-not $manifest) {
        Write-Warning 'Leda Local development release found no complete canonical runtime; foreign or replaced state was left untouched.'
        return
    }
    $ownership = $manifest.PSObject.Properties['developmentOwnership']
    if (-not $ownership) {
        Write-Warning 'Leda Local has no development ownership record; manual or legacy state was left untouched.'
        return
    }

    $generation = [string]$ownership.Value.generation
    $callerRegistered = @($ownership.Value.owners | Where-Object { Test-LedaOwnerTokenEqual -Left $_ -Right $OwnerToken }).Count -gt 0
    if (-not $callerRegistered) { return }
    if (-not $RecoverRegisteredOwner -and ([string]::IsNullOrWhiteSpace($ExpectedGeneration) -or $generation -ne $ExpectedGeneration)) {
        Write-Warning 'Leda Local development generation changed; replacement state was left untouched.'
        return
    }
    if (-not (Test-LedaDevelopmentRuntimeIdentity -Manifest $manifest)) {
        Write-Warning 'Leda Local development process identity changed; replacement state was left untouched.'
        return
    }

    $reap = Invoke-LedaDevelopmentOwnerReap -Ownership $ownership.Value -ExcludedOwnerToken $OwnerToken
    [void](Remove-LedaDevelopmentOwner -Manifest $manifest -OwnerToken $OwnerToken -ExpectedGeneration $generation)
    $shouldStop = @($ownership.Value.owners).Count -eq 0
    if (-not $shouldStop) {
        Save-LedaProcessManifest -ManifestPath $ManifestPath -Manifest $manifest
        Write-LedaDevelopmentOwnerWarnings -Messages $reap.warnings
        return
    }

    $remaining = @()
    foreach ($record in @($manifest.processes)) {
        $module = Get-LedaExpectedModule -Service ([string]$record.service)
        $listener = Resolve-LedaVerifiedListener -Port ([int]$record.port) -ExpectedModule $module
        if (-not $listener -or -not (Test-LedaManifestIdentity -Listener $listener -Record $record -RequireCreationTime)) {
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
        Save-LedaProcessManifest -ManifestPath $ManifestPath -Manifest $manifest
        Write-Warning 'One or more Leda Local development processes could not be proven or stopped; their records were preserved.'
    }
    Write-LedaDevelopmentOwnerWarnings -Messages $reap.warnings
}

function Resolve-LedaPortState {
    <#
    .SYNOPSIS
        Classifies a local port for the always-start launcher recovery path
        with exactly one Get-NetTCPConnection call.

    .DESCRIPTION
        Returns a pscustomobject with `state` one of:
          - 'free': no listener at all.
          - 'ours': a single listener verified (by path + `-m <module>`
            command line) as this repository's Leda module; safe to stop.
          - 'foreign': a listener present but not verified as ours; NEVER a
            stop target. `pid` and (when resolvable) `processName` are set.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [int]$Port,
        [Parameter(Mandatory = $true)] [string]$ExpectedModule
    )

    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { return [pscustomobject]@{ state = 'free'; pid = 0; processName = '' } }

    $ownerPid = [int]$listeners[0].OwningProcess
    $identity = Get-LedaProcessIdentity -ProcessId $ownerPid
    if ($identity -and (Test-LedaProcessIdentity -ProcessIdentity $identity -ExpectedModule $ExpectedModule)) {
        return [pscustomobject]@{ state = 'ours'; pid = $ownerPid; processName = '' }
    }

    $processName = ''
    if ($identity -and -not [string]::IsNullOrWhiteSpace([string]$identity.executable)) {
        $processName = [IO.Path]::GetFileName([string]$identity.executable)
    }
    return [pscustomobject]@{ state = 'foreign'; pid = $ownerPid; processName = $processName }
}

function Test-LedaViteProcessIdentity {
    <#
    .SYNOPSIS
        Node/Vite counterpart to Test-LedaProcessIdentity (T18b): verifies a listener is
        node.exe running THIS repository's own Vite CLI script, instead of python.exe running a
        Leda module.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [object]$ProcessIdentity,
        [Parameter(Mandatory = $true)] [string]$ExpectedViteCliPath
    )

    $executable = [string]$ProcessIdentity.executable
    $commandLine = Normalize-LedaCommandLine -Value $ProcessIdentity.commandLine
    $cliToken = Normalize-LedaCommandLine -Value $ExpectedViteCliPath
    $cliPattern = '(^|\s)"?' + [Regex]::Escape($cliToken) + '"?(?=\s|$)'
    return -not [string]::IsNullOrWhiteSpace($executable) -and [IO.Path]::GetFileName($executable) -match '^node(w)?\.exe$' -and $commandLine -match $cliPattern
}

function Resolve-LedaViteDevPortState {
    <#
    .SYNOPSIS
        Classifies a local port for the Vite dev-server leftover-listener guard (dev.mjs, T18b)
        with exactly one Get-NetTCPConnection call -- same single-snapshot 'free'/'ours'/'foreign'
        contract as Resolve-LedaPortState, generalized to verify a node.exe process running
        THIS repository's Vite CLI script instead of a Python module.

    .DESCRIPTION
        Returns a pscustomobject with `state` one of:
          - 'free': no listener at all.
          - 'ours': a single listener verified (by executable name + Vite CLI script path in the
            command line) as this repository's own Vite dev server; safe to stop.
          - 'foreign': a listener present but not verified as ours; NEVER a stop target. `pid`
            and (when resolvable) `processName` are set.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [int]$Port,
        [Parameter(Mandatory = $true)] [string]$ExpectedViteCliPath
    )

    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { return [pscustomobject]@{ state = 'free'; pid = 0; processName = '' } }

    $ownerPid = [int]$listeners[0].OwningProcess
    $identity = Get-LedaProcessIdentity -ProcessId $ownerPid
    if ($identity -and (Test-LedaViteProcessIdentity -ProcessIdentity $identity -ExpectedViteCliPath $ExpectedViteCliPath)) {
        return [pscustomobject]@{ state = 'ours'; pid = $ownerPid; processName = '' }
    }

    $processName = ''
    if ($identity -and -not [string]::IsNullOrWhiteSpace([string]$identity.executable)) {
        $processName = [IO.Path]::GetFileName([string]$identity.executable)
    }
    return [pscustomobject]@{ state = 'foreign'; pid = $ownerPid; processName = $processName }
}

function Test-LedaDevelopmentRuntimeHealthy {
    <#
    .SYNOPSIS
        Single-attempt health check (no retry loop) for a warm-reuse decision;
        distinct from Wait-VoiceReady/Wait-PresentationReady in start-local.ps1,
        which poll while actively starting a fresh process.
    #>
    [CmdletBinding()]
    param()

    try {
        $voiceHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5056/health' -TimeoutSec 2
    }
    catch {
        return $false
    }
    if (-not ($voiceHealth.ok -eq $true -and $voiceHealth.ready -eq $true -and $voiceHealth.service -eq 'leda-voice' -and $voiceHealth.mode -eq 'local')) { return $false }

    try {
        $presentationHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5057/health' -TimeoutSec 2
    }
    catch {
        return $false
    }
    if (-not ($presentationHealth.ok -eq $true -and $presentationHealth.ready -eq $true -and $presentationHealth.service -eq 'leda-local-presentation' -and $presentationHealth.mode -eq 'local' -and $presentationHealth.ledaVoiceReady -eq $true)) { return $false }

    return $true
}

function Prune-LedaProcessManifest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string]$ManifestPath,
        [Parameter(Mandatory = $true)] [string]$RepositoryRoot
    )

    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { return }
    try {
        $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
        if ($manifest.PSObject.Properties['developmentOwnership']) { return }
        $manifestRoot = [IO.Path]::GetFullPath([string]$manifest.repositoryRoot)
        if (-not [StringComparer]::OrdinalIgnoreCase.Equals($manifestRoot, [IO.Path]::GetFullPath($RepositoryRoot))) { return }
        $remaining = @()
        foreach ($record in @($manifest.processes)) {
            $expectedModule = Get-LedaExpectedModule -Service ([string]$record.service)
            $listener = if ($expectedModule) { Resolve-LedaVerifiedListener -Port ([int]$record.port) -ExpectedModule $expectedModule } else { $null }
            if ($listener -and [StringComparer]::OrdinalIgnoreCase.Equals([string]$record.module, $expectedModule) -and (Test-LedaManifestIdentity -Listener $listener -Record $record)) { $remaining += $record }
        }
        if ($remaining.Count -eq 0) {
            Remove-Item -LiteralPath $ManifestPath -Force -ErrorAction SilentlyContinue
        } else {
            $manifest.processes = @($remaining)
            Save-LedaProcessManifest -ManifestPath $ManifestPath -Manifest $manifest
        }
    } catch {
        return
    }
}
