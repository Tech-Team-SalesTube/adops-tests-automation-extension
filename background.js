// config
const CM_API_ENDPOINT = 'https://adops-tests-automation-niedzwiedz-ze-mna-application-8322403152.us-central1.run.app/papiez/submit';

// global state
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

// Token management utilities
function isTokenExpired(authData) {
  if (!authData || !authData.timestamp) return true;
  // check if token is older than 55 minutes
  const FIFTY_FIVE_MINUTES = 55 * 60 * 1000;
  return (Date.now() - authData.timestamp) > FIFTY_FIVE_MINUTES;
}

function ensureValidToken() {
  if (!userAuthData) {
    throw new Error('User not authenticated. Please login first.');
  }
  
  if (isTokenExpired(userAuthData)) {
    // clear expired auth data
    userAuthData = null;
    chrome.storage.local.remove('userAuthData');
    throw new Error('Authentication expired. Please login again.');
  }
  
  return userAuthData.access_token;
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

// CM check
async function checkInCM(sendResponse) {
  try {
    // ensure we have a valid token before proceeding
    const validToken = ensureValidToken();
    
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

    const requestData = {
      codes: Array.from(googleCmCodes),
      auth: {
        access_token: validToken,
        scopes: userAuthData.scopes || []
      },
      metadata: {
        test_urls: Array.from(monitoredTabUrls),
        timestamp: new Date().toISOString()
      }
    };
    
    console.log('Sending data to CM API:', requestData);
    
    const response = await fetch(CM_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData)
    });
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    const apiResponse = await response.json();
    console.log('CM API response:', apiResponse);
    
    // create new tab with results
    const resultsTab = await chrome.tabs.create({
      url: chrome.runtime.getURL('results.html'),
      active: true
    });
    
    // store response data for the results page
    await chrome.storage.local.set({ 
      cmApiResponse: apiResponse,
      resultsTabId: resultsTab.id 
    });
    
    sendResponse({ success: true, data: apiResponse });
  } catch (error) {
    console.error('Error checking in CM:', error);
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
    checkInCM: checkInCM,
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
