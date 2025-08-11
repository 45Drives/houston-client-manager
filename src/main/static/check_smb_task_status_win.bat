@echo off
setlocal

set "SMB_HOST=%~1"
set "SMB_SHARE=%~2"
set "TARGET=%~3"
set "CRED_FILE=%~4"

:: echo "[DEBUG] Host=%SMB_HOST%, Share=%SMB_SHARE%, Target=%TARGET%, Credfile is at=%CRED_FILE%"

:: Validate that the file exists
if not exist "%CRED_FILE%" (
  echo {"status": "offline_invalid_credentials"}
  exit /b 0
)

:: Check if host is reachable
ping -n 1 %SMB_HOST% >nul
if %ERRORLEVEL% NEQ 0 (
  echo {"status": "offline_unreachable"}
  exit /b 0
)

:: Call external PowerShell script and let it read the credentials
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check_smb_task_status.ps1" -SmbHost "%SMB_HOST%" -Share "%SMB_SHARE%" -Target "%TARGET%" -CredFile "%CRED_FILE%"

