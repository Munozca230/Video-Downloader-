// Content Script - Puente entre la pagina y la extension
// Este script inyecta el interceptor y comunica las URLs al background

(function() {
  'use strict';

  // Inyectar el script de intercepcion en la pagina
  function injectScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = function() {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  // Escuchar mensajes del script inyectado
  window.addEventListener('message', function(event) {
    // Solo aceptar mensajes de la misma ventana
    if (event.source !== window) return;

    if (event.data && event.data.type === 'DRIVE_VIDEO_URL_DETECTED') {
      // Reenviar al background script
      chrome.runtime.sendMessage({
        type: 'URL_FROM_PAGE',
        mediaType: event.data.mediaType,
        data: event.data.data,
        allUrls: event.data.allUrls
      }).catch(() => {
        // Extension no disponible, ignorar
      });
    }
  });

  // Inyectar cuando el DOM este listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectScript);
  } else {
    injectScript();
  }

  console.log('[Drive Downloader] Content script cargado');
})();
