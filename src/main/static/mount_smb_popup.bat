@echo off
setlocal EnableDelayedExpansion

:: ── validate args ──
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

:: (optional) clear any previous mapping to this share
net use "\\%SMB_HOST%\%SMB_SHARE%" /delete /y >nul 2>&1

:: ── try each drive letter Z: → D: ──
for %%L in (Z Y X W V U T S R Q P O N M L K J I H G F E D) do (
  rem clear stale mapping on that letter, if any
  net use %%L: /delete /y >nul 2>&1

  rem try to map
  net use %%L: "%NETWORK_PATH%" /user:%USERNAME% "%PASSWORD%" /persistent:no >nul 2>&1
  if not errorlevel 1 (
    set "DRIVE_LETTER=%%L"
    goto :EMIT_JSON
  )
)

:: If we fall through, mapping already tried above. Jump here if it succeeded.
:EMIT_JSON

if defined DRIVE_LETTER (
  rem success! emit minimal JSON and exit 0
  echo {"DriveLetter":"%DRIVE_LETTER%","MountPoint":"%DRIVE_LETTER%:\\","smb_share":"%SMB_SHARE%"}
  exit /b 0
) else (
  echo {"error":"Mapping failed for %NETWORK_PATH% on any drive letter"}
)

exit /b 2
