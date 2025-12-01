@echo off
chcp 65001 > nul
title Drive Video Downloader - Instalador

echo ========================================
echo   Drive Video Downloader - Instalador
echo ========================================
echo.

:: Verificar si Python esta instalado
echo [1/4] Verificando Python...
python --version > nul 2>&1
if errorlevel 1 (
    echo ERROR: Python no esta instalado.
    echo Por favor descarga Python desde: https://www.python.org/downloads/
    echo Asegurate de marcar "Add Python to PATH" durante la instalacion.
    pause
    exit /b 1
)
echo Python encontrado.
echo.

:: Instalar dependencias de Python
echo [2/4] Instalando dependencias de Python...
cd /d "%~dp0merger"
pip install -r requirements.txt
if errorlevel 1 (
    echo ADVERTENCIA: Algunas dependencias no se instalaron correctamente.
    echo El programa funcionara, pero sin algunas caracteristicas.
)
cd /d "%~dp0"
echo Dependencias instaladas.
echo.

:: Descargar ffmpeg si no existe
echo [3/4] Verificando ffmpeg...
if exist "%~dp0ffmpeg\ffmpeg.exe" (
    echo ffmpeg ya esta instalado.
) else (
    echo Descargando ffmpeg...
    echo.
    echo IMPORTANTE: Necesitas descargar ffmpeg manualmente.
    echo.
    echo 1. Ve a: https://www.gyan.dev/ffmpeg/builds/
    echo 2. Descarga "ffmpeg-release-essentials.zip"
    echo 3. Extrae el archivo
    echo 4. Copia ffmpeg.exe a la carpeta: %~dp0ffmpeg\
    echo.
    echo Alternativamente, puedes instalar ffmpeg con winget:
    echo    winget install ffmpeg
    echo.

    :: Crear carpeta ffmpeg
    if not exist "%~dp0ffmpeg" mkdir "%~dp0ffmpeg"

    :: Intentar con winget
    echo Intentando instalar con winget...
    winget install ffmpeg --accept-package-agreements --accept-source-agreements > nul 2>&1
    if not errorlevel 1 (
        echo ffmpeg instalado con winget.
    ) else (
        echo No se pudo instalar automaticamente.
        echo Por favor sigue las instrucciones manuales arriba.
    )
)
echo.

:: Crear carpeta de descargas
echo [4/4] Creando carpetas...
if not exist "%USERPROFILE%\Downloads\DriveVideos" (
    mkdir "%USERPROFILE%\Downloads\DriveVideos"
    echo Carpeta creada: %USERPROFILE%\Downloads\DriveVideos
)
if not exist "%USERPROFILE%\Downloads\DriveVideos\Combined" (
    mkdir "%USERPROFILE%\Downloads\DriveVideos\Combined"
    echo Carpeta creada: %USERPROFILE%\Downloads\DriveVideos\Combined
)
echo.

echo ========================================
echo   Instalacion completada!
echo ========================================
echo.
echo Proximos pasos:
echo.
echo 1. EXTENSION DEL NAVEGADOR:
echo    - Abre Edge y ve a: edge://extensions/
echo    - Activa "Modo de desarrollador"
echo    - Haz clic en "Cargar descomprimida"
echo    - Selecciona la carpeta: %~dp0extension
echo.
echo 2. GENERAR ICONOS:
echo    - Abre el archivo: extension\icons\generate-icons.html
echo    - Descarga los iconos y muevalos a extension\icons\
echo.
echo 3. EJECUTAR MERGER:
echo    - Ejecuta: run_merger.bat
echo.
pause
