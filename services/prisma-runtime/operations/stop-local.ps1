[CmdletBinding()]
param()

$ErrorActionPreference = 'SilentlyContinue'
foreach ($port in @(5056, 5057)) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen
    foreach ($listener in $listeners) { Stop-Process -Id $listener.OwningProcess -Force }
}
Write-Host 'Prisma Local stopped.' -ForegroundColor Green
