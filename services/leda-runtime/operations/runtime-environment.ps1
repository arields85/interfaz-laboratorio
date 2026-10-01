<#
.SYNOPSIS
    Single source of truth for the repository-owned Leda Local runtime environment.

.DESCRIPTION
    Every launcher dot-sources this file instead of resolving paths or an
    interpreter on its own. The runtime interpreter is always the virtual
    environment stored next to this checkout, at <runtime root>\.venv. There is
    deliberately no fallback to an interpreter discovered on PATH: a fallback
    turns a broken environment into a silently wrong one.

    All paths are anchored on $PSScriptRoot, so every function behaves the same
    regardless of the caller's current working directory.
#>

# Age past this threshold is an eligibility condition for sweeping a seeding
# temporary, not proof that its owner is dead: deletion additionally requires
# an attributable owner that is no longer running. See the stale-temporary
# sweep inside Initialize-LedaRuntimeState.
$script:LedaStaleSeedingTemporaryThreshold = [timespan]::FromHours(1)

function Get-LedaRuntimeRoot {
    <#
    .SYNOPSIS
        Absolute path of the runtime checkout that owns this operations folder.
    #>
    [CmdletBinding()]
    param()

    return [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
}

function Get-LedaStateRoot {
    <#
    .SYNOPSIS
        Absolute path of the mutable machine state shared by every checkout.
    #>
    [CmdletBinding()]
    param()

    if ($env:LEDA_RUNTIME_STATE_DIR) {
        return [IO.Path]::GetFullPath($env:LEDA_RUNTIME_STATE_DIR)
    }
    return Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'CoreAnalytics\Leda'
}

function Get-LedaVirtualEnvironmentRoot {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$RuntimeRoot)

    return Join-Path ([IO.Path]::GetFullPath($RuntimeRoot)) '.venv'
}

function Get-LedaVirtualEnvironmentPython {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$RuntimeRoot)

    return Join-Path (Get-LedaVirtualEnvironmentRoot -RuntimeRoot $RuntimeRoot) 'Scripts\python.exe'
}

function Get-LedaDependencyLockFile {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$RuntimeRoot)

    return Join-Path ([IO.Path]::GetFullPath($RuntimeRoot)) 'requirements.lock.txt'
}

function Get-LedaConfigurationTemplate {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$RuntimeRoot)

    return Join-Path ([IO.Path]::GetFullPath($RuntimeRoot)) 'config\leda_voice_config.example.json'
}

function Get-LedaRequiredPythonVersion {
    <#
    .SYNOPSIS
        Reads the declared major.minor Python series from the .python-version pin.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$RuntimeRoot)

    $pin = Join-Path ([IO.Path]::GetFullPath($RuntimeRoot)) '.python-version'
    if (-not (Test-Path -LiteralPath $pin -PathType Leaf)) {
        throw "Missing Python version pin: $pin."
    }
    $declared = (Get-Content -LiteralPath $pin -Raw).Trim()
    if ($declared -notmatch '^\d+\.\d+$') {
        throw "Python version pin '$declared' in $pin must use the major.minor form, for example 3.14."
    }
    return $declared
}

function Resolve-LedaPython {
    <#
    .SYNOPSIS
        Resolves the only interpreter the runtime is allowed to use.

    .DESCRIPTION
        Returns <runtime root>\.venv\Scripts\python.exe and throws when it does
        not exist. This function never inspects PATH and never honours an
        environment override, so a missing environment can never degrade into a
        run against an unrelated interpreter.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$RuntimeRoot)

    $python = Get-LedaVirtualEnvironmentPython -RuntimeRoot $RuntimeRoot
    if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
        throw "The repository-owned Python interpreter is missing: $python. Run operations\bootstrap-local.ps1 to create it. The launchers never fall back to an interpreter found on PATH."
    }
    return $python
}

