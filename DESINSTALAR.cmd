@echo off
chcp 65001 >nul
title Desinstalar La Subtituleta
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1" -Uninstall
if errorlevel 1 (
  echo.
  echo No se pudo desinstalar La Subtituleta.
  pause
  exit /b 1
)
echo.
echo La Subtituleta fue desinstalada.
pause
