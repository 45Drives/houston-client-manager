@echo off
setlocal enabledelayedexpansion

set "SMB_HOST=%1"
set "SMB_SHARE=%2"
set "TARGET=%3"
set "USERNAME=%4"
set "PASSWORD=%5"

:: Check if host is reachable
ping -n 1 %SMB_HOST% >nul
if %ERRORLEVEL% NEQ 0 (
  echo {"status": "offline", "reason": "unreachable"}
  exit /b 0
)

:: Use PowerShell to check folder via UNC path
:: Build full target UNC path
set "UNC=\\%SMB_HOST%\%SMB_SHARE%\%TARGET%"

powershell -NoProfile -Command ^
  "$username='%USERNAME%'; $password='%PASSWORD%';" ^
  "$securePassword = ConvertTo-SecureString $password -AsPlainText -Force;" ^
  "$cred = New-Object System.Management.Automation.PSCredential ($username, $securePassword);" ^
  "try {" ^
  "  New-PSDrive -Name TEMP -PSProvider FileSystem -Root '\\%SMB_HOST%\%SMB_SHARE%' -Credential $cred -ErrorAction Stop | Out-Null;" ^
  "  $folderPath = 'TEMP:\%TARGET%';" ^
  "  if (Test-Path $folderPath) {" ^
  "    Write-Output '{\"status\": \"online\"}'" ^
  "  } else {" ^
  "    Write-Output '{\"status\": \"missing_folder\"}'" ^
  "  }" ^
  "  Remove-PSDrive TEMP -Force -ErrorAction SilentlyContinue;" ^
  "} catch {" ^
  "  $msg = $_.Exception.Message;" ^
  "  if ($msg -match 'Logon failure' -or $msg -match 'Access is denied') {" ^
  "    Write-Output '{\"status\": \"offline_invalid_credentials\"}'" ^
  "  } elseif ($msg -match 'Access to the path is denied') {" ^
  "    Write-Output '{\"status\": \"offline_insufficient_permissions\"}'" ^
  "  } else {" ^
  "    Write-Output '{\"status\": \"offline_connection_error\"}'" ^
  "  }" ^
  "}"