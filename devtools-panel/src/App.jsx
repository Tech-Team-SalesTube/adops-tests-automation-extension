import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

const TIMELINE_FLAG = 'CLICK_BEFORE_INTERACTION';
const DEFAULT_TAB_COLOR = '#94a3b8';

const FILTER_STORAGE_KEY = 'cm_monitor_filter_settings';
const CM_CODES_FILTER_KEY = 'cm_monitor_show_only_cm_codes';
const SIMPLE_VIEW_STORAGE_KEY = 'cm_monitor_simple_view';
const COLUMN_STORAGE_KEY = 'cm_monitor_column_widths';
const DEFAULT_COLUMN_WIDTHS = {
  type: 140,
  adId: 120,
  url: 400,
  gdpr: 80,
  status: 80,
  duplicates: 100,
  time: 100,
};
const PANEL_WIDTH_STORAGE_KEY = 'cm_monitor_panel_width';
const DEFAULT_PANEL_WIDTH = 420;
const MIN_PANEL_WIDTH = 280;
const MAX_PANEL_WIDTH = 800;

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

function extractAdId(url) {
  if (!url) return '—';
  try {
    // parseUrlParameters handles both `?` and `;`-separated params (DoubleClick uses `;`).
    const params = parseUrlParameters(url);
    return params.ad || params.trk_aid || params.dc_trk_aid || '—';
  } catch (error) {
    return '—';
  }
}

// Parses both `?key=value&...` query params and `;key=value;...` semicolon params.
// DoubleClick/CM URLs put tracking params after a semicolon, e.g.
// `https://ad.doubleclick.net/ddm/trackclk/B123.456;dc_trk_aid=789;dc_trk_cid=1;gdpr=1`.
function parseUrlParameters(url) {
  if (!url) return {};
  try {
    const params = {};

    const parsed = new URL(url);
    parsed.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    const beforeQuery = url.split('?')[0];
    const semicolonParts = beforeQuery.split(';');
    for (let i = 1; i < semicolonParts.length; i++) {
      const part = semicolonParts[i];
      const equalIndex = part.indexOf('=');
      if (equalIndex > 0) {
        params[part.substring(0, equalIndex)] = part.substring(equalIndex + 1);
      }
    }

    return params;
  } catch (error) {
    return {};
  }
}

function validateGdprPresence(papiezData) {
  if (!papiezData) return { hasGdpr: true, message: null };

  const gdprValue = papiezData.urlgdpr;
  if (gdprValue === undefined || gdprValue === null || gdprValue === '') {
    return { hasGdpr: false, message: 'Brak urlgdpr' };
  }

  return { hasGdpr: true, message: null };
}

