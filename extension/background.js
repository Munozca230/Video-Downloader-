// Drive Video Downloader - Background Service Worker
// Intercepta y procesa URLs de videoplayback de Google Drive

// Almacenamiento de URLs detectadas por pestaña
const detectedUrls = new Map();

// Configuración por defecto
const DEFAULT_CONFIG = {
  downloadPath: 'DriveVideos',
  autoDownload: false
};

// Obtener configuración
async function getConfig() {
  const result = await chrome.storage.local.get('config');
  return { ...DEFAULT_CONFIG, ...result.config };
}

// Guardar configuración
async function saveConfig(config) {
  await chrome.storage.local.set({ config: { ...DEFAULT_CONFIG, ...config } });
}

// Limpiar URL removiendo parámetros de rango
function cleanVideoUrl(url) {
  // Remover &range=X-Y y todo lo que sigue relacionado con range
  let cleanUrl = url;

  // Patrón para remover range y parámetros relacionados
  cleanUrl = cleanUrl.replace(/&range=[^&]*/g, '');
  cleanUrl = cleanUrl.replace(/&rn=[^&]*/g, '');
  cleanUrl = cleanUrl.replace(/&rbuf=[^&]*/g, '');

  return cleanUrl;
}

// Detectar si es video o audio basado en la URL
function detectMediaType(url) {
  const urlLower = url.toLowerCase();

  // Buscar en el parámetro mime
  if (urlLower.includes('mime=video')) {
    return 'video';
  }
  if (urlLower.includes('mime=audio')) {
    return 'audio';
  }

  // Buscar por itag (códigos conocidos)
  // Video itags: 137, 136, 135, 134, 133, 160, 298, 299, 264, 266, 138, 313, 315, 272, 308
  // Audio itags: 140, 141, 171, 249, 250, 251
  const itagMatch = url.match(/itag[=/](\d+)/);
  if (itagMatch) {
    const itag = parseInt(itagMatch[1]);
    const audioItags = [140, 141, 171, 249, 250, 251, 139, 172];
    const videoItags = [137, 136, 135, 134, 133, 160, 298, 299, 264, 266, 138, 313, 315, 272, 308, 243, 244, 245, 246, 247, 248, 278, 302, 303, 308, 315, 330, 331, 332, 333, 334, 335, 336, 337];

    if (audioItags.includes(itag)) {
      return 'audio';
    }
    if (videoItags.includes(itag)) {
      return 'video';
    }
  }

  return 'unknown';
}

// Obtener calidad del video basado en itag
function getQualityFromItag(url) {
  const itagMatch = url.match(/itag[=/](\d+)/);
  if (!itagMatch) return 'unknown';

  const itag = parseInt(itagMatch[1]);
  const qualityMap = {
    // Video
    137: '1080p', 299: '1080p60', 264: '1440p', 266: '2160p',
    136: '720p', 298: '720p60',
    135: '480p', 134: '360p', 133: '240p', 160: '144p',
    313: '2160p', 315: '2160p60', 308: '1440p60',
    // Audio
    140: '128kbps', 141: '256kbps', 171: '128kbps',
    249: '50kbps', 250: '70kbps', 251: '160kbps'
  };

  return qualityMap[itag] || 'unknown';
}

// Listener para interceptar peticiones de red
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;

    // Filtrar solo URLs de videoplayback
    if (!url.includes('videoplayback')) {
      return;
    }

    const tabId = details.tabId;
    if (tabId < 0) return; // Ignorar peticiones sin tab

    const mediaType = detectMediaType(url);
    const quality = getQualityFromItag(url);
    const cleanUrl = cleanVideoUrl(url);

    // Inicializar storage para esta pestaña si no existe
    if (!detectedUrls.has(tabId)) {
      detectedUrls.set(tabId, { video: null, audio: null, timestamp: Date.now() });
    }

    const tabData = detectedUrls.get(tabId);

    // Actualizar URL según el tipo
    if (mediaType === 'video') {
      // Solo actualizar si es mejor calidad o no tenemos video
      if (!tabData.video || shouldUpdateUrl(tabData.video, url)) {
        tabData.video = {
          original: url,
          clean: cleanUrl,
          quality: quality,
          timestamp: Date.now()
        };
      }
    } else if (mediaType === 'audio') {
      if (!tabData.audio || shouldUpdateUrl(tabData.audio, url)) {
        tabData.audio = {
          original: url,
          clean: cleanUrl,
          quality: quality,
          timestamp: Date.now()
        };
      }
    }

    tabData.timestamp = Date.now();
    detectedUrls.set(tabId, tabData);

    // Notificar al popup si está abierto
    chrome.runtime.sendMessage({
      type: 'URL_DETECTED',
      tabId: tabId,
      data: tabData
    }).catch(() => {
      // Popup no está abierto, ignorar error
    });
  },
  { urls: ['*://*.googlevideo.com/*', '*://*.google.com/*'] }
);

