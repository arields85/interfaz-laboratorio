[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$python = if ($env:PRISMA_PYTHON) { $env:PRISMA_PYTHON } else { (Get-Command python.exe -ErrorAction Stop).Source }
$env:PYTHONPATH = "$runtimeRoot\src" + $(if ($env:PYTHONPATH) { ";$env:PYTHONPATH" } else { '' })

& $python -m unittest discover -s $runtimeRoot -p 'test_*.py'
if ($LASTEXITCODE -ne 0) { throw 'Prisma Local focused tests failed.' }
Write-Host 'Prisma Local verification passed without starting services or contacting providers.' -ForegroundColor Green
