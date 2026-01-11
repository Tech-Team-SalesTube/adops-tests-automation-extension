(() => {
  const { TIMELINE_FLAG_CLICK_BEFORE_INTERACTION } = self.Constants;
  const { SessionStore, PapiezService } = self;

  async function attachTab(rootTabId, tabId, sourceTabId = null) {
    const session = SessionStore.ensureSession(rootTabId);

    session.monitoredTabs.add(tabId);
    SessionStore.mapTabToRoot(tabId, rootTabId);
    SessionStore.assignColorToTab(session, tabId);
    if (!session.tabOrigins) {
      session.tabOrigins = new Map();
    }
    if (!session.tabOrigins.has(tabId)) {
      session.tabOrigins.set(tabId, tabId === rootTabId ? null : sourceTabId);
    }
    if (tabId !== rootTabId) {
      session.childTabs.add(tabId);
    }

    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.url) {
        SessionStore.setTabUrl(session, tabId, tab.url);
      }
    } catch (error) {
      console.warn(`Could not fetch tab info for ${tabId}:`, error.message);
    }

    if (tabId === rootTabId) {
      // Load preserve log preference from storage for new root sessions
      try {
        const stored = await chrome.storage.local.get('cm_monitor_preserve_log');
        if (stored.cm_monitor_preserve_log !== undefined) {
          session.preserveLog = Boolean(stored.cm_monitor_preserve_log);
        }
      } catch (error) {
        console.warn('Failed to load preserve log preference:', error);
      }

      await PapiezService.loadPapiezSnapshot(session);
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['click-listener.js'],
      });
    } catch (error) {
      console.warn(`Failed to inject click listener into tab ${tabId}:`, error.message);
    }

    SessionStore.broadcastSessionUpdate(rootTabId);
  }

  function detachTab(tabId) {
    const rootTabId = SessionStore.getRootForTab(tabId);
    if (rootTabId === undefined) return;

    const session = SessionStore.getSession(rootTabId);
    if (!session) {
      SessionStore.unmapTab(tabId);
      return;
    }

    session.monitoredTabs.delete(tabId);
    session.tabUrls.delete(tabId);
    session.tabsWithClicks.delete(tabId);
    session.childTabs.delete(tabId);
    if (session.tabOrigins) {
      session.tabOrigins.delete(tabId);
    }
    if (session.tabColors) {
      session.tabColors.delete(tabId);
    }
    SessionStore.unmapTab(tabId);

    SessionStore.broadcastSessionUpdate(rootTabId);

    if (tabId === rootTabId) {
      const storageKey = `${self.Constants.PAPIEZ_STORAGE_PREFIX}${rootTabId}`;
      chrome.storage.local.remove(storageKey).catch((error) => {
        console.warn('Failed to remove Papierz snapshot for tab', rootTabId, error);
      });
      SessionStore.destroySession(rootTabId);
    }
  }

  // Strict pattern matching for Campaign Manager tracking URLs
  function isCmTrackingUrl(url) {
    try {
      const parsed = new URL(url);
      // Must be ad.doubleclick.net hostname
      if (parsed.hostname !== 'ad.doubleclick.net') return false;
      // Pathname must start with /ddm/trackclk or /ddm/trackimp (or legacy /trackclk, /trackimp)
      const isMatch = /^\/(ddm\/)?(trackclk|trackimp)/.test(parsed.pathname);
      console.log('[CM Filter]', isMatch ? '✓' : '✗', 'hostname:', parsed.hostname, 'pathname:', parsed.pathname);
      return isMatch;
    } catch (error) {
      console.warn('[CM Filter] Invalid URL:', url, error);
      return false;
    }
  }

  function handleNetworkRequest(details) {
    if (!details || details.tabId === -1) return;

    const rootTabId = SessionStore.getRootForTab(details.tabId);
    if (rootTabId === undefined) return;

    const session = SessionStore.getSession(rootTabId);
    if (!session) return;

    const url = details.url;
    const isAdRequest = url.includes('ad.d') || url.includes('doubleclick');
    const isGoogleCm = isCmTrackingUrl(url);
    const cmType = isGoogleCm ? (url.includes('trackclk') ? 'trackclk' : 'trackimp') : 'general';

    session.totalRequests += 1;
    if (isAdRequest) {
      session.adRequests += 1;
    }

    let duplicateCount = 1;
    let timelineFlag = null;

    if (isGoogleCm) {
      const now = Date.now();
      let summary = session.cmCodes.get(url);
      if (!summary) {
        summary = {
          count: 0,
          type: cmType,
          firstSeenAt: now,
          lastSeenAt: now,
          papiez: null,
          originTabs: new Set(),
        };
      }
      summary.count += 1;
      summary.type = cmType;
      summary.lastSeenAt = now;
      summary.originTabs.add(details.tabId);
      session.cmCodes.set(url, summary);
      duplicateCount = summary.count;

      if (cmType === 'trackclk' && session.tabsWithClicks.size === 0) {
        timelineFlag = TIMELINE_FLAG_CLICK_BEFORE_INTERACTION;
      }

      PapiezService.schedulePapiezRefresh(session, 'auto');
    }

    const entry = {
      id: details.requestId,
      sequence: session.requests.length + 1,
      url,
      tabId: details.tabId,
      originTabId: details.tabId,
      timestamp: Date.now(),
      type: cmType,
      isAdRequest,
      isCmCode: isGoogleCm,
      duplicateCount,
      timelineFlag,
      isChildRequest: details.tabId !== rootTabId,
      tabColor: SessionStore.getTabColor(session, details.tabId),
      statusCode: null, // Will be populated by onCompleted
    };

    session.requests.push(entry);
    SessionStore.broadcastSessionUpdate(rootTabId);
  }

  function handleRequestCompleted(details) {
    if (!details || details.tabId === -1) return;

    const rootTabId = SessionStore.getRootForTab(details.tabId);
    if (rootTabId === undefined) return;

    const session = SessionStore.getSession(rootTabId);
    if (!session) return;

    // Find the request entry by requestId and update status code
    const entry = session.requests.find((req) => req.id === details.requestId);
    if (entry) {
      entry.statusCode = details.statusCode || null;
      SessionStore.broadcastSessionUpdate(rootTabId);
    }
  }

  function handlePageClick(tabId) {
    const rootTabId = SessionStore.getRootForTab(tabId);
    if (rootTabId === undefined) return;
    const session = SessionStore.getSession(rootTabId);
    if (!session) return;

    session.tabsWithClicks.add(tabId);
    SessionStore.broadcastSessionUpdate(rootTabId);
  }

  function handleRequestRedirect(details) {
    console.log('=== REDIRECT DETECTED ===');
    console.log('From URL:', details.url);
    console.log('To URL:', details.redirectUrl);
    console.log('Tab ID:', details.tabId);
    console.log('Status Code:', details.statusCode);

    const rootTabId = SessionStore.getRootForTab(details.tabId);
    console.log('Root Tab ID:', rootTabId);
    if (rootTabId === undefined) {
      console.log('❌ No root tab found, ignoring redirect');
      console.log('========================');
      return;
    }

    const session = SessionStore.getSession(rootTabId);
    if (!session) {
      console.log('❌ No session found, ignoring redirect');
      console.log('========================');
      return;
    }

    const url = details.url;
    const redirectUrl = details.redirectUrl;

    // Check if this is a CM tracking code redirect
    const isDoubleClickRedirect = url.includes('doubleclick.net/ddm/track');
    console.log('Is DoubleClick redirect?', isDoubleClickRedirect);

    if (isDoubleClickRedirect) {
      console.log('Available CM codes:', Array.from(session.cmCodes.keys()));

      // Store redirect destination for this CM code
      const cmCode = session.cmCodes.get(url);
      console.log('Found CM code in session?', !!cmCode);

      if (cmCode) {
        console.log('✓ Storing redirect URL for CM code:', url);
        cmCode.redirectUrl = redirectUrl;
        SessionStore.broadcastSessionUpdate(rootTabId);
      } else {
        console.log('❌ CM code not found in session for URL:', url);
      }
    }
    console.log('========================');
  }

  function initializeEventListeners() {
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => {
        handleNetworkRequest(details);
      },
      { urls: ['<all_urls>'] }
    );

    // Track HTTP status codes on completion
    chrome.webRequest.onCompleted.addListener(
      (details) => {
        handleRequestCompleted(details);
      },
      { urls: ['<all_urls>'] }
    );

    // Track redirects to capture final landing page URLs
    chrome.webRequest.onBeforeRedirect.addListener(
      (details) => {
        handleRequestRedirect(details);
      },
      { urls: ['<all_urls>'] }
    );

    chrome.tabs.onRemoved.addListener(detachTab);

    chrome.tabs.onCreated.addListener((tab) => {
      if (typeof tab?.openerTabId !== 'number') return;
      const rootTabId = SessionStore.getRootForTab(tab.openerTabId);
      if (rootTabId === undefined) return;
      if (SessionStore.getRootForTab(tab.id) !== undefined) return;

      attachTab(rootTabId, tab.id, tab.openerTabId).catch((error) => {
        console.warn('Failed to attach newly created tab to session:', error.message);
      });
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      const rootTabId = SessionStore.getRootForTab(tabId);
      if (rootTabId === undefined) return;
      const session = SessionStore.getSession(rootTabId);
      if (!session) return;

      if (changeInfo.url) {
        SessionStore.setTabUrl(session, tabId, changeInfo.url);
      } else if (tab?.url) {
        SessionStore.setTabUrl(session, tabId, tab.url);
      }

      if (tabId === rootTabId && changeInfo.status === 'loading' && !session.preserveLog) {
        SessionStore.resetSessionData(session, { forgetClicks: true });
        SessionStore.broadcastSessionUpdate(rootTabId);
      }

      if (changeInfo.status === 'complete') {
        chrome.scripting
          .executeScript({ target: { tabId }, files: ['click-listener.js'] })
          .catch((error) => {
            console.warn('Failed to re-inject click listener after navigation:', error.message);
          });
      }
    });

    const allowedTransitions = new Set(['link', 'auto_toplevel', 'form_submit', 'generated']);

    chrome.webNavigation.onCommitted.addListener((details) => {
      if (details.frameId !== 0) return;
      if (typeof details.sourceTabId !== 'number') return;
      if (details.transitionType && !allowedTransitions.has(details.transitionType)) return;

      const rootTabId = SessionStore.getRootForTab(details.sourceTabId);
      if (rootTabId === undefined) return;
      if (SessionStore.getRootForTab(details.tabId) !== undefined) return;

      attachTab(rootTabId, details.tabId, details.sourceTabId).catch((error) => {
        console.warn('Failed to attach navigated tab to session:', error.message);
      });
    });

    chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
      if (typeof details.sourceTabId !== 'number') return;

      const rootTabId = SessionStore.getRootForTab(details.sourceTabId);
      if (rootTabId === undefined) return;

      attachTab(rootTabId, details.tabId, details.sourceTabId).catch((error) => {
        console.warn('Failed to attach navigation target tab to session:', error.message);
      });
    });
  }

  self.TabManager = {
    initializeEventListeners,
    attachTab,
    detachTab,
    handleNetworkRequest,
    handlePageClick,
    loadPapiezSnapshot: PapiezService.loadPapiezSnapshot,
  };
})();
