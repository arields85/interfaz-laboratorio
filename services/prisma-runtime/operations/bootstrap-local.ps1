[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stateRoot = if ($env:PRISMA_RUNTIME_STATE_DIR) {
    [IO.Path]::GetFullPath($env:PRISMA_RUNTIME_STATE_DIR)
} else {
    Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'CoreAnalytics\Prisma'
}
$template = Join-Path $runtimeRoot 'config\prisma_voice_config.example.json'
$config = Join-Path $stateRoot 'prisma_voice_config.json'

if (-not (Test-Path -LiteralPath $template -PathType Leaf)) {
    throw "Missing secret-free configuration template: $template"
}

New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stateRoot 'logs') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stateRoot 'run') -Force | Out-Null
if (-not (Test-Path -LiteralPath $config -PathType Leaf)) {
    Copy-Item -LiteralPath $template -Destination $config
}

Write-Host "Prisma Local state is ready at $stateRoot." -ForegroundColor Green
Write-Host 'Dependencies are declared in requirements.txt; this bootstrap does not install them.'
