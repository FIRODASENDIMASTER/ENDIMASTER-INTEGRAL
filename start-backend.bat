@echo off
cd /d "%~dp0"

if not exist .env (
  echo [ERROR] No has corrido setup.bat todavia. Hazlo primero.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install
)

echo ===============================================
echo   ENDIMASTER backend iniciando...
echo   NO CIERRES ESTA VENTANA mientras uses el sistema.
echo ===============================================
call npm run dev
pause
