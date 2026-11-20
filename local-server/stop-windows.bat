@echo off
setlocal EnableDelayedExpansion
title SMARTMENU QR - Arret Serveur Local
cd /d "%~dp0.."

set STOPPED=0
if exist "local-server\data\server.pid" (
  set /p SERVER_PID=<local-server\data\server.pid
  if not "!SERVER_PID!"=="" (
    echo Arret du serveur SMARTMENU QR ^(PID !SERVER_PID!^)...
    taskkill /F /PID !SERVER_PID! >nul 2>&1
    if !errorlevel!==0 (
      set STOPPED=1
    )
  )
  del /F /Q "local-server\data\server.pid" >nul 2>&1
)

if "!STOPPED!"=="0" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*local-server*server.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; exit 0 }" >nul 2>&1
  if !errorlevel!==0 set STOPPED=1
)

if "!STOPPED!"=="1" (
  echo [OK] Serveur local SMARTMENU QR arrete proprement.
) else (
  echo [INFO] Aucun serveur SMARTMENU QR actif n'a ete trouve.
)
pause
