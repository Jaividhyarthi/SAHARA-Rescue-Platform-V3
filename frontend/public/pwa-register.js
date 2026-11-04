if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/sw.js');
      console.log('[SAHARA] Service worker ready');
    } catch (error) {
      console.error('[SAHARA] Service worker error', error);
    }
  });
}
