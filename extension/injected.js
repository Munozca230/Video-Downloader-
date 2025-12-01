// Script inyectado en la pagina para interceptar fetch y XHR
// Este script corre en el contexto de la pagina, no de la extension

(function() {
  'use strict';

  // Almacenar URLs detectadas
  const detectedUrls = {
    video: null,
    audio: null
  };

  // Set para evitar procesar URLs duplicadas
  const processedUrls = new Set();

  // Funcion para detectar tipo de media
  function detectMediaType(url) {
    const urlLower = url.toLowerCase();

    if (urlLower.includes('mime=video')) {
      return 'video';
    }
    if (urlLower.includes('mime=audio')) {
      return 'audio';
    }

    // Detectar por itag
    const itagMatch = url.match(/itag[=/](\d+)/);
    if (itagMatch) {
      const itag = parseInt(itagMatch[1]);
      const audioItags = [140, 141, 171, 249, 250, 251, 139, 172];
      if (audioItags.includes(itag)) {
        return 'audio';
      }
      return 'video';
    }

    return 'unknown';
  }

  // Funcion para limpiar URL
  function cleanUrl(url) {
    // Remover range y parametros relacionados
    let clean = url;
    clean = clean.replace(/&range=[^&]*/g, '');
    clean = clean.replace(/&rn=[^&]*/g, '');
    clean = clean.replace(/&rbuf=[^&]*/g, '');
    return clean;
  }

  // Funcion para obtener calidad
  function getQuality(url) {
    const itagMatch = url.match(/itag[=/](\d+)/);
    if (!itagMatch) return 'unknown';

    const itag = parseInt(itagMatch[1]);
    const qualityMap = {
      137: '1080p', 299: '1080p60', 264: '1440p', 266: '2160p',
      136: '720p', 298: '720p60',
      135: '480p', 134: '360p', 133: '240p', 160: '144p',
      140: '128kbps', 141: '256kbps', 251: '160kbps'
    };

    return qualityMap[itag] || 'detected';
  }

  // Funcion para enviar URL detectada
  function sendDetectedUrl(url) {
    if (!url.includes('videoplayback')) return;

    // Crear una key unica basada en el tipo de media (no la URL completa que cambia con range)
    const mediaType = detectMediaType(url);
    if (mediaType === 'unknown') return;

    // Evitar procesar la misma URL base multiples veces
    const urlKey = mediaType + '_' + url.split('&range=')[0].substring(0, 200);
    if (processedUrls.has(urlKey)) return;
    processedUrls.add(urlKey);

    const cleanedUrl = cleanUrl(url);
    const quality = getQuality(url);

    detectedUrls[mediaType] = {
      original: url,
      clean: cleanedUrl,
      quality: quality,
      timestamp: Date.now()
    };

    // Enviar al content script
    window.postMessage({
      type: 'DRIVE_VIDEO_URL_DETECTED',
      mediaType: mediaType,
      data: detectedUrls[mediaType],
      allUrls: detectedUrls
    }, '*');

    console.log('[Drive Downloader] Detectado:', mediaType, quality);
  }

  // Interceptar fetch
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const url = args[0] instanceof Request ? args[0].url : args[0];

    if (typeof url === 'string' && url.includes('videoplayback')) {
      sendDetectedUrl(url);
    }

    return originalFetch.apply(this, args);
  };

  // Interceptar XMLHttpRequest
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    if (typeof url === 'string' && url.includes('videoplayback')) {
      sendDetectedUrl(url);
    }
    return originalXhrOpen.apply(this, [method, url, ...rest]);
  };

  // Interceptar createElement para video elements
  const originalCreateElement = document.createElement;
  document.createElement = function(tagName, ...args) {
    const element = originalCreateElement.apply(this, [tagName, ...args]);

    if (tagName.toLowerCase() === 'video' || tagName.toLowerCase() === 'source') {
      const originalSetAttribute = element.setAttribute.bind(element);
      element.setAttribute = function(name, value) {
        if (name === 'src' && typeof value === 'string' && value.includes('videoplayback')) {
          sendDetectedUrl(value);
        }
        return originalSetAttribute(name, value);
      };

      // También monitorear la propiedad src
      let srcValue = '';
      Object.defineProperty(element, 'src', {
        get: function() { return srcValue; },
        set: function(value) {
          srcValue = value;
          if (typeof value === 'string' && value.includes('videoplayback')) {
            sendDetectedUrl(value);
          }
          originalSetAttribute('src', value);
        }
      });
    }

    return element;
  };

  // PerformanceObserver para detectar recursos cargados (funciona incluso con Service Workers)
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name && entry.name.includes('videoplayback')) {
          sendDetectedUrl(entry.name);
        }
      }
    });
    observer.observe({ entryTypes: ['resource'] });
    console.log('[Drive Downloader] PerformanceObserver activado');
  } catch (e) {
    console.log('[Drive Downloader] PerformanceObserver no disponible');
  }

  // Tambien revisar recursos ya cargados
  if (performance && performance.getEntriesByType) {
    const resources = performance.getEntriesByType('resource');
    for (const entry of resources) {
      if (entry.name && entry.name.includes('videoplayback')) {
        sendDetectedUrl(entry.name);
      }
    }
  }

  console.log('[Drive Downloader] Interceptor de URLs activado');
})();
