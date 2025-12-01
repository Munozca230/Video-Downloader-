// Drive Video Downloader - Popup Script

// Elementos del DOM
const videoStatus = document.getElementById('videoStatus');
const audioStatus = document.getElementById('audioStatus');
const videoQuality = document.getElementById('videoQuality');
const audioQuality = document.getElementById('audioQuality');
const scanBtn = document.getElementById('scanBtn');
const downloadBtn = document.getElementById('downloadBtn');
const clearBtn = document.getElementById('clearBtn');
const messageSection = document.getElementById('messageSection');
const message = document.getElementById('message');
const instructionsSection = document.getElementById('instructionsSection');
const configToggle = document.getElementById('configToggle');
const configPanel = document.getElementById('configPanel');
const downloadPath = document.getElementById('downloadPath');
const saveConfigBtn = document.getElementById('saveConfig');
const manualToggle = document.getElementById('manualToggle');
const manualPanel = document.getElementById('manualPanel');
const manualVideoUrl = document.getElementById('manualVideoUrl');
const manualAudioUrl = document.getElementById('manualAudioUrl');
const manualDownloadBtn = document.getElementById('manualDownloadBtn');

let currentTabId = null;

// Inicializar popup
async function init() {
  // Obtener la pestaña activa
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;

  // Verificar si estamos en una página de Google Drive
  const isGoogleDrive = tab.url && (
    tab.url.includes('drive.google.com') ||
    tab.url.includes('docs.google.com')
  );

  if (!isGoogleDrive) {
    showMessage('Abre un video en Google Drive para usar esta extension', 'info');
    downloadBtn.disabled = true;
    return;
  }

  // Cargar configuración
  await loadConfig();

  // Obtener estado actual
  await updateStatus();

  // Escuchar actualizaciones en tiempo real
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'URL_DETECTED' && msg.tabId === currentTabId) {
      updateStatusFromData(msg.data);
    }
  });
}

// Actualizar estado desde el background
async function updateStatus() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_STATUS',
      tabId: currentTabId
    });

    if (response.success) {
      updateStatusFromData(response.data);
    }
  } catch (error) {
    console.error('Error getting status:', error);
  }
}

// Actualizar UI con los datos
function updateStatusFromData(data) {
  // Video
  if (data.video) {
    videoStatus.classList.add('detected');
    videoQuality.textContent = data.video.quality || 'Detectado';
  } else {
    videoStatus.classList.remove('detected');
    videoQuality.textContent = 'No detectado';
  }

  // Audio
  if (data.audio) {
    audioStatus.classList.add('detected');
    audioQuality.textContent = data.audio.quality || 'Detectado';
  } else {
    audioStatus.classList.remove('detected');
    audioQuality.textContent = 'No detectado';
  }

  // Habilitar/deshabilitar boton de descarga
  downloadBtn.disabled = !(data.video && data.audio);

  // Ocultar instrucciones si ya detectamos algo
  if (data.video || data.audio) {
    instructionsSection.style.display = 'none';
  } else {
    instructionsSection.style.display = 'block';
  }
}

// Mostrar mensaje
function showMessage(text, type = 'info') {
  message.textContent = text;
  message.className = 'message ' + type;
  messageSection.style.display = 'block';

  // Auto-ocultar despues de 5 segundos (excepto loading)
  if (type !== 'loading') {
    setTimeout(() => {
      messageSection.style.display = 'none';
    }, 5000);
  }
}

// Descargar video
async function download() {
  downloadBtn.disabled = true;
  showMessage('Iniciando descarga...', 'loading');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'DOWNLOAD',
      tabId: currentTabId
    });

    if (response.success) {
      showMessage(
        `Descarga iniciada! Los archivos se combinaran automaticamente.`,
        'success'
      );
    } else {
      showMessage('Error: ' + response.error, 'error');
      downloadBtn.disabled = false;
    }
  } catch (error) {
    showMessage('Error al descargar: ' + error.message, 'error');
    downloadBtn.disabled = false;
  }
}

