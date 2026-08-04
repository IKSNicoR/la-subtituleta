@echo off
chcp 65001 >nul
title Instalar Subtitulador
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"
if errorlevel 1 (
  echo.
  echo No se pudo instalar Subtitulador.
  pause
  exit /b 1
)
echo.
echo Instalacion terminada. Reinicia Premiere Pro.
pause
