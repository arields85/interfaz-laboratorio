[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("P1")]
    [string]$Suite,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$EvidencePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-PythonExecutable {
    $pythonRoots = @(
        (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) "Programs\Python"),
        (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)) "Python"),
        (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)) "Python")
    )

    foreach ($root in $pythonRoots) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) {
            continue
        }

        $candidate = Get-ChildItem -LiteralPath $root -Directory -Filter "Python*" |
            Sort-Object -Property Name -Descending |
            ForEach-Object { Join-Path $_.FullName "python.exe" } |
            Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
            Select-Object -First 1

        if ($null -ne $candidate) {
            return [IO.Path]::GetFullPath($candidate)
        }
    }

    throw "No Python executable was found in an explicit standard installation directory."
}

function Resolve-ExternalEvidencePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RequestedPath,

        [Parameter(Mandatory = $true)]
        [string]$RepositoryRoot
    )

    if (-not [IO.Path]::IsPathRooted($RequestedPath)) {
        throw "EvidencePath must be an absolute external path."
    }
    if ($RequestedPath -match "[;&|<>`$*?\x00-\x1F]") {
        throw "EvidencePath contains unsafe characters."
    }

    try {
        $resolvedPath = [IO.Path]::GetFullPath($RequestedPath)
        $resolvedRepositoryRoot = [IO.Path]::GetFullPath($RepositoryRoot).TrimEnd("\")
    }
    catch {
        throw "EvidencePath is not a valid filesystem path."
    }

    if (
        $resolvedPath.Equals($resolvedRepositoryRoot, [StringComparison]::OrdinalIgnoreCase) -or
        $resolvedPath.StartsWith("$resolvedRepositoryRoot\", [StringComparison]::OrdinalIgnoreCase)
    ) {
        throw "EvidencePath must remain outside the repository."
    }

    $parent = Split-Path -Parent $resolvedPath
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        throw "EvidencePath parent must already exist."
    }
    if (Test-Path -LiteralPath $resolvedPath -PathType Container) {
        throw "EvidencePath must identify a file, not a directory."
    }

    return $resolvedPath
}

$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $runtimeRoot "..\.."))
$evidenceFile = Resolve-ExternalEvidencePath -RequestedPath $EvidencePath -RepositoryRoot $repositoryRoot
$pythonExecutable = Resolve-PythonExecutable
$testStartDirectory = Join-Path $runtimeRoot "tests"

$testExitCode = 1
$processStartInfo = New-Object System.Diagnostics.ProcessStartInfo
$processStartInfo.FileName = $pythonExecutable
$processStartInfo.Arguments = "-m unittest discover -s `"$testStartDirectory`" -p `"test_skeleton.py`""
$processStartInfo.WorkingDirectory = $repositoryRoot
$processStartInfo.UseShellExecute = $false
$processStartInfo.CreateNoWindow = $true
$processStartInfo.RedirectStandardOutput = $true
$processStartInfo.RedirectStandardError = $true
$processStartInfo.EnvironmentVariables.Clear()
$processStartInfo.EnvironmentVariables["SystemRoot"] = [Environment]::GetEnvironmentVariable("SystemRoot")
$processStartInfo.EnvironmentVariables["PRISMA_RUNTIME_VERIFY_CHILD"] = "1"

$testProcess = New-Object System.Diagnostics.Process
$testProcess.StartInfo = $processStartInfo
if (-not $testProcess.Start()) {
    throw "Focused P1 unittest could not be started."
}
$standardOutput = $testProcess.StandardOutput.ReadToEnd()
$standardError = $testProcess.StandardError.ReadToEnd()
$testProcess.WaitForExit()
$testExitCode = $testProcess.ExitCode
$testOutputText = "$standardOutput`n$standardError"
$testsRun = 0
$skipped = 0

if ($testOutputText -match "Ran\s+(\d+)\s+tests?") {
    $testsRun = [int]$Matches[1]
}
if ($testOutputText -match "skipped=(\d+)") {
    $skipped = [int]$Matches[1]
}

$testStatus = if ($testExitCode -eq 0 -and $testOutputText -match "\bOK\b") { "passed" } else { "failed" }
$evidence = [ordered]@{
    schema = "prisma-runtime-p1-evidence/v1"
    suite = $Suite
    repository_scope = "services/prisma-runtime"
    test_command = 'python -m unittest discover -s services/prisma-runtime/tests -p "test_skeleton.py"'
    test_result = [ordered]@{
        status = $testStatus
        exit_status = $testExitCode
        tests_run = $testsRun
        failures = if ($testStatus -eq "passed") { 0 } else { 1 }
        errors = 0
        skipped = $skipped
    }
    runtime_harness = [ordered]@{
        status = "not_applicable"
        reason = "P1 is offline scaffold and evidence only; no runtime boundary exists."
    }
}

$evidenceJson = $evidence | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText($evidenceFile, $evidenceJson + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

if ($testExitCode -ne 0) {
    throw "Focused P1 unittest failed."
}
