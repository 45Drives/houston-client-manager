@echo off
setlocal DisableDelayedExpansion

:: Check if network path, username, and password are provided
if "%1"=="" (
    echo {"error": "No network path provided"}
    exit /b
)

if "%2"=="" (
    echo {"error": "No share provided"}
    exit /b
)

if "%3"=="" (
    echo {"error": "No username provided"}
    exit /b
)

if "%4"=="" (
    echo {"error": "No password provided"}
    exit /b
)

:: Assign parameters to variables
set "SMB_HOST=%1"
set "SMB_SHARE=%2"
set "USERNAME=%3"
set "PASSWORD=%~4"

set "NETWORK_PATH=\\%SMB_HOST%\%SMB_SHARE%"

:: Extract SMB Server from NETWORK_PATH (e.g., \\192.168.1.100\share -> 192.168.1.100)
for /f "tokens=2 delims=\\" %%A in ("%NETWORK_PATH%") do set "SMB_SERVER=%%A"

:: Check if the SMB server is already mounted
for /f "tokens=2" %%D in ('net use ^| findstr /I "%SMB_SERVER%"') do (
    echo {"message": "SMB share is already mounted on drive %%D"}
    start explorer %%D  & exit /b 0
)

:: Find an available drive letter (Z: downward)
for %%L in (Z Y X W V U T S R Q P O N M L K J I H G F E D) do (
    if not exist %%L:\ (
        set "DRIVE_LETTER=%%L"
        goto :MOUNT_SMB
    )
)

echo {"error": "No available drive letters found"}
exit /b 1

:MOUNT_SMB
:: Map the network drive with credentials
net use %DRIVE_LETTER%: %NETWORK_PATH% /user:%USERNAME% "%PASSWORD%" /persistent:no >nul 2>&1

:: Check if the mapping was successful
if %ERRORLEVEL%==0 (
    echo {"DriveLetter": "%DRIVE_LETTER%", "smb_server": "%SMB_SERVER%"}
    start explorer %DRIVE_LETTER%:  & exit /b 0
) else (
    echo {"error": "Failed to map network drive", "drive": "%DRIVE_LETTER%", "smb_host": "%SMB_HOST%", "smb_share": "%SMB_SHARE%", "smb_user": "%USERNAME%", "smb_pass": "%PASSWORD%"}
)
