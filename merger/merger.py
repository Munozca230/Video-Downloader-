#!/usr/bin/env python3
"""
Drive Video Merger - Combina automaticamente video y audio descargados
Este script monitorea una carpeta y combina los archivos de video y audio
que son descargados por la extension Drive Video Downloader.

Tambien puede procesar archivos HAR exportados de DevTools para extraer
y descargar automaticamente las URLs de video y audio.
"""

import os
import sys
import time
import json
import re
import subprocess
import logging
from pathlib import Path
from datetime import datetime
from collections import defaultdict
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse, unquote

# Intentar importar requests para descargas
try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False
    print("requests no disponible, instala con: pip install requests")

# Intentar importar watchdog, si no esta disponible usar polling
try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    WATCHDOG_AVAILABLE = True
except ImportError:
    WATCHDOG_AVAILABLE = False
    print("Watchdog no disponible, usando modo polling...")

# Intentar importar win10toast para notificaciones
try:
    from win10toast import ToastNotifier
    TOAST_AVAILABLE = True
except ImportError:
    TOAST_AVAILABLE = False

# Configuracion de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('merger.log', encoding='utf-8')
    ]
)
logger = logging.getLogger(__name__)


class Config:
    """Configuracion del merger"""

    def __init__(self, config_path='config.json'):
        self.config_path = config_path
        self.load()

    def load(self):
        """Cargar configuracion desde archivo"""
        defaults = {
            'watch_folder': os.path.join(os.path.expanduser('~'), 'Downloads', 'DriveVideos'),
            'output_folder': os.path.join(os.path.expanduser('~'), 'Downloads', 'DriveVideos', 'Combined'),
            'ffmpeg_path': 'ffmpeg',
            'delete_temp_files': True,
            'notification_enabled': True,
            'check_interval': 5,  # segundos (para modo polling)
            'merge_timeout': 300  # segundos
        }

        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    user_config = json.load(f)
                    # Solo actualizar valores que no esten vacios
                    for key, value in user_config.items():
                        if value != "" and value is not None:
                            defaults[key] = value
            except Exception as e:
                logger.error(f"Error cargando config: {e}")

        for key, value in defaults.items():
            setattr(self, key, value)

    def save(self):
        """Guardar configuracion actual"""
        config_dict = {
            'watch_folder': self.watch_folder,
            'output_folder': self.output_folder,
            'ffmpeg_path': self.ffmpeg_path,
            'delete_temp_files': self.delete_temp_files,
            'notification_enabled': self.notification_enabled,
            'check_interval': self.check_interval,
            'merge_timeout': self.merge_timeout
        }

        with open(self.config_path, 'w', encoding='utf-8') as f:
            json.dump(config_dict, f, indent=2)


