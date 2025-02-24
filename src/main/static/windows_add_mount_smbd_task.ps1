param (
    [string]$networkPath,
    [string]$username,
    [string]$password
)

# Define log file
$logFile = "$env:TEMP\smb_mount_log.txt"

Function Log {
    param ($message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp - $message" | Out-File -Append -FilePath $logFile
}

# Start logging
Log "========== SMB Mount add task Script Started =========="

# Validate input arguments
if (-not $networkPath) {
    Log "ERROR: No network path provided"
    Write-Output '{"error": "No network path provided"}'
    exit 1
}

if (-not $username) {
    Log "ERROR: No username provided"
    Write-Output '{"error": "No username provided"}'
    exit 1
}

if (-not $password) {
    Log "ERROR: No password provided"
    Write-Output '{"error": "No password provided"}'
    exit 1
}

Log "Network Path: $networkPath"
Log "Username: $username"

# Extract SMB Server from network path (e.g., \\192.168.1.100\share -> 192.168.1.100)
$networkParts = $networkPath -split '\\'
if ($networkParts.Count -lt 3) {
    Log "ERROR: Invalid network path format: $networkPath"
    Write-Output '{"error": "Invalid network path format"}'
    exit 1
}
$smbServer = $networkParts[2]
Log "SMB Server: $smbServer"

# Get all currently used drive letters (local + network) from PSDrive and registry
$usedDrives = Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Name

# Get mapped network drives from the registry (HKEY_USERS\*\Network\*)
$networkDriveRegistry = Get-ItemProperty "Registry::HKEY_USERS\*\Network\*" | Select-Object -ExpandProperty PSChildName
Log "Mapped Network Drives from Registry: $($networkDriveRegistry -join ', ')"

# Combine both sets of drives
$usedDrives += $networkDriveRegistry
Log "Used Drives (Local + Network): $($usedDrives -join ', ')"

# Generate available drive letters from "Z" downward to "D"
$driveLetters = [char[]](90..68) | ForEach-Object { [string]$_ }
$availableDrive = $driveLetters | Where-Object { $_ -notin $usedDrives } | Select-Object -First 1

if (-not $availableDrive) {
    Log "ERROR: No available drive letters found"
    Write-Output '{"error": "No available drive letters found"}'
    exit 1
}

# Define Task Name
$TaskName = "HoustonMountNetworkDrive_${networkPath}"

# Define Task Action
$Action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c net use ${availableDrive}: ${networkPath} /user:DOMAIN\${username} ${password} /persistent:yes"

# Define Trigger (Runs at logon)
$Trigger = New-ScheduledTaskTrigger -AtLogOn

# Set it to run as the current user (not SYSTEM)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

# Register the Task
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Force

Write-Output "Scheduled task '$TaskName' created to remount drive on reboot."

Log "========== SMB Mount Add Task Script Finished =========="

exit 0
