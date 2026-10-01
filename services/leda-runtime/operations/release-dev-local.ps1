[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$DevelopmentOwnerToken,
    [string]$ExpectedGeneration = '',
    [switch]$RecoverRegisteredOwner,
    [int]$LockTimeoutMilliseconds = 10000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'runtime-environment.ps1')
$runtimeRoot = Get-LedaRuntimeRoot
$stateRoot = Get-LedaStateRoot
$manifestPath = Join-Path $stateRoot 'run\process-manifest.json'
$manifestLockPath = Join-Path $stateRoot 'run\process-manifest.lock'
. (Join-Path $PSScriptRoot 'process-ownership.ps1')

Invoke-LedaManifestLock -LockPath $manifestLockPath -TimeoutMilliseconds $LockTimeoutMilliseconds -Action {
    Invoke-LedaDevelopmentReleaseTransaction -ManifestPath $manifestPath -RepositoryRoot $runtimeRoot -OwnerToken $DevelopmentOwnerToken -ExpectedGeneration $ExpectedGeneration -RecoverRegisteredOwner:$RecoverRegisteredOwner
}
