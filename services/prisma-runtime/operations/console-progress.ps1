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
    `\r`-based caret animation would just leave literal `\r` bytes and
    repeated text instead of an animation. An interactive console gets a
    single line that is repeatedly overwritten with a blinking caret, then
    cleared (restored to blank) before the next real output line prints, so
    it never garbles the "ready" lines or anything else.

    K1 (user request, live test 2026-09-27): the previous orange `|/-\`
    spinner is gone. The label now prints in the console's own default
    foreground -- the SAME color as the npm output lines above it -- so no
    color mechanism (ANSI truecolor, nor the legacy ConsoleColor fallback
    it previously used) is used anywhere in this file. The animation itself is a blinking
    underscore caret placed IMMEDIATELY after the label (no separating
    space, no glyph before it), matching the HMI's own "Cargando_" caret
    rhythm (`.widget-runtime-state-caret` in hmi-app/src/index.css): a 0.6 s
    cycle, 50% duty -- visible for ~0.3 s, hidden for ~0.3 s. start-local.ps1's
    callers still tick every 100 ms, unchanged, so 3 ticks (300 ms) make one
    caret phase and 6 ticks (600 ms) make one full blink cycle. The hidden
    phase overwrites the caret with a space (never simply omits it), so the
    printed line length never changes and no stray "_" is ever left behind.
#>

$script:prismaConsoleIsInteractive = -not [Console]::IsOutputRedirected

# Width covers the longest label ("Starting Prisma presentation") plus the
# caret glyph and a small margin, so clearing never leaves stray characters
# behind regardless of which label was showing.
$script:prismaWaitIndicatorWidth = 40

# K1 caret (user request): 3 ticks (300 ms) per phase at start-local.ps1's existing 100 ms tick
# rate, matching the HMI's own runtime-state caret rhythm (0.6 s full cycle, 50% duty).
$script:prismaCaretTicksPerPhase = 3

function Start-PrismaWaitIndicator {
    [CmdletBinding()]
    param([string]$Label)

    if (-not $script:prismaConsoleIsInteractive) {
        Write-Host "$Label..."
    }
}

function Update-PrismaWaitIndicator {
    [CmdletBinding()]
    param([string]$Label, [int]$FrameIndex)

    if (-not $script:prismaConsoleIsInteractive) { return }
    $phase = [Math]::Floor($FrameIndex / $script:prismaCaretTicksPerPhase)
    $caret = if (($phase % 2) -eq 0) { '_' } else { ' ' }
    $text = "$Label$caret".PadRight($script:prismaWaitIndicatorWidth)
    Write-Host -NoNewline "`r$text"
}

function Clear-PrismaWaitIndicator {
    [CmdletBinding()]
    param()

    if (-not $script:prismaConsoleIsInteractive) { return }
    Write-Host -NoNewline ("`r" + (' ' * $script:prismaWaitIndicatorWidth) + "`r")
}
