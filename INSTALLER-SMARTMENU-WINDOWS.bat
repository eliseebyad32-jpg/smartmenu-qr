@echo off
title SMARTMENU QR - Installateur Windows
cd /d "%~dp0"

echo Lancement de l'assistant graphique SMARTMENU QR...
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0local-server\installer-ui.ps1"
if errorlevel 1 (
  echo.
  echo [INFO] L'interface graphique n'a pas pu s'ouvrir. Lancement du mode guide simple...
  call "%~dp0local-server\setup-windows.bat"
)
