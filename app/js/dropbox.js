// Save to Dropbox: sign in once (OAuth 2 with PKCE, no password ever touches Music Scribe),
// then files upload straight into Dropbox › Apps › <app name>. The app can only see that folder.
//
// Setup: put the Dropbox app's "App key" (public, not a secret) in DROPBOX_APP_KEY below.

export const DROPBOX_APP_KEY = '';

const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const UPLOAD_URL = 'https://content.dropboxapi.com/2/files/upload';
const REVOKE_URL = 'https://api.dropboxapi.com/2/auth/token/revoke';
const STORE = 'musicScribe.dropbox';
const RETURN = 'musicScribe.dropboxReturn';

const redirectUri = () => new URL('dropbox.html', document.baseURI).href;

function load() { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; } }
function save(v) { try { if (v) localStorage.setItem(STORE, JSON.stringify(v)); else localStorage.removeItem(STORE); } catch { /* storage off */ } }

export const dropboxReady = () => !!DROPBOX_APP_KEY;
export const dropboxConnected = () => !!load()?.refresh;

// ---------- PKCE ----------
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function randomVerifier() {
  const a = new Uint8Array(48);
  crypto.getRandomValues(a);
  return b64url(a);
}
async function challengeFor(verifier) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(hash));
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: DROPBOX_APP_KEY, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `Dropbox sign-in failed (${res.status}).`);
  return data;
}
function keep(data, prev = {}) {
  const v = {
    refresh: data.refresh_token || prev.refresh,
    access: data.access_token,
    expires: Date.now() + ((data.expires_in || 14400) - 60) * 1000,
    account: data.account_id || prev.account,
  };
  save(v);
  return v;
}

/** Open the sign-in window straight away (it must happen during the tap, or browsers block it). */
export function openSignInWindow() {
  try { return window.open('about:blank', 'ms-dropbox', 'width=520,height=720'); } catch { return null; }
}

/**
 * Sign in to Dropbox.
 * mode 'popup': Dropbox opens in `win` (from openSignInWindow) and hands back the result by itself.
 * mode 'paste': for iPhone home-screen apps, Dropbox shows a code that the person pastes back in.
 * Returns { mode, url, finish(code?) }: in paste mode, call finish(code) with the pasted code;
 * in popup mode the returned promise only resolves once signed in.
 */
export async function beginConnect({ mode = 'popup', win = null } = {}) {
  if (!dropboxReady()) throw new Error('Dropbox isn’t set up in this copy of Music Scribe yet.');
  const verifier = randomVerifier();
  const state = randomVerifier().slice(0, 16);
  const params = new URLSearchParams({
    client_id: DROPBOX_APP_KEY,
    response_type: 'code',
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    token_access_type: 'offline', // stay signed in
  });
  if (mode === 'popup') { params.set('redirect_uri', redirectUri()); params.set('state', state); }
  const url = `${AUTH_URL}?${params}`;

  if (mode === 'paste' || !win) {
    // no window (iPhone home-screen app, or pop-ups blocked): show a link; Dropbox displays a code to paste back
    if (mode === 'popup') return beginConnect({ mode: 'paste', win: null });
    if (win) { try { win.location.href = url; } catch { /* closed */ } }
    return {
      mode: 'paste',
      url,
      finish: async (code) => keep(await tokenRequest({ code: String(code).trim(), grant_type: 'authorization_code', code_verifier: verifier })),
    };
  }

  const popup = win;
  popup.location.href = url;
  try { localStorage.removeItem(RETURN); } catch { /* ignore */ }
  const code = await new Promise((resolve, reject) => {
    const done = (msg) => {
      if (!msg || msg.type !== 'ms-dropbox' || msg.state !== state) return;
      cleanup();
      if (msg.error || !msg.code) reject(new Error(msg.error || 'Dropbox sign-in was cancelled.'));
      else resolve(msg.code);
    };
    const onMessage = (e) => { if (e.origin === location.origin) done(e.data); };
    const onStorage = (e) => { if (e.key === RETURN && e.newValue) { try { done(JSON.parse(e.newValue)); } catch { /* ignore */ } } };
    const timer = setInterval(() => {
      try { const v = localStorage.getItem(RETURN); if (v) done(JSON.parse(v)); } catch { /* ignore */ }
      if (popup.closed) setTimeout(() => { cleanup(); reject(new Error('Dropbox sign-in was closed before it finished.')); }, 800);
    }, 500);
    const cleanup = () => {
      clearInterval(timer);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('storage', onStorage);
      try { localStorage.removeItem(RETURN); } catch { /* ignore */ }
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('storage', onStorage);
  });
  keep(await tokenRequest({ code, grant_type: 'authorization_code', code_verifier: verifier, redirect_uri: redirectUri() }));
  return { mode, url, finish: async () => load() };
}

async function accessToken() {
  const v = load();
  if (!v?.refresh) throw new Error('Not connected to Dropbox.');
  if (v.access && v.expires > Date.now()) return v.access;
  try {
    return keep(await tokenRequest({ grant_type: 'refresh_token', refresh_token: v.refresh }), v).access;
  } catch (err) {
    save(null); // the connection was revoked or expired
    throw new Error(`Dropbox needs you to sign in again. (${err.message})`);
  }
}

/** Dropbox wants its JSON header in plain ASCII. */
const asciiJson = (o) => JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** Upload a file into the app's Dropbox folder. Returns the saved path (e.g. "/My Song.pdf"). */
export async function uploadToDropbox(name, blob) {
  const token = await accessToken();
  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': asciiJson({ path: `/${name}`, mode: 'add', autorename: true, mute: false }),
    },
    body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { save(null); throw new Error('Dropbox signed you out. Tap Dropbox again to reconnect.'); }
  if (!res.ok) throw new Error(data.error_summary ? `Dropbox: ${data.error_summary}` : `Dropbox upload failed (${res.status}).`);
  return data.path_display || `/${name}`;
}

/** Forget the connection (and tell Dropbox to cancel it). */
export async function disconnectDropbox() {
  const v = load();
  save(null);
  if (v?.access) {
    try { await fetch(REVOKE_URL, { method: 'POST', headers: { Authorization: `Bearer ${v.access}` } }); } catch { /* offline is fine */ }
  }
}
