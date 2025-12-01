#!/usr/bin/env python3
"""
Drive Video Merger - Combina automaticamente video y audio descargados
Este script monitorea una carpeta y combina los archivos de video y audio
que son descargados por la extension Drive Video Downloader.
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


class VideoMerger:
    """Clase principal para combinar video y audio"""

    def __init__(self, config):
        self.config = config
        self.pending_files = defaultdict(dict)  # {session_id: {video: path, audio: path}}
        self.processed_sessions = set()
        self.toaster = ToastNotifier() if TOAST_AVAILABLE and config.notification_enabled else None

        # Crear carpetas si no existen
        os.makedirs(config.watch_folder, exist_ok=True)
        os.makedirs(config.output_folder, exist_ok=True)

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
            if filename.endswith('.mp4'):
                filepath = os.path.join(self.config.watch_folder, filename)
                self.process_file(filepath)


class FileHandler(FileSystemEventHandler):
    """Handler para eventos de archivos (watchdog)"""

    def __init__(self, merger):
        self.merger = merger

    def on_created(self, event):
        if event.is_directory:
            return

        if event.src_path.endswith('.mp4'):
            # Pequeño delay para asegurar que el archivo esta escrito
            time.sleep(2)
            self.merger.process_file(event.src_path)

    def on_moved(self, event):
        if event.is_directory:
            return

        if event.dest_path.endswith('.mp4'):
            time.sleep(2)
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
                    if filename.endswith('.mp4'):
                        filepath = os.path.join(config.watch_folder, filename)
                        time.sleep(2)  # Esperar a que termine la descarga
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
