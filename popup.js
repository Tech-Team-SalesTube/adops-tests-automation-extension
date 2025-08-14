document.addEventListener('DOMContentLoaded', () => {
  const elements = {
    startBtn: document.getElementById('startBtn'),
    stopBtn: document.getElementById('stopBtn'),
    status: document.getElementById('status'),
    tabInfo: document.getElementById('tabInfo'),
    authBtn: document.getElementById('authBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    authStatus: document.querySelector('.auth-status'),
    userInfo: document.getElementById('userInfo'),
    totalCount: document.getElementById('totalCount'),
    adCount: document.getElementById('adCount'),
    cmCount: document.getElementById('cmCount'),
    cmCodesList: document.querySelector('#cmCodes .url-list-inner'),
    cmCodesContainer: document.getElementById('cmCodes'),
    copyBtn: document.getElementById('copyBtn'),
    checkCmBtn: document.getElementById('checkCmBtn'),
  };

  // event listeners
  elements.startBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.runtime.sendMessage({ action: 'startMonitoring', tabId: tabs[0].id }, updateUI);
      }
    });
  });

  elements.stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stopMonitoring' }, updateUI);
  });

  elements.authBtn.addEventListener('click', () => {
    elements.authBtn.textContent = '🔄 Authenticating...';
    elements.authBtn.disabled = true;
    chrome.runtime.sendMessage({ action: 'googleAuth' }, (response) => {
      if (!response || !response.success) {
        alert(`Authentication failed: ${response?.error || 'Unknown error'}`);
      }
      updateUI();
    });
  });

  elements.logoutBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'logout' }, updateUI);
  });

  elements.copyBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'getResults' }, (state) => {
      if (state && state.googleCmCodes && state.googleCmCodes.length > 0) {
        navigator.clipboard.writeText(state.googleCmCodes.join('\n')).then(() => {
          elements.copyBtn.textContent = '✅ Copied!';
          setTimeout(() => { elements.copyBtn.textContent = '📋 Copy All Codes'; }, 2000);
        });
      }
    });
  });
  
  elements.checkCmBtn.addEventListener('click', () => {
    elements.checkCmBtn.textContent = '🔄 Checking...';
    elements.checkCmBtn.disabled = true;
    
    chrome.runtime.sendMessage({ action: 'checkInCM' }, (response) => {
      elements.checkCmBtn.disabled = false;
      elements.checkCmBtn.textContent = '🔍 Check in CM';
      
      if (response && response.success) {
        console.log('CM check completed:', response.data);
      } else {
        alert('CM check failed: ' + (response ? response.error : 'Unknown error'));
      }
    });
  });


  // UI update logic
  function updateUI() {
    chrome.runtime.sendMessage({ action: 'getResults' }, (state) => {
      if (!state) {
        console.error("Could not get state from background script.");
        return;
      }
      
      // Auth section
      const isAuthenticated = state.userAuthData && state.userAuthData.access_token;
      elements.authBtn.style.display = isAuthenticated ? 'none' : 'block';
      elements.logoutBtn.style.display = isAuthenticated ? 'block' : 'none';
      elements.authBtn.disabled = false;
      elements.authBtn.textContent = '🔑 Login with Google';

      if (isAuthenticated) {
        elements.authStatus.textContent = '✅ Authenticated';
        elements.authStatus.className = 'auth-status authenticated';
        elements.userInfo.style.display = 'block';
        if (state.userAuthData.user_info) {
          const { name, email } = state.userAuthData.user_info;
          const scopes = state.userAuthData.scopes || [];
          elements.userInfo.innerHTML = `<strong>${name || 'User'}</strong><br>${email || 'Email not available'}<br><small>Scopes: ${scopes.length}</small>`;
        } else {
          elements.userInfo.innerHTML = `<strong>Authenticated</strong><br><small>Could not fetch user details.</small>`;
        }
      } else {
        elements.authStatus.textContent = '🔐 Not Authenticated';
        elements.authStatus.className = 'auth-status';
        elements.userInfo.style.display = 'none';
      }

      // Monitoring section
      elements.startBtn.style.display = state.isMonitoring ? 'none' : 'block';
      elements.stopBtn.style.display = state.isMonitoring ? 'block' : 'none';
      elements.tabInfo.style.display = state.isMonitoring ? 'block' : 'none';
      if (state.isMonitoring) {
        elements.status.textContent = '🟢 Monitoring Active';
        elements.status.className = 'status monitoring pulse';
        elements.tabInfo.textContent = `📊 Monitoring ${state.monitoredTabCount} tab(s)`;
      } else {
        elements.status.textContent = '🔍 Not Monitoring';
        elements.status.className = 'status stopped';
      }

      // Results section
      elements.totalCount.textContent = state.totalRequests || 0;
      elements.adCount.textContent = state.adRequests || 0;
      elements.cmCount.textContent = state.googleCmCodes ? state.googleCmCodes.length : 0;

      const hasCmCodes = state.googleCmCodes && state.googleCmCodes.length > 0;
      elements.cmCodesContainer.style.display = hasCmCodes ? 'block' : 'none';
      elements.copyBtn.style.display = hasCmCodes ? 'inline-block' : 'none';
      elements.checkCmBtn.style.display = hasCmCodes && isAuthenticated ? 'inline-block' : 'none';
      
      if (hasCmCodes) {
        elements.cmCodesList.innerHTML = state.googleCmCodes
          .map(url => `<div class="url-item cm-code">${url}</div>`)
          .join('');
      }
    });
  }

  updateUI();
  setInterval(updateUI, 1500);
});