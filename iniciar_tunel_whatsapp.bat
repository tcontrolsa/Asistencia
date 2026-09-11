@echo off
title Tunel Cloudflare - OpenWA WhatsApp TCONTROL (con CORS Bridge)
echo ========================================================
echo   Iniciando CORS Bridge y Tunel Cloudflare para OpenWA
echo   OpenWA Destino: http://192.168.10.129:2785
echo   CORS Bridge: http://127.0.0.1:2786
echo ========================================================
echo.

:: 1. Verificar si el CORS Bridge ya esta activo en el puerto 2786
netstat -ano | findstr :2786 >nul
if %errorlevel% neq 0 (
    echo [1/2] Levantando WhatsApp CORS Bridge en segundo plano...
    start /B python whatsapp_cors_bridge.py
    timeout /t 2 /nobreak >nul
) else (
    echo [1/2] WhatsApp CORS Bridge ya esta corriendo en el puerto 2786.
)

echo.
echo [2/2] Iniciando Tunel HTTPS Cloudflare...
echo Copia el enlace https://...trycloudflare.com generado a continuacion si cambia de dominio.
echo Presiona Ctrl+C para detener el tunel.
echo ========================================================
echo.
"C:\Users\tcontrol\bin\cloudflared.exe" tunnel --url http://127.0.0.1:2786
pause
