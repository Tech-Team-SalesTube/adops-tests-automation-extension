# Development

How to build, load, debug, and ship changes to the extension.

## Prerequisites

- Node.js >= 18 and npm.
- Google Chrome (or any Chromium-based browser with `chrome://extensions` and DevTools).
- The Google account used for testing must have access to the Campaign Manager instance the Papierz backend is configured against.

`manifest.json` pins an extension `key`, which means the extension ID is stable across machines. That same ID is allowlisted in the Google Cloud Console OAuth client - keep the key intact unless you also update the OAuth allowlist.

## First-time setup

```bash
git clone git@github.com:Tech-Team-SalesTube/adops-tests-automation-extension.git
cd adops-tests-automation-extension/devtools-panel
npm install
```

The repo root has no `package.json` install step - only `devtools-panel/` carries dependencies. The build orchestrator (`scripts/build-extension.js`) is plain Node and uses no third-party packages.

## Build

From the repo root:

```bash
npm run build
```

This runs [`scripts/build-extension.js`](../scripts/build-extension.js), which:

1. Removes `dist/` if it exists.
2. Runs `npm run build` inside `devtools-panel/`. Vite emits the React app into `dist/panel-dist/` (path configured in [`devtools-panel/vite.config.js`](../devtools-panel/vite.config.js)).
3. Copies the static extension files into `dist/`: `manifest.json`, `background.js`, `background/`, `devtools.html`, `devtools.js`, `click-listener.js`.

The build script is necessary because Vite alone only handles the panel SPA. The service worker, the manifest, the DevTools shim, and the content script are vanilla files that Chrome loads as-is, so they need to land in `dist/` next to the Vite output.

`dist/` after a clean build:

```
dist/
├── manifest.json
├── background.js
├── background/        # six modules
├── click-listener.js
├── devtools.html
├── devtools.js
└── panel-dist/
    ├── index.html
    └── assets/        # JS + CSS bundles
```

## Loading into Chrome

1. Open `chrome://extensions/`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked**.
4. Pick the `dist/` folder. **Not** the repo root, **not** `dist/panel-dist/`.

The extension ID Chrome shows on the card is derived from the `key` field in `manifest.json` and will be the same on every machine. Save it - you may need it for OAuth allowlisting.

To test, open any page that fires Campaign Manager pixels, hit **F12**, and look for the **CM Monitor** tab in the DevTools tab strip (sometimes hidden under the `>>` overflow).

## Reload workflow

| What changed | What to do |
|---|---|
| `devtools-panel/src/**` (panel UI) | `npm run build` -> click the reload icon on the extension card -> close and reopen DevTools on the test page. |
| `background.js`, `background/**`, `manifest.json` | `npm run build` -> reload the extension card -> close and reopen DevTools -> reload the monitored tab if you changed `webRequest`/`webNavigation` listeners. |
| `click-listener.js` | `npm run build` -> reload the extension card -> reload the monitored tab so the new content script gets injected. |
| `scripts/build-extension.js` | Just rerun `npm run build`; nothing in Chrome to reload. |

The DevTools panel does not hot-reload on its own. After rebuilding, you must close and reopen DevTools - or right-click inside the panel and choose **Reload frame**.

## Debugging

### Service worker

`chrome://extensions/` -> find the extension card -> click the **service worker** link under "Inspect views". This opens a DevTools window attached to the worker, where every `console.log` from `tabManager.js`, `papiezService.js`, etc. appears.

The MV3 worker can be terminated by Chrome when idle. Two consequences:

- The Inspect window shows "(inactive)" - click any extension event (open the panel, fire a request) to wake it.
- Keep the inspector open while debugging; an attached DevTools window prevents Chrome from killing the worker as aggressively.

### DevTools panel

Open DevTools on a page, switch to the **CM Monitor** tab, then right-click anywhere inside the panel and choose **Inspect**. You get a nested DevTools window attached to the panel iframe. React DevTools (browser extension) attaches here too if you have it installed.

For prints from `App.jsx`, this is where they show up - **not** in the page's main DevTools console.

### Content script