function Get-LedaInterpreterVersion {
    <#
    .SYNOPSIS
        Reports the major.minor.patch version of an interpreter. Test seam.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Interpreter)

    # The probe deliberately contains no quote characters. PowerShell strips
    # embedded double quotes when it builds a native command line, which would
    # hand Python a syntactically invalid expression.
    $reported = & $Interpreter -c 'import platform; print(platform.python_version())'
    if ($LASTEXITCODE -ne 0) {
        throw "Could not read the Python version reported by $Interpreter."
    }
    return ([string]$reported).Trim()
}

function Assert-LedaInterpreterVersion {
    <#
    .SYNOPSIS
        Fails when an interpreter is outside the declared major.minor series.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Interpreter,
        [Parameter(Mandatory = $true)][string]$RequiredVersion
    )

    $found = Get-LedaInterpreterVersion -Interpreter $Interpreter
    $parts = @($found.Split('.'))
    $foundSeries = if ($parts.Count -ge 2) { "$($parts[0]).$($parts[1])" } else { $found }
    if ($foundSeries -ne $RequiredVersion) {
        throw "Leda Local requires Python $RequiredVersion, but $Interpreter reports $found. Install Python $RequiredVersion, or point LEDA_BOOTSTRAP_PYTHON at a matching interpreter, then re-run operations\bootstrap-local.ps1."
    }
    return $found
}

function Resolve-LedaBootstrapInterpreter {
    <#
    .SYNOPSIS
        Resolves the base interpreter used once, to create the virtual environment.

    .DESCRIPTION
        This is the only place allowed to look outside the owned environment,
        because the owned environment does not exist yet. LEDA_BOOTSTRAP_PYTHON
        is an explicit, validated and loudly logged override; it is never a
        silent default, and it is not consulted by any launcher.
    #>
    [CmdletBinding()]
    param()

    if ($env:LEDA_BOOTSTRAP_PYTHON) {
        $configured = [IO.Path]::GetFullPath($env:LEDA_BOOTSTRAP_PYTHON)
        if (-not (Test-Path -LiteralPath $configured -PathType Leaf)) {
            throw "LEDA_BOOTSTRAP_PYTHON points at a missing interpreter: $configured."
        }
        Write-Host "Bootstrap interpreter override LEDA_BOOTSTRAP_PYTHON is active: $configured." -ForegroundColor Yellow
        return $configured
    }

    $command = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $command) {
        throw 'No base Python interpreter was found to create the virtual environment. Install the declared Python version or set LEDA_BOOTSTRAP_PYTHON to an explicit interpreter path.'
    }
    return $command.Source
}

function New-LedaVirtualEnvironment {
    <#
    .SYNOPSIS
        Creates the virtual environment with the base interpreter. Test seam.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Interpreter,
        [Parameter(Mandatory = $true)][string]$VenvRoot
    )

    & $Interpreter -m venv $VenvRoot | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create the virtual environment at $VenvRoot with $Interpreter."
    }
}

function Install-LedaLockedDependencies {
    <#
    .SYNOPSIS
        Installs the fully pinned, hash-verified dependency graph.

    .DESCRIPTION
        Consumption of the lock needs nothing beyond the stock pip shipped with
        the virtual environment. No extra resolver is on the startup path.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Interpreter,
        [Parameter(Mandatory = $true)][string]$LockFile
    )

    if (-not (Test-Path -LiteralPath $LockFile -PathType Leaf)) {
        throw "Missing dependency lock: $LockFile."
    }
    & $Interpreter -m pip install --disable-pip-version-check --no-input --require-hashes --requirement $LockFile | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Locked dependency installation failed for $LockFile."
    }
}

