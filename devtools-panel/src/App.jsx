import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

const TIMELINE_FLAG = 'CLICK_BEFORE_INTERACTION';
const DEFAULT_TAB_COLOR = '#94a3b8';

function formatTimestamp(ts) {
  if (!ts) return '—';
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatTabLabel(url) {
  if (!url) return 'about:blank';
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '');
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length === 0) {
      return host || parsed.hostname;
    }
    const firstSegment = segments[0];
    const label = `${host}/${firstSegment}`;
    return label.length > 36 ? `${label.slice(0, 33)}…` : label;
  } catch (error) {
    return url.length > 36 ? `${url.slice(0, 33)}…` : url;
  }
}

function withOpacity(color, alpha) {
  if (!color || typeof color !== 'string') {
    return `rgba(148, 163, 184, ${alpha})`;
  }
  let hex = color.replace('#', '').trim();
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((char) => char + char)
      .join('');
  }
  if (hex.length !== 6) {
    return `rgba(148, 163, 184, ${alpha})`;
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function resolveStatusLabel(status) {
  switch (status) {
    case 'ready':
      return 'Live';
    case 'connecting':
      return 'Connecting';
    case 'disconnected':
      return 'Disconnected';
    case 'ended':
      return 'Tab closed';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
}

function resolveStatusClass(status) {
  if (status === 'error') return 'status-pill error';
  if (status === 'connecting' || status === 'idle') return 'status-pill idle';
  if (status === 'disconnected' || status === 'ended') return 'status-pill error';
  return 'status-pill';
}

function createRequestFilter(term) {
  if (!term) return () => true;
  const needle = term.trim().toLowerCase();
  return (request) => request.url.toLowerCase().includes(needle) || request.type.toLowerCase().includes(needle);
}

function createCodeFilter(term) {
  if (!term) return () => true;
  const needle = term.trim().toLowerCase();
  return (code) => code.url.toLowerCase().includes(needle) || code.type.toLowerCase().includes(needle);
}

function derivePapiezStatus(papiez) {
  if (!papiez) {
    return { label: 'Pending', tone: 'idle' };
  }
  if (papiez.error) {
    return { label: 'Error', tone: 'danger', message: papiez.error };
  }
  if (papiez.data) {
    return { label: 'Ready', tone: 'success' };
  }
  return { label: 'No data', tone: 'warning' };
}

function AuthCard({ authInfo, loading, error, onLogin, onLogout }) {
  const isAuthenticated = Boolean(authInfo?.access_token);
  const name = authInfo?.user_info?.name;
  const email = authInfo?.user_info?.email;
  const scopes = authInfo?.scopes?.length ?? 0;

  return (
    <div className="auth-card">
      <div className="auth-details">
        {isAuthenticated ? (
          <>
            <strong>{name || 'Authenticated'}</strong>
            {email ? <span className="small-text">{email}</span> : null}
            <span className="small-text">Scopes: {scopes} · Refreshed {formatDateTime(authInfo?.timestamp)}</span>
          </>
        ) : (
          <>
            <strong>Sign in required</strong>
            <span className="small-text">Authenticate to verify Campaign Manager codes.</span>
          </>
        )}
      </div>
      <div className="auth-actions">
        {isAuthenticated ? (
          <button className="button danger" onClick={onLogout} disabled={loading}>
            {loading ? 'Logging out…' : 'Logout'}
          </button>
        ) : (
          <button className="button primary" onClick={onLogin} disabled={loading}>
            {loading ? 'Signing in…' : 'Login with Google'}
          </button>
        )}
      </div>
      {error ? <div className="auth-error">{error}</div> : null}
    </div>
  );
}

function RequestsTable({ requests, selectedUrl, onSelectUrl, tabLookup, fallbackColor }) {
  if (!requests.length) {
    return <div className="empty-state">No matching requests observed yet.</div>;
  }

  const lookup = tabLookup || new Map();
  const baseColor = fallbackColor || DEFAULT_TAB_COLOR;

  return (
    <div className="table-wrapper">
      <table className="request-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Type</th>
            <th>Duplicates</th>
            <th>Timeline</th>
            <th>Tab</th>
            <th>Time</th>
            <th>URL</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => {
            const isSelectable = request.isCmCode;
            const isSelected = isSelectable && selectedUrl === request.url;
            const rowClassNames = [
              request.timelineFlag ? 'highlight' : '',
              isSelectable ? 'selectable' : '',
              isSelected ? 'selected' : '',
              request.isChildRequest ? 'child' : '',
            ]
              .filter(Boolean)
              .join(' ');

            const tabMeta = lookup.get(request.tabId);
            const accentColor = request.tabColor || tabMeta?.color || baseColor;
            const label = tabMeta ? formatTabLabel(tabMeta.url) : `Tab ${request.tabId}`;
            const rowStyle = !request.timelineFlag && !isSelected ? { borderLeft: `3px solid ${accentColor}` } : undefined;

            return (
              <tr
                key={`${request.id}-${request.sequence}`}
                className={rowClassNames}
                style={rowStyle}
                onClick={() => {
                  if (!isSelectable) return;
                  onSelectUrl(request.url);
                }}
              >
                <td>{request.sequence}</td>
                <td>
                  <div className="type-cell">
                    <div className="type-row">
                      <span
                        className="tab-color-dot"
                        style={{ backgroundColor: accentColor }}
                        title={label}
                      />
                      <span className={`type-pill ${request.type}`}>
                        {request.type === 'general' ? 'other' : request.type}
                      </span>
                      {request.isChildRequest ? <span className="badge child">child tab</span> : null}
                    </div>
                    <div className="tab-source-label" title={tabMeta?.url || label}>
                      {label}
                    </div>
                  </div>
                </td>
                <td>
                  {request.duplicateCount > 1 ? (
                    <span className="badge danger">×{request.duplicateCount}</span>
                  ) : (
                    <span className="small-text">—</span>
                  )}
                </td>
                <td>
                  {request.timelineFlag === TIMELINE_FLAG ? (
                    <span className="timeline-flag">⚠ Click before user action</span>
                  ) : (
                    <span className="small-text">—</span>
                  )}
                </td>
                <td>
                  <span className="badge">{request.tabId}</span>
                </td>
                <td>{formatTimestamp(request.timestamp)}</td>
                <td className="url-cell">{request.url}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CmCodeList({ codes, selectedUrl, onSelect, rootTabId, tabLookup, fallbackColor }) {
  if (!codes.length) {
    return <div className="empty-state">No Campaign Manager codes observed yet.</div>;
  }

  const lookup = tabLookup || new Map();
  const baseColor = fallbackColor || DEFAULT_TAB_COLOR;

  return (
    <div className="code-list">
      {codes.map((code) => {
        const status =
          code.type === 'trackclk' || code.type === 'trackimp'
            ? derivePapiezStatus(code.papiez)
            : { label: 'N/A', tone: 'idle' };
        const seenTabsRaw = code.originTabs || [];
        const uniqueTabIds = [...new Set(seenTabsRaw)];
        const swatchIds = uniqueTabIds.length ? uniqueTabIds : rootTabId !== null ? [rootTabId] : [];
        const safeSwatchIds = swatchIds.length ? swatchIds : [];
        const seenOnChild = rootTabId !== null ? swatchIds.some((tabId) => tabId !== rootTabId) : false;
        const primaryTab = swatchIds.length ? lookup.get(swatchIds[0]) : lookup.get(rootTabId);
        const primaryColor = primaryTab?.color || baseColor;
        const tabLabelsFull = swatchIds
          .map((tabId) => {
            const meta = lookup.get(tabId);
            return meta ? formatTabLabel(meta.url) : `Tab ${tabId}`;
          })
          .join(', ');
        const tabLabelDisplay = tabLabelsFull.length > 40 ? `${tabLabelsFull.slice(0, 37)}…` : tabLabelsFull;
        const isSelected = selectedUrl === code.url;
        return (
          <button
            type="button"
            key={code.url}
            className={`code-item ${isSelected ? 'selected' : ''}`}
            onClick={() => onSelect(code.url)}
          >
            <div className="code-item-header">
              <span
                className="tab-color-dot"
                style={{ backgroundColor: primaryColor }}
                title={tabLabelsFull || 'Tab origin'}
              />
              <span className={`type-pill ${code.type}`}>{code.type === 'trackclk' ? 'click' : 'view'}</span>
              <span className="badge repetitions">×{code.count}</span>
              {seenOnChild ? <span className="badge child">child tab</span> : null}
              <span className={`status-dot ${status.tone}`} />
              <span className={`status-label ${status.tone}`}>{status.label}</span>
            </div>
            <div className="code-url">{code.url}</div>
            <div className="code-meta">
              <span>First seen {formatTimestamp(code.firstSeenAt)}</span>
              <span>Last seen {formatTimestamp(code.lastSeenAt)}</span>
              <span>Tabs: {safeSwatchIds.length}</span>
              {code.papiez?.lastFetchedAt ? (
                <span>Papierz {formatTimestamp(code.papiez.lastFetchedAt)}</span>
              ) : null}
            </div>
            <div className="tab-meta" title={tabLabelsFull}>
              <div className="tab-color-swatches">
                {safeSwatchIds.map((tabId) => {
                  const meta = lookup.get(tabId);
                  const swatchColor = meta?.color || baseColor;
                  return (
                    <span
                      key={`${code.url}-${tabId}`}
                      className="tab-color-swatch"
                      style={{ backgroundColor: swatchColor }}
                    />
                  );
                })}
              </div>
              <span className="tab-origin-label">{tabLabelDisplay || 'Unknown tab'}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function CodeDetailPanel({ code, onClose, rootTabId, tabLookup, fallbackColor }) {
  const status = derivePapiezStatus(code.papiez);
  const fields = code.papiez?.data ? Object.entries(code.papiez.data) : [];
  const lookup = tabLookup || new Map();
  const baseColor = fallbackColor || DEFAULT_TAB_COLOR;
  const seenTabsRaw = code.originTabs || [];
  const uniqueTabIds = [...new Set(seenTabsRaw.length ? seenTabsRaw : rootTabId !== null ? [rootTabId] : [])];
  const seenOnChild = rootTabId !== null ? uniqueTabIds.some((tabId) => tabId !== rootTabId) : false;
  const mappedTabItems = uniqueTabIds.map((tabId) => {
    const meta = lookup.get(tabId);
    return {
      tabId,
      color: meta?.color || baseColor,
      label: meta ? formatTabLabel(meta.url) : `Tab ${tabId}`,
      url: meta?.url || null,
    };
  });
  const tabItems = mappedTabItems.length
    ? mappedTabItems
    : [
        {
          tabId: rootTabId ?? 'n/a',
          color: baseColor,
          label: rootTabId !== null
            ? formatTabLabel(lookup.get(rootTabId)?.url || '') || `Tab ${rootTabId}`
            : 'Current tab',
          url: lookup.get(rootTabId)?.url || null,
        },
      ];
  const tabSummary = tabItems.map((item) => item.label).join(', ');

  return (
    <div className="detail-overlay">
      <div className="detail-panel">
        <div className="detail-header">
          <div className="detail-tags">
            <span className={`type-pill ${code.type}`}>{code.type === 'trackclk' ? 'click' : 'view'}</span>
            <span className="badge repetitions">×{code.count}</span>
            {seenOnChild ? <span className="badge child">child tab</span> : null}
          </div>
          <button className="button ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="detail-url">{code.url}</div>
        <div className="detail-meta">
          <span>First seen {formatDateTime(code.firstSeenAt)}</span>
          <span>Last seen {formatDateTime(code.lastSeenAt)}</span>
          {code.papiez?.lastFetchedAt ? (
            <span>
              Papierz {formatDateTime(code.papiez.lastFetchedAt)} ({code.papiez?.source || 'auto'})
            </span>
          ) : (
            <span>Waiting for Papierz details…</span>
          )}
        </div>
        <div className="detail-tabline" title={tabSummary || 'Tab lineage'}>
          <span className="detail-tabline-title">Tabs ({tabItems.length})</span>
          <div className="tab-origin-list">
            {tabItems.map((item) => (
              <div key={`${code.url}-${item.tabId}`} className="tab-origin-item">
                <span className="tab-color-dot" style={{ backgroundColor: item.color }} />
                <span className="tab-origin-text">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={`detail-status ${status.tone}`}>
          <span className={`status-dot ${status.tone}`} />
          <span>{status.label}</span>
        </div>
        {code.papiez?.error ? <div className="detail-error">{code.papiez.error}</div> : null}
        {fields.length ? (
          <table className="detail-table">
            <tbody>
              {fields.map(([key, value]) => (
                <tr key={key}>
                  <th>{key}</th>
                  <td>{value ?? 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [rootTabId, setRootTabId] = useState(null);
  const [authInfo, setAuthInfo] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [selectedCodeUrl, setSelectedCodeUrl] = useState(null);
  const portRef = useRef(null);

  useEffect(() => {
    const tabId = chrome?.devtools?.inspectedWindow?.tabId;
    if (typeof tabId !== 'number') {
      setStatus('error');
      setError('Open DevTools on a page to start monitoring.');
      return;
    }

    setRootTabId(tabId);
    setStatus('connecting');

    const runtimePort = chrome.runtime.connect({ name: 'cm-devtools' });
    portRef.current = runtimePort;

    const handlePortMessage = (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'SESSION_UPDATE') {
        setSession(message.payload);
        setStatus('ready');
      } else if (message.type === 'SESSION_ENDED') {
        setStatus('ended');
      } else if (message.type === 'SESSION_ERROR') {
        setStatus('error');
        setError(message.error || 'Background error received.');
      }
    };

    runtimePort.onMessage.addListener(handlePortMessage);
    runtimePort.onDisconnect.addListener(() => {
      setStatus((prev) => (prev === 'ended' ? prev : 'disconnected'));
    });

    runtimePort.postMessage({ type: 'INIT_SESSION', rootTabId: tabId });

    chrome.runtime.sendMessage({ action: 'getSessionState', rootTabId: tabId }, (response) => {
      if (chrome.runtime.lastError) {
        setError(chrome.runtime.lastError.message);
        setStatus('error');
        return;
      }
      if (response?.payload) {
        setSession(response.payload);
        setStatus('ready');
      }
      if (response?.userAuthData) {
        setAuthInfo(response.userAuthData);
      }
    });

    return () => {
      runtimePort.onMessage.removeListener(handlePortMessage);
      try {
        runtimePort.disconnect();
      } catch (disconnectError) {
        console.warn('Failed to disconnect runtime port:', disconnectError);
      }
    };
  }, []);

  useEffect(() => {
    if (rootTabId === null) return;
    const handleStorageChange = (changes, areaName) => {
      if (areaName !== 'local') return;
      if (Object.prototype.hasOwnProperty.call(changes, 'userAuthData')) {
        setAuthInfo(changes.userAuthData.newValue || null);
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [rootTabId]);

  useEffect(() => {
    if (!session || !selectedCodeUrl) return;
    const exists = session.cmCodes?.some((code) => code.url === selectedCodeUrl);
    if (!exists) {
      setSelectedCodeUrl(null);
    }
  }, [session, selectedCodeUrl]);

  const filteredRequests = useMemo(() => {
    if (!session) return [];
    return session.requests.filter(createRequestFilter(filter));
  }, [session, filter]);

  const filteredCodes = useMemo(() => {
    if (!session) return [];
    return session.cmCodes.filter(createCodeFilter(filter));
  }, [session, filter]);

  const selectedCode = useMemo(() => {
    if (!session || !selectedCodeUrl) return null;
    return session.cmCodes.find((code) => code.url === selectedCodeUrl) || null;
  }, [session, selectedCodeUrl]);

  const tabsMeta = session?.tabs || [];
  const sortedTabs = useMemo(() => {
    const copy = [...tabsMeta];
    copy.sort((a, b) => {
      if (a.tabId === rootTabId) return -1;
      if (b.tabId === rootTabId) return 1;
      return a.tabId - b.tabId;
    });
    return copy;
  }, [tabsMeta, rootTabId]);

  const tabLookup = useMemo(() => {
    const map = new Map();
    sortedTabs.forEach((tab) => {
      map.set(tab.tabId, tab);
    });
    return map;
  }, [sortedTabs]);

  const totals = session ? session.totals : { totalRequests: 0, adRequests: 0, uniqueCmCodes: 0 };
  const papiezState = session?.papiez || { inFlight: false, lastError: null };
  const cmCodeCount = session?.cmCodes?.length ?? 0;
  const hasAuth = Boolean(authInfo?.access_token);
  const fallbackTabColor = tabLookup.get(rootTabId)?.color || DEFAULT_TAB_COLOR;
  const autoStatusText = !hasAuth
    ? 'Login to enable Papierz'
    : papiezState.inFlight
    ? 'Refreshing Papierz…'
    : 'Auto refresh ready';
  const autoStatusClass = [
    'auto-status',
    papiezState.inFlight ? 'live' : '',
    !hasAuth ? 'muted' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const handlePreserveToggle = () => {
    if (!session || !portRef.current) return;
    portRef.current.postMessage({ type: 'SET_PRESERVE_LOG', value: !session.preserveLog });
  };

  const handleClear = () => {
    if (!portRef.current) return;
    portRef.current.postMessage({ type: 'CLEAR_SESSION' });
    setSelectedCodeUrl(null);
  };

  const handleLogin = () => {
    setAuthError(null);
    setAuthLoading(true);
    chrome.runtime.sendMessage({ action: 'googleAuth' }, (response) => {
      setAuthLoading(false);
      if (chrome.runtime.lastError) {
        setAuthError(chrome.runtime.lastError.message);
        return;
      }
      if (response?.success) {
        setAuthInfo(response.authData);
      } else {
        setAuthError(response?.error || 'Authentication failed.');
      }
    });
  };

  const handleLogout = () => {
    setAuthError(null);
    setAuthLoading(true);
    chrome.runtime.sendMessage({ action: 'logout' }, (response) => {
      setAuthLoading(false);
      if (chrome.runtime.lastError) {
        setAuthError(chrome.runtime.lastError.message);
        return;
      }
      if (response?.success) {
        setAuthInfo(null);
      } else {
        setAuthError(response?.error || 'Logout failed.');
      }
    });
  };

  const handleCheckPapiez = () => {
    if (rootTabId === null) return;
    setError(null);
    chrome.runtime.sendMessage({ action: 'checkInCM', rootTabId }, (response) => {
      if (chrome.runtime.lastError) {
        setError(chrome.runtime.lastError.message);
        return;
      }
      if (!response?.success) {
        setError(response?.error || 'Campaign Manager validation failed.');
      }
    });
  };

  const canRunPapiez = cmCodeCount > 0 && hasAuth && !authLoading;

  return (
    <div className="app-shell">
      <div className="app-header">
        <div className="title-group">
          <h1>Campaign Manager Monitor</h1>
          <span>Tracking requests on tab {rootTabId ?? '—'}</span>
        </div>
        <span className={resolveStatusClass(status)}>{resolveStatusLabel(status)}</span>
      </div>

      {error ? <div className="warning-banner">{error}</div> : null}

      <AuthCard authInfo={authInfo} loading={authLoading} error={authError} onLogin={handleLogin} onLogout={handleLogout} />

      {session ? (
        <>
          <div className="stats-bar">
            <span className="stat-chip">Requests: {totals.totalRequests}</span>
            <span className="stat-chip">Ad requests: {totals.adRequests}</span>
            <span className="stat-chip">CM codes: {totals.uniqueCmCodes}</span>
            <span className="stat-chip">Tracked tabs: {sortedTabs.length}</span>
            <span className="stat-chip">{session.tabsWithClicks?.length ? 'User interaction detected' : 'Awaiting user click'}</span>
          </div>
          <div className="tab-chip-row">
            {sortedTabs.map((tab) => {
              const background = withOpacity(tab.color, tab.isChild ? 0.22 : 0.16);
              const border = tab.color || fallbackTabColor;
              const label = tab.url ? formatTabLabel(tab.url) : `Tab ${tab.tabId}`;
              return (
                <span
                  key={tab.tabId}
                  className="tab-chip"
                  style={{ backgroundColor: background, borderColor: border, color: '#f8fafc' }}
                  title={tab.url || label}
                >
                  <span className="tab-color-dot" style={{ backgroundColor: tab.color || fallbackTabColor }} />
                  <span className="tab-chip-label">{label}</span>
                </span>
              );
            })}
          </div>
        </>
      ) : null}

      <div className="control-bar">
        <div className="control-left">
          <input
            className="filter-input"
            type="search"
            placeholder="Filter by URL or type…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <label className="toggle">
            <input type="checkbox" checked={session?.preserveLog ?? false} onChange={handlePreserveToggle} />
            Preserve log
          </label>
        </div>
        <div className="control-right">
          <span className={autoStatusClass}>{autoStatusText}</span>
          <button className="button primary" onClick={handleCheckPapiez} disabled={!canRunPapiez || papiezState.inFlight}>
            {papiezState.inFlight ? 'Checking…' : 'Check in CM'}
          </button>
          <button className="button danger" onClick={handleClear}>
            Clear
          </button>
        </div>
      </div>

      {papiezState.lastError ? <div className="warning-banner">{papiezState.lastError}</div> : null}

      <div className="main-grid">
        <section className="panel">
          <header className="panel-header">
            <h2>Request timeline</h2>
            <span className="badge">{filteredRequests.length} shown</span>
          </header>
          <RequestsTable
            requests={filteredRequests}
            selectedUrl={selectedCodeUrl}
            onSelectUrl={setSelectedCodeUrl}
            tabLookup={tabLookup}
            fallbackColor={fallbackTabColor}
          />
        </section>
        <section className="panel">
          <header className="panel-header">
            <h2>Campaign Manager codes</h2>
            <span className="badge">{filteredCodes.length} listed</span>
          </header>
          <CmCodeList
            codes={filteredCodes}
            selectedUrl={selectedCodeUrl}
            onSelect={setSelectedCodeUrl}
            rootTabId={rootTabId}
            tabLookup={tabLookup}
            fallbackColor={fallbackTabColor}
          />
        </section>
      </div>

      {selectedCode ? (
        <CodeDetailPanel
          code={selectedCode}
          onClose={() => setSelectedCodeUrl(null)}
          rootTabId={rootTabId}
          tabLookup={tabLookup}
          fallbackColor={fallbackTabColor}
        />
      ) : null}
    </div>
  );
}
