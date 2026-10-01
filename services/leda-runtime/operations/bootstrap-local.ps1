[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'runtime-environment.ps1')

$runtimeRoot = Get-LedaRuntimeRoot
$stateRoot = Get-LedaStateRoot
$template = Get-LedaConfigurationTemplate -RuntimeRoot $runtimeRoot

# One-time Prisma -> Leda copy of the old state and credential key, before the new state exists.
Invoke-LedaLegacyLocalMigration | Out-Null
$state = Initialize-LedaRuntimeState -StateRoot $stateRoot -Template $template
Write-Host "Leda Local state is ready at $($state.StateRoot)." -ForegroundColor Green
if (-not $state.Seeded) {
    Write-Host 'An effective configuration already exists and was left untouched.'
}

$environment = Initialize-LedaVirtualEnvironment -RuntimeRoot $runtimeRoot
$outcome = if ($environment.Created) { 'created' } else { 'reused' }
Write-Host "Leda Local $outcome the repository-owned Python $($environment.PythonVersion) environment at $($environment.VenvRoot)." -ForegroundColor Green
Write-Host "Locked dependencies are installed for $($environment.Python)."
