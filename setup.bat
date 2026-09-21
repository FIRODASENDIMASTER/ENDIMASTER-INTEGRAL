@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ===============================================
echo   ENDIMASTER - Configuracion inicial (Windows)
echo ===============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro Node.js instalado.
  echo Descargalo de https://nodejs.org ^(version LTS^), instalalo,
  echo y vuelve a hacer doble clic en este archivo.
  echo.
  pause
  exit /b 1
)
echo [OK] Node.js encontrado.

rem --- Buscar PostgreSQL: primero en el PATH, y si no, en la ubicacion tipica ---
rem Esto evita depender de que el instalador haya marcado "agregar al PATH".
set "PGBIN="

where psql >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%i in ('where psql') do if not defined PGBIN set "PGBIN=%%~dpi"
)

if not defined PGBIN (
  for /f "delims=" %%d in ('dir /b /ad "C:\Program Files\PostgreSQL" 2^>nul') do (
    if exist "C:\Program Files\PostgreSQL\%%d\bin\psql.exe" set "PGBIN=C:\Program Files\PostgreSQL\%%d\bin\"
  )
)

if not defined PGBIN (
  for /f "delims=" %%d in ('dir /b /ad "C:\Program Files (x86)\PostgreSQL" 2^>nul') do (
    if exist "C:\Program Files (x86)\PostgreSQL\%%d\bin\psql.exe" set "PGBIN=C:\Program Files (x86)\PostgreSQL\%%d\bin\"
  )
)

if not defined PGBIN (
  echo [ERROR] No se encontro PostgreSQL instalado.
  echo Si instalaste pgAdmin sin PostgreSQL, instala PostgreSQL completo desde:
  echo https://www.postgresql.org/download/windows/
  echo.
  pause
  exit /b 1
)

echo [OK] PostgreSQL encontrado en: !PGBIN!
rem Guardamos la ruta para que otros scripts la reutilicen sin buscar de nuevo.
echo !PGBIN!> .pgbin.txt
echo.

if exist .env (
  echo [OK] Ya existe un archivo .env, no se vuelve a crear.
  goto :installdeps
)

set /p PGPASS="Escribe la contrasena del usuario 'postgres' de PostgreSQL: "

for /f "delims=" %%i in ('node scripts\gen-key.js') do set ENCKEY=%%i
for /f "delims=" %%i in ('node scripts\gen-key.js') do set JWTKEY=%%i

(
echo DATABASE_URL=postgres://postgres:!PGPASS!@localhost:5432/endimaster
echo PGSSL=false
echo TOKEN_ENCRYPTION_KEY=!ENCKEY!
echo JWT_SECRET=!JWTKEY!
echo JWT_EXPIRES_IN=8h
echo QBO_CLIENT_ID=pendiente
echo QBO_CLIENT_SECRET=pendiente
echo QBO_ENVIRONMENT=sandbox
echo QBO_REDIRECT_URI=http://localhost:3000/api/connectors/quickbooks/callback
echo SIIGO_PARTNER_ID=pendiente
echo GOOGLE_CLIENT_ID=pendiente
echo GOOGLE_CLIENT_SECRET=pendiente
echo GOOGLE_REDIRECT_URI=http://localhost:3000/api/connectors/googlesheets/callback
echo ANTHROPIC_API_KEY=pendiente
echo FRONTEND_URL=http://localhost:5500
echo PORT=3000
) > .env

echo [OK] Archivo .env creado con claves de seguridad generadas automaticamente.
echo.

echo Creando la base de datos 'endimaster'...
set "PGPASSWORD=!PGPASS!"
"!PGBIN!createdb.exe" -U postgres endimaster 2>nul
"!PGBIN!psql.exe" -U postgres -d endimaster -f db\schema.sql
if errorlevel 1 (
  echo.
  echo [ERROR] No se pudo crear o cargar la base de datos.
  echo Revisa que la contrasena que escribiste sea correcta e intenta de nuevo.
  echo Si te equivocaste al escribirla, borra el archivo .env de esta carpeta
  echo y vuelve a correr setup.bat.
  pause
  exit /b 1
)
echo [OK] Base de datos creada y esquema cargado.

:installdeps
echo.
echo Instalando dependencias de Node.js (puede tardar 1-2 minutos)...
call npm install
if errorlevel 1 (
  echo [ERROR] Fallo la instalacion de dependencias. Revisa tu conexion a internet.
  pause
  exit /b 1
)

echo.
echo ===============================================
echo   TODO LISTO. Ahora puedes:
echo   1. Hacer doble clic en start-backend.bat
echo   2. Hacer doble clic en start-frontend.bat ^(dentro de la carpeta frontend^)
echo ===============================================
echo.
pause
