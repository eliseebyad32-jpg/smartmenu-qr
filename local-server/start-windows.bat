@echo off
setlocal EnableDelayedExpansion
title SMARTMENU QR - Serveur Local Wi-Fi
cd /d "%~dp0.."

echo ==============================================================
echo   SMARTMENU QR - Demarrage Automatique (PC + Wi-Fi)
echo ==============================================================
echo.

:: 1. Detecter Node.js meme si le PATH Windows n'a pas encore ete rafraichi
where node >nul 2>&1
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" (
    set "PATH=%ProgramFiles%\nodejs;!PATH!"
  ) else if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
    set "PATH=%ProgramFiles(x86)%\nodejs;!PATH!"
  ) else if exist "%LocalAppData%\Programs\nodejs\node.exe" (
    set "PATH=%LocalAppData%\Programs\nodejs;!PATH!"
  )
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] Node.js n'est pas detecte sur ce PC.
  echo Installez Node.js LTS depuis https://nodejs.org/ puis relancez ce fichier.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo [1/5] Node.js pret : !NODE_VER!

:: 2. Preserver la configuration existante, ou initialiser config.json si absent
if not exist "local-server\config.json" (
  if exist "local-server\config.example.json" (
    copy /Y "local-server\config.example.json" "local-server\config.json" >nul
  )
)

:: Lire le port reel depuis local-server\config.json (ou 3000 par defaut)
set PORT_VAL=3000
for /f "tokens=*" %%p in ('node -e "try{var fs=require('fs');var c=fs.existsSync('local-server/config.json')?JSON.parse(fs.readFileSync('local-server/config.json','utf8')):{};var p=Number(process.env.LOCAL_PORT?process.env.LOCAL_PORT:(c.port?c.port:3000));console.log(p?p:3000)}catch(e){console.log(3000)}"') do set PORT_VAL=%%p

:: 3. Verifier si le serveur SMARTMENU QR repond deja sur ce port
node -e "fetch('http://127.0.0.1:' + process.argv[1] + '/api/health').then(function(r){return r.json()}).then(function(d){process.exit(d && d.ok ? 0 : 1)}).catch(function(){process.exit(1)})" "!PORT_VAL!" >nul 2>&1
if not errorlevel 1 (
  echo.
  echo [OK] Le serveur SMARTMENU QR est deja actif !
  echo.
  for /f "tokens=*" %%u in ('node -e "fetch('http://127.0.0.1:' + process.argv[1] + '/api/server-info').then(function(r){return r.json()}).then(function(d){var p=d.port?d.port:process.argv[1];console.log('[PC]        http://localhost:' + p);if(Array.isArray(d.lanUrls)){d.lanUrls.forEach(function(u){console.log('[TELEPHONE] ' + u)})}}).catch(function(){console.log('[PC]        http://localhost:' + process.argv[1])})" "!PORT_VAL!"') do (
    echo   %%u
  )
  echo.
  echo Ouverture dans votre navigateur...
  start "" "http://localhost:!PORT_VAL!"
  pause
  exit /b 0
)

if exist "local-server\data\server.pid" (
  del /F /Q "local-server\data\server.pid" >nul 2>&1
)

:: 4. Installer automatiquement les dependances manquantes (express, dotenv, vite...)
set NEED_INSTALL=0
if not exist "node_modules\express\package.json" set NEED_INSTALL=1
if not exist "node_modules\dotenv\package.json" set NEED_INSTALL=1
if not exist "node_modules\vite\package.json" set NEED_INSTALL=1

if "!NEED_INSTALL!"=="1" (
  echo [2/5] Installation automatique des dependances manquantes ^(patientez 1 a 2 min^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo [ERREUR] L'installation des dependances a echoue.
    echo Verifiez votre connexion Internet puis double-cliquez a nouveau sur ce fichier.
    pause
    exit /b 1
  )
  echo [OK] Dependances installees avec succes.
) else (
  echo [2/5] Dependances deja installees.
)

:: 5. Compiler l'application si dist\index.html n'existe pas encore
if not exist "dist\index.html" (
  echo [3/5] Compilation de SmartMenu QR en cours...
  call npm run build
  if errorlevel 1 (
    echo.
    echo [ERREUR] Echec de compilation de l'application.
    pause
    exit /b 1
  )
  echo [OK] Application compilee dans dist\.
) else (
  echo [3/5] Build de l'application deja pret.
)

:: 6. Synchronisation rapide avec Supabase (sans bloquer si hors ligne)
echo [4/5] Synchronisation rapide avec Supabase ^(si Internet disponible^)...
node local-server\sync-cloud.mjs --quiet --timeout=4000

:: 7. Ouvrir automatiquement le navigateur sur le PC 2 secondes apres lancement
echo [5/5] Demarrage du serveur local SMARTMENU QR...
echo.
start /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:!PORT_VAL!'" >nul 2>&1
node local-server\server.mjs
echo.
echo Le serveur s'est arrete.
pause
