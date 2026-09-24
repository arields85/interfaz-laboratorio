<#
.SYNOPSIS
    T18b leftover-Vite-listener guard, invoked by hmi-app/scripts/dev.mjs before it spawns Vite.

.DESCRIPTION
    Classifies -Port via Resolve-PrismaViteDevPortState (process-ownership.ps1). When the
    listener is verified as this repository's own Vite dev server ('ours'), stops it and waits
    briefly (same 20x100ms bounded wait already used by start-local.ps1's own leftover-Prisma
    stop) for the port to free. Never stops a 'foreign' listener. Writes a JSON receipt to
    -ReceiptPath so dev.mjs (Node) can decide what to print/do -- this script only classifies and
    stops; dev.mjs owns all terminal messaging, mirroring the existing Prisma
    receipt-on-failure pattern (dev.mjs T4b/T4d).

    Receipt shape: { state: 'free'|'ours'|'foreign'; pid: number; processName: string;
    stopped: bool; freed: bool }.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [int]$Port,
    [Parameter(Mandatory = $true)] [string]$ViteCliPath,
    [Parameter(Mandatory = $true)] [string]$ReceiptPath
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'process-ownership.ps1')

$listenerState = Resolve-PrismaViteDevPortState -Port $Port -ExpectedViteCliPath $ViteCliPath
$result = [ordered]@{
    state = [string]$listenerState.state
    pid = [int]$listenerState.pid
    processName = [string]$listenerState.processName
    stopped = $false
    freed = $true
}

if ($result.state -eq 'ours') {
    try {
        Stop-Process -Id $result.pid -Force -ErrorAction Stop
        $result.stopped = $true
    }
    catch {
        $result.stopped = $false
    }

    if ($result.stopped) {
        $freed = $false
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            if (@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count -eq 0) { $freed = $true; break }
            Start-Sleep -Milliseconds 100
        }
        $result.freed = $freed
    }
    else {
        $result.freed = $false
    }
}

Save-PrismaJsonFile -Path $ReceiptPath -Value $result -Depth 4
