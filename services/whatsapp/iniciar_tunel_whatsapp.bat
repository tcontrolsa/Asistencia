@echo off
title Tunel Cloudflare - OpenWA WhatsApp TCONTROL (Sincronizado con Firebase)
cd /d "%~dp0"
python iniciar_tunel.py
if %errorlevel% neq 0 (
    echo.
    echo Ocurrio un error al ejecutar iniciar_tunel.py.
    pause
)
