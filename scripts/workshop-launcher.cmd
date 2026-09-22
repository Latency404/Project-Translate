@echo off
rem Startet Project Translate mit dem auf dem Rechner installierten Node.js.
rem Im Workshop-Item liegt keine node.exe (der Workshop erlaubt keine .exe).
rem Bewusst geradeaus geschrieben: kein verstecktes Fenster, keine Wartetricks,
rem kein Nachladen aus dem Netz - solche Muster lassen Virenscanner anschlagen.
setlocal
cd /d "%~dp0"
set "PT_CONFIG_PATH=%~dp0config.json"
set "PT_EXPORT_ROOT=%~dp0export"
set "PT_OPEN_BROWSER=1"
echo.
echo   Project Translate
echo   -----------------

where node >nul 2>nul
if errorlevel 1 goto nonode
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=2)?0:1)"
if errorlevel 1 goto oldnode

echo   Address: http://127.0.0.1:3100
echo   Your browser opens as soon as the tool is ready.
echo   Close this window to stop it.
echo.
node "%~dp0app\server\index.js"
echo.
echo   Project Translate has stopped.
pause
exit /b 0

:nonode
echo   Node.js is not installed.
echo   Install the LTS version from https://nodejs.org, then start this file again.
echo   Or use the self-contained download (Node included) from the GitHub releases page.
echo.
pause
exit /b 1

:oldnode
echo   Your Node.js is too old. Version 22.2 or newer is needed.
echo   Install the current LTS version from https://nodejs.org, then start this file again.
echo.
pause
exit /b 1
