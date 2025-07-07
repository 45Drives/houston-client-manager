@echo off
setlocal DisableDelayedExpansion

:: --- validate args ---
if "%~1"=="" (
  echo {"error":"No SMB host provided"}
  exit /b 1
)
if "%~2"=="" (
  echo {"error":"No SMB share provided"}
  exit /b 1
)
if "%~3"=="" (
  echo {"error":"No username provided"}
  exit /b 1
)
if "%~4"=="" (
  echo {"error":"No password provided"}
  exit /b 1
)

set "SMB_HOST=%~1"
set "SMB_SHARE=%~2"
set "USERNAME=%~3"
set "PASSWORD=%~4"
set "NETWORK_PATH=\\%SMB_HOST%\%SMB_SHARE%"

:: where to drop debug log

setlocal EnableDelayedExpansion

:: --- pre-clear any existing mapping for this share ---
net use "%NETWORK_PATH%" /delete /y >nul 2>&1

:: --- loop drive letters Z→D ---
for %%L in (Z Y X W V U T S R Q P O N M L K J I H G F E D) do (
  if exist "%%L:\nul" (
    echo [DEBUG] Skipping %%L: already in use 1>&2
  ) else (
    echo [DEBUG] Trying drive %%L: mapping "%NETWORK_PATH%" 1>&2
    net use %%L: "%NETWORK_PATH%" /user:%USERNAME% "%PASSWORD%" /persistent:no 1>&2
    echo [DEBUG] ERRORLEVEL after net use = !errorlevel! 1>&2
    if not errorlevel 1 (
      set "DRIVE_LETTER=%%L"
      goto :SUCCESS
    )
  )
)


:: --- if we get here, none of the letters worked ---
echo {"error":"No available drive letters or mapping failed for %NETWORK_PATH%"}
exit /b 2

:SUCCESS
:: --- emit minimal JSON and exit 0 ---
echo {"DriveLetter":"%DRIVE_LETTER%","MountPoint":"%DRIVE_LETTER%:\\","smb_share":"%SMB_SHARE%"}
exit /b 0
