function Normalize-PrismaCommandLine {
    [CmdletBinding()]
    param([object]$Value)

    return (([string]$Value -replace '\s+', ' ').Trim())
}

function Get-PrismaProcessIdentity {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [int]$ProcessId)

    $processInfo = @(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue)
    if ($processInfo.Count -ne 1) { return $null }
    return [pscustomobject]@{
        pid = [int]$processInfo[0].ProcessId
        executable = [string]$processInfo[0].ExecutablePath
        commandLine = Normalize-PrismaCommandLine -Value $processInfo[0].CommandLine
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
        [Parameter(Mandatory = $true)] [object]$Record
    )

    return $Listener -and [int]$Listener.pid -eq [int]$Record.pid -and [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath([string]$Listener.executable), [IO.Path]::GetFullPath([string]$Record.executable)) -and [StringComparer]::OrdinalIgnoreCase.Equals([string]$Listener.module, [string]$Record.module) -and [StringComparer]::OrdinalIgnoreCase.Equals((Normalize-PrismaCommandLine -Value $Listener.commandLine), (Normalize-PrismaCommandLine -Value $Record.commandLine))
}

function Stop-PrismaWrapperIfSeparate {
    [CmdletBinding()]
    param(
        [int]$WrapperProcessId = 0,
        [Parameter(Mandatory = $true)] [int]$ListenerProcessId,
        [Parameter(Mandatory = $true)] [string]$ExpectedModule
    )

    if ($WrapperProcessId -le 0 -or $WrapperProcessId -eq $ListenerProcessId) { return }
    $wrapper = Get-PrismaProcessIdentity -ProcessId $WrapperProcessId
    if ($wrapper -and (Test-PrismaProcessIdentity -ProcessIdentity $wrapper -ExpectedModule $ExpectedModule)) { Stop-Process -Id $WrapperProcessId -Force -ErrorAction Stop }
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
            $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8
        }
    } catch {
        Remove-Item -LiteralPath $ManifestPath -Force -ErrorAction SilentlyContinue
    }
}
