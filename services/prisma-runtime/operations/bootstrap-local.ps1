[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'runtime-environment.ps1')

$runtimeRoot = Get-PrismaRuntimeRoot
$stateRoot = Get-PrismaStateRoot
$template = Get-PrismaConfigurationTemplate -RuntimeRoot $runtimeRoot

$state = Initialize-PrismaRuntimeState -StateRoot $stateRoot -Template $template
Write-Host "Prisma Local state is ready at $($state.StateRoot)." -ForegroundColor Green
if (-not $state.Seeded) {
    Write-Host 'An effective configuration already exists and was left untouched.'
}

$environment = Initialize-PrismaVirtualEnvironment -RuntimeRoot $runtimeRoot
$outcome = if ($environment.Created) { 'created' } else { 'reused' }
Write-Host "Prisma Local $outcome the repository-owned Python $($environment.PythonVersion) environment at $($environment.VenvRoot)." -ForegroundColor Green
Write-Host "Locked dependencies are installed for $($environment.Python)."
