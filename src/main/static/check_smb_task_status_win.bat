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
  "try { New-PSDrive -Name TEMP -PSProvider FileSystem -Root '\\%SMB_HOST%\%SMB_SHARE%' -Credential $cred -ErrorAction Stop | Out-Null;" ^
  "if (Test-Path 'TEMP:\%TARGET%') { Write-Output '{\"status\": \"online\"}' }" ^
  "else { Write-Output '{\"status\": \"missing_folder\"}' }" ^
  "Remove-PSDrive TEMP -Force -ErrorAction SilentlyContinue;" ^
  "} catch { Write-Output '{\"status\": \"offline\", \"reason\": \"access_denied_or_invalid\"}' }"