// Limpiar datos
async function clearData() {
  try {
    await chrome.runtime.sendMessage({
      type: 'CLEAR_DATA',
      tabId: currentTabId
    });

    videoStatus.classList.remove('detected');
    audioStatus.classList.remove('detected');
    videoQuality.textContent = 'No detectado';
    audioQuality.textContent = 'No detectado';
    downloadBtn.disabled = true;
    instructionsSection.style.display = 'block';
    messageSection.style.display = 'none';

    showMessage('Datos limpiados. Reproduce el video nuevamente.', 'info');
  } catch (error) {
    showMessage('Error al limpiar: ' + error.message, 'error');
  }
}

// Cargar configuracion
async function loadConfig() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
    if (response.success && response.config) {
      downloadPath.value = response.config.downloadPath || 'DriveVideos';
    }
  } catch (error) {
    console.error('Error loading config:', error);
  }
}

// Guardar configuracion
async function saveConfig() {
  try {
    await chrome.runtime.sendMessage({
      type: 'SAVE_CONFIG',
      config: {
        downloadPath: downloadPath.value || 'DriveVideos'
      }
    });
    showMessage('Configuracion guardada', 'success');
  } catch (error) {
    showMessage('Error al guardar: ' + error.message, 'error');
  }
}

// Toggle panel de configuracion
function toggleConfig() {
  if (configPanel.style.display === 'none') {
    configPanel.style.display = 'block';
  } else {
    configPanel.style.display = 'none';
  }
}

// Toggle panel manual
function toggleManual() {
  if (manualPanel.style.display === 'none') {
    manualPanel.style.display = 'block';
  } else {
    manualPanel.style.display = 'none';
  }
}

// Limpiar URL (remover range y parametros relacionados)
function cleanUrl(url) {
  let clean = url.trim();
  clean = clean.replace(/&range=[^&]*/g, '');
  clean = clean.replace(/&rn=[^&]*/g, '');
  clean = clean.replace(/&rbuf=[^&]*/g, '');
  return clean;
}

// Descargar con URLs manuales
async function manualDownload() {
  const videoUrl = manualVideoUrl.value.trim();
  const audioUrl = manualAudioUrl.value.trim();

  if (!videoUrl) {
    showMessage('Falta la URL del video', 'error');
    return;
  }

  if (!audioUrl) {
    showMessage('Falta la URL del audio', 'error');
    return;
  }

  if (!videoUrl.includes('videoplayback')) {
    showMessage('La URL del video no parece valida', 'error');
    return;
  }

  if (!audioUrl.includes('videoplayback')) {
    showMessage('La URL del audio no parece valida', 'error');
    return;
  }

  manualDownloadBtn.disabled = true;
  showMessage('Iniciando descarga manual...', 'loading');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'MANUAL_DOWNLOAD',
      videoUrl: cleanUrl(videoUrl),
      audioUrl: cleanUrl(audioUrl)
    });

    if (response.success) {
      showMessage('Descarga iniciada! Los archivos se combinaran automaticamente.', 'success');
      manualVideoUrl.value = '';
      manualAudioUrl.value = '';
    } else {
      showMessage('Error: ' + response.error, 'error');
    }
  } catch (error) {
    showMessage('Error al descargar: ' + error.message, 'error');
  }

  manualDownloadBtn.disabled = false;
}

// Escanear URLs usando chrome.debugger (acceso a Network como DevTools)
async function scanForUrls() {
  scanBtn.disabled = true;
  showMessage('Recargando pagina y escaneando... (espera 15s)', 'loading');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SCAN_WITH_DEBUGGER',
      tabId: currentTabId
    });

    if (response.success) {
      if (response.video || response.audio) {
        await updateStatus();
        const found = [];
        if (response.video) found.push('video');
        if (response.audio) found.push('audio');
        showMessage(`Encontrado: ${found.join(' y ')}!`, 'success');
      } else {
        showMessage('No se encontraron URLs. Asegurate de que el video se reproduzca.', 'error');
      }
    } else {
      showMessage('Error: ' + response.error, 'error');
    }
  } catch (error) {
    console.error('Scan error:', error);
    showMessage('Error: ' + error.message, 'error');
  }

  scanBtn.disabled = false;
}

// Event listeners
scanBtn.addEventListener('click', scanForUrls);
downloadBtn.addEventListener('click', download);
clearBtn.addEventListener('click', clearData);
configToggle.addEventListener('click', toggleConfig);
saveConfigBtn.addEventListener('click', saveConfig);
manualToggle.addEventListener('click', toggleManual);
manualDownloadBtn.addEventListener('click', manualDownload);

// Inicializar
init();