`click-listener.js` runs in the monitored page's isolated world but logs to that page's DevTools console (the regular F12 view, **Console** tab). It is intentionally minimal; if it stops working, the most common cause is `Extension context invalidated` after an extension reload, which it swallows silently.

## Linting

```bash
cd devtools-panel
npx eslint src/
```

Known pre-existing noise in `App.jsx` (do not let new errors stack on top):

- `chrome is not defined` - the ESLint config does not declare `chrome` as a global. All chrome.* call sites trigger this. It is a config gap, not a code issue.
- A handful of unused `error` bindings in `catch (error) { return ... }` branches.
- One `react-hooks/exhaustive-deps` warning on `tabsMeta`.

Adding a real lint setup (with `chrome` registered as a global and `unused-imports`/`no-unused-vars` tightened) is on the backlog; until then, eyeball the diff and avoid widening the existing surface.

## OAuth setup

The OAuth client ID is hard-coded in [`manifest.json:30-37`](../manifest.json):

```json
"oauth2": {
  "client_id": "8322403152-…apps.googleusercontent.com",
  "scopes": [
    "https://www.googleapis.com/auth/dfareporting",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/dfatrafficking"
  ]
}
```

The Google Cloud Console project for that client ID has the extension's pinned ID (derived from the `key` field at [`manifest.json:28`](../manifest.json)) on its authorized origin list. If you regenerate the key or fork the extension, you must:

1. Compute the new extension ID (Chrome shows it on the card after a fresh **Load unpacked**).
2. Add it as a Chrome Extension item in the Google Cloud Console -> APIs & Services -> Credentials -> the OAuth client.

Tokens last roughly an hour; `AuthManager.ensureValidToken` handles silent refresh inside a 55-minute window. Refresh failures clear `userAuthData` and the panel reverts to the "Sign in required" state.

## Papierz endpoint

The Cloud Run URL is hard-coded at [`background/constants.js:3-4`](../background/constants.js). To point at a different backend (staging, local emulator), edit that constant and rebuild. Authorization is the OAuth bearer token from `userAuthData.access_token`; an unauthenticated or scope-revoked call returns 401, surfaces in the panel as `papiez.lastError`, and individual codes get `papiez.error: 'No data returned from Papierz.'`.

## Code conventions

- **Comments**: only when they justify a non-obvious *why* (rationale, ordering constraint, format quirk such as DoubleClick's `;`-separated tracking params). Do not narrate what the code already says, and do not reference past edits ("moved to bottom", "removed indentation"). All comments in English.
- **UI strings**: intentionally Polish (the audience is the Polish AdOps team). Do not translate them.
- **Emojis**: not in source files unless explicitly requested.
- **Editing over creating**: prefer modifying an existing file to introducing a new one.
- **Documentation prose**: plain ASCII hyphens (`-`) only, never em-dashes or en-dashes.

## Common issues

**Panel does not appear in DevTools.**
Check `chrome://extensions/` for a red error on the card; verify `dist/panel-dist/index.html` exists. After a fresh install, a full Chrome restart is occasionally needed before the new DevTools panel registers.

**OAuth fails with `bad client id` or `OAuth2 not granted or revoked`.**
The extension ID does not match anything allowlisted in the Google Cloud Console. This usually means the `key` in `manifest.json` was modified, or you are running a fork that was not registered. Re-add the new ID to the OAuth client's authorized origins.

**Papierz returns 401 or "No data returned from Papierz."**
Most often the token expired or the user's CM permissions changed. Click **Logout** in the panel, then **Login with Google** again. If a single CM code shows "No data" while others succeed, the creative may not exist in the Papierz backend's CM view - sanity check the URL by hand against Campaign Manager.

**Service worker shows "(inactive)" in `chrome://extensions/`.**
Chrome killed it. Open the panel, fire a network event, or open the worker's Inspect window - any of those wakes it. This is normal MV3 behaviour, not a bug.

**`Extension context invalidated` errors in the page console.**
Triggered when you reload the extension while a monitored page is still open. The content script swallows it; ignore unless you see it from elsewhere.

**Verifying the build is current.**
`ls -la dist/` and check the timestamps; the panel files in `dist/panel-dist/assets/` are rewritten by every build. If they look stale, your `npm run build` did not actually run (cwd issue, error swallowed, etc.).
