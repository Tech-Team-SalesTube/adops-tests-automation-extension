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
    // Check if extension context is still valid
    if (!runtimeApi?.id) {
      // Extension was reloaded - silently ignore
      return;
    }

    try {
      runtimeApi.sendMessage({ action: 'pageClickDetected' });
    } catch (error) {
      // Only log if it's not a context invalidation error
      if (!error.message?.includes('Extension context invalidated')) {
        console.warn('Failed to notify background about click:', error);
      }
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
