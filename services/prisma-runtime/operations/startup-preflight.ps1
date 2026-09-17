. (Join-Path $PSScriptRoot 'runtime-environment.ps1')

function Assert-PrismaLocalPortsAvailable {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [int[]]$Ports
    )

    foreach ($port in $Ports) {
        $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
        if ($listeners.Count -gt 0) {
            throw "Prisma Local port $port is occupied; no service was started."
        }
    }
}

function Get-PrismaInterpreterPrefix {
    <#
    .SYNOPSIS
        Reports sys.prefix for an interpreter that already passed identity checks. Test seam.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Interpreter)

    $reported = & $Interpreter -c 'import sys; print(sys.prefix)'
    if ($LASTEXITCODE -ne 0) {
        throw "Could not read sys.prefix from $Interpreter."
    }
    return ([string]$reported).Trim()
}

function Assert-PrismaOwnedInterpreter {
    <#
    .SYNOPSIS
        Guarantees the interpreter about to be launched is the repository-owned one.

    .DESCRIPTION
        Two independent checks run in a deliberate order.

        1. Path identity, a pure string comparison. A foreign interpreter is
           rejected here, so an untrusted binary is never executed and no
           external location is probed.
        2. sys.prefix containment, which proves the interpreter actually runs
           inside <runtime root>\.venv rather than merely sitting at that path.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Interpreter,
        [Parameter(Mandatory = $true)][string]$RuntimeRoot
    )

    $venvRoot = [IO.Path]::GetFullPath((Get-PrismaVirtualEnvironmentRoot -RuntimeRoot $RuntimeRoot))
    $expected = [IO.Path]::GetFullPath((Get-PrismaVirtualEnvironmentPython -RuntimeRoot $RuntimeRoot))
    $candidate = [IO.Path]::GetFullPath($Interpreter)

    if (-not [StringComparer]::OrdinalIgnoreCase.Equals($candidate, $expected)) {
        throw "Refusing to start Prisma Local with a foreign interpreter: $candidate. The only accepted interpreter is the repository-owned $expected. Run operations\bootstrap-local.ps1."
    }
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "The repository-owned Python interpreter is missing: $candidate. Run operations\bootstrap-local.ps1."
    }

    $boundary = ([IO.Path]::GetFullPath((Get-PrismaInterpreterPrefix -Interpreter $candidate))).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $owned = $venvRoot.TrimEnd([IO.Path]::DirectorySeparatorChar)
    $contained = [StringComparer]::OrdinalIgnoreCase.Equals($boundary, $owned) -or $boundary.StartsWith($owned + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
    if (-not $contained) {
        throw "The interpreter $candidate reports sys.prefix '$boundary', which is outside the repository-owned environment $owned. Delete the environment and re-run operations\bootstrap-local.ps1."
    }
}
