@echo off
setlocal DisableDelayedExpansion

:: Set log file
set "LOG=%~dp0mount_debug.log"
>>"%LOG%" echo.
>>"%LOG%" echo ==== New mount attempt at %DATE% %TIME% ====

set "UI_MODE=%~4"

:: Check if network path, username, and password are provided
if "%1"=="" (
    echo {"error": "No network path provided"}
    >>"%LOG%" echo ERROR: No network path provided
    exit /b
)

if "%2"=="" (
    echo {"error": "No share provided"}
    >>"%LOG%" echo ERROR: No share provided
    exit /b
)

if "%3"=="" (
    echo {"error": "No cred file provided"}
    >>"%LOG%" echo ERROR: No cred file provided
    exit /b
)

:: Assign parameters to variables
set SMB_HOST=%~1
set SMB_SHARE=%~2
set CRED_FILE=%~3
set NETWORK_PATH=\\%SMB_HOST%\%SMB_SHARE%


:: Read username and password from .cred file
set "USERNAME="
set "PASSWORD="

for /f "usebackq tokens=1,* delims==" %%A in ("%CRED_FILE%") do (
    if /i "%%A"=="username" set "USERNAME=%%B"
    if /i "%%A"=="password" set "PASSWORD=%%B"
)

if not defined USERNAME (
    echo {"error": "Missing username in cred file"}
    >>"%LOG%" echo ERROR: Username not found in %CRED_FILE%
    exit /b 1
)

if not defined PASSWORD (
    echo {"error": "Missing password in cred file"}
    >>"%LOG%" echo ERROR: Password not found in %CRED_FILE%
    exit /b 1
)

>>"%LOG%" echo Input: Host=%SMB_HOST% Share=%SMB_SHARE% User=%USERNAME%

:: Extract SMB Server from NETWORK_PATH (e.g., \\192.168.1.100\share -> 192.168.1.100)
for /f "tokens=2 delims=\\" %%A in ("%NETWORK_PATH%") do set "SMB_SERVER=%%A"
>>"%LOG%" echo Extracted SMB_SERVER: %SMB_SERVER%

:: Check if the SMB server is already mounted
for /f "tokens=2" %%D in ('net use ^| findstr /I "%SMB_SERVER%"') do (
    >>"%LOG%" echo Found existing mount %%D, deleting...
    net use %%D /delete /y >nul 2>&1
)
:: Find an available drive letter (Z: downward)
set "DRIVE_LETTER="

for %%L in (Z Y X W V U T S R Q P O N M L K J I H G F E D) do (
    >> "%LOG%" echo Checking drive: %%L

    rem Check if drive is used in net use output
    net use | findstr /I /C:" %%L: " >nul
    if errorlevel 1 (
        rem Not in net use, check if it physically exists
        if not exist %%L:\ (
            set "DRIVE_LETTER=%%L"
            >>"%LOG%" echo Selected drive letter: %%L
            goto :MOUNT_SMB
        )
    )
)

>>"%LOG%" echo No available drive letter found.
goto :EOF


echo {"error": "No available drive letters found"}
>>"%LOG%" echo ERROR: No available drive letters
exit /b 1

:MOUNT_SMB
:: Map the network drive with credentials
>>"%LOG%" echo Attempting to mount %NETWORK_PATH% to %DRIVE_LETTER%: using %USERNAME%
net use %DRIVE_LETTER%: %NETWORK_PATH% /user:%USERNAME% "%PASSWORD%" /persistent:no >nul 2>&1
>>"%LOG%" echo NET USE result: %ERRORLEVEL%

:: Check if the mapping was successful
if %ERRORLEVEL%==0 (
    >> "%LOG%" echo UI MODE: %UI_MODE%
    >>"%LOG%" echo SUCCESS: Drive %DRIVE_LETTER%: mapped to %NETWORK_PATH%

    if /i "%UI_MODE%"=="popup" (
            >> "%LOG%" echo open sesame
        start "" explorer %DRIVE_LETTER%:\
    )

    echo {"DriveLetter":"%DRIVE_LETTER%","MountPoint":"%DRIVE_LETTER%:\\","smb_share":"%SMB_SHARE%","message":"Mounted successfully"}

    exit /b 0
) else (
    >>"%LOG%" echo ERROR: Failed to map %NETWORK_PATH% to %DRIVE_LETTER%: with user %USERNAME%
    echo {"error": "Failed to map network drive", "drive": "%DRIVE_LETTER%", "smb_host": "%SMB_HOST%", "smb_share": "%SMB_SHARE%", "smb_user": "%USERNAME%"}
    exit /b 1
)