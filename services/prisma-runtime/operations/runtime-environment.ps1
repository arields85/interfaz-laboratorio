<#
.SYNOPSIS
    Single source of truth for the repository-owned Prisma Local runtime environment.

.DESCRIPTION
    Every launcher dot-sources this file instead of resolving paths or an
    interpreter on its own. The runtime interpreter is always the virtual
    environment stored next to this checkout, at <runtime root>\.venv. There is
    deliberately no fallback to an interpreter discovered on PATH: a fallback
    turns a broken environment into a silently wrong one.

    All paths are anchored on $PSScriptRoot, so every function behaves the same
    regardless of the caller's current working directory.
#>

function Get-PrismaRuntimeRoot {
    <#
    .SYNOPSIS
        Absolute path of the runtime checkout that owns this operations folder.
    #>
    [CmdletBinding()]
    param()

    return [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
}

function Get-PrismaStateRoot {
    <#
    .SYNOPSIS
        Absolute path of the mutable machine state shared by every checkout.
    #>
    [CmdletBinding()]
    param()

    if ($env:PRISMA_RUNTIME_STATE_DIR) {
        return [IO.Path]::GetFullPath($env:PRISMA_RUNTIME_STATE_DIR)
    }
    return Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'CoreAnalytics\Prisma'
}

function Get-PrismaVirtualEnvironmentRoot {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$RuntimeRoot)

    return Join-Path ([IO.Path]::GetFullPath($RuntimeRoot)) '.venv'
}

function Get-PrismaVirtualEnvironmentPython {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$RuntimeRoot)

    return Join-Path (Get-PrismaVirtualEnvironmentRoot -RuntimeRoot $RuntimeRoot) 'Scripts\python.exe'
}

function Get-PrismaDependencyLockFile {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$RuntimeRoot)

    return Join-Path ([IO.Path]::GetFullPath($RuntimeRoot)) 'requirements.lock.txt'
}

function Get-PrismaConfigurationTemplate {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$RuntimeRoot)

    return Join-Path ([IO.Path]::GetFullPath($RuntimeRoot)) 'config\prisma_voice_config.example.json'
}

function Get-PrismaRequiredPythonVersion {
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

function Resolve-PrismaPython {
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

    $python = Get-PrismaVirtualEnvironmentPython -RuntimeRoot $RuntimeRoot
    if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
        throw "The repository-owned Python interpreter is missing: $python. Run operations\bootstrap-local.ps1 to create it. The launchers never fall back to an interpreter found on PATH."
    }
    return $python
}

function Get-PrismaInterpreterVersion {
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

function Assert-PrismaInterpreterVersion {
    <#
    .SYNOPSIS
        Fails when an interpreter is outside the declared major.minor series.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Interpreter,
        [Parameter(Mandatory = $true)][string]$RequiredVersion
    )

    $found = Get-PrismaInterpreterVersion -Interpreter $Interpreter
    $parts = @($found.Split('.'))
    $foundSeries = if ($parts.Count -ge 2) { "$($parts[0]).$($parts[1])" } else { $found }
    if ($foundSeries -ne $RequiredVersion) {
        throw "Prisma Local requires Python $RequiredVersion, but $Interpreter reports $found. Install Python $RequiredVersion, or point PRISMA_BOOTSTRAP_PYTHON at a matching interpreter, then re-run operations\bootstrap-local.ps1."
    }
    return $found
}

function Resolve-PrismaBootstrapInterpreter {
    <#
    .SYNOPSIS
        Resolves the base interpreter used once, to create the virtual environment.

    .DESCRIPTION
        This is the only place allowed to look outside the owned environment,
        because the owned environment does not exist yet. PRISMA_BOOTSTRAP_PYTHON
        is an explicit, validated and loudly logged override; it is never a
        silent default, and it is not consulted by any launcher.
    #>
    [CmdletBinding()]
    param()

    if ($env:PRISMA_BOOTSTRAP_PYTHON) {
        $configured = [IO.Path]::GetFullPath($env:PRISMA_BOOTSTRAP_PYTHON)
        if (-not (Test-Path -LiteralPath $configured -PathType Leaf)) {
            throw "PRISMA_BOOTSTRAP_PYTHON points at a missing interpreter: $configured."
        }
        Write-Host "Bootstrap interpreter override PRISMA_BOOTSTRAP_PYTHON is active: $configured." -ForegroundColor Yellow
        return $configured
    }

    $command = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $command) {
        throw 'No base Python interpreter was found to create the virtual environment. Install the declared Python version or set PRISMA_BOOTSTRAP_PYTHON to an explicit interpreter path.'
    }
    return $command.Source
}

function New-PrismaVirtualEnvironment {
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

function Install-PrismaLockedDependencies {
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

function Initialize-PrismaVirtualEnvironment {
    <#
    .SYNOPSIS
        Creates the owned environment when absent, reuses it when present, and
        always reconciles it with the dependency lock.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$RuntimeRoot)

    $resolvedRoot = [IO.Path]::GetFullPath($RuntimeRoot)
    $venvRoot = Get-PrismaVirtualEnvironmentRoot -RuntimeRoot $resolvedRoot
    $venvPython = Get-PrismaVirtualEnvironmentPython -RuntimeRoot $resolvedRoot
    $required = Get-PrismaRequiredPythonVersion -RuntimeRoot $resolvedRoot
    $created = $false

    if (Test-Path -LiteralPath $venvPython -PathType Leaf) {
        Write-Host "Reusing the repository-owned virtual environment at $venvRoot."
    }
    else {
        $interpreter = Resolve-PrismaBootstrapInterpreter
        Assert-PrismaInterpreterVersion -Interpreter $interpreter -RequiredVersion $required | Out-Null
        New-PrismaVirtualEnvironment -Interpreter $interpreter -VenvRoot $venvRoot
        if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
            throw "The virtual environment at $venvRoot was created without an interpreter at $venvPython."
        }
        $created = $true
    }

    $effective = Assert-PrismaInterpreterVersion -Interpreter $venvPython -RequiredVersion $required
    Install-PrismaLockedDependencies -Interpreter $venvPython -LockFile (Get-PrismaDependencyLockFile -RuntimeRoot $resolvedRoot)

    return [pscustomobject]@{
        Created       = $created
        VenvRoot      = $venvRoot
        Python        = $venvPython
        PythonVersion = $effective
    }
}

function Initialize-PrismaRuntimeState {
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

    $config = Join-Path $resolvedRoot 'prisma_voice_config.json'
    $seeded = $false

    # Publish-by-rename seeding: the template bytes are written to a unique
    # temporary file in the destination directory (same volume) and published
    # with a rename, so the destination name only ever exposes complete content.
    # The rename still fails when the destination already exists, so an existing
    # effective configuration is never overwritten, and a failed write leaves no
    # destination at all instead of a truncated file that would permanently block
    # future seeding.
    $tempPath = Join-Path $resolvedRoot ("prisma_voice_config.json." + [Guid]::NewGuid().ToString("N") + ".tmp")
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