function Initialize-LedaVirtualEnvironment {
    <#
    .SYNOPSIS
        Creates the owned environment when absent, reuses it when present, and
        always reconciles it with the dependency lock.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$RuntimeRoot)

    $resolvedRoot = [IO.Path]::GetFullPath($RuntimeRoot)
    $venvRoot = Get-LedaVirtualEnvironmentRoot -RuntimeRoot $resolvedRoot
    $venvPython = Get-LedaVirtualEnvironmentPython -RuntimeRoot $resolvedRoot
    $required = Get-LedaRequiredPythonVersion -RuntimeRoot $resolvedRoot
    $created = $false

    if (Test-Path -LiteralPath $venvPython -PathType Leaf) {
        Write-Host "Reusing the repository-owned virtual environment at $venvRoot."
    }
    else {
        $interpreter = Resolve-LedaBootstrapInterpreter
        Assert-LedaInterpreterVersion -Interpreter $interpreter -RequiredVersion $required | Out-Null
        New-LedaVirtualEnvironment -Interpreter $interpreter -VenvRoot $venvRoot
        if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
            throw "The virtual environment at $venvRoot was created without an interpreter at $venvPython."
        }
        $created = $true
    }

    $effective = Assert-LedaInterpreterVersion -Interpreter $venvPython -RequiredVersion $required
    Install-LedaLockedDependencies -Interpreter $venvPython -LockFile (Get-LedaDependencyLockFile -RuntimeRoot $resolvedRoot)

    return [pscustomobject]@{
        Created       = $created
        VenvRoot      = $venvRoot
        Python        = $venvPython
        PythonVersion = $effective
    }
}

