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
    line that is repeatedly overwritten with an animated spinner, then
    cleared (restored to blank) before the next real output line prints, so
    it never garbles the "ready" lines or anything else.

    User request (m1 spinner): the animated indicator is a single orange
    `|/-\` glyph printed BEFORE the label (start-local.ps1's callers tick it
    every 100 ms, so the 4-frame glyph completes a full cycle every 0.4 s),
    replacing the previous grey animated "...". Windows PowerShell 5.1 has no
    truecolor/256-color `ConsoleColor` entry, so real orange requires a raw
    ANSI/VT escape sequence -- used only where the console has proven VT
    support (`Test-PrismaVirtualTerminalSupport`, attempted once at
    dot-source time). Where VT is unsupported (older consoles, or output
    that only claims to be interactive without a real console handle), the
    sensible fallback is the legacy `DarkYellow` `ConsoleColor`, the closest
    built-in approximation of orange -- never a raw escape code, so a
    console without VT support never gets literal escape-sequence garbage.
#>

$script:prismaConsoleIsInteractive = -not [Console]::IsOutputRedirected

# Width covers the longest label ("Starting Prisma presentation") plus the
# spinner glyph, a separating space and a small margin, so clearing never
# leaves stray characters behind regardless of which label was showing.
$script:prismaWaitIndicatorWidth = 40

# m1 spinner classic: cycled by FrameIndex % 4, one glyph per 100 ms tick (see
# start-local.ps1's Wait-VoiceReady/Wait-PresentationReady) for a 0.4 s full cycle.
$script:prismaSpinnerFrames = @('|', '/', '-', '\')

# Same orange (CSS "darkorange", RGB 255,140,0) used for both the spinner glyph and the label
# text, via an ANSI 24-bit truecolor escape sequence -- broadly supported by VT-capable consoles
# (Windows Terminal, VS Code's terminal, modern ConEmu/mintty) without needing a 256-color fallback.
$script:prismaOrangeAnsiTrueColor = "$([char]27)[38;2;255;140;0m"
$script:prismaAnsiReset = "$([char]27)[0m"

function Test-PrismaVirtualTerminalSupport {
    <#
    .SYNOPSIS
        Best-effort detection of ANSI/VT escape sequence support on the current console.
    .DESCRIPTION
        Windows PowerShell 5.1 has no `$PSStyle`/`$Host.UI.SupportsVirtualTerminal` (PS7+ only),
        so support is detected the same way Windows itself exposes it: by attempting to enable
        `ENABLE_VIRTUAL_TERMINAL_PROCESSING` on the real console output handle via `kernel32.dll`.
        This only succeeds against a genuine console screen buffer -- a redirected/piped stdout
        (this repository's own subprocess-based tests, or an unattended CI run) fails
        `GetConsoleMode` and is correctly treated as VT-unsupported. Any failure at any step
        (missing handle, P/Invoke exception, non-Windows host) is treated as "not supported"
        rather than surfaced as an error: this is a display nicety, never worth failing a
        health-wait loop over.
    #>
    [CmdletBinding()]
    param()

    if (-not $script:prismaConsoleIsInteractive) { return $false }
    try {
        if (-not ('Prisma.NativeConsole' -as [type])) {
            Add-Type -Namespace Prisma -Name NativeConsole -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern System.IntPtr GetStdHandle(int nStdHandle);
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern bool GetConsoleMode(System.IntPtr hConsoleHandle, out uint lpMode);
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern bool SetConsoleMode(System.IntPtr hConsoleHandle, uint dwMode);
'@ | Out-Null
        }
        $STD_OUTPUT_HANDLE = -11
        $ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004
        $handle = [Prisma.NativeConsole]::GetStdHandle($STD_OUTPUT_HANDLE)
        $mode = 0
        if (-not [Prisma.NativeConsole]::GetConsoleMode($handle, [ref]$mode)) { return $false }
        if (($mode -band $ENABLE_VIRTUAL_TERMINAL_PROCESSING) -ne 0) { return $true }
        return [Prisma.NativeConsole]::SetConsoleMode($handle, ($mode -bor $ENABLE_VIRTUAL_TERMINAL_PROCESSING))
    }
    catch {
        return $false
    }
}

$script:prismaVirtualTerminalEnabled = Test-PrismaVirtualTerminalSupport

function Start-PrismaWaitIndicator {
    [CmdletBinding()]
    param([string]$Label)

    if (-not $script:prismaConsoleIsInteractive) {
        Write-Host "$Label..." -ForegroundColor DarkYellow
    }
}

function Update-PrismaWaitIndicator {
    [CmdletBinding()]
    param([string]$Label, [int]$FrameIndex)

    if (-not $script:prismaConsoleIsInteractive) { return }
    $frame = $script:prismaSpinnerFrames[$FrameIndex % $script:prismaSpinnerFrames.Length]
    $text = "$frame $Label".PadRight($script:prismaWaitIndicatorWidth)
    if ($script:prismaVirtualTerminalEnabled) {
        Write-Host -NoNewline "`r$($script:prismaOrangeAnsiTrueColor)$text$($script:prismaAnsiReset)"
    }
    else {
        Write-Host -NoNewline "`r$text" -ForegroundColor DarkYellow
    }
}

function Clear-PrismaWaitIndicator {
    [CmdletBinding()]
    param()

    if (-not $script:prismaConsoleIsInteractive) { return }
    Write-Host -NoNewline ("`r" + (' ' * $script:prismaWaitIndicatorWidth) + "`r")
}