class HARProcessor:
    """Procesa archivos HAR para extraer URLs de videoplayback"""

    # itags conocidos para video y audio
    VIDEO_ITAGS = {137, 136, 135, 134, 133, 160, 298, 299, 264, 266, 138, 313, 315, 272, 308,
                   243, 244, 245, 246, 247, 248, 278, 302, 303, 330, 331, 332, 333, 334, 335, 336, 337}
    AUDIO_ITAGS = {140, 141, 171, 249, 250, 251, 139, 172}

    # Prioridad de calidad (mayor = mejor)
    QUALITY_PRIORITY = {
        # Video
        266: 10, 313: 10, 315: 11,  # 2160p
        264: 8, 308: 9,  # 1440p
        137: 6, 299: 7,  # 1080p
        136: 4, 298: 5,  # 720p
        135: 3,  # 480p
        134: 2,  # 360p
        133: 1,  # 240p
        160: 0,  # 144p
        # Audio
        141: 5,  # 256kbps
        251: 4,  # 160kbps
        140: 3,  # 128kbps
        250: 2,  # 70kbps
        249: 1,  # 50kbps
    }

    @staticmethod
    def clean_url(url):
        """Limpiar URL removiendo parametros de rango y streaming"""
        parsed = urlparse(url)
        params = parse_qs(parsed.query, keep_blank_values=True)

        # Parametros a remover
        params_to_remove = ['range', 'rn', 'rbuf', 'ump', 'srfvp', 'cpn', 'cver', 'alr']
        for param in params_to_remove:
            params.pop(param, None)

        # Reconstruir query string (sin listas)
        clean_params = {k: v[0] if isinstance(v, list) and len(v) == 1 else v for k, v in params.items()}
        new_query = urlencode(clean_params, doseq=True)

        return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_query, parsed.fragment))

    @staticmethod
    def is_valid_url(url):
        """Verificar si una URL es valida para descarga"""
        if 'videoplayback' not in url:
            return False

        # Rechazar solo URLs que claramente son peticiones parciales/chunked
        # Estas tienen ump=1 Y srfvp=1 juntos (streaming chunks)
        has_ump = 'ump=1' in url
        has_srfvp = 'srfvp=1' in url

        # Solo rechazar si tiene AMBOS parametros de streaming
        if has_ump and has_srfvp:
            return False

        return True

    @staticmethod
    def get_itag(url):
        """Extraer itag de la URL"""
        match = re.search(r'itag[=/](\d+)', url)
        return int(match.group(1)) if match else None

    @staticmethod
    def get_media_type(url):
        """Detectar si es video o audio"""
        # Primero verificar por mime
        if 'mime=video' in url.lower():
            return 'video'
        if 'mime=audio' in url.lower():
            return 'audio'

        # Luego por itag
        itag = HARProcessor.get_itag(url)
        if itag:
            if itag in HARProcessor.VIDEO_ITAGS:
                return 'video'
            if itag in HARProcessor.AUDIO_ITAGS:
                return 'audio'

        return None

    @staticmethod
    def get_content_length(url):
        """Extraer clen (content length) de la URL"""
        match = re.search(r'clen=(\d+)', url)
        return int(match.group(1)) if match else 0

    @classmethod
    def process_har(cls, har_path):
        """Procesar archivo HAR y extraer las mejores URLs de video y audio"""
        logger.info(f"Procesando HAR: {har_path}")

        try:
            with open(har_path, 'r', encoding='utf-8') as f:
                har_data = json.load(f)
        except Exception as e:
            logger.error(f"Error leyendo HAR: {e}")
            return None, None

        entries = har_data.get('log', {}).get('entries', [])

        video_urls = []
        audio_urls = []

        videoplayback_count = 0
        for entry in entries:
            url = entry.get('request', {}).get('url', '')

            if 'videoplayback' not in url:
                continue

            videoplayback_count += 1
            # Decodificar URL por si tiene caracteres escapados
            url = unquote(url)

            media_type = cls.get_media_type(url)
            if not media_type:
                itag = cls.get_itag(url)
                logger.warning(f"URL videoplayback ignorada (tipo desconocido): itag={itag}, mime detectado: {'mime=' in url}")
                # Mostrar parte de la URL para debug
                if 'mime=' in url:
                    mime_start = url.find('mime=')
                    logger.warning(f"  mime param: {url[mime_start:mime_start+30]}")
                continue

            if not cls.is_valid_url(url):
                logger.debug(f"URL ignorada (invalida): {media_type} itag={cls.get_itag(url)}")
                continue

            itag = cls.get_itag(url)
            priority = cls.QUALITY_PRIORITY.get(itag, 0)
            clen = cls.get_content_length(url)
            has_redirect = 'cms_redirect=yes' in url

            url_info = {
                'url': url,
                'itag': itag,
                'priority': priority,
                'clen': clen,
                'has_redirect': has_redirect
            }

            if media_type == 'video':
                video_urls.append(url_info)
            else:
                audio_urls.append(url_info)

        logger.info(f"Total videoplayback URLs en HAR: {videoplayback_count}")
        logger.info(f"URLs validas encontradas: {len(video_urls)} video, {len(audio_urls)} audio")

        # Seleccionar la mejor URL para video y audio
        best_video = cls._select_best_url(video_urls)
        best_audio = cls._select_best_url(audio_urls)

        if best_video:
            logger.info(f"Video seleccionado: itag={best_video['itag']}, size={best_video['clen']//1024//1024}MB, redirect={best_video['has_redirect']}")
        if best_audio:
            logger.info(f"Audio seleccionado: itag={best_audio['itag']}, size={best_audio['clen']//1024//1024}MB, redirect={best_audio['has_redirect']}")

        return best_video, best_audio

    @classmethod
    def _select_best_url(cls, urls):
        """Seleccionar la mejor URL basado en prioridad y otros factores"""
        if not urls:
            return None

        # Ordenar por: 1) tiene cms_redirect, 2) prioridad de calidad, 3) content length
        urls.sort(key=lambda x: (x['has_redirect'], x['priority'], x['clen']), reverse=True)

        best = urls[0]
        logger.debug(f"Seleccionada URL con itag={best['itag']}, redirect={best['has_redirect']}, clen={best['clen']}")
        return best


