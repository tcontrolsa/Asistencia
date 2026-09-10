@echo off
title Tunel Cloudflare - OpenWA WhatsApp TCONTROL
echo ========================================================
echo   Iniciando Tunel Cloudflare HTTPS para OpenWA WhatsApp
echo   Destino local: http://192.168.10.129:2785
echo ========================================================
echo.
echo Presiona Ctrl+C si deseas detener el tunel.
echo.
"C:\Users\tcontrol\bin\cloudflared.exe" tunnel --url http://192.168.10.129:2785 --http-host-header 192.168.10.129:2785
pause
