(() => {
  const { SessionStore, AuthManager, PapiezService, TabManager } = self;

  function handlePortConnection(port) {
    if (port.name !== 'cm-devtools') return;

    let trackedRootTabId = null;

    port.onMessage.addListener((message) => {
      if (!message || typeof message !== 'object') return;

      switch (message.type) {
        case 'INIT_SESSION': {
          const { rootTabId } = message;
          if (typeof rootTabId !== 'number') {
            port.postMessage({ type: 'SESSION_ERROR', error: 'Invalid rootTabId supplied.' });
            return;
          }

          trackedRootTabId = rootTabId;
          SessionStore.registerPort(rootTabId, port);

          TabManager.attachTab(rootTabId, rootTabId)
            .then(() => {
              const session = SessionStore.ensureSession(rootTabId);
              port.postMessage({ type: 'SESSION_UPDATE', payload: SessionStore.serializeSession(session) });
            })
            .catch((error) => {
              port.postMessage({ type: 'SESSION_ERROR', error: error.message });
            });
          break;
        }
        case 'SET_PRESERVE_LOG': {
          if (trackedRootTabId === null) return;
          const session = SessionStore.getSession(trackedRootTabId);
          if (!session) return;
          session.preserveLog = Boolean(message.value);
          if (!session.preserveLog) {
            SessionStore.resetSessionData(session, { forgetClicks: true });
          }
          SessionStore.broadcastSessionUpdate(trackedRootTabId);
          break;
        }
        case 'CLEAR_SESSION': {
          if (trackedRootTabId === null) return;
          const session = SessionStore.getSession(trackedRootTabId);
          if (!session) return;
          SessionStore.resetSessionData(session, { forgetClicks: true });
          SessionStore.broadcastSessionUpdate(trackedRootTabId);
          break;
        }
        default:
          console.warn('Unknown message received on port:', message.type);
      }
    });

    port.onDisconnect.addListener(() => {
      if (trackedRootTabId !== null) {
        SessionStore.unregisterPort(trackedRootTabId, port);
      }
    });
  }

  function handleRuntimeMessage(message, sender, sendResponse) {
    if (!message || typeof message !== 'object') return;

    const actions = {
      googleAuth: () => AuthManager.handleGoogleAuth(sendResponse),
      logout: () => AuthManager.handleLogout(sendResponse),
      checkInCM: () => {
        const rootTabId = message.rootTabId;
        PapiezService.handleCheckInCM(rootTabId, sendResponse);
      },
      getSessionState: () => {
        const rootTabId = message.rootTabId;
        const session = SessionStore.getSession(rootTabId);
        sendResponse({
          success: Boolean(session),
          payload: session ? SessionStore.serializeSession(session) : null,
          userAuthData: AuthManager.getAuthData(),
        });
      },
      pageClickDetected: () => {
        if (sender?.tab?.id !== undefined) {
          TabManager.handlePageClick(sender.tab.id);
        }
        sendResponse({ success: true });
      },
    };

    if (actions[message.action]) {
      actions[message.action]();
      return true;
    }

    return false;
  }

  function initializeMessageRouting() {
    chrome.runtime.onConnect.addListener(handlePortConnection);
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  }

  self.MessageRouter = {
    initializeMessageRouting,
  };
})();
