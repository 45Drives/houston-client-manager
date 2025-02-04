@echo off
setlocal enabledelayedexpansion

:: Check if network path, username, and password are provided
if "%1"=="" (
    echo {"error": "No network path provided"}
    exit /b
)

if "%2"=="" (
    echo {"error": "No username provided"}
    exit /b
)

if "%3"=="" (
    echo {"error": "No password provided"}
    exit /b
)

:: Assign parameters to variables
set "NETWORK_PATH=%1"
set "USERNAME=%2"
set "PASSWORD=%3"

:: Extract SMB Server from NETWORK_PATH (e.g., \\192.168.1.100\share -> 192.168.1.100)
for /f "tokens=2 delims=\\" %%A in ("%NETWORK_PATH%") do set "SMB_SERVER=%%A"

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
net use !DRIVE_LETTER!: !NETWORK_PATH! /user:!USERNAME! "!PASSWORD!" /persistent:yes >nul 2>&1

:: Check if the mapping was successful
if %ERRORLEVEL%==0 (
    echo {"DriveLetter": "!DRIVE_LETTER!", "smb_server": "!SMB_SERVER!", "smb_user": "!USERNAME!"}
) else (
    echo {"error": "Failed to map network drive", "drive": "!DRIVE_LETTER!", "path": "!NETWORK_PATH!", "user": "!USERNAME!"}
)
