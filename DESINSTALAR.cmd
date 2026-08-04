@echo off
chcp 65001 >nul
title Desinstalar Subtitulador
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1" -Uninstall
if errorlevel 1 (
  echo.
  echo No se pudo desinstalar Subtitulador.
  pause
  exit /b 1
)
echo.
echo Subtitulador fue desinstalado.
pause
