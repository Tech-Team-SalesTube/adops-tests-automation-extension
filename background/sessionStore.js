(() => {
  const { TAB_COLOR_PALETTE, TIMELINE_FLAG_CLICK_BEFORE_INTERACTION, PAPIEZ_STORAGE_PREFIX } = self.Constants;

  const sessions = new Map();
  const tabToRootMap = new Map();
  const panelPorts = new Map();

  function createSession(rootTabId) {
    const session = {
      rootTabId,
      monitoredTabs: new Set([rootTabId]),
      childTabs: new Set(),
      tabOrigins: new Map([[rootTabId, null]]),
      tabColors: new Map(),
      nextColorIndex: 0,
      requests: [],
      cmCodes: new Map(),
      totalRequests: 0,
      adRequests: 0,
      tabsWithClicks: new Set(),
      preserveLog: false,
      tabUrls: new Map(),
      papiezState: {
        inFlight: false,
        lastRunAt: null,
        lastError: null,
        source: null,
        timerId: null,
        dirty: false,
      },
    };

    sessions.set(rootTabId, session);
    mapTabToRoot(rootTabId, rootTabId);
    assignColorToTab(session, rootTabId);
    return session;
  }

  function ensureSession(rootTabId) {
    if (!sessions.has(rootTabId)) {
      return createSession(rootTabId);
    }
    return sessions.get(rootTabId);
  }

  function getSession(rootTabId) {
    return sessions.get(rootTabId) || null;
  }

  function getSessions() {
    return sessions;
  }

  function mapTabToRoot(tabId, rootTabId) {
    tabToRootMap.set(tabId, rootTabId);
  }

  function unmapTab(tabId) {
    tabToRootMap.delete(tabId);
  }

  function getRootForTab(tabId) {
    return tabToRootMap.get(tabId);
  }

  function registerPort(rootTabId, port) {
    if (!panelPorts.has(rootTabId)) {
      panelPorts.set(rootTabId, new Set());
    }
    panelPorts.get(rootTabId).add(port);
  }

  function unregisterPort(rootTabId, port) {
    const ports = panelPorts.get(rootTabId);
    if (!ports) return;
    ports.delete(port);
    if (ports.size === 0) {
      panelPorts.delete(rootTabId);
    }
  }

  function assignColorToTab(session, tabId) {
    if (!session.tabColors.has(tabId)) {
      const palette = TAB_COLOR_PALETTE.length ? TAB_COLOR_PALETTE : ['#94a3b8'];
      const index = session.nextColorIndex % palette.length;
      const color = palette[index];
      session.tabColors.set(tabId, color);
      session.nextColorIndex += 1;
    }
    return session.tabColors.get(tabId);
  }

  function getTabColor(session, tabId) {
    return session.tabColors.get(tabId) || null;
  }

  function setTabUrl(session, tabId, url) {
    if (url) {
      session.tabUrls.set(tabId, url);
    }
  }

  function resetSessionData(session, { forgetClicks = false } = {}) {
    session.requests = [];
    session.cmCodes.clear();
    session.totalRequests = 0;
    session.adRequests = 0;
    if (forgetClicks) {
      session.tabsWithClicks.clear();
    }
    clearPapiezTimer(session);
    session.papiezState.inFlight = false;
    session.papiezState.lastRunAt = null;
    session.papiezState.lastError = null;
    session.papiezState.source = null;
    session.papiezState.dirty = false;
  }

  function serializeSession(session) {
    const requestPayload = session.requests.map((entry) => ({
      id: entry.id,
      sequence: entry.sequence,
      url: entry.url,
      tabId: entry.tabId,
      originTabId: entry.originTabId,
      timestamp: entry.timestamp,
      type: entry.type,
      isAdRequest: entry.isAdRequest,
      isCmCode: entry.isCmCode,
      duplicateCount: entry.duplicateCount,
      timelineFlag: entry.timelineFlag,
      isChildRequest: entry.isChildRequest,
      tabColor: entry.tabColor,
    }));

    const cmCodePayload = Array.from(session.cmCodes.entries()).map(([url, summary]) => ({
      url,
      count: summary.count,
      type: summary.type,
      firstSeenAt: summary.firstSeenAt,
      lastSeenAt: summary.lastSeenAt,
      originTabs: summary.originTabs ? Array.from(summary.originTabs.values()) : [],
      papiez: summary.papiez
        ? {
            bucket: summary.papiez.bucket,
            lastFetchedAt: summary.papiez.lastFetchedAt,
            source: summary.papiez.source,
            error: summary.papiez.error,
            data: summary.papiez.data,
          }
        : null,
    }));

    const tabUrls = Array.from(session.tabUrls.entries()).map(([tabId, url]) => ({ tabId, url }));
    const tabs = Array.from(session.monitoredTabs.values()).map((tabId) => ({
      tabId,
      url: session.tabUrls.get(tabId) || '',
      color: session.tabColors.get(tabId) || null,
      isChild: session.childTabs.has(tabId),
      openerTabId: session.tabOrigins?.get(tabId) ?? null,
    }));

    return {
      rootTabId: session.rootTabId,
      preserveLog: session.preserveLog,
      totals: {
        totalRequests: session.totalRequests,
        adRequests: session.adRequests,
        uniqueCmCodes: session.cmCodes.size,
      },
      requests: requestPayload,
      cmCodes: cmCodePayload,
      trackedTabs: Array.from(session.monitoredTabs.values()),
      childTabs: Array.from(session.childTabs.values()),
      tabOrigins: session.tabOrigins ? Array.from(session.tabOrigins.entries()) : [],
      tabsWithClicks: Array.from(session.tabsWithClicks.values()),
      tabUrls,
      tabs,
      papiez: {
        inFlight: session.papiezState.inFlight,
        lastRunAt: session.papiezState.lastRunAt,
        lastError: session.papiezState.lastError,
        source: session.papiezState.source,
      },
    };
  }

  function broadcastSessionUpdate(rootTabId) {
    const session = sessions.get(rootTabId);
    if (!session) return;

    const payload = serializeSession(session);
    const ports = panelPorts.get(rootTabId);
    if (!ports) return;

    ports.forEach((port) => {
      try {
        port.postMessage({ type: 'SESSION_UPDATE', payload });
      } catch (error) {
        console.error('Failed to post session update to panel:', error);
      }
    });
  }

  function clearPapiezTimer(session) {
    const state = session.papiezState;
    if (state.timerId) {
      clearTimeout(state.timerId);
      state.timerId = null;
    }
  }

  function destroySession(rootTabId) {
    const session = sessions.get(rootTabId);
    if (!session) return;

    clearPapiezTimer(session);
    session.monitoredTabs.forEach((tabId) => {
      tabToRootMap.delete(tabId);
    });

    sessions.delete(rootTabId);
    if (session.tabOrigins) {
      session.tabOrigins.clear();
    }
    if (session.tabColors) {
      session.tabColors.clear();
    }

    const ports = panelPorts.get(rootTabId);
    if (ports) {
      ports.forEach((port) => {
        try {
          port.postMessage({ type: 'SESSION_ENDED', rootTabId });
        } catch (error) {
          console.error('Failed to notify panel about session end:', error);
        }
      });
      panelPorts.delete(rootTabId);
    }
  }

  function withSession(rootTabId, callback) {
    const session = ensureSession(rootTabId);
    return callback(session);
  }
  function resetAllState() {
    sessions.clear();
    tabToRootMap.clear();
    panelPorts.clear();
  }

  self.SessionStore = {
    TIMELINE_FLAG_CLICK_BEFORE_INTERACTION,
    PAPIEZ_STORAGE_PREFIX,
    ensureSession,
    getSession,
    getSessions,
    mapTabToRoot,
    unmapTab,
    getRootForTab,
    registerPort,
    unregisterPort,
    broadcastSessionUpdate,
    serializeSession,
    resetSessionData,
    destroySession,
    assignColorToTab,
    getTabColor,
    setTabUrl,
    clearPapiezTimer,
    withSession,
    resetAllState,
    tabToRootMap,
  };
})();