// Pair impression/click codes that belong to the same creative or placement,
// falling back to the URL itself when no shared identifier is present.
function matchImpressionWithClick(codes) {
  const groups = new Map();

  codes.forEach((code) => {
    const params = parseUrlParameters(code.url);
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

// Returns the 4 fields that Simple View uses to deduplicate requests:
// the `/B<advertiser>.<placement>` path segment plus dc_trk_aid/dc_trk_cid/ord.
function extractSimpleViewParams(url) {
  try {
    const parsed = new URL(url);
    const params = parseUrlParameters(url);

    const bMatch = parsed.pathname.match(/\/(B\d+\.\d+)/);
    const bSegment = bMatch ? `/${bMatch[1]}` : '—';

    return {
      bSegment,
      dc_trk_aid: params.dc_trk_aid || '—',
      dc_trk_cid: params.dc_trk_cid || '—',
      ord: params.ord || '—',
    };
  } catch (error) {
    return {
      bSegment: '—',
      dc_trk_aid: '—',
      dc_trk_cid: '—',
      ord: '—',
    };
  }
}

// Groups requests by (type, bSegment, dc_trk_aid, dc_trk_cid, ord). `type` is part
// of the key so an impression and a click with otherwise identical params stay separate.
function groupRequestsBySimpleViewParams(requests) {
  const groups = new Map();

  requests.forEach((request) => {
    const params = extractSimpleViewParams(request.url);
    const key = `${request.type}|${params.bSegment}|${params.dc_trk_aid}|${params.dc_trk_cid}|${params.ord}`;

    if (!groups.has(key)) {
      groups.set(key, { params, requests: [] });
    }

    groups.get(key).requests.push(request);
  });

  return groups;
}

// Picks one representative from a Simple View group.
// Priority: status 200 > highest known status > first request.
function selectBestRequestFromGroup(requests) {
  if (requests.length === 1) return requests[0];

  const status200 = requests.find(r => r.statusCode === 200 || r.statusCode === '200');
  if (status200) return status200;

  const withStatus = requests.filter(r => r.statusCode && r.statusCode !== '—');
  if (withStatus.length > 0) {
    withStatus.sort((a, b) => {
      const aCode = parseInt(a.statusCode) || 0;
      const bCode = parseInt(b.statusCode) || 0;
      return bCode - aCode;
    });
    return withStatus[0];
  }

  return requests[0];
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

function useColumnResize(columnKey, initialWidth, onWidthChange) {
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(initialWidth);

  const handleMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = initialWidth;
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e) => {
      document.body.classList.add('resizing-column');
      const delta = e.clientX - startXRef.current;
      const newWidth = Math.max(50, startWidthRef.current + delta);
      onWidthChange(columnKey, newWidth);
    };

    const handleMouseUp = () => {
      document.body.classList.remove('resizing-column');
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, columnKey, onWidthChange]);

  return { handleMouseDown, isResizing };
}

function ColumnResizeHandle({ columnKey, onResize, currentWidth }) {
  const { handleMouseDown, isResizing } = useColumnResize(
    columnKey,
    currentWidth,
    onResize
  );

  return (
    <div
      className={`resize-handle ${isResizing ? 'resizing' : ''}`}
      onMouseDown={handleMouseDown}
      title="Drag to resize column"
    />
  );
}

function usePanelResize(initialWidth, minWidth, maxWidth, onWidthChange) {
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(initialWidth);

  const handleMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = initialWidth;
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e) => {
      document.body.classList.add('resizing-panel');
      const delta = startXRef.current - e.clientX;
      const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidthRef.current + delta));
      onWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      document.body.classList.remove('resizing-panel');
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, minWidth, maxWidth, onWidthChange]);

  return { handleMouseDown, isResizing };
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

