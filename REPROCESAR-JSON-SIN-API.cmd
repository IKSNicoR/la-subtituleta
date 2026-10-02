@echo off
setlocal
if "%~1"=="" (
  echo Arrastra un JSON de La Subtituleta sobre este archivo.
  echo No abre Premiere ni consume ninguna API.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo No encontre Node.js en esta computadora.
  pause
  exit /b 1
)
node "%~dp0tools\reprocess-json.js" %*
echo.
pause
