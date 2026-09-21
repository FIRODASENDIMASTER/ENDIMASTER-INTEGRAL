@echo off
cd /d "%~dp0"

echo ===============================================
echo   Abriendo ENDIMASTER en el navegador...
echo   NO CIERRES ESTA VENTANA mientras uses el sistema.
echo ===============================================

start "" http://localhost:5500/EndiMaster_conectado.html
npx --yes serve -l 5500 .
pause
