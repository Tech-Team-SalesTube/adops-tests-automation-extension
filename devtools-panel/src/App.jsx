import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

const TIMELINE_FLAG = 'CLICK_BEFORE_INTERACTION';
const DEFAULT_TAB_COLOR = '#94a3b8';

const FILTER_STORAGE_KEY = 'cm_monitor_filter_settings';
const CM_CODES_FILTER_KEY = 'cm_monitor_show_only_cm_codes';

// Ordered fields for Papierz display
const PAPIERZ_FIELD_ORDER = [
  'site_name',
  'campaign_name',
  'placement_name',
  'ad_name',
  'creative_name',
  'urlpartnerid',
  'urlgdpr',
  'urlgdpr_consent',
];

// Parameters to exclude from "Inne parametry" section (already shown elsewhere)
const EXCLUDED_FROM_OTHER_PARAMS = new Set([
  // Papierz fields (avoid duplication with Papierz section)
  'site_name', 'campaign_name', 'placement_name', 'ad_name', 'creative_name',
  'urlpartnerid', 'urlgdpr', 'urlgdpr_consent',

  // UTM params (shown in separate UTM section)
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'fbclid', 'dclid',

  // CM structural/tracking params (technical, not user-relevant)
  'dc_trk_cid', 'dc_trk_aid', 'trk_aid', 'ad', 'cid',
  'dc_lat', 'dc_rdid', 'tag_for_child_directed_treatment',

  // Embedded URL containers (content shown in UTM section via extraction)
  'u1', 'u2', 'u3', 'u4', 'u5', 'url', 'destination', 'redirect_url', 'landing_url',
]);

