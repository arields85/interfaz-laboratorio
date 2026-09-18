[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$DirectoryPath,
    [string]$DatabasePath,
    [switch]$VerifyOnly,
    [switch]$DirectoryOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-PlainPathChain {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    $current = [IO.Path]::GetFullPath($LiteralPath)
    while ($null -ne $current) {
        try {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'AUTH_STORAGE_PERMISSIONS_INVALID'
            }
        } catch [System.Management.Automation.ItemNotFoundException] {
            # Missing transient SQLite sidecars are valid; existing ancestors are still checked.
        }
        $parent = [IO.Directory]::GetParent($current)
        $current = if ($null -eq $parent) { $null } else { $parent.FullName }
    }
}

function Get-AllowedIdentitySids {
    $current = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = New-Object Security.Principal.SecurityIdentifier(
        [Security.Principal.WellKnownSidType]::LocalSystemSid,
        $null
    )
    $administrators = New-Object Security.Principal.SecurityIdentifier(
        [Security.Principal.WellKnownSidType]::BuiltinAdministratorsSid,
        $null
    )
    return @($current, $system, $administrators)
}

function Get-PrismaDirectorySecurity {
    # Read only the sections this policy uses (Owner + DACL). Windows PowerShell
    # 5.1's full-descriptor Get-Acl/Set-Acl persistence touches audit (SACL)
    # sections, which requires SeSecurityPrivilege and fails under the ordinary
    # user token. Never request the Audit section here.
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    $sections = [Security.AccessControl.AccessControlSections]'Owner, Access'
    return New-Object Security.AccessControl.DirectorySecurity($LiteralPath, $sections)
}

function Set-PrismaAcl {
    param([string]$LiteralPath, [bool]$IsDirectory)
    $current = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = Get-PrismaDirectorySecurity -LiteralPath $LiteralPath
    $owner = (New-Object Security.Principal.NTAccount($acl.Owner)).Translate(
        [Security.Principal.SecurityIdentifier]
    ).Value
    if ($owner -ne $current.Value) {
        throw 'AUTH_STORAGE_PERMISSIONS_INVALID'
    }
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($existingRule in @($acl.Access)) {
        $acl.RemoveAccessRuleSpecific($existingRule)
    }
    foreach ($identity in (Get-AllowedIdentitySids)) {
        $inheritance = if ($IsDirectory) {
            [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
        } else {
            [Security.AccessControl.InheritanceFlags]::None
        }
        $rule = New-Object Security.AccessControl.FileSystemAccessRule(
            $identity,
            [Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow
        )
        $acl.AddAccessRule($rule)
    }
    [System.IO.Directory]::SetAccessControl($LiteralPath, $acl)
}

function Assert-PrismaAcl {
    param(
        [string]$LiteralPath,
        [ValidateSet('Directory', 'File', 'Sidecar')][string]$ObjectKind
    )
    $acl = Get-PrismaDirectorySecurity -LiteralPath $LiteralPath
    $current = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $owner = (New-Object Security.Principal.NTAccount($acl.Owner)).Translate(
        [Security.Principal.SecurityIdentifier]
    ).Value
    if ($owner -ne $current) {
        throw 'AUTH_STORAGE_PERMISSIONS_INVALID'
    }
    if ($ObjectKind -eq 'Directory' -and -not $acl.AreAccessRulesProtected) {
        throw 'AUTH_STORAGE_PERMISSIONS_INVALID'
    }

    $allowed = @((Get-AllowedIdentitySids) | ForEach-Object { $_.Value })
    $currentHasFullControl = $false
    $directoryInheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $noInheritance = [Security.AccessControl.InheritanceFlags]::None
    $noPropagation = [Security.AccessControl.PropagationFlags]::None
    $fullControl = [Security.AccessControl.FileSystemRights]::FullControl
    foreach ($rule in $acl.Access) {
        $identity = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or $identity -notin $allowed) {
            throw 'AUTH_STORAGE_PERMISSIONS_INVALID'
        }
        if ($ObjectKind -ne 'Directory' -and -not $acl.AreAccessRulesProtected) {
            if (-not $rule.IsInherited) { throw 'AUTH_STORAGE_PERMISSIONS_INVALID' }
        } elseif ($rule.IsInherited) {
            throw 'AUTH_STORAGE_PERMISSIONS_INVALID'
        }

        $expectedInheritance = if ($ObjectKind -eq 'Directory') { $directoryInheritance } else { $noInheritance }
        if ($rule.InheritanceFlags -ne $expectedInheritance -or $rule.PropagationFlags -ne $noPropagation) {
            throw 'AUTH_STORAGE_PERMISSIONS_INVALID'
        }
        if ($identity -eq $current -and ($rule.FileSystemRights -band $fullControl) -eq $fullControl) {
            $currentHasFullControl = $true
        }
    }
    if (-not $currentHasFullControl) { throw 'AUTH_STORAGE_PERMISSIONS_INVALID' }
}

Assert-PlainPathChain -LiteralPath $DirectoryPath
if (-not $VerifyOnly) {
    Set-PrismaAcl -LiteralPath $DirectoryPath -IsDirectory $true
}
Assert-PrismaAcl -LiteralPath $DirectoryPath -ObjectKind 'Directory'

if ($DirectoryOnly) { exit 0 }
if ([string]::IsNullOrWhiteSpace($DatabasePath)) { throw 'AUTH_STORAGE_PERMISSIONS_INVALID' }

Assert-PlainPathChain -LiteralPath $DatabasePath
Assert-PrismaAcl -LiteralPath $DatabasePath -ObjectKind 'File'

foreach ($suffix in @('-journal', '-wal', '-shm')) {
    $sidecar = "$DatabasePath$suffix"
    Assert-PlainPathChain -LiteralPath $sidecar
    try {
        Get-Item -LiteralPath $sidecar -Force | Out-Null
        Assert-PrismaAcl -LiteralPath $sidecar -ObjectKind 'Sidecar'
    } catch [System.Management.Automation.ItemNotFoundException] {
        # SQLite creates and removes these files transiently under the protected directory.
    }
}