function Initialize-LedaRuntimeState {
    <#
    .SYNOPSIS
        Prepares the mutable machine state and seeds the secret-free template.

    .DESCRIPTION
        An existing effective configuration is never overwritten, so operator
        edits survive every re-run.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$StateRoot,
        [Parameter(Mandatory = $true)][string]$Template
    )

    if (-not (Test-Path -LiteralPath $Template -PathType Leaf)) {
        throw "Missing secret-free configuration template: $Template"
    }

    $resolvedRoot = [IO.Path]::GetFullPath($StateRoot)
    New-Item -ItemType Directory -Path $resolvedRoot -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $resolvedRoot 'logs') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $resolvedRoot 'run') -Force | Out-Null

    $config = Join-Path $resolvedRoot 'leda_voice_config.json'
    $seeded = $false

    # Sweep orphaned temporaries left behind by a hard process kill between the
    # temporary write and the rename. This runs BEFORE the already-configured
    # early return below, so an already-configured state root still sheds
    # orphans on every start. The sweep is owner-aware, not unconditionally
    # "safe by construction": every temporary name carries the owning process
    # id, and a temporary is deleted only when it is BOTH older than the
    # threshold AND its owner is no longer running. Age alone is not enough,
    # because FileShare::None protects a temporary only while the handle is
    # open: a live owner suspended past the threshold in the dispose-to-rename
    # interval must never be disturbed. Residual: pid reuse can keep a
    # genuinely orphaned temporary longer than the threshold, which errs
    # toward never deleting a live owner's file. A name that does not parse,
    # or whose owner id cannot be represented as a process id, is skipped
    # entirely: never delete what cannot be attributed. The whole sweep is
    # guarded: ANY unexpected error while enumerating, parsing, aging, looking
    # up the owner or deleting warns and continues, so this opportunistic
    # cleanup can never abort initialization or replace an in-flight exception
    # from the seeding path itself, which stays unguarded. A temporary that
    # vanishes mid-flight surfaces through the existing IOException handler as
    # a genuine error, because the destination is not a leaf. A deletion
    # failure only warns: it must never replace another error and must never
    # turn a lost race into a failure.
    $staleTemporaries = @()
    try {
        $staleTemporaries = @(Get-ChildItem -LiteralPath $resolvedRoot -File -Filter 'leda_voice_config.json.*.tmp' -ErrorAction SilentlyContinue)
    }
    catch {
        try { Write-Warning ("Failed to enumerate the stale seeding temporaries in '{0}': {1}" -f $resolvedRoot, $_.Exception.Message) -WarningAction Continue } catch { }
    }
    foreach ($staleTemporary in $staleTemporaries) {
        try {
            if ($null -eq $staleTemporary) { continue }
            if ($staleTemporary.Name -notmatch '^leda_voice_config\.json\.(\d+)\.[0-9a-f]{32}\.tmp$') { continue }
            $ownerPid = 0
            if (-not [int]::TryParse($Matches[1], [ref]$ownerPid)) { continue }
            if ($staleTemporary.LastWriteTimeUtc -gt ([DateTime]::UtcNow - $script:LedaStaleSeedingTemporaryThreshold)) { continue }
            if (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue) { continue }
            $staleTemporary.Delete()
        }
        catch {
            try { Write-Warning ("Failed to inspect or remove the stale seeding temporary '{0}': {1}" -f $staleTemporary.FullName, $_.Exception.Message) -WarningAction Continue } catch { }
        }
    }

    # An already-configured state root needs no write access on this path:
    # return immediately when the effective configuration is a leaf file. This
    # is an optimization only - the rename below stays the authoritative
    # publication step, so no check-then-act hazard is reintroduced, the
    # directory creation above is never skipped, and the stale-temporary sweep
    # above has already run.
    if (Test-Path -LiteralPath $config -PathType Leaf) {
        return [pscustomobject]@{
            StateRoot     = $resolvedRoot
            Configuration = $config
            Seeded        = $false
        }
    }

    # Publish-by-rename seeding: the template bytes are written to a unique
    # temporary file in the destination directory (same volume) and published
    # with a rename, so the destination name only ever exposes complete content.
    # The rename still fails when the destination already exists, so an existing
    # effective configuration is never overwritten, and a failed write leaves no
    # destination at all instead of a truncated file that would permanently block
    # future seeding.
    # The temporary name carries the owning process id so the sweep can
    # attribute every temporary to its owner.
    $tempPath = Join-Path $resolvedRoot ("leda_voice_config.json." + $PID + "." + [Guid]::NewGuid().ToString("N") + ".tmp")
    $published = $false
    try {
        $tempStream = [IO.File]::Open($tempPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $closeError = $null
        try {
            $source = [IO.File]::Open($Template, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
            try {
                $source.CopyTo($tempStream)
            }
            finally {
                # Disposal cleanup never replaces the error that caused it.
                # The warning is guarded with -WarningAction Continue so a
                # terminating warning preference (-WarningAction Stop or
                # $WarningPreference = 'Stop') cannot itself interrupt the
                # in-flight exception while unwinding.
                try { $source.Dispose() } catch { try { Write-Warning ("Failed to dispose the template read handle for '{0}': {1}" -f $Template, $_.Exception.Message) -WarningAction Continue } catch { } }
            }
        }
        finally {
            # The write is complete only when this handle closes cleanly: no
            # success flag is set before the close. The close failure is both
            # recorded (it becomes the hard error when nothing else is in
            # flight) and reported as a path-bearing warning, because when an
            # earlier exception is already unwinding the recorded error is
            # never rethrown here; the guarded warning is the only diagnostic
            # that survives on that path.
            #
            # The data must also reach the disk before the rename is issued:
            # closing a FileStream flushes only to the operating system, while
            # the rename is journaled metadata on NTFS, so a power cut in the
            # window could persist the final name with absent or partial
            # content. Flush($true) forces the file buffers to the disk. A
            # flush failure is a failure to publish and propagates exactly
            # like a failed close: hard error when nothing else is in flight,
            # guarded path-bearing diagnostic when an exception is already
            # unwinding.
            try { $tempStream.Flush($true) } catch {
                $closeError = $_.Exception
                try { Write-Warning ("Failed to flush the seeding write handle for destination '{0}' (temporary file '{1}'): {2}" -f $config, $tempPath, $_.Exception.Message) -WarningAction Continue } catch { }
            }
            try { $tempStream.Dispose() } catch {
                $closeError = $_.Exception
                try { Write-Warning ("Failed to close the seeding write handle for destination '{0}' (temporary file '{1}'): {2}" -f $config, $tempPath, $_.Exception.Message) -WarningAction Continue } catch { }
            }
        }
        if ($null -ne $closeError) {
            throw $closeError
        }
        try {
            # Same-volume rename: atomic publication that still fails when the
            # destination already exists.
            [IO.File]::Move($tempPath, $config)
            $published = $true
            $seeded = $true
        }
        catch [IO.IOException] {
            if (-not (Test-Path -LiteralPath $config -PathType Leaf)) {
                throw
            }
            # The destination is now a leaf file: another concurrent caller won
            # the rename, or an effective configuration already exists. No
            # overwrite; this caller reports Seeded = false.
        }
    }
    finally {
        # A failed attempt must not leave temporary files behind, and a cleanup
        # failure is surfaced separately without masking the original error.
        if (-not $published -and (Test-Path -LiteralPath $tempPath -PathType Leaf)) {
            try {
                [IO.File]::Delete($tempPath)
            }
            catch {
                try { Write-Warning ("Failed to remove the temporary seeding file '{0}': {1}" -f $tempPath, $_.Exception.Message) -WarningAction Continue } catch { }
            }
        }
    }

    return [pscustomobject]@{
        StateRoot     = $resolvedRoot
        Configuration = $config
        Seeded        = $seeded
    }
}

# --- Prisma -> Leda one-time local migration -------------------------------------------------
# The assistant was renamed, and with it the default machine state directory and the credential
# master key directory. The credential store is encrypted with that key, so the old key must
# arrive intact. Both migrations COPY: the old directories are never moved, modified or deleted,
# an existing new directory or key is never overwritten, and a repeated call is a no-op. This is
# the only place that still names the old locations.

function ConvertTo-LedaName {
    <#
    .SYNOPSIS
        Maps a name containing the old assistant name to its Leda spelling, preserving case.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Name)

    return $Name.Replace('PRISMA', 'LEDA').Replace('Prisma', 'Leda').Replace('prisma', 'leda')
}

