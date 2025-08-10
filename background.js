let isMonitoring = false;
let monitoredTabs = new Set();
let monitoredTabUrls = new Set();
let capturedRequests = [];
let googleCmCodes = new Set();
let userAuthData = null;

// utils functions
async function fetchUserProfile(token) {
  if (typeof token !== 'string') {
    console.error('fetchUserProfile: Expected token to be a string, but got', typeof token);
    return null;
  }
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) return await response.json();
    throw new Error(`Failed to fetch user profile: ${response.statusText}`);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return null;
  }
}

// auth
async function handleGoogleAuth(sendResponse) {
  try {
    const tokenResponse = await chrome.identity.getAuthToken({ interactive: true });
    if (chrome.runtime.lastError || !tokenResponse || !tokenResponse.token) {
      throw new Error(chrome.runtime.lastError?.message || 'Authentication failed: No token was returned.');
    }
    
    const token = tokenResponse.token;
    const grantedScopes = tokenResponse.grantedScopes || [];
    console.log('Auth: Token extracted successfully.');

    const userInfo = await fetchUserProfile(token);
    
    userAuthData = {
      access_token: token,
      user_info: userInfo,
      scopes: grantedScopes,
      timestamp: Date.now()
    };

    await chrome.storage.local.set({ userAuthData });
    console.log('Auth: User data stored successfully.');
    sendResponse({ success: true, authData: userAuthData });
  } catch (error) {
    console.error('OAuth error:', error.message);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleLogout(sendResponse) {
  try {
    if (userAuthData && userAuthData.access_token) {
      const token = userAuthData.access_token;
      console.log('Logout: Revoking and removing token.');
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
      await chrome.identity.removeCachedAuthToken({ token: token });
    }
  } catch (error) {
    console.error('Error during token revocation/removal:', error.message);
  } finally {
    await chrome.storage.local.remove('userAuthData');
    userAuthData = null;
    console.log('Logout: User data cleared.');
    sendResponse({ success: true });
  }
}

// data export
async function exportDataForAPI(sendResponse) {
  try {
    const monitoredTabsArray = Array.from(monitoredTabs);
    for (const tabId of monitoredTabsArray) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab && tab.url) {
          monitoredTabUrls.add(tab.url);
        }
      } catch (error) {
        console.error('Could not get tab URL for tab:', tabId, error);
      }
    }

    const exportData = {
      codes: Array.from(googleCmCodes),
      auth: userAuthData ? {
        access_token: userAuthData.access_token,
        scopes: userAuthData.scopes || []
      } : null,
      metadata: {
        test_urls: Array.from(monitoredTabUrls),
        timestamp: new Date().toISOString()
      }
    };
    
    console.log('Export data prepared for REST API:', exportData);
    sendResponse({ success: true, data: exportData });
  } catch (error) {
    console.error('Error preparing export data:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// requests monitoring
function startMonitoring(tabId) {
  isMonitoring = true;
  monitoredTabs.clear();
  monitoredTabUrls.clear();
  monitoredTabs.add(tabId);
  capturedRequests = [];
  googleCmCodes.clear();
  console.log('Monitoring: Started for tab:', tabId);
}

function stopMonitoring() {
  isMonitoring = false;
  console.log('Monitoring: Stopped.');
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!isMonitoring || !monitoredTabs.has(details.tabId)) return;
    const url = details.url;
    capturedRequests.push(url);
    if (url.includes('ad.doubleclick.net') && (url.includes('trackimp') || url.includes('trackclk'))) {
      googleCmCodes.add(url);
    }
  },
  { urls: ["<all_urls>"] }
);

chrome.tabs.onCreated.addListener((tab) => { if (isMonitoring) monitoredTabs.add(tab.id); });
chrome.tabs.onRemoved.addListener((tabId) => { monitoredTabs.delete(tabId); });

// communication hub between popup and service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const actions = {
    googleAuth: handleGoogleAuth,
    logout: handleLogout,
    exportData: exportDataForAPI,
    startMonitoring: (cb) => { startMonitoring(message.tabId); cb({ success: true }); },
    stopMonitoring: (cb) => { stopMonitoring(); cb({ success: true }); },
    getResults: (cb) => cb({
      isMonitoring,
      monitoredTabCount: monitoredTabs.size,
      userAuthData,
      googleCmCodes: Array.from(googleCmCodes),
      totalRequests: capturedRequests.length,
      adRequests: capturedRequests.filter(url => url.includes('ad.d') || url.includes('doubleclick')).length
    })
  };
  if (actions[message.action]) {
    actions[message.action](sendResponse);
    return true;
  }
});

// lifecycle and init
const initializeState = () => {
  isMonitoring = false;
  monitoredTabs.clear();
  monitoredTabUrls.clear();
  chrome.storage.local.get('userAuthData', (result) => {
    userAuthData = result.userAuthData || null;
    console.log('State initialized. User is', userAuthData ? 'authenticated.' : 'not authenticated.');
  });
};

chrome.runtime.onStartup.addListener(initializeState);
chrome.runtime.onInstalled.addListener(initializeState);
