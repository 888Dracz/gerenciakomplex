@echo off
chcp 65001 >nul
rem Abre el puerto 3004 en el Firewall de Windows para usar Gerencia Komplex
rem desde el celular u otras computadoras de la misma red WiFi.
rem Ejecutar como administrador UNA sola vez (clic derecho -> Ejecutar como administrador).
netsh advfirewall firewall add rule name="Gerencia Komplex (3004)" dir=in action=allow protocol=TCP localport=3004
echo.
echo Listo. Desde el celular entra a la direccion que aparece en
echo Configuracion - Acceso y celular (por ejemplo http://192.168.1.20:3004).
pause