function Copy-LedaAccessRules {
    <#
    .SYNOPSIS
        Copies the DACL (including its protection against inheritance) from one path to another.

    .DESCRIPTION
        Goes through the SDDL form on purpose: on Windows PowerShell 5.1, SetAccessControl with a
        security object that was only read (never modified) persists nothing and raises nothing, so
        a protected credential directory would silently inherit its new parent's rules.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    $sections = [Security.AccessControl.AccessControlSections]::Access
    $isDirectory = [IO.Directory]::Exists($Source)
    $sourceItem = if ($isDirectory) { New-Object IO.DirectoryInfo($Source) } else { New-Object IO.FileInfo($Source) }
    $destinationItem = if ($isDirectory) { New-Object IO.DirectoryInfo($Destination) } else { New-Object IO.FileInfo($Destination) }
    $sddl = $sourceItem.GetAccessControl($sections).GetSecurityDescriptorSddlForm($sections)
    $acl = $destinationItem.GetAccessControl($sections)
    $acl.SetSecurityDescriptorSddlForm($sddl, $sections)
    $destinationItem.SetAccessControl($acl)
}

function Copy-LedaAccessRulesOrThrow {
    <#
    .SYNOPSIS
        Copy-LedaAccessRules that fails closed: an error names the destination and is rethrown.

    .DESCRIPTION
        A credential copy that silently kept the inherited, more permissive rules would be worse
        than a launcher that stops, so the migrations never continue past a failed copy.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    try {
        Copy-LedaAccessRules -Source $Source -Destination $Destination
    }
    catch {
        throw ("Could not preserve the access rules of '{0}' (copied from '{1}'): {2}" -f $Destination, $Source, $_.Exception.Message)
    }
}

