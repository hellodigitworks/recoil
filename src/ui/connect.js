// Getting and keeping a Whoop session, and reporting honestly when it breaks.
//
// Everything user-facing here says what actually happened. No screen in this
// app is ever allowed to imply data it does not have.

import { getTokens, setTokens, clearTokens, WhoopError } from '../data/sync.js';

/** Set once Whoop has proven it will not grant `offline` to this app. */
const NO_OFFLINE = 'recoil.v1.no_offline';

const READ_SCOPES = 'read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement';

/**
 * `offline` is what makes Whoop issue a refresh token; without it the session
 * dies after about an hour. Whoop documents it as request-level, but not every
 * app has it available. If authorization is rejected for that reason we
 * remember it and fall back, because an hourly session beats no login at all.
 */
export async function startAuth(notice) {
  try {
    const cfg = await fetch('/.netlify/functions/config').then((r) => r.json());
    if (!cfg.clientId) throw new Error('WHOOP_CLIENT_ID is not set in Netlify.');
    const st = crypto.randomUUID().replace(/-/g, '');
    sessionStorage.setItem('oauth_state', st);
    const scopes = localStorage.getItem(NO_OFFLINE) ? READ_SCOPES : 'offline ' + READ_SCOPES;
    location.href = 'https://api.prod.whoop.com/oauth/oauth2/auth'
      + `?client_id=${encodeURIComponent(cfg.clientId)}`
      + `&redirect_uri=${encodeURIComponent(cfg.redirectUri)}`
      + `&response_type=code&scope=${encodeURIComponent(scopes)}&state=${st}`;
  } catch (e) {
    notice({ title: 'Cannot start the connection', body: e.message, error: true });
  }
}

/**
 * Handle the OAuth redirect. Resolves true when a usable token is stored.
 * @param {(o:object)=>void} notice
 */
export async function handleCallback(notice) {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const err = params.get('error');

  if (err) {
    // Whoop turned down the offline scope. Go straight round again without it
    // rather than leaving a dead end on screen.
    if (/scope/i.test(err) && !localStorage.getItem(NO_OFFLINE)) {
      localStorage.setItem(NO_OFFLINE, '1');
      history.replaceState({}, '', '/');
      notice({
        title: 'Reconnecting without the offline scope',
        body: 'Whoop would not grant it on this app, so sessions last about an hour. Your history stays cached either way.'
      });
      startAuth(notice);
      return false;
    }
    notice({ title: 'Whoop refused the login', body: err, error: true });
    return false;
  }
  if (!code) return false;

  if (params.get('state') !== sessionStorage.getItem('oauth_state')) {
    notice({ title: 'Login could not be verified', body: 'The state value did not match. Start the connection again.', error: true });
    return false;
  }
  history.replaceState({}, '', '/');

  // Arc and some browsers preload /callback, which would spend the one-time
  // code twice. First loader wins; the second waits for it to store a token.
  const lock = 'recoil_oauth_' + code;
  if (localStorage.getItem(lock)) {
    for (let i = 0; i < 30; i++) {
      if (getTokens()) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return !!getTokens();
  }
  localStorage.setItem(lock, '1');

  try {
    const res = await fetch('/.netlify/functions/oauth-exchange', { method: 'POST', body: JSON.stringify({ code }) });
    const body = await res.json();
    if (body.error) {
      if (getTokens()) return true;
      throw new Error(body.error);
    }
    setTokens(body);
    if (!body.refresh_token) {
      notice({
        title: 'Connected, but this session expires in about an hour',
        body: 'Whoop issued no refresh token. Your whole history is cached, so the app keeps opening instantly and showing everything. It just cannot pull new days until you reconnect.'
      });
    }
    return true;
  } catch (e) {
    if (getTokens()) return true;
    notice({ title: 'Token exchange failed', body: e.message, error: true });
    return false;
  }
}

/** Render a sync failure, with a way out when the session is the problem. */
export function describeSyncError(err, notice) {
  const reconnect = err instanceof WhoopError && (err.code === 'reconnect' || err.code === 'not_connected');
  const box = notice({
    title: reconnect ? 'Whoop session ended' : err instanceof WhoopError ? 'Could not reach Whoop' : 'Sync failed',
    body: err.message,
    hint: err.hint,
    detail: err.whoopStatus ? `HTTP ${err.whoopStatus}\n${err.whoopBody || ''}`.trim() : null,
    error: true
  });
  if (reconnect && box) {
    const outs = document.createElement('div');
    outs.className = 'outs';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = 'Reconnect Whoop';
    btn.addEventListener('click', () => { clearTokens(); location.replace(location.pathname); });
    outs.appendChild(btn);
    box.appendChild(outs);
  }
}
