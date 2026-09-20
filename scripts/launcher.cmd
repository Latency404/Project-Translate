@echo off
rem Startet Project Translate mit der mitgelieferten Node-Laufzeit.
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
echo   Address: http://127.0.0.1:3100
echo   Your browser opens as soon as the tool is ready.
echo   Close this window to stop it.
echo.
"%~dp0runtime\node.exe" "%~dp0app\server\index.js"
echo.
echo   Project Translate has stopped.
pause