function formatTimestamp(ts) {
  if (!ts) return '—';
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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

// Extract Ad ID from Campaign Manager URL
function extractAdId(url) {
  if (!url) return '—';
  try {
    // Use parseUrlParameters to handle both ? and ; separated params
    const params = parseUrlParameters(url);

    // Try to extract from 'ad' parameter
    if (params.ad) return params.ad;

    // Try Campaign Manager tracking aid parameter
    if (params.trk_aid) return params.trk_aid;

    // Try DoubleClick tracking aid parameter
    if (params.dc_trk_aid) return params.dc_trk_aid;

    return '—';
  } catch (error) {
    return '—';
  }
}

// Parse all URL parameters (both ? query params and ; semicolon params)
function parseUrlParameters(url) {
  if (!url) return {};
  try {
    const params = {};

    // Parse standard query parameters (?key=value&key2=value2)
    const parsed = new URL(url);
    parsed.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    // Parse semicolon-separated parameters (common in DoubleClick URLs)
    // Example: ;dc_trk_aid=123;dc_trk_cid=456;gdpr=1
    const urlString = url.split('?')[0]; // Get part before ? (if any)
    const semicolonParts = urlString.split(';');

    for (let i = 1; i < semicolonParts.length; i++) {
      const part = semicolonParts[i];
      const equalIndex = part.indexOf('=');
      if (equalIndex > 0) {
        const key = part.substring(0, equalIndex);
        const value = part.substring(equalIndex + 1);
        params[key] = value;
      }
    }

    return params;
  } catch (error) {
    return {};
  }
}

// Check if GDPR is present and valid
function validateGdprPresence(papiezData) {
  if (!papiezData) return { hasGdpr: true, message: null };

  const gdprValue = papiezData.urlgdpr;
  if (gdprValue === undefined || gdprValue === null || gdprValue === '') {
    return { hasGdpr: false, message: 'Brak urlgdpr' };
  }

  return { hasGdpr: true, message: null };
}

// Match impression and click codes by common identifier
function matchImpressionWithClick(codes) {
  // Group codes by a common identifier (e.g., creative ID or placement ID)
  const groups = new Map();

  codes.forEach((code) => {
    const params = parseUrlParameters(code.url);
    // Try multiple possible identifiers
    const identifier = params.dc_trk_cid || params.trk_aid || params.dc_trk_aid || params.cid || code.url;

    if (!groups.has(identifier)) {
      groups.set(identifier, { impression: null, click: null });
    }

    const group = groups.get(identifier);
    if (code.type === 'trackimp') {
      group.impression = code;
    } else if (code.type === 'trackclk') {
      group.click = code;
    }
  });

  return groups;
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
  return (request) => {
    const adId = extractAdId(request.url);
    return (
      request.url.toLowerCase().includes(needle) ||
      request.type.toLowerCase().includes(needle) ||
      adId.toLowerCase().includes(needle)
    );
  };
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
            <span className="small-text">Scopes: {scopes}</span>
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

function RequestsTable({ requests, selectedUrl, onSelectUrl, tabLookup, fallbackColor, cmCodesMap, requestToGroupMap, impressionClickGroups }) {
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
            <th>Type</th>
            <th>Ad ID</th>
            <th>GDPR</th>
            <th>Status</th>
            <th>Duplicates</th>
            <th>Time</th>
            <th>URL</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request, index) => {
            const isSelectable = request.isCmCode;
            const isSelected = isSelectable && selectedUrl === request.url;

            // Get CM code data for GDPR check
            const cmCode = cmCodesMap?.get(request.url);
            const gdprValidation = cmCode?.papiez?.data ? validateGdprPresence(cmCode.papiez.data) : { hasGdpr: true, message: null };

            // Check if this is the first request in a group (for visual separator)
            const groupId = requestToGroupMap?.get(request.url);
            const prevRequest = index > 0 ? requests[index - 1] : null;
            const prevGroupId = prevRequest ? requestToGroupMap?.get(prevRequest.url) : null;
            const isFirstInGroup = groupId && groupId !== prevGroupId;

            const rowClassNames = [
              request.timelineFlag ? 'highlight' : '',
              isSelectable ? 'selectable' : '',
              isSelected ? 'selected' : '',
              request.isChildRequest ? 'child' : '',
              !gdprValidation.hasGdpr ? 'missing-gdpr' : '',
              isFirstInGroup ? 'group-start' : '',
            ]
              .filter(Boolean)
              .join(' ');

            const tabMeta = lookup.get(request.tabId);
            const accentColor = request.tabColor || tabMeta?.color || baseColor;
            const label = tabMeta ? formatTabLabel(tabMeta.url) : `Tab ${request.tabId}`;
            const rowStyle = !request.timelineFlag && !isSelected && gdprValidation.hasGdpr
              ? { borderLeft: `3px solid ${accentColor}` }
              : !gdprValidation.hasGdpr && !isSelected
              ? { borderLeft: `3px solid #f87171` }
              : undefined;

            const adId = extractAdId(request.url);
            const statusCode = request.statusCode || '—';

            return (
              <tr
                key={`${request.id}-${request.sequence}`}
                className={rowClassNames}
                style={rowStyle}
                data-group-id={groupId}
                onClick={() => {
                  if (!isSelectable) return;
                  onSelectUrl(request.url);
                }}
                title={request.url}
              >
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
                  </div>
                </td>
                <td className="truncate-cell" title={adId}>
                  {adId}
                </td>
                <td>
                  {!gdprValidation.hasGdpr ? (
                    <span className="badge danger">{gdprValidation.message}</span>
                  ) : (
                    <span className="small-text">✓</span>
                  )}
                </td>
                <td>
                  <span className={`badge ${statusCode === '302' ? 'warning' : ''}`}>
                    {statusCode}
                  </span>
                </td>
                <td>
                  {request.duplicateCount > 1 ? (
                    <span className="badge danger">×{request.duplicateCount}</span>
                  ) : (
                    <span className="small-text">—</span>
                  )}
                </td>
                <td>{formatTimestamp(request.timestamp)}</td>
                <td className="url-cell truncate-cell" title={request.url}>
                  {request.url}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


function CodeDetailPanel({ code, onClose }) {
  const urlParams = parseUrlParameters(code.url);
  const gdprValidation = code.papiez?.data ? validateGdprPresence(code.papiez.data) : { hasGdpr: true, message: null };

  // Order Papierz fields according to PAPIERZ_FIELD_ORDER
  const papiezData = code.papiez?.data || {};
  const orderedFields = [];
  const remainingFields = [];

  PAPIERZ_FIELD_ORDER.forEach((fieldName) => {
    if (papiezData.hasOwnProperty(fieldName)) {
      orderedFields.push([fieldName, papiezData[fieldName]]);
    }
  });

  // Add remaining fields that are not in the ordered list
  Object.entries(papiezData).forEach(([key, value]) => {
    if (!PAPIERZ_FIELD_ORDER.includes(key)) {
      remainingFields.push([key, value]);
    }
  });

  const allPapiezFields = [...orderedFields, ...remainingFields];

  // Filter URL parameters to exclude those already shown in other sections
  const filteredUrlParams = Object.entries(urlParams).filter(
    ([key]) => !EXCLUDED_FROM_OTHER_PARAMS.has(key)
  );

  // Extract UTM parameters from embedded URLs (like u1, u2, u3, url, destination)
  const extractUtmFromEmbeddedUrls = () => {
    console.log('=== UTM EXTRACTION DEBUG ===');
    console.log('CM Code URL:', code.url);
    console.log('All URL params:', urlParams);

    const utmParams = [];
    const urlContainingParams = ['u1', 'u2', 'u3', 'u4', 'u5', 'url', 'destination', 'redirect_url', 'landing_url'];

    for (const paramName of urlContainingParams) {
      if (urlParams[paramName]) {
        console.log(`Found ${paramName} parameter:`, urlParams[paramName]);
        try {
          // Decode the URL (might be URL-encoded)
          const decodedUrl = decodeURIComponent(urlParams[paramName]);
          console.log(`Decoded ${paramName}:`, decodedUrl);

          // Parse parameters from the embedded URL
          const embeddedParams = parseUrlParameters(decodedUrl);
          console.log(`Parsed params from ${paramName}:`, embeddedParams);

          // Extract UTM and tracking parameters
          Object.entries(embeddedParams).forEach(([key, value]) => {
            if (key.startsWith('utm_') || key === 'gclid' || key === 'fbclid' || key === 'dclid') {
              console.log(`Found UTM param: ${key} = ${value}`);
              utmParams.push([key, value]);
            }
          });
        } catch (e) {
          console.warn(`Failed to decode ${paramName}:`, e);
        }
      }
    }

    console.log('Extracted UTM params:', utmParams);
    console.log('===========================');
    return utmParams;
  };

  // Also check for UTM params from HTTP redirect (if available)
  console.log('Checking redirect URL:', code.redirectUrl);
  const redirectParams = code.redirectUrl ? parseUrlParameters(code.redirectUrl) : {};
  const redirectUtmParams = Object.entries(redirectParams).filter(([key]) =>
    key.startsWith('utm_') || key === 'gclid' || key === 'fbclid' || key === 'dclid'
  );
  console.log('Redirect UTM params:', redirectUtmParams);

  // Combine UTM params from both sources (deduplicate)
  const embeddedUtmParams = extractUtmFromEmbeddedUrls();
  const allUtmParams = [...embeddedUtmParams, ...redirectUtmParams];
  const utmParams = Array.from(
    new Map(allUtmParams.map(([k, v]) => [k, v])).entries()
  );
  console.log('Final combined UTM params:', utmParams);

  return (
    <div className="detail-overlay">
      <div className="detail-panel">
        <div className="detail-header">
          <div className="detail-tags">
            <span className={`type-pill ${code.type}`}>{code.type === 'trackclk' ? 'click' : 'view'}</span>
            <span className="badge repetitions">×{code.count}</span>
            {!gdprValidation.hasGdpr ? (
              <span className="badge danger">{gdprValidation.message}</span>
            ) : null}
          </div>
          <button className="button ghost" onClick={onClose}>
            Close
          </button>
        </div>

        {/* Papierz Details Section - Ordered Fields */}
        {allPapiezFields.length > 0 ? (
          <>
            <div className="detail-section-title">Szczegóły reklamy (Papierz)</div>
            <table className="detail-table papierz-table">
              <tbody>
                {allPapiezFields.map(([key, value]) => {
                  const isGdprField = key === 'urlgdpr';
                  const isMissingGdpr = isGdprField && (value === null || value === undefined || value === '');
                  return (
                    <tr key={key} className={isMissingGdpr ? 'gdpr-missing-row' : ''}>
                      <th>{key}</th>
                      <td className={isMissingGdpr ? 'gdpr-missing' : ''}>
                        {value ?? 'N/A'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : (
          <div className="detail-pending">
            {code.papiez?.error ? (
              <div className="detail-error">{code.papiez.error}</div>
            ) : (
              <div className="detail-info">Waiting for Papierz validation…</div>
            )}
          </div>
        )}

        {/* Filtered URL Parameters (excluding duplicates shown elsewhere) */}
        {filteredUrlParams.length > 0 ? (
          <>
            <div className="detail-section-title">Inne parametry</div>
            <table className="detail-table url-params-table">
              <tbody>
                {filteredUrlParams.map(([key, value]) => (
                  <tr key={key}>
                    <th>{key}</th>
                    <td title={value}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        {/* UTM Parameters from redirect destination */}
        {utmParams.length > 0 ? (
          <>
            <div className="detail-section-title">Parametry UTM (z przekierowania)</div>
            <table className="detail-table url-params-table">
              <tbody>
                {utmParams.map(([key, value]) => (
                  <tr key={key}>
                    <th>{key}</th>
                    <td title={value}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {code.redirectUrl ? (
              <div className="redirect-url-info">
                Przekierowanie do: {code.redirectUrl}
              </div>
            ) : null}
          </>
        ) : null}

        {/* Full URL Section */}
        <div className="detail-section-title">Pełny URL</div>
        <div className="detail-url-full" title={code.url}>{code.url}</div>
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
  const [showOnlyCmCodes, setShowOnlyCmCodes] = useState(false);
  const portRef = useRef(null);

  // Load saved filter on mount
  useEffect(() => {
    chrome.storage.local.get(FILTER_STORAGE_KEY, (result) => {
      if (result[FILTER_STORAGE_KEY]) {
        setFilter(result[FILTER_STORAGE_KEY]);
      }
    });
  }, []);

  // Save filter to storage when it changes
  useEffect(() => {
    if (filter !== undefined) {
      chrome.storage.local.set({ [FILTER_STORAGE_KEY]: filter });
    }
  }, [filter]);

  // Load saved CM codes filter on mount
  useEffect(() => {
    chrome.storage.local.get(CM_CODES_FILTER_KEY, (result) => {
      if (result[CM_CODES_FILTER_KEY] !== undefined) {
        setShowOnlyCmCodes(result[CM_CODES_FILTER_KEY]);
      }
    });
  }, []);

  // Save CM codes filter to storage when it changes
  useEffect(() => {
    chrome.storage.local.set({ [CM_CODES_FILTER_KEY]: showOnlyCmCodes });
  }, [showOnlyCmCodes]);

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
    let filtered = session.requests.filter(createRequestFilter(filter));

    // Filter to show only CM codes (trackimp/trackclk) if enabled
    if (showOnlyCmCodes) {
      filtered = filtered.filter(req => req.type === 'trackimp' || req.type === 'trackclk');
    }

    return filtered;
  }, [session, filter, showOnlyCmCodes]);

  const selectedCode = useMemo(() => {
    if (!session || !selectedCodeUrl) return null;
    return session.cmCodes.find((code) => code.url === selectedCodeUrl) || null;
  }, [session, selectedCodeUrl]);

  // Create a map of CM codes for quick lookup
  const cmCodesMap = useMemo(() => {
    if (!session || !session.cmCodes) return new Map();
    const map = new Map();
    session.cmCodes.forEach((code) => {
      map.set(code.url, code);
    });
    return map;
  }, [session]);

  // Group impression and click codes by common identifier
  const impressionClickGroups = useMemo(() => {
    if (!session?.cmCodes) return new Map();
    return matchImpressionWithClick(session.cmCodes);
  }, [session?.cmCodes]);

  // Map request URL to group identifier for visual grouping
  const requestToGroupMap = useMemo(() => {
    const map = new Map();
    impressionClickGroups.forEach((group, identifier) => {
      if (group.impression) {
        map.set(group.impression.url, identifier);
      }
      if (group.click) {
        map.set(group.click.url, identifier);
      }
    });
    return map;
  }, [impressionClickGroups]);

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

      {session ? (
        <>
          <div className="stats-bar">
            <span className="stat-chip">Total: {totals.totalRequests}</span>
            <span className="stat-chip">Ad requests: {totals.adRequests}</span>
            <span className="stat-chip">CM codes: {totals.uniqueCmCodes}</span>
            <span className="stat-chip">Tabs: {sortedTabs.length}</span>
            <span className="stat-chip">{session.tabsWithClicks?.length ? 'User click detected ✓' : 'No user click yet'}</span>
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
            placeholder="Filter by URL, Ad ID, or type…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <label className="toggle">
            <input type="checkbox" checked={session?.preserveLog ?? false} onChange={handlePreserveToggle} />
            Preserve log
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={showOnlyCmCodes}
              onChange={(e) => setShowOnlyCmCodes(e.target.checked)}
            />
            Tylko CM codes (trackimp/trackclk)
          </label>
          <button className="button danger" onClick={handleClear}>
            Clear
          </button>
        </div>
        <div className="control-right">
          <span className={autoStatusClass}>{autoStatusText}</span>
          <button className="button primary" onClick={handleCheckPapiez} disabled={!canRunPapiez || papiezState.inFlight}>
            {papiezState.inFlight ? 'Checking…' : 'Check in CM'}
          </button>
        </div>
      </div>

      {papiezState.lastError ? <div className="warning-banner">{papiezState.lastError}</div> : null}

      {/* Single panel layout - Network tab style */}
      <section className="panel main-panel">
        <header className="panel-header">
          <h2>Request Monitor</h2>
          <span className="badge">{filteredRequests.length} / {session?.requests?.length || 0} requests</span>
        </header>
        <RequestsTable
          requests={filteredRequests}
          selectedUrl={selectedCodeUrl}
          onSelectUrl={setSelectedCodeUrl}
          tabLookup={tabLookup}
          fallbackColor={fallbackTabColor}
          cmCodesMap={cmCodesMap}
          requestToGroupMap={requestToGroupMap}
          impressionClickGroups={impressionClickGroups}
        />
      </section>

      {/* Auth card moved to bottom */}
      <AuthCard authInfo={authInfo} loading={authLoading} error={authError} onLogin={handleLogin} onLogout={handleLogout} />

      {/* Detail panel overlay */}
      {selectedCode ? (
        <CodeDetailPanel
          code={selectedCode}
          onClose={() => setSelectedCodeUrl(null)}
        />
      ) : null}
    </div>
  );
}
