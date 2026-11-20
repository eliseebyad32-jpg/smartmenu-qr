@echo off
title SMARTMENU QR - Synchronisation Supabase -> PC Local
cd /d "%~dp0.."

where node >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] Node.js n'est pas installe.
  pause
  exit /b 1
)

echo Synchronisation du catalogue et des images depuis Supabase vers ce PC...
node local-server\sync-cloud.mjs --timeout=12000
echo.
pause
