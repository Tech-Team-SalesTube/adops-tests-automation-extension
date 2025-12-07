(() => {
  const {
    CM_API_ENDPOINT,
    PAPIEZ_STORAGE_PREFIX,
  } = self.Constants;

  const { SessionStore, AuthManager } = self;

  function getStorageKey(rootTabId) {
    return `${PAPIEZ_STORAGE_PREFIX}${rootTabId}`;
  }

  async function loadPapiezSnapshot(session) {
    if (!session) return;
    const storageKey = getStorageKey(session.rootTabId);
    try {
      const stored = await chrome.storage.local.get(storageKey);
      const snapshot = stored?.[storageKey];
      if (snapshot) {
        await applyPapiezResults(
          session,
          snapshot.response,
          snapshot.source || 'restore',
          snapshot.receivedAt || Date.now(),
          { persist: false }
        );
      }
    } catch (error) {
      console.warn('Failed to restore Papierz snapshot:', error.message);
    }
  }

  function getEligibleUrls(session) {
    if (!session) return [];
    const urls = [];
    session.cmCodes.forEach((summary, url) => {
      if (summary.type === 'trackclk' || summary.type === 'trackimp') {
        urls.push(url);
      }
    });
    return urls;
  }

  async function applyPapiezResults(session, apiResponse, source, receivedAt = Date.now(), { persist = true } = {}) {
    if (!session) return;

    const clickCodes = apiResponse?.click || [];
    const viewCodes = apiResponse?.view || [];
    const processed = new Set();

    const recordResult = (item, bucket) => {
      if (!item || typeof item.link !== 'string') return;
      const summary = session.cmCodes.get(item.link);
      if (!summary) return;
      summary.papiez = {
        bucket,
        lastFetchedAt: receivedAt,
        source,
        error: item.error_msg && item.error_msg.trim() ? item.error_msg : null,
        data: item.response || null,
      };
      processed.add(item.link);
    };

    clickCodes.forEach((item) => recordResult(item, 'click'));
    viewCodes.forEach((item) => recordResult(item, 'view'));

    session.cmCodes.forEach((summary, url) => {
      if ((summary.type === 'trackclk' || summary.type === 'trackimp') && !processed.has(url)) {
        summary.papiez = {
          bucket: summary.type === 'trackclk' ? 'click' : 'view',
          lastFetchedAt: receivedAt,
          source,
          error: 'No data returned from Papierz.',
          data: null,
        };
      }
    });

    session.papiezState.lastRunAt = receivedAt;
    session.papiezState.source = source;
    session.papiezState.lastError = null;

    if (persist) {
      const storageKey = getStorageKey(session.rootTabId);
      await chrome.storage.local.set({
        [storageKey]: {
          response: apiResponse,
          source,
          receivedAt,
        },
      });
    }

    SessionStore.broadcastSessionUpdate(session.rootTabId);
  }

  function schedulePapiezRefresh(session, reason = 'auto', { immediate = false } = {}) {
    if (!session) return;
    const auth = AuthManager.getAuthData();
    if (!auth) {
      session.papiezState.lastError = 'Login with Google to fetch Papierz details.';
      SessionStore.broadcastSessionUpdate(session.rootTabId);
      return;
    }

    const state = session.papiezState;
    if (state.inFlight) {
      state.dirty = true;
      return;
    }

    const delay = immediate ? 0 : 600;
    SessionStore.clearPapiezTimer(session);
    state.timerId = setTimeout(() => {
      state.timerId = null;
      runPapiezCheck(session, reason).catch((error) => {
        console.error('Papierz auto-refresh failed:', error);
      });
    }, delay);
  }

  async function runPapiezCheck(session, reason, sendResponse) {
    if (!session) {
      if (sendResponse) {
        sendResponse({ success: false, error: 'No active session.' });
      }
      return;
    }

    SessionStore.clearPapiezTimer(session);

    const urls = getEligibleUrls(session);
    if (urls.length === 0) {
      session.papiezState.lastRunAt = Date.now();
      session.papiezState.lastError = null;
      SessionStore.broadcastSessionUpdate(session.rootTabId);
      if (sendResponse) {
        sendResponse({ success: true, data: { click: [], view: [] } });
      }
      return;
    }

    const state = session.papiezState;
    state.inFlight = true;
    state.source = reason;
    state.lastError = null;
    SessionStore.broadcastSessionUpdate(session.rootTabId);

    try {
      const token = await AuthManager.ensureValidToken();

      const monitoredUrls = Array.from(session.tabUrls.values());
      const requestData = {
        codes: urls,
        auth: {
          access_token: token,
          scopes: AuthManager.getAuthData()?.scopes || [],
        },
        metadata: {
          test_urls: monitoredUrls,
          timestamp: new Date().toISOString(),
        },
      };

      const response = await fetch(CM_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const apiResponse = await response.json();
      await applyPapiezResults(session, apiResponse, reason);

      if (sendResponse) {
        sendResponse({ success: true, data: apiResponse });
      }
    } catch (error) {
      state.lastError = error.message;
      SessionStore.broadcastSessionUpdate(session.rootTabId);
      if (sendResponse) {
        sendResponse({ success: false, error: error.message });
      }
    } finally {
      state.inFlight = false;
      const shouldReschedule = state.dirty;
      state.dirty = false;
      SessionStore.broadcastSessionUpdate(session.rootTabId);
      if (shouldReschedule) {
        schedulePapiezRefresh(session, 'auto');
      }
    }
  }

  async function handleCheckInCM(rootTabId, sendResponse) {
    const session = SessionStore.getSession(rootTabId);
    if (!session) {
      sendResponse({ success: false, error: 'No active monitoring session for this tab.' });
      return;
    }
    await runPapiezCheck(session, 'manual', sendResponse);
  }

  function notifyAuthRevoked(message) {
    SessionStore.getSessions().forEach((session) => {
      session.papiezState.lastError = message;
      SessionStore.broadcastSessionUpdate(session.rootTabId);
    });
  }

  function onAuthenticationGranted() {
    SessionStore.getSessions().forEach((session) => {
      if (session.cmCodes.size > 0) {
        schedulePapiezRefresh(session, 'auto', { immediate: true });
      }
    });
  }

  self.PapiezService = {
    loadPapiezSnapshot,
    schedulePapiezRefresh,
    runPapiezCheck,
    handleCheckInCM,
    applyPapiezResults,
    notifyAuthRevoked,
    onAuthenticationGranted,
  };
})();
