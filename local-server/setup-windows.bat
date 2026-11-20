@echo off
setlocal EnableDelayedExpansion
title SMARTMENU QR - Installation Serveur Local Windows
cd /d "%~dp0.."

echo ==============================================================
echo   SMARTMENU QR - Installation Serveur Local PC (Wi-Fi)
echo ==============================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] Node.js n'est pas installe sur ce PC.
  echo Telechargez Node.js LTS ^(v20+^) sur https://nodejs.org/ puis relancez ce script.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo [OK] Node.js detecte : %NODE_VER%
echo.

if not exist "node_modules" (
  echo [1/6] Installation des dependances npm ^(connexion Internet requise une fois^)...
  call npm install
  if errorlevel 1 (
    echo [ERREUR] Echec de npm install. Verifiez votre connexion Internet.
    pause
    exit /b 1
  )
) else (
  echo [1/6] Dependances npm deja presentes.
)

echo.
echo [2/6] Configuration Supabase ^(.env^)...
set ENV_UPDATED=0
if not exist ".env" (
  echo Aucun fichier .env trouve a la racine.
  set /p INPUT_SB_URL="URL Supabase ^(ex: https://xxxx.supabase.co, vide = mode local uniquement^) : "
  set /p INPUT_SB_KEY="Cle publique Supabase ^(VITE_SUPABASE_ANON_KEY, vide si local uniquement^) : "
  set "SM_SB_URL=!INPUT_SB_URL!"
  set "SM_SB_KEY=!INPUT_SB_KEY!"
  node -e "const fs=require('fs');const u=(process.env.SM_SB_URL||'').trim();const k=(process.env.SM_SB_KEY||'').trim();fs.writeFileSync('.env',`VITE_SUPABASE_URL=\"${u}\"\nVITE_SUPABASE_ANON_KEY=\"${k}\"\n`,'utf8');console.log('[OK] Fichier .env cree.');"
  set ENV_UPDATED=1
) else (
  echo [OK] Fichier .env deja present ^(conserve tel quel^).
)

echo.
echo [3/6] Configuration du restaurant sur ce PC ^(local-server\config.json^)...
set /p REST_ID="Identifiant / slug du restaurant [rocomamas-lubumbashi] : "
if "%REST_ID%"=="" set REST_ID=rocomamas-lubumbashi

set /p LOCAL_PORT="Port local du serveur [3000] : "
if "%LOCAL_PORT%"=="" set LOCAL_PORT=3000

set /p PUBLIC_LAN="Adresse Wi-Fi fixe optionnelle ^(ex: http://192.168.1.50:3000, vide = auto^) : "

set "SM_REST_ID=%REST_ID%"
set "SM_PORT=%LOCAL_PORT%"
set "SM_LAN=%PUBLIC_LAN%"
node -e "const fs=require('fs');const cfg={port:Number(process.env.SM_PORT)||3000,restaurantId:process.env.SM_REST_ID.trim(),restaurantSlug:process.env.SM_REST_ID.trim(),publicLanUrl:process.env.SM_LAN.trim(),autoSyncMinutes:5};fs.writeFileSync('local-server/config.json',JSON.stringify(cfg,null,2),'utf8');console.log('[OK] Configuration enregistree dans local-server/config.json');"

echo.
echo [4/6] Configuration du Pare-feu Windows pour le port TCP %LOCAL_PORT%...
netsh advfirewall firewall show rule name="SMARTMENU QR Local Server" >nul 2>&1
if errorlevel 1 (
  netsh advfirewall firewall add rule name="SMARTMENU QR Local Server" dir=in action=allow protocol=TCP localport=%LOCAL_PORT% >nul 2>&1
  if errorlevel 1 (
    echo [INFO] Regle pare-feu non ajoutee ^(droits Administrateur requis^).
    echo        Lors du premier demarrage, cliquez sur "Autoriser l'acces" dans Windows Defender.
  ) else (
    echo [OK] Port TCP %LOCAL_PORT% autorise sur le reseau local.
  )
) else (
  echo [OK] Regle Pare-feu Windows deja configuree.
)

echo.
if not exist "dist\index.html" set ENV_UPDATED=1
if "%ENV_UPDATED%"=="1" (
  echo [5/6] Compilation de l'application PWA ^(dist\^)...
  call npm run build
  if errorlevel 1 (
    echo [ERREUR] Echec de la compilation Vite.
    pause
    exit /b 1
  )
) else (
  echo [5/6] Build PWA ^(dist\^) deja pret. ^(Relancez "npm run build" apres toute modification du code ou de .env^)
)

echo.
echo [6/6] Pre-synchronisation du menu et des images depuis Supabase ^(si connecte^)...
node local-server\sync-cloud.mjs --timeout=8000

echo.
set /p MAKE_SHORTCUT="Creer un raccourci de demarrage sur le Bureau Windows ? [O/n] : "
if /I not "%MAKE_SHORTCUT%"=="N" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\SMARTMENU QR Serveur.lnk'); $s.TargetPath = '%CD%\local-server\start-windows.bat'; $s.WorkingDirectory = '%CD%'; $s.Save()" >nul 2>&1
  if errorlevel 1 (
    echo [INFO] Impossible de creer le raccourci automatiquement.
  ) else (
    echo [OK] Raccourci "SMARTMENU QR Serveur" ajoute sur le Bureau.
  )
)

echo.
echo ==============================================================
echo   Installation terminee avec succes !
echo   Double-cliquez sur local-server\start-windows.bat pour lancer.
echo ==============================================================
pause
