@echo off
setlocal EnableDelayedExpansion
title SMARTMENU QR - Serveur Local Wi-Fi
cd /d "%~dp0.."

where node >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] Node.js n'est pas installe. Double-cliquez sur INSTALLER-SMARTMENU-WINDOWS.bat
  pause
  exit /b 1
)

set PORT_VAL=3000
if exist "local-server\config.json" (
  for /f "tokens=*" %%p in ('node -e "try{const c=JSON.parse(require('fs').readFileSync('local-server/config.json','utf8'));console.log(c.port||3000)}catch{console.log(3000)}"') do set PORT_VAL=%%p
)

if exist "local-server\data\server.pid" (
  set /p OLD_PID=<local-server\data\server.pid
  tasklist /FI "PID eq !OLD_PID!" 2>nul | find "!OLD_PID!" >nul
  if not errorlevel 1 (
    echo [OK] Le serveur SMARTMENU QR est deja actif ^(PID !OLD_PID!^).
    echo Ouverture de l'adresse locale http://localhost:!PORT_VAL! ...
    start "" "http://localhost:!PORT_VAL!"
    exit /b 0
  )
)

if not exist "local-server\config.json" (
  if exist "local-server\config.example.json" (
    copy /Y "local-server\config.example.json" "local-server\config.json" >nul
  )
)

if not exist "dist\index.html" (
  echo Compilation de SMARTMENU QR en cours...
  call npm run build
  if errorlevel 1 (
    echo [ERREUR] Echec de compilation. Lancez INSTALLER-SMARTMENU-WINDOWS.bat
    pause
    exit /b 1
  )
)

echo Synchronisation rapide avec Supabase ^(si Internet disponible^)...
node local-server\sync-cloud.mjs --quiet --timeout=4000

echo Demarrage du serveur local SMARTMENU QR sur le port !PORT_VAL!...
node local-server\server.mjs
pause
