@echo off
chcp 65001 >nul
title Gerencia Komplex
rem Inicia Gerencia Komplex (puerto 3004) y lo abre en su propia ventana.
rem Para cerrar el programa, cierra esta ventana negra.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No se encontro Node.js.
  echo  Ejecuta primero "Instalar requisitos.bat".
  echo.
  pause
  exit /b 1
)

rem Si falta lo compilado o las librerias, se prepara solo la primera vez.
if not exist "node_modules" goto PREPARAR
if not exist "server\dist\index.js" goto PREPARAR
if not exist "server\public\index.html" goto PREPARAR
goto ARRANCAR

:PREPARAR
echo.
echo  Primera vez: preparando el programa (esto tarda unos minutos)...
echo.
if not exist "node_modules" call npm install
call npm run build
if errorlevel 1 (
  echo.
  echo  [ERROR] No se pudo preparar el programa.
  echo          Ejecuta "Instalar requisitos.bat" y revisa el mensaje.
  echo.
  pause
  exit /b 1
)

:ARRANCAR
rem La primera vez deja un icono "Gerencia Komplex" en el Escritorio.
node scripts/acceso-directo.mjs

echo.
echo  Iniciando Gerencia Komplex... (para cerrarlo, cierra esta ventana)
echo  El programa se abre solo en su ventana.
echo.
call npm start
pause
