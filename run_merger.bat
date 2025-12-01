@echo off
chcp 65001 > nul
title Drive Video Merger

echo ========================================
echo   Drive Video Merger
echo ========================================
echo.
echo Monitoreando descargas...
echo Presiona Ctrl+C para detener.
echo.

cd /d "%~dp0merger"
python merger.py

if errorlevel 1 (
    echo.
    echo ERROR: El programa termino con errores.
    echo Revisa que Python este instalado correctamente.
    pause
)
