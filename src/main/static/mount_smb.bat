@echo off

:: ── mount_smb.bat ──
:: Usage: mount_smb.bat <host> <share> <username> <password> [popup]

:: 0) Optional UI mode flag
set "UI_MODE=%~5"

:: 1) Validate arguments
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

:: 2) If UI_MODE is "popup", check if already mounted and open folder
if /i "%UI_MODE%"=="popup" (
  for /f "tokens=2" %%D in ('net use ^| findstr /i "\\\\%SMB_HOST%\\"') do (
    echo {"message":"SMB share already mounted on drive %%D"}
    start explorer %%D: >nul 2>&1
    exit /b 0
  )
)

:: 2.5) Retry loop: ensure hostname is resolvable before continuing
setlocal enabledelayedexpansion
set RETRIES=5
:resolve_loop
ping -n 1 -w 1000 %SMB_HOST% >nul 2>&1
nbtstat -a %SMB_HOST% >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  endlocal
  goto continue_mount
)
set /a RETRIES-=1
if !RETRIES! LEQ 0 (
  >>"%LOG%" echo [RESOLVE FAIL] Hostname %SMB_HOST% not resolved after retries
  echo {"error":"Unable to resolve SMB host %SMB_HOST%"} & exit /b 1
)
timeout /t 1 >nul
goto resolve_loop

:continue_mount

:: 3) Clean up only connections _to this share_ (and IPC$ on that host)
for /f "skip=1 tokens=2" %%L in ('net use ^| findstr /I "\\\\%SMB_HOST%\\%SMB_SHARE%"') do (
    >>"%LOG%" echo [PRE-CLEAN] Deleting mapping: %%L
    net use %%L: /delete /y >nul 2>&1
)
:: Also clear any hidden IPC$ session to that host
net use \\%SMB_HOST%\IPC$ /delete /y >nul 2>&1

:: 4) Smart ping check with retry
ping -n 1 -w 1000 %SMB_HOST% >nul 2>&1
if errorlevel 1 (
    >>"%LOG%" echo [PING] First attempt to reach %SMB_HOST% failed, retrying...
    timeout /t 1 >nul
    ping -n 1 -w 1000 %SMB_HOST% >nul 2>&1
    if errorlevel 1 (
        >>"%LOG%" echo [PING] Retry failed, host %SMB_HOST% unreachable
        echo {"error":"Host %SMB_HOST% unreachable after retry"} & exit /b 1
    )
)

:: 5) Authenticate to share, with retry
setlocal enabledelayedexpansion
set AUTH_RETRIES=3
:auth_loop
  >>"%LOG%" echo [AUTH] Attempt !AUTH_RETRIES! for %UNC_PATH% with %USERNAME%
  net use "%UNC_PATH%" /user:"%USERNAME%" "%PASSWORD%" /persistent:no > "%TMP%" 2>&1
  if ERRORLEVEL 0 (
    >>"%LOG%" echo [AUTH] Success on attempt !AUTH_RETRIES!
    endlocal
    goto after_auth
  )
  >>"%LOG%" type "%TMP%"
  set /a AUTH_RETRIES-=1
  if !AUTH_RETRIES! GTR 0 (
    timeout /t 1 >nul
    goto auth_loop
  )
  endlocal
  for /f "delims=" %%L in ('type "%TMP%"') do >>"%LOG%" echo [SHARE AUTH ERROR] %%L
  echo {"error":"Share authentication failed"} & exit /b 1

:after_auth


:: 6) Use pushd to discover a free drive letter
pushd "%UNC_PATH%" > "%TMP%" 2>&1
if ERRORLEVEL 1 (
    for /f "delims=" %%L in ('type "%TMP%"') do >>"%LOG%" echo [PUSHD ERROR] %%L
    echo {"error":"SMB mount failed"} & exit /b 1
)
for %%D in ("%CD%") do set "DRIVE=%%~dD"
set "LETTER=%DRIVE:~0,1%"
popd

:: 7) Clean up temp mount (UNC and drive letter)
net use "%UNC_PATH%" /delete /y >nul 2>&1
net use %LETTER%: /delete /y >nul 2>&1

:: 8) Final persistent mount to known letter
net use %LETTER%: "%UNC_PATH%" /user:"%USERNAME%" "%PASSWORD%" /persistent:no > "%TMP%" 2>&1
if ERRORLEVEL 1 (
    for /f "delims=" %%L in ('type "%TMP%"') do >>"%LOG%" echo [PERSIST ERROR] %%L
    echo {"error":"Failed to map %LETTER%: as %USERNAME%"} & exit /b 1
)

:: 9) Write test
echo test > %LETTER%:\houston_test_write.txt 2>nul
if not exist %LETTER%:\houston_test_write.txt (
    >>"%LOG%" echo [WRITE TEST ERROR] Cannot write to %LETTER%:\ as %USERNAME%
    net use %LETTER%: /delete /y >nul 2>&1
    echo {"error":"Write permission denied on %LETTER%:\\"} & exit /b 1
)
del %LETTER%:\houston_test_write.txt >nul 2>&1

:: 10) Success
>>"%LOG%" echo [SUCCESS] %LETTER%: mounted to %UNC_PATH% as %USERNAME%

if /i "%UI_MODE%"=="popup" (
    echo {"DriveLetter":"%LETTER%","MountPoint":"%LETTER%:\\","smb_share":"%SMB_SHARE%","message":"Mounted successfully"}
    start explorer %LETTER%: >nul 2>&1
) else (
    echo {"DriveLetter":"%LETTER%","MountPoint":"%LETTER%:\\","smb_share":"%SMB_SHARE%"}
)

exit /b 0
