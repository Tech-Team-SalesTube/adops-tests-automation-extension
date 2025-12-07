(() => {
  if (window.__cmClickListenerAttached) {
    return;
  }

  const runtimeApi = typeof chrome !== 'undefined' && chrome?.runtime ? chrome.runtime : null;
  if (!runtimeApi?.sendMessage) {
    return;
  }

  window.__cmClickListenerAttached = true;

  const notifyBackgroundAboutClick = () => {
    try {
      runtimeApi.sendMessage({ action: 'pageClickDetected' });
    } catch (error) {
      console.warn('Failed to notify background about click:', error);
    }
  };

  window.addEventListener(
    'click',
    () => {
      notifyBackgroundAboutClick();
    },
    { capture: true, once: true }
  );
})();