function RequestsTable({ requests, selectedUrl, onSelectUrl, tabLookup, fallbackColor, cmCodesMap, requestToGroupMap, simpleViewMode, columnWidths, onColumnResize }) {
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
            <th style={{ width: `${columnWidths.type}px`, position: 'relative' }}>
              Type
              <ColumnResizeHandle columnKey="type" onResize={onColumnResize} currentWidth={columnWidths.type} />
            </th>
            <th style={{ width: `${columnWidths.adId}px`, position: 'relative' }}>
              Ad ID
              <ColumnResizeHandle columnKey="adId" onResize={onColumnResize} currentWidth={columnWidths.adId} />
            </th>
            <th style={{ width: `${columnWidths.url}px`, position: 'relative' }}>
              URL
              <ColumnResizeHandle columnKey="url" onResize={onColumnResize} currentWidth={columnWidths.url} />
            </th>
            <th style={{ width: `${columnWidths.gdpr}px`, position: 'relative' }}>
              GDPR
              <ColumnResizeHandle columnKey="gdpr" onResize={onColumnResize} currentWidth={columnWidths.gdpr} />
            </th>
            <th style={{ width: `${columnWidths.status}px`, position: 'relative' }}>
              Status
              <ColumnResizeHandle columnKey="status" onResize={onColumnResize} currentWidth={columnWidths.status} />
            </th>
            <th style={{ width: `${columnWidths.duplicates}px`, position: 'relative' }}>
              Duplicates
              <ColumnResizeHandle columnKey="duplicates" onResize={onColumnResize} currentWidth={columnWidths.duplicates} />
            </th>
            <th style={{ width: `${columnWidths.time}px`, position: 'relative' }}>
              Time
              <ColumnResizeHandle columnKey="time" onResize={onColumnResize} currentWidth={columnWidths.time} />
            </th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request, index) => {
            const isSelectable = request.isCmCode;
            const isSelected = isSelectable && selectedUrl === request.url;

            const cmCode = cmCodesMap?.get(request.url);
            const gdprValidation = cmCode?.papiez?.data ? validateGdprPresence(cmCode.papiez.data) : { hasGdpr: true, message: null };

            // First row of an impression/click pair gets a visual separator border-top.
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
                <td style={{ width: `${columnWidths.type}px` }}>
                  <div className="type-cell">
                    <div className="type-row">
                      <span
                        className="tab-color-dot"
                        style={{ backgroundColor: accentColor }}
                        title={label}
                      />
                      <span className={`type-pill ${request.type}`} title={request.type}>
                        {request.type === 'trackimp' ? '👁️' : request.type === 'trackclk' ? '🖱️' : request.type === 'general' ? 'other' : request.type}
                      </span>
                      {request.isChildRequest ? <span className="badge child">child tab</span> : null}
                    </div>
                  </div>
                </td>
                <td style={{ width: `${columnWidths.adId}px` }} className="truncate-cell" title={adId}>
                  {adId}
                </td>
                <td style={{ width: `${columnWidths.url}px` }} className="url-cell" title={request.url}>
                  {simpleViewMode && request._simpleViewParams ? (
                    <div className="simple-view-url">
                      <span>{request._simpleViewParams.bSegment}</span>
                      <span>dc_trk_aid={request._simpleViewParams.dc_trk_aid}</span>
                      <span>dc_trk_cid={request._simpleViewParams.dc_trk_cid}</span>
                      <span>ord={request._simpleViewParams.ord}</span>
                    </div>
                  ) : (
                    request.url
                  )}
                </td>
                <td style={{ width: `${columnWidths.gdpr}px` }}>
                  {!gdprValidation.hasGdpr ? (
                    <span className="badge danger">{gdprValidation.message}</span>
                  ) : (
                    <span className="small-text">✓</span>
                  )}
                </td>
                <td style={{ width: `${columnWidths.status}px` }}>
                  <span className={`badge ${statusCode === '302' ? 'warning' : ''}`}>
                    {statusCode}
                  </span>
                </td>
                <td style={{ width: `${columnWidths.duplicates}px` }}>
                  {request.duplicateCount > 1 ? (
                    <span className="badge danger">×{request.duplicateCount}</span>
                  ) : (
                    <span className="small-text">—</span>
                  )}
                </td>
                <td style={{ width: `${columnWidths.time}px` }}>{formatTimestamp(request.timestamp)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


function CodeDetailPanel({ code, onClose, panelWidth, onPanelResize }) {
  const { handleMouseDown, isResizing } = usePanelResize(
    panelWidth,
    MIN_PANEL_WIDTH,
    MAX_PANEL_WIDTH,
    onPanelResize
  );

  const urlParams = parseUrlParameters(code.url);

  const papiezData = code.papiez?.data || {};
  const orderedFields = [];
  const remainingFields = [];

  PAPIERZ_FIELD_ORDER.forEach((fieldName) => {
    if (Object.prototype.hasOwnProperty.call(papiezData, fieldName)) {
      orderedFields.push([fieldName, papiezData[fieldName]]);
    }
  });

  Object.entries(papiezData).forEach(([key, value]) => {
    if (!PAPIERZ_FIELD_ORDER.includes(key)) {
      remainingFields.push([key, value]);
    }
  });

  const allPapiezFields = [...orderedFields, ...remainingFields];

  const filteredUrlParams = Object.entries(urlParams).filter(
    ([key]) => !EXCLUDED_FROM_OTHER_PARAMS.has(key)
  );

  const isUtmKey = (key) =>
    key.startsWith('utm_') || key === 'gclid' || key === 'fbclid' || key === 'dclid';

  // CM/DoubleClick wrap landing URLs in `u1`/`u2`/`url`/`destination`/etc. Decode each
  // and surface UTM-like params from inside, so the user can see attribution data
  // without manually unpacking the redirect chain.
  const extractUtmFromEmbeddedUrls = () => {
    const utmParams = [];
    const urlContainingParams = ['u1', 'u2', 'u3', 'u4', 'u5', 'url', 'destination', 'redirect_url', 'landing_url'];

    for (const paramName of urlContainingParams) {
      if (!urlParams[paramName]) continue;
      try {
        const decodedUrl = decodeURIComponent(urlParams[paramName]);
        const embeddedParams = parseUrlParameters(decodedUrl);
        Object.entries(embeddedParams).forEach(([key, value]) => {
          if (isUtmKey(key)) utmParams.push([key, value]);
        });
      } catch (e) {
        console.warn(`Failed to decode ${paramName}:`, e);
      }
    }

    return utmParams;
  };

  // Second UTM source: params captured from the actual HTTP redirect target,
  // when the background page recorded one.
  const redirectParams = code.redirectUrl ? parseUrlParameters(code.redirectUrl) : {};
  const redirectUtmParams = Object.entries(redirectParams).filter(([key]) => isUtmKey(key));

  const utmParams = Array.from(
    new Map([...extractUtmFromEmbeddedUrls(), ...redirectUtmParams]).entries()
  );

  return (
    <div
      className={`detail-overlay ${isResizing ? 'resizing' : ''}`}
      style={{ width: `${panelWidth}px` }}
    >
      <div
        className={`panel-resize-handle ${isResizing ? 'resizing' : ''}`}
        onMouseDown={handleMouseDown}
      />
      <button className="button ghost close-btn" onClick={onClose}>×</button>
      <div className="detail-scroll-content">
        <div className="detail-panel">
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

          <div className="detail-section-title">Pełny URL</div>
          <div className="detail-url-full" title={code.url}>{code.url}</div>
        </div>
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
  const [simpleViewMode, setSimpleViewMode] = useState(false);
  const [columnWidths, setColumnWidths] = useState(DEFAULT_COLUMN_WIDTHS);
  const [detailPanelWidth, setDetailPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const portRef = useRef(null);

  useEffect(() => {
    chrome.storage.local.get(FILTER_STORAGE_KEY, (result) => {
      if (result[FILTER_STORAGE_KEY]) {
        setFilter(result[FILTER_STORAGE_KEY]);
      }
    });
  }, []);

  useEffect(() => {
    if (filter !== undefined) {
      chrome.storage.local.set({ [FILTER_STORAGE_KEY]: filter });
    }
  }, [filter]);

  useEffect(() => {
    chrome.storage.local.get(CM_CODES_FILTER_KEY, (result) => {
      if (result[CM_CODES_FILTER_KEY] !== undefined) {
        setShowOnlyCmCodes(result[CM_CODES_FILTER_KEY]);
      }
    });
  }, []);

  useEffect(() => {
    chrome.storage.local.set({ [CM_CODES_FILTER_KEY]: showOnlyCmCodes });
  }, [showOnlyCmCodes]);

  useEffect(() => {
    chrome.storage.local.get(SIMPLE_VIEW_STORAGE_KEY, (result) => {
      if (result[SIMPLE_VIEW_STORAGE_KEY] !== undefined) {
        setSimpleViewMode(result[SIMPLE_VIEW_STORAGE_KEY]);
      }
    });
  }, []);

  useEffect(() => {
    chrome.storage.local.set({ [SIMPLE_VIEW_STORAGE_KEY]: simpleViewMode });
  }, [simpleViewMode]);

  useEffect(() => {
    chrome.storage.local.get(COLUMN_STORAGE_KEY, (result) => {
      if (result[COLUMN_STORAGE_KEY]) {
        setColumnWidths({ ...DEFAULT_COLUMN_WIDTHS, ...result[COLUMN_STORAGE_KEY] });
      }
    });
  }, []);

  useEffect(() => {
    if (columnWidths !== DEFAULT_COLUMN_WIDTHS) {
      chrome.storage.local.set({ [COLUMN_STORAGE_KEY]: columnWidths });
    }
  }, [columnWidths]);

  useEffect(() => {
    chrome.storage.local.get(PANEL_WIDTH_STORAGE_KEY, (result) => {
      if (result[PANEL_WIDTH_STORAGE_KEY]) {
        setDetailPanelWidth(result[PANEL_WIDTH_STORAGE_KEY]);
      }
    });
  }, []);

  useEffect(() => {
    if (detailPanelWidth !== DEFAULT_PANEL_WIDTH) {
      chrome.storage.local.set({ [PANEL_WIDTH_STORAGE_KEY]: detailPanelWidth });
    }
  }, [detailPanelWidth]);

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

  // Must be declared before `filteredRequests` — the Simple View branch reads it.
  const cmCodesMap = useMemo(() => {
    if (!session || !session.cmCodes) return new Map();
    const map = new Map();
    session.cmCodes.forEach((code) => {
      map.set(code.url, code);
    });
    return map;
  }, [session]);

  const filteredRequests = useMemo(() => {
    if (!session) return [];
    let filtered = session.requests.filter(createRequestFilter(filter));

    if (showOnlyCmCodes) {
      filtered = filtered.filter(req => req.type === 'trackimp' || req.type === 'trackclk');
    }

    // Simple View hides CM rows that came back from Papierz with "No data returned",
    // then collapses each (type, bSegment, dc_trk_aid, dc_trk_cid, ord) group to a
    // single representative row so the user sees one entry per logical impression/click.
    if (simpleViewMode) {
      filtered = filtered.filter(req => {
        // Non-CM requests have no Papierz data by design — always keep them.
        if (!req.isCmCode) return true;
        const cmCode = cmCodesMap.get(req.url);
        if (!cmCode) return true;
        return cmCode.papiez?.error !== 'No data returned from Papierz.';
      });

      const groups = groupRequestsBySimpleViewParams(filtered);
      const deduplicated = [];
      groups.forEach((group) => {
        const bestRequest = selectBestRequestFromGroup(group.requests);
        // Stash the grouping params on the chosen row so the URL cell can render them.
        bestRequest._simpleViewParams = group.params;
        deduplicated.push(bestRequest);
      });

      filtered = deduplicated;
    }

    return filtered;
  }, [session, filter, showOnlyCmCodes, simpleViewMode, cmCodesMap]);

  const selectedCode = useMemo(() => {
    if (!session || !selectedCodeUrl) return null;
    return session.cmCodes.find((code) => code.url === selectedCodeUrl) || null;
  }, [session, selectedCodeUrl]);

  const impressionClickGroups = useMemo(() => {
    if (!session?.cmCodes) return new Map();
    return matchImpressionWithClick(session.cmCodes);
  }, [session?.cmCodes]);

  // URL → group identifier, used by the table to draw a separator above the first
  // row of each impression/click pair.
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
        <span className="tracking-info">Tracking requests on tab {rootTabId ?? '—'}</span>
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
          <label className="toggle">
            <input
              type="checkbox"
              checked={simpleViewMode}
              onChange={(e) => setSimpleViewMode(e.target.checked)}
            />
            Simple view
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
          simpleViewMode={simpleViewMode}
          columnWidths={columnWidths}
          onColumnResize={(key, width) => {
            setColumnWidths(prev => ({ ...prev, [key]: width }));
          }}
        />
      </section>

      <AuthCard authInfo={authInfo} loading={authLoading} error={authError} onLogin={handleLogin} onLogout={handleLogout} />

      {selectedCode ? (
        <CodeDetailPanel
          code={selectedCode}
          onClose={() => setSelectedCodeUrl(null)}
          panelWidth={detailPanelWidth}
          onPanelResize={setDetailPanelWidth}
        />
      ) : null}
    </div>
  );
}
