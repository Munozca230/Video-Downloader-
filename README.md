# Drive Video Downloader

Herramienta para descargar videos de Google Drive que no permiten descarga directa (solo visualizacion).

## Descripcion

Google Drive separa los videos en dos streams: video (sin audio) y audio. Esta herramienta:

1. **Extension de navegador**: Detecta y descarga ambos streams automaticamente
2. **Programa Merger**: Combina video + audio en un solo archivo MP4

## Requisitos

- Windows 10/11
- Microsoft Edge (o Chrome)
- Python 3.8 o superior
- ffmpeg

## Instalacion

### Paso 1: Ejecutar instalador

```
Doble clic en install.bat
```

Este script:
- Verifica Python
- Instala dependencias (watchdog, win10toast)
- Crea las carpetas necesarias
- Intenta instalar ffmpeg

### Paso 2: Instalar ffmpeg (si no se instalo automaticamente)

Opcion A - Con winget (recomendado):
```
winget install ffmpeg
```

Opcion B - Manual:
1. Descarga desde: https://www.gyan.dev/ffmpeg/builds/
2. Descarga "ffmpeg-release-essentials.zip"
3. Extrae y copia `ffmpeg.exe` a la carpeta `ffmpeg/` del proyecto

### Paso 3: Generar iconos de la extension

1. Abre `extension/icons/generate-icons.html` en tu navegador
2. Haz clic en "Generar y Descargar Iconos"
3. Mueve los 3 archivos PNG descargados a `extension/icons/`

### Paso 4: Instalar extension en Edge

1. Abre Edge y ve a: `edge://extensions/`
2. Activa **"Modo de desarrollador"** (esquina inferior izquierda)
3. Clic en **"Cargar descomprimida"**
4. Selecciona la carpeta `extension` del proyecto

## Uso

### 1. Iniciar el Merger

```
Doble clic en run_merger.bat
```

Deja esta ventana abierta mientras descargas videos. El merger monitorea la carpeta de descargas y combina automaticamente los archivos.

### 2. Descargar un video

1. Abre el video en Google Drive con tu cuenta
2. **Reproduce el video** por unos segundos (esto es importante para que carguen los streams)
3. Haz clic en el icono de la extension
4. Espera a que se detecten **Video** y **Audio**
5. Clic en **"Descargar Video"**

### 3. Esperar resultado

- Los archivos se descargan a: `~/Downloads/DriveVideos/`
- El merger los combina automaticamente
- El video final aparece en: `~/Downloads/DriveVideos/Combined/`
- Los archivos temporales se eliminan automaticamente

## Estructura del Proyecto

```
Video-Downloader-/
├── extension/              # Extension del navegador
│   ├── manifest.json
│   ├── background.js       # Intercepta URLs
│   ├── popup.html/js/css   # Interfaz
│   └── icons/              # Iconos de la extension
│
├── merger/                 # Programa combinador
│   ├── merger.py           # Script principal
│   ├── config.json         # Configuracion
│   └── requirements.txt    # Dependencias Python
│
├── ffmpeg/                 # ffmpeg portable
│   └── ffmpeg.exe
│
├── install.bat             # Instalador
├── run_merger.bat          # Ejecutar merger
└── README.md
```

## Configuracion

Edita `merger/config.json` para personalizar:

```json
{
  "watch_folder": "C:/Users/TU_USUARIO/Downloads/DriveVideos",
  "output_folder": "C:/Users/TU_USUARIO/Downloads/DriveVideos/Combined",
  "ffmpeg_path": "ffmpeg",
  "delete_temp_files": true,
  "notification_enabled": true
}
```

## Solucion de Problemas

### "No se detecta video/audio"
- Asegurate de **reproducir** el video por unos segundos
- Refresca la pagina e intenta de nuevo
- Haz clic en "Limpiar" en la extension y reproduce el video nuevamente

### "ffmpeg no encontrado"
- Verifica que ffmpeg este instalado: `ffmpeg -version`
- Si usas ffmpeg portable, actualiza la ruta en `config.json`

### "Los archivos no se combinan"
- Verifica que `run_merger.bat` este ejecutandose
- Revisa el archivo `merger/merger.log` para ver errores

### "La extension no aparece"
- Asegurate de que el "Modo de desarrollador" este activado
- Verifica que los iconos PNG existan en `extension/icons/`

## Como Funciona (Tecnico)

1. Google Drive usa DASH (Dynamic Adaptive Streaming over HTTP)
2. Video y audio se transmiten como streams separados via URLs `videoplayback`
3. La extension intercepta estas URLs usando `chrome.webRequest`
4. Detecta el tipo (video/audio) por el parametro `mime` o `itag`
5. Limpia las URLs removiendo `&range=...` para obtener el archivo completo
6. El merger usa ffmpeg para combinar sin re-codificar (`-c copy`)

## Nota Legal

Esta herramienta esta disenada para descargar contenido al que tienes acceso legitimo (ej: clases de tu universidad). No la uses para descargar contenido protegido por derechos de autor sin permiso.

## Creditos

- ffmpeg: https://ffmpeg.org/
- Metodo basado en discusiones de Reddit sobre descarga de videos de Google Drive
