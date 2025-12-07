importScripts(
  'background/constants.js',
  'background/sessionStore.js',
  'background/authManager.js',
  'background/papiezService.js',
  'background/tabManager.js',
  'background/messageRouter.js'
);

(async () => {
  async function initializeState() {
    SessionStore.resetAllState();
    await AuthManager.initialize();
  }

  await initializeState();

  TabManager.initializeEventListeners();
  MessageRouter.initializeMessageRouting();

  chrome.runtime.onStartup.addListener(() => {
    initializeState().catch((error) => console.error('Startup init failed', error));
  });

  chrome.runtime.onInstalled.addListener(() => {
    initializeState().catch((error) => console.error('Install init failed', error));
  });
})();