function Copy-LedaDirectoryTree {
    <#
    .SYNOPSIS
        Recursively copies a directory, preserving each item's DACL, skipping top-level names.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination,
        [string[]]$ExcludeTopLevelName = @()
    )

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    $stack = New-Object System.Collections.Generic.Stack[object]
    $stack.Push([pscustomobject]@{ Source = $Source; Destination = $Destination; Top = $true })
    $directories = New-Object System.Collections.Generic.List[object]
    while ($stack.Count -gt 0) {
        $current = $stack.Pop()
        $directories.Add($current)
        foreach ($child in [IO.Directory]::GetFileSystemEntries($current.Source)) {
            $name = [IO.Path]::GetFileName($child)
            if ($current.Top -and ($ExcludeTopLevelName -contains $name)) { continue }
            $target = Join-Path $current.Destination $name
            if ([IO.Directory]::Exists($child)) {
                New-Item -ItemType Directory -Path $target -Force | Out-Null
                $stack.Push([pscustomobject]@{ Source = $child; Destination = $target; Top = $false })
            }
            else {
                [IO.File]::Copy($child, $target, $false)
                Copy-LedaAccessRulesOrThrow -Source $child -Destination $target
            }
        }
    }
    # Directory rules last, so a protected (non-inheriting) directory never blocks the copy above.
    foreach ($pair in $directories) {
        Copy-LedaAccessRulesOrThrow -Source $pair.Source -Destination $pair.Destination
    }
}

function Invoke-LedaLegacyStateMigration {
    <#
    .SYNOPSIS
        Copies %LOCALAPPDATA%\CoreAnalytics\Prisma to ...\Leda when only the old one exists.

    .DESCRIPTION
        The copy is staged in a sibling directory and renamed into place, so an interrupted run
        never leaves a half-populated Leda directory. Failing to copy any access rule aborts the
        migration (fail closed): the staging directory is removed and the error is thrown. The ephemeral run directory (process
        manifest and locks, which name the old modules) is not copied, and files whose names
        contain the old assistant name are renamed inside the copy.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$LocalAppData)

    $core = Join-Path ([IO.Path]::GetFullPath($LocalAppData)) 'CoreAnalytics'
    $legacy = Join-Path $core 'Prisma'
    $target = Join-Path $core 'Leda'
    $staging = Join-Path $core 'Leda.migrating'
    if ((Test-Path -LiteralPath $target) -or -not (Test-Path -LiteralPath $legacy -PathType Container)) {
        return $false
    }

    if (Test-Path -LiteralPath $staging) {
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
    $renamed = 0
    try {
        Copy-LedaDirectoryTree -Source $legacy -Destination $staging -ExcludeTopLevelName @('run')
        foreach ($item in @(Get-ChildItem -LiteralPath $staging -Recurse -Force | Sort-Object { $_.FullName.Length } -Descending)) {
            $newName = ConvertTo-LedaName -Name $item.Name
            if ($newName -ceq $item.Name) { continue }
            if (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $item.FullName) $newName)) { continue }
            Rename-Item -LiteralPath $item.FullName -NewName $newName
            $renamed++
        }
        [IO.Directory]::Move($staging, $target)
    }
    catch {
        # Fail closed: never leave a half-built or unprotected state directory behind.
        $failure = $_
        if (Test-Path -LiteralPath $staging) {
            try { Remove-Item -LiteralPath $staging -Recurse -Force } catch { Write-Warning ("Could not remove the staging directory '{0}': {1}" -f $staging, $_.Exception.Message) }
        }
        throw $failure
    }
    Write-Host "Migrated the legacy local state '$legacy' to '$target' ($renamed file name(s) renamed). The old directory was left untouched."
    return $true
}

