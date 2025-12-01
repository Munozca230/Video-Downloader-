// Drive Video Downloader - Popup Script

// Elementos del DOM
const videoStatus = document.getElementById('videoStatus');
const audioStatus = document.getElementById('audioStatus');
const videoQuality = document.getElementById('videoQuality');
const audioQuality = document.getElementById('audioQuality');
const messageSection = document.getElementById('messageSection');
const message = document.getElementById('message');
const configToggle = document.getElementById('configToggle');
const configPanel = document.getElementById('configPanel');
const downloadPath = document.getElementById('downloadPath');
const saveConfigBtn = document.getElementById('saveConfig');
const manualVideoUrl = document.getElementById('manualVideoUrl');
const manualAudioUrl = document.getElementById('manualAudioUrl');
const manualDownloadBtn = document.getElementById('manualDownloadBtn');
const helpBtn = document.getElementById('helpBtn');
const manualHelp = document.getElementById('manualHelp');
const videoDetect = document.getElementById('videoDetect');
const audioDetect = document.getElementById('audioDetect');

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
    manualDownloadBtn.disabled = true;
    return;
  }

  // Cargar configuración
  await loadConfig();

  // Agregar validación en tiempo real
  manualVideoUrl.addEventListener('input', validateUrls);
  manualAudioUrl.addEventListener('input', validateUrls);
}

// Detectar tipo de media de una URL
function detectMediaType(url) {
  if (!url.includes('videoplayback')) return 'invalid';

  if (url.includes('mime=video')) return 'video';
  if (url.includes('mime=audio')) return 'audio';

  // Detectar por itag
  const itagMatch = url.match(/itag[=/](\d+)/);
  if (itagMatch) {
    const itag = parseInt(itagMatch[1]);
    const audioItags = [140, 141, 171, 249, 250, 251, 139, 172];
    if (audioItags.includes(itag)) return 'audio';
    return 'video';
  }

  return 'unknown';
}

// Obtener calidad de la URL
function getQuality(url) {
  const itagMatch = url.match(/itag[=/](\d+)/);
  if (!itagMatch) return '';

  const itag = parseInt(itagMatch[1]);
  const map = {
    137: '1080p', 136: '720p', 135: '480p', 134: '360p', 133: '240p', 160: '144p',
    140: '128kbps', 141: '256kbps', 251: '160kbps', 250: '70kbps', 249: '50kbps'
  };
  return map[itag] || '';
}

// Validar URLs y actualizar UI
function validateUrls() {
  const videoUrl = manualVideoUrl.value.trim();
  const audioUrl = manualAudioUrl.value.trim();

  // Validar video
  if (videoUrl) {
    const videoType = detectMediaType(videoUrl);
    const videoQ = getQuality(videoUrl);

    if (videoType === 'video') {
      videoDetect.textContent = videoQ || 'OK';
      videoDetect.className = 'auto-detect valid';
      videoStatus.classList.add('detected');
      videoQuality.textContent = videoQ || 'Detectado';
    } else if (videoType === 'audio') {
      videoDetect.textContent = 'Es audio!';
      videoDetect.className = 'auto-detect invalid';
      videoStatus.classList.remove('detected');
    } else if (videoType === 'invalid') {
      videoDetect.textContent = 'No valida';
      videoDetect.className = 'auto-detect invalid';
      videoStatus.classList.remove('detected');
    } else {
      videoDetect.textContent = videoQ || '?';
      videoDetect.className = 'auto-detect valid';
    }
  } else {
    videoDetect.textContent = '';
    videoDetect.className = 'auto-detect';
    videoStatus.classList.remove('detected');
    videoQuality.textContent = 'No detectado';
  }

  // Validar audio
  if (audioUrl) {
    const audioType = detectMediaType(audioUrl);
    const audioQ = getQuality(audioUrl);

    if (audioType === 'audio') {
      audioDetect.textContent = audioQ || 'OK';
      audioDetect.className = 'auto-detect valid';
      audioStatus.classList.add('detected');
      audioQuality.textContent = audioQ || 'Detectado';
    } else if (audioType === 'video') {
      audioDetect.textContent = 'Es video!';
      audioDetect.className = 'auto-detect invalid';
      audioStatus.classList.remove('detected');
    } else if (audioType === 'invalid') {
      audioDetect.textContent = 'No valida';
      audioDetect.className = 'auto-detect invalid';
      audioStatus.classList.remove('detected');
    } else {
      audioDetect.textContent = audioQ || '?';
      audioDetect.className = 'auto-detect valid';
    }
  } else {
    audioDetect.textContent = '';
    audioDetect.className = 'auto-detect';
    audioStatus.classList.remove('detected');
    audioQuality.textContent = 'No detectado';
  }

  // Habilitar/deshabilitar botón
  const videoValid = videoUrl && detectMediaType(videoUrl) !== 'invalid';
  const audioValid = audioUrl && detectMediaType(audioUrl) !== 'invalid';
  manualDownloadBtn.disabled = !(videoValid && audioValid);
}

// Mostrar mensaje
function showMessage(text, type = 'info') {
  message.textContent = text;
  message.className = 'message ' + type;
  messageSection.style.display = 'block';

  if (type !== 'loading') {
    setTimeout(() => {
      messageSection.style.display = 'none';
    }, 5000);
  }
}

// Limpiar URL
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

  if (!videoUrl || !audioUrl) {
    showMessage('Pega ambas URLs (video y audio)', 'error');
    return;
  }

  manualDownloadBtn.disabled = true;
  showMessage('Iniciando descarga...', 'loading');

  try {
    const cleanedVideoUrl = cleanUrl(videoUrl);
    const cleanedAudioUrl = cleanUrl(audioUrl);

    console.log('[Popup] Enviando URLs al background...');
    console.log('[Popup] Video URL length:', cleanedVideoUrl.length);
    console.log('[Popup] Audio URL length:', cleanedAudioUrl.length);

    const response = await chrome.runtime.sendMessage({
      type: 'MANUAL_DOWNLOAD',
      videoUrl: cleanedVideoUrl,
      audioUrl: cleanedAudioUrl
    });

    console.log('[Popup] Respuesta:', response);

    if (response && response.success) {
      showMessage('Descarga iniciada! El merger combinara los archivos.', 'success');
      manualVideoUrl.value = '';
      manualAudioUrl.value = '';
      validateUrls();
    } else if (response && response.error) {
      showMessage('Error: ' + response.error, 'error');
    } else {
      showMessage('Error: Respuesta inesperada del servicio', 'error');
    }
  } catch (error) {
    console.error('[Popup] Error:', error);
    // Si el canal se cerro, la descarga puede haber iniciado igual
    if (error.message && error.message.includes('message channel closed')) {
      showMessage('Descarga posiblemente iniciada. Revisa tu carpeta de descargas.', 'info');
    } else {
      showMessage('Error: ' + error.message, 'error');
    }
  }

  manualDownloadBtn.disabled = false;
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
  configPanel.style.display = configPanel.style.display === 'none' ? 'block' : 'none';
}

// Toggle ayuda
function toggleHelp() {
  manualHelp.style.display = manualHelp.style.display === 'none' ? 'block' : 'none';
}

// Event listeners
manualDownloadBtn.addEventListener('click', manualDownload);
configToggle.addEventListener('click', toggleConfig);
saveConfigBtn.addEventListener('click', saveConfig);
helpBtn.addEventListener('click', toggleHelp);

// Inicializar
init();
