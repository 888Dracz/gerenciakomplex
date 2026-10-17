@echo off
chcp 65001 >nul
title Instalar requisitos - Gerencia Komplex
cd /d "%~dp0"

echo.
echo  ============================================
echo    INSTALAR GERENCIA KOMPLEX
echo  ============================================
echo.
echo  Esto revisa si falta Node.js, lo instala si hace falta,
echo  prepara el programa (descarga librerias y compila) y deja
echo  el icono "Gerencia Komplex" en el Escritorio.
echo  Puede pedir permiso de Administrador durante la instalacion.
echo.

where node >nul 2>nul
if errorlevel 1 goto FALTA_NODE

rem Se necesita Node 22.5 o mas nuevo.
node -e "const v=process.versions.node.split('.').map(Number); process.exit(v[0]>22||(v[0]===22&&v[1]>=5)?0:1)"
if errorlevel 1 goto FALTA_NODE
goto PREPARAR

:FALTA_NODE
where winget >nul 2>nul
if errorlevel 1 goto SIN_WINGET

echo  [*] Instalando Node.js 22 (version LTS)...
winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
echo.
echo  ============================================
echo    Node.js quedo instalado. CIERRA esta ventana
echo    y vuelve a abrir "Instalar requisitos.bat"
echo    (para que Windows reconozca los cambios).
echo  ============================================
echo.
pause
exit /b 0

:SIN_WINGET
echo  Esta PC no tiene winget, asi que se descargara el
echo  instalador oficial de Node.js y se abrira.
echo  Puedes dejar todas las opciones por defecto (Next, Next...).
echo.
set TMPDIR=%TEMP%\komplex_installers
if not exist "%TMPDIR%" mkdir "%TMPDIR%"
echo  [*] Descargando instalador de Node.js...
curl -L -o "%TMPDIR%\node-installer.msi" "https://nodejs.org/dist/v22.20.0/node-v22.20.0-x64.msi"
if errorlevel 1 (
  echo  [ERROR] No se pudo descargar Node.js. Revisa tu conexion a internet.
  echo          Tambien puedes instalarlo a mano desde https://nodejs.org
  pause
  exit /b 1
)
echo  [*] Abriendo instalador de Node.js...
start /wait "" msiexec /i "%TMPDIR%\node-installer.msi"
echo.
echo  ============================================
echo    LISTO. CIERRA esta ventana y vuelve a abrir
echo    "Instalar requisitos.bat" para terminar.
echo  ============================================
echo.
pause
exit /b 0

:PREPARAR
for /f %%v in ('node -p "process.versions.node"') do echo  Node.js %%v detectado.
echo.
echo  [*] Descargando librerias (puede tardar unos minutos)...
call npm install
if errorlevel 1 (
  echo.
  echo  [ERROR] Fallo la descarga de librerias. Revisa tu conexion
  echo          a internet y vuelve a intentar.
  pause
  exit /b 1
)

echo.
echo  [*] Compilando el programa...
call npm run build
if errorlevel 1 (
  echo.
  echo  [ERROR] Fallo la compilacion.
  pause
  exit /b 1
)

echo.
echo  [*] Creando el icono del Escritorio...
node scripts/acceso-directo.mjs --forzar

echo.
echo  ============================================
echo    TODO LISTO. Abre Gerencia Komplex con el
echo    icono "Gerencia Komplex" del Escritorio.
echo    La primera vez te pedira crear la carpeta
echo    donde se guardara la informacion.
echo  ============================================
echo.
pause
exit /b 0
