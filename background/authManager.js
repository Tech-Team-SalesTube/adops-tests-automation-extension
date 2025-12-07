(() => {
  const TOKEN_REFRESH_WINDOW = 55 * 60 * 1000;
  let userAuthData = null;

  async function fetchUserProfile(token) {
    if (typeof token !== 'string') {
      console.error('fetchUserProfile: Expected token to be a string, but got', typeof token);
      return null;
    }
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) return await response.json();
      throw new Error(`Failed to fetch user profile: ${response.statusText}`);
    } catch (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }
  }

  function isTokenExpired(authData) {
    if (!authData || !authData.timestamp) return true;
    return Date.now() - authData.timestamp > TOKEN_REFRESH_WINDOW;
  }

  async function refreshAccessToken() {
    if (!userAuthData) {
      throw new Error('User not authenticated.');
    }

    try {
      if (userAuthData.access_token) {
        await chrome.identity.removeCachedAuthToken({ token: userAuthData.access_token });
      }
    } catch (error) {
      console.warn('Failed to remove cached auth token before refresh:', error.message);
    }

    let tokenResponse;
    try {
      tokenResponse = await chrome.identity.getAuthToken({ interactive: false });
    } catch (error) {
      throw new Error(error?.message || 'Token refresh rejected by identity API.');
    }

    const resolvedToken = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
    if (!resolvedToken) {
      throw new Error('Authentication expired. Please login again.');
    }

    const grantedScopes = Array.isArray(tokenResponse?.grantedScopes)
      ? tokenResponse.grantedScopes
      : userAuthData.scopes || [];

    const refreshedProfile = await fetchUserProfile(resolvedToken);

    userAuthData = {
      ...userAuthData,
      access_token: resolvedToken,
      scopes: grantedScopes,
      user_info: refreshedProfile || userAuthData.user_info,
      timestamp: Date.now(),
    };

    await chrome.storage.local.set({ userAuthData });
    return resolvedToken;
  }

  async function ensureValidToken() {
    if (!userAuthData) {
      throw new Error('User not authenticated. Please login first.');
    }

    if (isTokenExpired(userAuthData)) {
      try {
        return await refreshAccessToken();
      } catch (error) {
        await chrome.storage.local.remove('userAuthData');
        userAuthData = null;
        throw error;
      }
    }

    return userAuthData.access_token;
  }

  async function handleGoogleAuth(sendResponse) {
    try {
      const tokenResponse = await chrome.identity.getAuthToken({ interactive: true });
      if (chrome.runtime.lastError || !tokenResponse || !tokenResponse.token) {
        throw new Error(chrome.runtime.lastError?.message || 'Authentication failed: No token was returned.');
      }

      const token = tokenResponse.token;
      const grantedScopes = tokenResponse.grantedScopes || [];
      const userInfo = await fetchUserProfile(token);

      userAuthData = {
        access_token: token,
        user_info: userInfo,
        scopes: grantedScopes,
        timestamp: Date.now(),
      };

      await chrome.storage.local.set({ userAuthData });

      if (self.PapiezService?.onAuthenticationGranted) {
        self.PapiezService.onAuthenticationGranted();
      }

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
        await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
        await chrome.identity.removeCachedAuthToken({ token });
      }
    } catch (error) {
      console.error('Error during token revocation/removal:', error.message);
    } finally {
      await chrome.storage.local.remove('userAuthData');
      userAuthData = null;

      if (self.PapiezService?.notifyAuthRevoked) {
        self.PapiezService.notifyAuthRevoked('Login with Google to fetch Papierz details.');
      }

      sendResponse({ success: true });
    }
  }

  function setAuthData(data) {
    userAuthData = data;
  }

  function getAuthData() {
    return userAuthData;
  }

  async function initialize() {
    const stored = await chrome.storage.local.get('userAuthData');
    userAuthData = stored.userAuthData || null;
  }

  self.AuthManager = {
    initialize,
    handleGoogleAuth,
    handleLogout,
    ensureValidToken,
    getAuthData,
    setAuthData,
    fetchUserProfile,
  };
})();
