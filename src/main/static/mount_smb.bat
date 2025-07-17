@echo off
setlocal EnableDelayedExpansion

:: Set log file
set "LOG=%~dp0mount_debug.log"
>>"%LOG%" echo.
>>"%LOG%" echo ==== New mount attempt at %DATE% %TIME% ====

set "UI_MODE=%~4"

:: Validate parameters
if "%~1"=="" (
    echo {"error": "No network path provided"}
    >>"%LOG%" echo ERROR: No network path provided
    exit /b 1
)
if "%~2"=="" (
    echo {"error": "No share provided"}
    >>"%LOG%" echo ERROR: No share provided
    exit /b 1
)
if "%~3"=="" (
    echo {"error": "No cred file provided"}
    >>"%LOG%" echo ERROR: No cred file provided
    exit /b 1
)

set "SMB_HOST=%~1"
set "SMB_SHARE=%~2"
set "CRED_FILE=%~3"
set "NETWORK_PATH=\\%SMB_HOST%\%SMB_SHARE%"

:: Check if already mounted (popup mode)
if /i "%UI_MODE%"=="popup" (
  for /f "tokens=2" %%D in ('net use ^| findstr /i "\\\\%SMB_HOST%\\"') do (
    echo {"DriveLetter":"%%D","MountPoint":"%%D:\\","smb_share":"%SMB_SHARE%","message":"Already mounted","smb_server":"%SMB_HOST%"}
    start "" explorer %%D: >nul 2>&1
    exit /b 0
  )
)

:: Read credentials
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

:: Unmount existing connections
for /f "tokens=2" %%D in ('net use ^| findstr /I "\\\\%SMB_HOST%\\"') do (
    >>"%LOG%" echo Removing existing mount on %%D:
    net use %%D: /delete /y >nul 2>&1
)

:: Find an available drive letter (Z to D)
set "DRIVE_LETTER="
for %%L in (Z Y X W V U T S R Q P O N M L K J I H G F E D) do (
    net use | findstr /I " %%L: " >nul
    if errorlevel 1 (
        if not exist %%L:\ (
            set "DRIVE_LETTER=%%L"
            goto :MOUNT_SMB
        )
    )
)

echo {"error": "No available drive letters found"}
>>"%LOG%" echo ERROR: No available drive letters
exit /b 1

:MOUNT_SMB
>>"%LOG%" echo Mounting %NETWORK_PATH% to %DRIVE_LETTER% using user: %USERNAME%
net use %DRIVE_LETTER%: "%NETWORK_PATH%" /user:%USERNAME% "%PASSWORD%" /persistent:no

:: Validate mount success
if !RESULT! == 0 (
    >>"%LOG%" echo SUCCESS: Mapped to %DRIVE_LETTER%:
    
    :: Wait for drive to be ready
    set RETRIES=10
:WAIT_LOOP
    if exist %DRIVE_LETTER%:\ (
        goto :CONTINUE
    )
    timeout /t 1 >nul
    set /a RETRIES=!RETRIES!-1
    if !RETRIES! GTR 0 goto WAIT_LOOP

    echo {"error": "Drive %DRIVE_LETTER%: never became available"}
    >>"%LOG%" echo ERROR: Drive never became available
    exit /b 1

:CONTINUE
    if /i "%UI_MODE%"=="popup" (
        >>"%LOG%" echo Opening explorer window...
        start "" explorer %DRIVE_LETTER%:\
    )
    echo {"DriveLetter":"%DRIVE_LETTER%","MountPoint":"%DRIVE_LETTER%:\\","smb_share":"%SMB_SHARE%","smb_host":"%SMB_HOST%","message":"Mounted successfully"}
    exit /b 0
) else (
    >>"%LOG%" echo ERROR: Failed to mount
    echo {"error": "Failed to map network drive", "DriveLetter": "%DRIVE_LETTER%", "smb_host": "%SMB_HOST%", "smb_share": "%SMB_SHARE%", "smb_user": "%USERNAME%"}
    exit /b 1
)
