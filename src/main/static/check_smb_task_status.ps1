param (
    [string]$SmbHost,
    [string]$Share,
    [string]$Target,
    [string]$CredFile
)

# Debug block
# Write-Output "=== DEBUG INPUTS ==="
# Write-Output "SmbHost: $SmbHost"
# Write-Output "Share: $Share"
# Write-Output "Target: $Target"
# Write-Output "Username: $username"
# Write-Output "Password: $password"
# Write-Output "UNC Path: \\$SmbHost\$Share"
# Write-Output "Full Folder Path (PSDrive): TEMP:\$Target"
# Write-Output "====================="

# 1) Quick port-445 check (1 s timeout)
try {
    $sock = New-Object System.Net.Sockets.TcpClient
    $async = $sock.BeginConnect($SmbHost, 445, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(1000)) { throw }
    $sock.EndConnect($async); $sock.Close()
} catch {
    Write-Output '{"status": "offline_unreachable"}'
    exit 0
}

# 2) Read credentials
$credData = @{}
Get-Content $CredFile | ForEach-Object {
    $parts = $_ -split '=', 2
    if ($parts.Count -eq 2) {
        $credData[$parts[0].Trim().ToLower()] = $parts[1].Trim()
    }
}
$securePass = ConvertTo-SecureString $credData["password"] -AsPlainText -Force
$cred       = New-Object System.Management.Automation.PSCredential ($credData["username"], $securePass)

# 3) Validate share root with PSDrive (fast bail on error)
try {
    New-PSDrive -Name X -PSProvider FileSystem -Root "\\$SmbHost\$Share" `
        -Credential $cred -ErrorAction Stop | Out-Null
} catch {
    $msg = $_.Exception.Message
    if ($msg -match 'Logon failure|Access is denied') {
        Write-Output '{"status": "offline_invalid_credentials"}'
    } else {
        Write-Output '{"status": "offline_connection_error"}'
    }
    exit 0
}
Remove-PSDrive X -Force -ErrorAction SilentlyContinue

# 4) Check target folder via .NET
$uncRoot   = "\\$SmbHost\$Share"
$uncTarget = "\\$SmbHost\$Share\$Target"

if ([System.IO.Directory]::Exists($uncTarget)) {
    $status = 'online'
}
elseif ([System.IO.Directory]::Exists($uncRoot)) {
    $status = 'missing_folder'
}
else {
    $status = 'offline_connection_error'
}

Write-Output (@{ status = $status } | ConvertTo-Json -Compress)