function Invoke-LedaLegacyCredentialKeyMigration {
    <#
    .SYNOPSIS
        Copies the credential master key from ...\PrismaCredentialKey to ...\LedaCredentialKey.

    .DESCRIPTION
        Only when the new master key does not exist yet. The key is staged in a sibling directory
        that gets the old key directory's protected rules first, copied byte for byte (verified),
        and renamed into place, so the final path never holds a truncated or unprotected key. Any
        failure removes the staging directory and throws; the old key is left in place.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$LocalAppData)

    $core = Join-Path ([IO.Path]::GetFullPath($LocalAppData)) 'CoreAnalytics'
    $legacyKey = Join-Path $core 'PrismaCredentialKey\master.key'
    $targetDirectory = Join-Path $core 'LedaCredentialKey'
    $targetKey = Join-Path $targetDirectory 'master.key'
    if ((Test-Path -LiteralPath $targetKey) -or -not (Test-Path -LiteralPath $legacyKey -PathType Leaf)) {
        return $false
    }

    $staging = Join-Path $core 'LedaCredentialKey.migrating'
    $stagedKey = Join-Path $staging 'master.key'
    if (Test-Path -LiteralPath $staging) {
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
    if ((Test-Path -LiteralPath $targetDirectory -PathType Container) -and -not @(Get-ChildItem -LiteralPath $targetDirectory -Force).Count) {
        # An empty directory left by an interrupted run would block the rename into place.
        Remove-Item -LiteralPath $targetDirectory -Force
    }
    try {
        New-Item -ItemType Directory -Path $staging -Force | Out-Null
        # The directory rules first, so the key is never written into a more permissive location.
        Copy-LedaAccessRulesOrThrow -Source (Split-Path -Parent $legacyKey) -Destination $staging
        [IO.File]::Copy($legacyKey, $stagedKey, $false)
        Copy-LedaAccessRulesOrThrow -Source $legacyKey -Destination $stagedKey
        $sourceBytes = [IO.File]::ReadAllBytes($legacyKey)
        $copiedBytes = [IO.File]::ReadAllBytes($stagedKey)
        if ($sourceBytes.Length -ne $copiedBytes.Length -or -not [Linq.Enumerable]::SequenceEqual([byte[]]$sourceBytes, [byte[]]$copiedBytes)) {
            throw "The copied credential master key '$stagedKey' does not match '$legacyKey'."
        }
        [IO.Directory]::Move($staging, $targetDirectory)
    }
    catch {
        # Fail closed: never leave a key with inherited rules or a truncated key at the final path.
        $failure = $_
        if (Test-Path -LiteralPath $staging) {
            try { Remove-Item -LiteralPath $staging -Recurse -Force } catch { Write-Warning ("Could not remove the staging directory '{0}': {1}" -f $staging, $_.Exception.Message) }
        }
        throw $failure
    }
    Write-Host "Migrated the legacy credential master key to '$targetKey'. The old key was left untouched."
    return $true
}

function Invoke-LedaLegacyLocalMigration {
    <#
    .SYNOPSIS
        Runs the one-time local migrations; call it before any read of the state or the key.

    .DESCRIPTION
        The state copy is skipped when LEDA_RUNTIME_STATE_DIR points the runtime elsewhere, because
        the default directory is then not in use. A variable that names the default directory itself
        (start-local.ps1 exports it before migrating) still migrates. The master key copy always
        applies: its default location is independent of the state directory.
    #>
    [CmdletBinding()]
    param([string]$LocalAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData))

    $defaultState = Join-Path ([IO.Path]::GetFullPath($LocalAppData)) 'CoreAnalytics\Leda'
    $configuredState = if ($env:LEDA_RUNTIME_STATE_DIR) { [IO.Path]::GetFullPath($env:LEDA_RUNTIME_STATE_DIR).TrimEnd('\') } else { $null }
    $state = $false
    if (-not $configuredState -or $configuredState -ieq $defaultState) {
        $state = Invoke-LedaLegacyStateMigration -LocalAppData $LocalAppData
    }
    $key = Invoke-LedaLegacyCredentialKeyMigration -LocalAppData $LocalAppData
    return [pscustomobject]@{ StateMigrated = $state; CredentialKeyMigrated = $key }
}