class VideoMerger:
    """Clase principal para combinar video y audio"""

    def __init__(self, config):
        self.config = config
        self.pending_files = defaultdict(dict)  # {session_id: {video: path, audio: path}}
        self.processed_sessions = set()
        self.processed_hars = set()  # HAR files already processed
        self.toaster = ToastNotifier() if TOAST_AVAILABLE and config.notification_enabled else None

        # Crear carpetas si no existen
        os.makedirs(config.watch_folder, exist_ok=True)
        os.makedirs(config.output_folder, exist_ok=True)

    def download_url(self, url, output_path, description="archivo"):
        """Descargar un archivo desde URL"""
        if not REQUESTS_AVAILABLE:
            logger.error("requests no disponible, no se puede descargar")
            return False

        logger.info(f"Descargando {description}...")

        try:
            response = requests.get(url, stream=True, timeout=300)
            response.raise_for_status()

            total_size = int(response.headers.get('content-length', 0))
            downloaded = 0

            with open(output_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total_size > 0:
                            percent = (downloaded / total_size) * 100
                            print(f"\r  {description}: {percent:.1f}% ({downloaded//1024//1024}MB)", end='', flush=True)

            print()  # Nueva linea despues del progreso
            logger.info(f"{description} descargado: {output_path}")
            return True

        except requests.exceptions.RequestException as e:
            logger.error(f"Error descargando {description}: {e}")
            return False

    def process_har_file(self, har_path):
        """Procesar un archivo HAR"""
        if har_path in self.processed_hars:
            return

        logger.info(f"Archivo HAR detectado: {os.path.basename(har_path)}")

        # Extraer URLs del HAR
        best_video, best_audio = HARProcessor.process_har(har_path)

        if not best_video:
            logger.error("No se encontro URL de video valida en el HAR")
            return

        if not best_audio:
            logger.error("No se encontro URL de audio valida en el HAR")
            return

        # Limpiar las URLs
        video_url = HARProcessor.clean_url(best_video['url'])
        audio_url = HARProcessor.clean_url(best_audio['url'])

        # Generar nombres de archivo
        timestamp = int(time.time() * 1000)
        session_id = os.urandom(3).hex()

        video_filename = f"video_{timestamp}_{session_id}.mp4"
        audio_filename = f"audio_{timestamp}_{session_id}.mp4"

        video_path = os.path.join(self.config.watch_folder, video_filename)
        audio_path = os.path.join(self.config.watch_folder, audio_filename)

        # Descargar video y audio
        video_ok = self.download_url(video_url, video_path, "video")
        audio_ok = self.download_url(audio_url, audio_path, "audio")

        if not video_ok or not audio_ok:
            logger.error("Error en la descarga, abortando")
            # Limpiar archivos parciales
            for path in [video_path, audio_path]:
                if os.path.exists(path):
                    os.remove(path)
            return

        # Marcar HAR como procesado
        self.processed_hars.add(har_path)

        # Combinar
        output_filename = f"clase_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4"
        output_path = os.path.join(self.config.output_folder, output_filename)

        success = self.merge_files(video_path, audio_path, output_path)

        if success:
            # Eliminar archivos temporales
            if self.config.delete_temp_files:
                try:
                    os.remove(video_path)
                    os.remove(audio_path)
                    os.remove(har_path)
                    logger.info("Archivos temporales y HAR eliminados")
                except Exception as e:
                    logger.warning(f"Error eliminando temporales: {e}")

            self.notify(f"Video combinado: {output_filename}")

    def extract_session_info(self, filename):
        """Extraer tipo y session_id del nombre del archivo"""
        # Formato esperado: {tipo}_{timestamp}_{sessionId}.mp4
        # Ejemplo: video_1699999999999_abc123.mp4
        pattern = r'^(video|audio)_(\d+)_([a-z0-9]+)\.mp4$'
        match = re.match(pattern, filename, re.IGNORECASE)

        if match:
            file_type = match.group(1).lower()
            timestamp = match.group(2)
            session_id = match.group(3)
            return file_type, f"{timestamp}_{session_id}"

        return None, None

    def check_file_ready(self, filepath, timeout=30):
        """Verificar que el archivo esta completamente descargado"""
        if not os.path.exists(filepath):
            return False

        # Esperar a que el tamano del archivo se estabilice
        last_size = -1
        stable_count = 0
        start_time = time.time()

        while time.time() - start_time < timeout:
            try:
                current_size = os.path.getsize(filepath)
                if current_size == last_size and current_size > 0:
                    stable_count += 1
                    if stable_count >= 3:  # Tamano estable por 3 checks
                        return True
                else:
                    stable_count = 0
                    last_size = current_size
            except OSError:
                pass

            time.sleep(1)

        return False

    def merge_files(self, video_path, audio_path, output_path):
        """Combinar video y audio usando ffmpeg"""
        logger.info(f"Combinando: {os.path.basename(video_path)} + {os.path.basename(audio_path)}")

        cmd = [
            self.config.ffmpeg_path,
            '-i', video_path,
            '-i', audio_path,
            '-c:v', 'copy',
            '-c:a', 'copy',
            '-y',  # Sobrescribir si existe
            output_path
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.config.merge_timeout
            )

            if result.returncode == 0:
                logger.info(f"Video combinado exitosamente: {output_path}")
                return True
            else:
                logger.error(f"Error ffmpeg: {result.stderr}")
                return False

        except subprocess.TimeoutExpired:
            logger.error("Timeout al combinar video")
            return False
        except FileNotFoundError:
            logger.error(f"ffmpeg no encontrado en: {self.config.ffmpeg_path}")
            return False
        except Exception as e:
            logger.error(f"Error al combinar: {e}")
            return False

    def process_file(self, filepath):
        """Procesar un archivo nuevo"""
        filename = os.path.basename(filepath)
        file_type, session_id = self.extract_session_info(filename)

        if not file_type or not session_id:
            logger.debug(f"Archivo ignorado (formato no reconocido): {filename}")
            return

        if session_id in self.processed_sessions:
            return

        logger.info(f"Archivo detectado: {filename} (tipo: {file_type}, sesion: {session_id})")

        # Verificar que el archivo esta listo
        if not self.check_file_ready(filepath):
            logger.warning(f"Archivo no esta listo: {filename}")
            return

        # Agregar al diccionario de pendientes
        self.pending_files[session_id][file_type] = filepath

        # Verificar si tenemos ambos archivos
        if 'video' in self.pending_files[session_id] and 'audio' in self.pending_files[session_id]:
            self.combine_session(session_id)

    def combine_session(self, session_id):
        """Combinar los archivos de una sesion"""
        if session_id in self.processed_sessions:
            return

        video_path = self.pending_files[session_id]['video']
        audio_path = self.pending_files[session_id]['audio']

        # Generar nombre de salida
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        output_filename = f"clase_{timestamp}.mp4"
        output_path = os.path.join(self.config.output_folder, output_filename)

        # Combinar
        success = self.merge_files(video_path, audio_path, output_path)

        if success:
            self.processed_sessions.add(session_id)

            # Eliminar archivos temporales si esta configurado
            if self.config.delete_temp_files:
                try:
                    os.remove(video_path)
                    os.remove(audio_path)
                    logger.info("Archivos temporales eliminados")
                except Exception as e:
                    logger.warning(f"Error eliminando temporales: {e}")

            # Notificacion
            self.notify(f"Video combinado: {output_filename}")
        else:
            logger.error(f"Error al combinar sesion {session_id}")

        # Limpiar pendientes
        del self.pending_files[session_id]

    def notify(self, message):
        """Enviar notificacion de Windows"""
        logger.info(message)

        if self.toaster:
            try:
                self.toaster.show_toast(
                    "Drive Video Downloader",
                    message,
                    duration=5,
                    threaded=True
                )
            except Exception as e:
                logger.debug(f"Error en notificacion: {e}")

    def scan_existing_files(self):
        """Escanear archivos existentes en la carpeta"""
        logger.info(f"Escaneando carpeta: {self.config.watch_folder}")

        if not os.path.exists(self.config.watch_folder):
            return

        for filename in os.listdir(self.config.watch_folder):
            filepath = os.path.join(self.config.watch_folder, filename)

            if filename.endswith('.har'):
                self.process_har_file(filepath)
            elif filename.endswith('.mp4'):
                self.process_file(filepath)


class FileHandler(FileSystemEventHandler):
    """Handler para eventos de archivos (watchdog)"""

    def __init__(self, merger):
        self.merger = merger

    def on_created(self, event):
        if event.is_directory:
            return

        # Pequeño delay para asegurar que el archivo esta escrito
        time.sleep(2)

        if event.src_path.endswith('.har'):
            self.merger.process_har_file(event.src_path)
        elif event.src_path.endswith('.mp4'):
            self.merger.process_file(event.src_path)

    def on_moved(self, event):
        if event.is_directory:
            return

        time.sleep(2)

        if event.dest_path.endswith('.har'):
            self.merger.process_har_file(event.dest_path)
        elif event.dest_path.endswith('.mp4'):
            self.merger.process_file(event.dest_path)


def run_with_watchdog(merger, config):
    """Ejecutar usando watchdog para monitoreo eficiente"""
    event_handler = FileHandler(merger)
    observer = Observer()
    observer.schedule(event_handler, config.watch_folder, recursive=False)
    observer.start()

    logger.info(f"Monitoreando carpeta: {config.watch_folder}")
    logger.info("Presiona Ctrl+C para detener...")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
        logger.info("Detenido por usuario")

    observer.join()


def run_with_polling(merger, config):
    """Ejecutar usando polling (alternativa si watchdog no esta disponible)"""
    logger.info(f"Monitoreando carpeta (polling): {config.watch_folder}")
    logger.info("Presiona Ctrl+C para detener...")

    seen_files = set()

    try:
        while True:
            if os.path.exists(config.watch_folder):
                current_files = set(os.listdir(config.watch_folder))
                new_files = current_files - seen_files

                for filename in new_files:
                    filepath = os.path.join(config.watch_folder, filename)
                    time.sleep(2)  # Esperar a que termine la descarga

                    if filename.endswith('.har'):
                        merger.process_har_file(filepath)
                    elif filename.endswith('.mp4'):
                        merger.process_file(filepath)

                seen_files = current_files

            time.sleep(config.check_interval)

    except KeyboardInterrupt:
        logger.info("Detenido por usuario")


def check_ffmpeg(ffmpeg_path):
    """Verificar que ffmpeg esta disponible"""
    try:
        result = subprocess.run(
            [ffmpeg_path, '-version'],
            capture_output=True,
            text=True
        )
        return result.returncode == 0
    except FileNotFoundError:
        return False


def main():
    print("=" * 50)
    print("  Drive Video Merger")
    print("  Combina automaticamente video y audio")
    print("=" * 50)
    print()
    print("Modos soportados:")
    print("  1. Archivos MP4 (video_*.mp4 + audio_*.mp4)")
    print("  2. Archivos HAR (exportados de DevTools)")
    print()

    # Cargar configuracion
    config = Config()

    # Verificar ffmpeg
    if not check_ffmpeg(config.ffmpeg_path):
        logger.error(f"ffmpeg no encontrado en: {config.ffmpeg_path}")
        logger.error("Por favor instala ffmpeg o actualiza la ruta en config.json")

        # Intentar con ffmpeg en la carpeta local
        local_ffmpeg = os.path.join(os.path.dirname(__file__), '..', 'ffmpeg', 'ffmpeg.exe')
        if os.path.exists(local_ffmpeg):
            config.ffmpeg_path = local_ffmpeg
            logger.info(f"Usando ffmpeg local: {local_ffmpeg}")
        else:
            sys.exit(1)

    logger.info(f"ffmpeg encontrado: {config.ffmpeg_path}")
    logger.info(f"Carpeta de monitoreo: {config.watch_folder}")
    logger.info(f"Carpeta de salida: {config.output_folder}")
    logger.info(f"Eliminar temporales: {config.delete_temp_files}")
    print()

    # Crear merger
    merger = VideoMerger(config)

    # Escanear archivos existentes
    merger.scan_existing_files()

    # Iniciar monitoreo
    if WATCHDOG_AVAILABLE:
        run_with_watchdog(merger, config)
    else:
        run_with_polling(merger, config)


if __name__ == '__main__':
    main()
