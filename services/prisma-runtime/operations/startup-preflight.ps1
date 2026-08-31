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
