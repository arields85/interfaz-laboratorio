<#
.SYNOPSIS
    Lightweight terminal progress indicator for Prisma's launcher health-wait
    loops (start-local.ps1's Wait-VoiceReady/Wait-PresentationReady).

.DESCRIPTION
    T19 (user request): the terminal showed nothing for several seconds
    between "Stopped previous Prisma runtime..." and "Prisma voice is
    ready..." while those loops were polling, even though real work was
    happening. `[Console]::IsOutputRedirected` is the standard .NET way to
    detect a real interactive console vs. a redirected/piped stdout (e.g.
    this repository's own subprocess-based PowerShell tests, or an
    unattended CI run) -- computed once, since it cannot change mid-process.

    Non-interactive stdout gets one plain line, printed once and never
    overwritten: a redirected stream has no cursor to move, so a
    `\r`-based spinner would just leave literal `\r` bytes and repeated
    text instead of an animation. An interactive console gets a single
    line that is repeatedly overwritten with animated dots, then cleared
    (restored to blank) before the next real output line prints, so it
    never garbles the "ready" lines or anything else.
#>

$script:prismaConsoleIsInteractive = -not [Console]::IsOutputRedirected

# Width covers the longest label ("Starting Prisma presentation") plus three
# dots and a small margin, so clearing never leaves stray characters behind
# regardless of which label was showing.
$script:prismaWaitIndicatorWidth = 40

function Start-PrismaWaitIndicator {
    [CmdletBinding()]
    param([string]$Label)

    if (-not $script:prismaConsoleIsInteractive) {
        Write-Host "$Label..." -ForegroundColor DarkGray
    }
}

function Update-PrismaWaitIndicator {
    [CmdletBinding()]
    param([string]$Label, [int]$FrameIndex)

    if (-not $script:prismaConsoleIsInteractive) { return }
    $dots = '.' * (($FrameIndex % 3) + 1)
    $line = "$Label$dots".PadRight($script:prismaWaitIndicatorWidth)
    Write-Host -NoNewline "`r$line" -ForegroundColor DarkGray
}

function Clear-PrismaWaitIndicator {
    [CmdletBinding()]
    param()

    if (-not $script:prismaConsoleIsInteractive) { return }
    Write-Host -NoNewline ("`r" + (' ' * $script:prismaWaitIndicatorWidth) + "`r")
}