// Determinar si debemos actualizar la URL (preferir mejor calidad)
function shouldUpdateUrl(existing, newUrl) {
  const existingQuality = getQualityFromItag(existing.original);
  const newQuality = getQualityFromItag(newUrl);

  // Prioridad de calidades
  const qualityPriority = {
    '2160p': 10, '2160p60': 11,
    '1440p': 8, '1440p60': 9,
    '1080p': 6, '1080p60': 7,
    '720p': 4, '720p60': 5,
    '480p': 3, '360p': 2, '240p': 1, '144p': 0,
    '256kbps': 5, '160kbps': 4, '128kbps': 3, '70kbps': 2, '50kbps': 1,
    'unknown': -1
  };

  return (qualityPriority[newQuality] || 0) > (qualityPriority[existingQuality] || 0);
}

// Generar nombre de archivo único
function generateFileName(type, tabId) {
  const timestamp = Date.now();
  const sessionId = Math.random().toString(36).substring(2, 8);
  return `${type}_${timestamp}_${sessionId}.mp4`;
}

// Descargar archivo
async function downloadFile(url, filename, downloadPath) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: url,
      filename: `${downloadPath}/${filename}`,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(downloadId);
      }
    });
  });
}

// Descargar video y audio de una pestaña
async function downloadVideoAndAudio(tabId) {
  const tabData = detectedUrls.get(tabId);

  if (!tabData) {
    throw new Error('No se han detectado URLs para esta pestaña');
  }

  if (!tabData.video) {
    throw new Error('No se ha detectado URL de video');
  }

  if (!tabData.audio) {
    throw new Error('No se ha detectado URL de audio');
  }

  const config = await getConfig();
  const timestamp = Date.now();
  const sessionId = Math.random().toString(36).substring(2, 8);

  const videoFilename = `video_${timestamp}_${sessionId}.mp4`;
  const audioFilename = `audio_${timestamp}_${sessionId}.mp4`;

  // Descargar ambos archivos
  const videoDownloadId = await downloadFile(tabData.video.clean, videoFilename, config.downloadPath);
  const audioDownloadId = await downloadFile(tabData.audio.clean, audioFilename, config.downloadPath);

  return {
    videoDownloadId,
    audioDownloadId,
    videoFilename,
    audioFilename,
    timestamp,
    sessionId
  };
}

// Limpiar datos de pestañas cerradas
chrome.tabs.onRemoved.addListener((tabId) => {
  detectedUrls.delete(tabId);
});

// Limpiar datos antiguos (más de 1 hora)
setInterval(() => {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  for (const [tabId, data] of detectedUrls.entries()) {
    if (data.timestamp < oneHourAgo) {
      detectedUrls.delete(tabId);
    }
  }
}, 5 * 60 * 1000); // Cada 5 minutos

// Manejar mensajes del popup y content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Mensaje del content script con URL detectada
  if (message.type === 'URL_FROM_PAGE') {
    const tabId = sender.tab ? sender.tab.id : -1;
    if (tabId < 0) {
      sendResponse({ success: false });
      return true;
    }

    // Inicializar storage para esta pestaña si no existe
    if (!detectedUrls.has(tabId)) {
      detectedUrls.set(tabId, { video: null, audio: null, timestamp: Date.now() });
    }

    const tabData = detectedUrls.get(tabId);
    const mediaType = message.mediaType;
    const urlData = message.data;

    if (mediaType === 'video' || mediaType === 'audio') {
      tabData[mediaType] = urlData;
      tabData.timestamp = Date.now();
      detectedUrls.set(tabId, tabData);

      console.log(`[Drive Downloader] ${mediaType} detectado:`, urlData.quality);

      // Notificar al popup si está abierto
      chrome.runtime.sendMessage({
        type: 'URL_DETECTED',
        tabId: tabId,
        data: tabData
      }).catch(() => {});
    }

    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'GET_STATUS') {
    const tabId = message.tabId;
    const tabData = detectedUrls.get(tabId) || { video: null, audio: null };
    sendResponse({ success: true, data: tabData });
    return true;
  }

  if (message.type === 'DOWNLOAD') {
    const tabId = message.tabId;
    downloadVideoAndAudio(tabId)
      .then((result) => {
        sendResponse({ success: true, data: result });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Indica que sendResponse será llamado asincrónicamente
  }

  if (message.type === 'GET_CONFIG') {
    getConfig().then((config) => {
      sendResponse({ success: true, config });
    });
    return true;
  }

  if (message.type === 'SAVE_CONFIG') {
    saveConfig(message.config).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'CLEAR_DATA') {
    const tabId = message.tabId;
    detectedUrls.delete(tabId);
    sendResponse({ success: true });
    return true;
  }

  // Descarga manual con URLs proporcionadas
  if (message.type === 'MANUAL_DOWNLOAD') {
    (async () => {
      try {
        const config = await getConfig();
        const timestamp = Date.now();
        const sessionId = Math.random().toString(36).substring(2, 8);

        const videoFilename = `video_${timestamp}_${sessionId}.mp4`;
        const audioFilename = `audio_${timestamp}_${sessionId}.mp4`;

        await downloadFile(message.videoUrl, videoFilename, config.downloadPath);
        await downloadFile(message.audioUrl, audioFilename, config.downloadPath);

        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
});

console.log('Drive Video Downloader - Background Service Worker iniciado');
