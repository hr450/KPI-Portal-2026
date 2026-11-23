/* Rankviz KPI Portal - browser <-> server connector.
 * Keeps the dashboard's google.script.run.* calls working, but sends them to /api/rpc.
 * Login = Google Sign-In; the server verifies it and sets a secure HttpOnly session cookie. */
(function () {
  let cfg = null, loginP = null, gsi = null;

  const post = (url, body) => fetch(url, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
  }).then(async r => { let d; try { d = await r.json(); } catch (e) { throw new Error('Server error (' + r.status + ').'); } return d; });

  /* ---------- login screen ---------- */
  function overlay() {
    let o = document.getElementById('rv-login');
    if (!o) {
      o = document.createElement('div'); o.id = 'rv-login';
      o.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;background:linear-gradient(135deg,#071a3d,#0A1F44);font-family:"DM Sans",Arial,sans-serif';
      o.innerHTML = '<div style="background:#fff;border-radius:20px;padding:36px 34px;text-align:center;width:100%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,.4)">' +
        '<h2 style="margin:0 0 6px;color:#0A1F44;font-family:Manrope,sans-serif;font-size:22px">Rankviz KPI Portal</h2>' +
        '<p id="rv-sub" style="margin:0 0 22px;color:#6B7A99;font-size:14px"></p>' +
        '<div id="rv-btn" style="display:flex;justify-content:center;min-height:44px"></div>' +
        '<p id="rv-err" style="margin:16px 0 0;color:#DC2626;font-size:13px;min-height:18px"></p></div>';
      document.body.appendChild(o);
    }
    o.style.display = 'flex';
    return o;
  }
  const say = (m, isErr) => { const o = overlay(); o.querySelector(isErr ? '#rv-err' : '#rv-sub').textContent = m || ''; };
  const hide = () => { const o = document.getElementById('rv-login'); if (o) o.style.display = 'none'; };

  function loadGsi() {
    return gsi || (gsi = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = res; s.onerror = () => { gsi = null; rej(new Error('Could not load Google Sign-In. Check your internet connection.')); };
      document.head.appendChild(s);
    }));
  }

  function login(msg) {
    if (loginP) return loginP;
    loginP = new Promise((resolve, reject) => {
      overlay(); say('Sign in with your company Google account'); say(msg || '', true);
      (async () => {
        try {
          if (!cfg) cfg = await (await fetch('/api/auth/config')).json();
          if (!cfg.clientId) throw new Error('Portal is not configured yet (GOOGLE_CLIENT_ID missing).');
          say('Sign in with your @' + cfg.domain + ' Google account');
          await loadGsi();
          google.accounts.id.initialize({
            client_id: cfg.clientId, hd: cfg.domain, auto_select: false, cancel_on_tap_outside: false,
            callback: async (resp) => {
              say('', true); say('Signing you in…');
              try {
                const d = await post('/api/auth/google', { credential: resp.credential });
                if (!d.ok) { say('Sign in with your @' + cfg.domain + ' Google account'); say(d.error, true); return; }
                hide(); loginP = null; resolve();
              } catch (e) { say('Sign in with your @' + cfg.domain + ' Google account'); say(e.message, true); }
            }
          });
          google.accounts.id.renderButton(document.getElementById('rv-btn'), { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with' });
        } catch (e) { say(e.message, true); loginP = null; reject(e); }
      })();
    });
    return loginP;
  }

  /* ---------- server call ---------- */
  async function rpc(fn, args, retried) {
    const d = await post('/api/rpc', { fn: fn, args: args });
    if (!d.ok) {
      if (d.code === 'AUTH') {
        if (retried) throw new Error(d.error);
        await login(d.error === 'Please sign in.' ? '' : d.error);
        return rpc(fn, args, true);
      }
      throw new Error(d.error || 'Unknown error');
    }
    return d.result;
  }

  /* ---------- google.script.run compatible proxy (dashboard code stays unchanged) ---------- */
  const mk = (ok, fail) => new Proxy({}, {
    get: (_, k) => k === 'withSuccessHandler' ? g => mk(g, fail)
      : k === 'withFailureHandler' ? g => mk(ok, g)
      : (...a) => { rpc(k, a).then(v => ok && ok(v)).catch(e => fail ? fail(e) : alert(e.message)); }
  });
  (window.google = window.google || {}).script = { run: mk() };

  /* ---------- sign-out link in the sidebar ---------- */
  window.rvSignOut = async () => { try { await post('/api/auth/logout'); } catch (e) {} location.reload(); };
  new MutationObserver(() => {
    const u = document.querySelector('.suser');
    if (u && !u.querySelector('.rv-so')) {
      const b = document.createElement('button'); b.className = 'rv-so'; b.textContent = 'Sign out'; b.title = 'Sign out';
      b.style.cssText = 'margin-left:auto;border:1px solid rgba(255,255,255,.25);background:transparent;color:#C9D8F5;border-radius:8px;padding:5px 9px;font-size:11px;cursor:pointer';
      b.onclick = window.rvSignOut; u.appendChild(b);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
