[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'runtime-environment.ps1')

$runtimeRoot = Get-LedaRuntimeRoot
$python = Resolve-LedaPython -RuntimeRoot $runtimeRoot
$env:PYTHONPATH = "$runtimeRoot\src" + $(if ($env:PYTHONPATH) { ";$env:PYTHONPATH" } else { '' })

& $python -m unittest discover -s $runtimeRoot -p 'test_*.py'
if ($LASTEXITCODE -ne 0) { throw 'Leda Local focused tests failed.' }
Write-Host 'Leda Local verification passed without starting services or contacting providers.' -ForegroundColor Green
