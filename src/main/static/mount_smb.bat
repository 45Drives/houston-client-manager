@echo off
:: ── mount_smb.bat ──
:: Usage: mount_smb.bat <host> <share> <username> <password>

setlocal

:: Validate arguments
if "%~1"=="" (echo {"error":"No SMB host"}     & exit /b 1)
if "%~2"=="" (echo {"error":"No SMB share"}    & exit /b 1)
if "%~3"=="" (echo {"error":"No username"}     & exit /b 1)
if "%~4"=="" (echo {"error":"No password"}     & exit /b 1)

set "SMB_HOST=%~1"
set "SMB_SHARE=%~2"
set "USERNAME=%~3"
set "PASSWORD=%~4"
set "UNC_PATH=\\%SMB_HOST%\%SMB_SHARE%"
set "TMP=%TEMP%\houston_mount_%RANDOM%.txt"
set "LOG=%~dp0mount_debug.log"

:: Clean up all connections to this host (even hidden or ghost ones)
for /f "skip=1 tokens=2" %%L in ('net use ^| findstr /i "\\%SMB_HOST%\"') do (
    >>"%LOG%" echo [PRE-CLEAN] Deleting mapping: %%L
    net use %%L /delete /y >nul 2>&1
)
set "WMIC_FILTER=RemoteName like '\\\\%SMB_HOST%\\%%'"
for /f "tokens=1" %%S in ('wmic netuse where "%WMIC_FILTER%" get LocalName 2^>nul ^| findstr ":"') do (
    net use %%S /delete /y >nul 2>&1
    >>"%LOG%" echo [WMIC CLEAN] Deleted ghost: %%S
)


:: Check if host is reachable
ping -n 1 -w 1000 %SMB_HOST% >nul 2>&1 || (
    echo {"error":"Host %SMB_HOST% unreachable"} & exit /b 1
)

:: Authenticate and mount the share temporarily to discover a free letter
net use "%UNC_PATH%" /user:"%USERNAME%" "%PASSWORD%" /persistent:no > "%TMP%" 2>&1
if ERRORLEVEL 1 (
    findstr /i "1219" "%TMP%" >nul
    if not errorlevel 1 (
        >>"%LOG%" type "%TMP%"
        echo {"error":"System error 1219: SMB session conflict. Disconnect all previous connections to %SMB_HOST%"} & exit /b 1
    )
    for /f "delims=" %%L in ('type "%TMP%"') do >>"%LOG%" echo [SHARE AUTH ERROR] %%L
    echo {"error":"Share authentication failed"} & exit /b 1
)

:: Use pushd to map and discover a free drive letter
pushd "%UNC_PATH%" > "%TMP%" 2>&1
if ERRORLEVEL 1 (
    for /f "delims=" %%L in ('type "%TMP%"') do >>"%LOG%" echo [PUSHD ERROR] %%L
    echo {"error":"SMB mount failed"} & exit /b 1
)
for %%D in ("%CD%") do set "DRIVE=%%~dD"
set "LETTER=%DRIVE:~0,1%"
popd
net use "%UNC_PATH%" /delete /y >nul 2>&1

:: Clean up any temp mounts before remapping with known letter
net use %LETTER%: /delete /y >nul 2>&1

:: Map again persistently with known letter
net use %LETTER%: "%UNC_PATH%" /user:"%USERNAME%" "%PASSWORD%" /persistent:no > "%TMP%" 2>&1
if ERRORLEVEL 1 (
    for /f "delims=" %%L in ('type "%TMP%"') do >>"%LOG%" echo [PERSIST ERROR] %%L
    echo {"error":"Failed to map %LETTER%: as %USERNAME%"} & exit /b 1
)

:: Test write access (create + delete test file)
echo test > %LETTER%:\houston_test_write.txt 2>nul
if not exist %LETTER%:\houston_test_write.txt (
    >>"%LOG%" echo [WRITE TEST ERROR] Cannot write to %LETTER%:\ as %USERNAME%
    net use %LETTER%: /delete /y >nul 2>&1
    echo {"error":"Write permission denied on %LETTER%:\\"} & exit /b 1
)
del %LETTER%:\houston_test_write.txt >nul 2>&1

:: Return success JSON
echo {"DriveLetter":"%LETTER%","MountPoint":"%LETTER%:\","smb_share":"%SMB_SHARE%"}
exit /b 0
