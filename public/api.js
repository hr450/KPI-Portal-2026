/* Rankviz KPI Portal - browser <-> server connector.
 * Keeps the dashboard's google.script.run.* calls working, but sends them to /api/rpc.
 * Login = Google Sign-In; the server verifies it and sets a secure HttpOnly session cookie. */
(function () {
  let cfg = null, loginP = null, gsi = null;

  const post = (url, body) => fetch(url, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
  }).then(async r => { let d; try { d = await r.json(); } catch (e) { throw new Error('Server error (' + r.status + ').'); } return d; });

  /* ---------- login screen (same look as the Attendance app's sign-in) ---------- */
  const LOGIN_CSS = `
.llg-page{
  --navy-950:#050F22; --navy-900:#0A1E42; --navy-800:#0E2A5E;
  --royal:#1E4FD8; --azure:#2F6FED; --sky:#6FA8FF; --ice:#DCE9FB; --ink:#0B1E3F; --red:#D9534F;
  position:relative; min-height:100vh; width:100%; overflow:hidden;
  display:flex; align-items:center; justify-content:center;
  color:#fff;
}
@media (prefers-reduced-motion: reduce){
  .llg-page *{ animation-duration:0.001ms !important; animation-iteration-count:1 !important; transition-duration:0.001ms !important; }
}

.llg-bg{
  position:fixed; inset:0; z-index:0;
  background:linear-gradient(125deg, var(--navy-950), var(--navy-800) 45%, var(--royal) 100%);
  background-size:220% 220%;
  animation:llgBgshift 16s ease-in-out infinite;
}
@keyframes llgBgshift{
  0%{background-position:0% 30%;}
  50%{background-position:100% 70%;}
  100%{background-position:0% 30%;}
}
.llg-grid{
  position:fixed; inset:0; z-index:1; pointer-events:none;
  background-image:
    linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px);
  background-size:46px 46px;
  mask-image:radial-gradient(ellipse 75% 65% at 50% 35%, black 20%, transparent 78%);
  -webkit-mask-image:radial-gradient(ellipse 75% 65% at 50% 35%, black 20%, transparent 78%);
}
.llg-orb{position:fixed; z-index:1; border-radius:50%; filter:blur(6px); pointer-events:none;}
.llg-orb1{width:420px;height:420px; top:-140px; left:-120px; background:radial-gradient(circle at 35% 30%, var(--sky), transparent 70%); opacity:0.35; animation:llgFloat1 13s ease-in-out infinite;}
.llg-orb2{width:300px;height:300px; bottom:-100px; right:-80px; background:radial-gradient(circle at 40% 40%, var(--azure), transparent 70%); opacity:0.3; animation:llgFloat2 17s ease-in-out infinite;}
.llg-orb3{width:180px;height:180px; top:20%; right:8%; background:radial-gradient(circle, var(--sky), transparent 70%); opacity:0.2; animation:llgFloat3 10s ease-in-out infinite;}
@keyframes llgFloat1{0%,100%{transform:translate(0,0);}50%{transform:translate(60px,50px);}}
@keyframes llgFloat2{0%,100%{transform:translate(0,0);}50%{transform:translate(-50px,-40px);}}
@keyframes llgFloat3{0%,100%{transform:translate(0,0) scale(1);}50%{transform:translate(-30px,40px) scale(1.15);}}

.llg-particles{position:fixed; inset:0; z-index:1; pointer-events:none; overflow:hidden;}
.llg-p{position:absolute; bottom:-20px; width:4px; height:4px; border-radius:50%; background:var(--sky); opacity:0.55; animation:llgDrift linear infinite;}
@keyframes llgDrift{
  0%{transform:translateY(0) translateX(0); opacity:0;}
  10%{opacity:0.6;} 90%{opacity:0.6;}
  100%{transform:translateY(-115vh) translateX(var(--dx,20px)); opacity:0;}
}

.llg-words-dim{position:fixed; inset:0; z-index:1; pointer-events:none; overflow:hidden;}
.llg-hword{position:absolute; font-weight:800; letter-spacing:0.02em; color:rgba(255,255,255,0.045); white-space:nowrap; user-select:none;}
.llg-words-bright{
  position:fixed; inset:0; z-index:1; pointer-events:none; overflow:hidden;
  -webkit-mask-image:radial-gradient(circle 170px at var(--mx,50%) var(--my,50%), black 0%, transparent 100%);
  mask-image:radial-gradient(circle 170px at var(--mx,50%) var(--my,50%), black 0%, transparent 100%);
}
.llg-words-bright .llg-hword{ color:var(--sky); text-shadow:0 0 18px rgba(111,168,255,0.85), 0 0 40px rgba(47,111,237,0.4); }

.llg-stage{position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; padding:40px 20px; width:100%;}

.llg-logo-row{
  opacity:0; transform:translateY(-18px) scale(0.96);
  animation:llgLogoIn 0.9s cubic-bezier(.2,.8,.2,1) forwards;
}
@keyframes llgLogoIn{ to{ opacity:1; transform:translateY(0) scale(1); } }

.llg-tagline{
  margin-top:10px; font-size:13px; letter-spacing:0.22em; text-transform:uppercase; color:#AFC7F2;
  opacity:0; animation:llgFadeUp 0.8s ease forwards 0.35s;
}
@keyframes llgFadeUp{ from{opacity:0; transform:translateY(10px);} to{opacity:1; transform:translateY(0);} }

.llg-ai-chip{
  margin-top:14px; display:inline-flex; align-items:center; gap:7px; font-size:12px; color:#CBDBFF;
  background:rgba(111,168,255,0.1); border:1px solid rgba(111,168,255,0.25);
  padding:7px 14px; border-radius:100px;
  opacity:0; animation:llgFadeUp 0.8s ease forwards 0.5s;
}
.llg-ai-chip b{color:#FFFFFF;}
.llg-ai-dot{
  width:7px; height:7px; border-radius:50%; background:#7FE0A8; display:inline-block;
  box-shadow:0 0 0 0 rgba(127,224,168,0.6); animation:llgAiPulse 1.6s ease-out infinite;
}
@keyframes llgAiPulse{
  0%{box-shadow:0 0 0 0 rgba(127,224,168,0.55);}
  70%{box-shadow:0 0 0 6px rgba(127,224,168,0);}
  100%{box-shadow:0 0 0 0 rgba(127,224,168,0);}
}

.llg-card{
  margin-top:34px; width:min(400px,92vw);
  background:rgba(255,255,255,0.98); border-radius:20px; padding:28px 28px 30px; color:var(--ink);
  box-shadow:0 40px 80px -20px rgba(3,10,25,0.55), 0 0 0 1px rgba(255,255,255,0.06);
  opacity:0; transform:translateY(24px);
  animation:llgCardIn 0.8s cubic-bezier(.2,.8,.2,1) forwards 0.45s;
}
@keyframes llgCardIn{ to{opacity:1; transform:translateY(0);} }

.llg-role-toggle{ display:flex; background:#EEF3FC; border-radius:12px; padding:4px; position:relative; }
.llg-role-toggle button{
  flex:1; border:none; background:transparent; cursor:pointer;
  font-size:13.5px; font-weight:700; color:#6E85A8;
  padding:10px 8px; border-radius:9px; position:relative; z-index:2;
  display:flex; align-items:center; justify-content:center; gap:6px;
  transition:color 0.25s ease;
}
.llg-role-toggle button.active{color:var(--royal);}
.llg-role-pill{
  position:absolute; top:4px; left:4px; height:calc(100% - 8px); width:calc(50% - 4px);
  background:#fff; border-radius:9px; box-shadow:0 6px 16px -6px rgba(30,79,216,0.35);
  transition:transform 0.32s cubic-bezier(.2,.8,.2,1);
}
.llg-role-toggle.employee .llg-role-pill{ transform:translateX(100%); }

.llg-welcome{margin-top:22px;}
.llg-welcome h1{font-size:22px; font-weight:800; letter-spacing:-0.01em;}
.llg-welcome p{font-size:13.5px; color:#6E85A8; margin-top:5px;}

.llg-field{margin-top:18px;}
.llg-field label{font-size:12.5px; font-weight:700; color:#3C5478; display:block; margin-bottom:7px;}
.llg-input-wrap{position:relative;}
.llg-field input{
  width:100%; border:1.5px solid #E7EEFA; background:#F5F9FF; border-radius:10px;
  padding:12px 14px; font-size:14px; color:var(--ink);
  outline:none; transition:border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}
.llg-field input:focus{ border-color:var(--azure); background:#fff; box-shadow:0 0 0 4px rgba(47,111,237,0.14); }

.llg-error{
  display:flex; align-items:center; gap:8px; background:#FBE8E7; color:var(--red);
  padding:9px 12px; border-radius:10px; font-size:13px; margin-top:14px; font-weight:600;
}

.llg-login-btn{
  margin-top:24px; width:100%; border:none; cursor:pointer;
  background:linear-gradient(135deg, var(--royal), var(--navy-800)); background-size:180% 180%;
  color:#fff; font-weight:800; font-size:15px; padding:14px; border-radius:11px;
  display:flex; align-items:center; justify-content:center; gap:9px;
  box-shadow:0 16px 30px -12px rgba(30,79,216,0.55);
  transition:transform 0.2s cubic-bezier(.2,.8,.3,1), box-shadow 0.2s ease, background-position 0.5s ease;
}
.llg-login-btn:hover{ transform:translateY(-2px) scale(1.015); box-shadow:0 22px 38px -12px rgba(30,79,216,0.6); background-position:100% 50%; }
.llg-login-btn:active{ transform:translateY(0) scale(0.99); }

.llg-or{ display:flex; align-items:center; gap:14px; margin:22px 0 18px; color:#8DA2C4; font-size:12px; font-weight:700; letter-spacing:0.08em; }
.llg-or::before, .llg-or::after{ content:""; flex:1; height:1px; background:#E3EBF8; }
.llg-eye{ position:absolute; right:6px; top:50%; transform:translateY(-50%); border:none; background:transparent; cursor:pointer; color:#6E85A8; padding:8px; display:flex; }
.llg-link{ border:none; background:transparent; cursor:pointer; color:var(--royal); font-size:13px; font-weight:700; padding:6px 0; margin-top:12px; display:block; width:100%; text-align:center; }
.llg-link:hover{ text-decoration:underline; }
.llg-ok{ background:#E6F6EE; color:#1F7A52; padding:9px 12px; border-radius:10px; font-size:13px; margin-top:14px; font-weight:600; }
.llg-eye:hover{ color:var(--royal); }
.llg-login-btn:disabled{ cursor:not-allowed; transform:none; }

.llg-footer{ margin-top:26px; text-align:center; font-size:12px; color:#B9CBEF; opacity:0; animation:llgFadeUp 0.8s ease forwards 0.75s; }
.llg-footer b{color:#DCE9FB;}

@media (max-width:420px){ .llg-card{padding:24px 20px 26px;} }

#rv-login{position:fixed;inset:0;z-index:99999;overflow:auto;font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif}
#rv-login h1,#rv-login p,#rv-login div{box-sizing:border-box}
#rv-login h1,#rv-login p{margin:0}
#rv-login .llg-page{min-height:100%}
#rv-login .llg-welcome h1{font-size:22px;font-weight:800;letter-spacing:-0.01em;color:#0B1E3F}
#rv-login .llg-welcome p{font-size:13.5px;color:#6E85A8;margin-top:5px;line-height:1.5}
#rv-login .llg-logo-row img{height:64px;width:auto;display:block}
`;
  const WORDS = ['SECURE','VERIFIED','ACCURATE','ERROR-FREE','ENCRYPTED','REAL-TIME','TRUSTED','AUDIT-READY','PRECISE','RELIABLE','TRANSPARENT','PROTECTED','INSTANT','CONSISTENT'];
  function overlay() {
    let o = document.getElementById('rv-login');
    if (!o) {
      if (!document.getElementById('rv-login-css')) {
        const st = document.createElement('style'); st.id = 'rv-login-css'; st.textContent = LOGIN_CSS; document.head.appendChild(st);
      }
      const r = Math.random;
      const words = WORDS.map((t, i) => ({ t, size: 15 + r() * 24, top: 4 + r() * 90, left: 2 + r() * 82, rot: (r() * 16 - 8).toFixed(1) }));
      const wordHtml = words.map(w => '<div class="llg-hword" style="font-size:' + w.size + 'px;top:' + w.top + 'vh;left:' + w.left + 'vw;transform:rotate(' + w.rot + 'deg)">' + w.t + '</div>').join('');
      let parts = '';
      for (let i = 0; i < 18; i++) parts += '<div class="llg-p" style="left:' + (r() * 100) + 'vw;animation-duration:' + (8 + r() * 10) + 's;animation-delay:' + (r() * 10) + 's;--dx:' + (r() * 80 - 40) + 'px"></div>';
      o = document.createElement('div'); o.id = 'rv-login';
      o.innerHTML = '<div class="llg-page">' +
        '<div class="llg-bg"></div><div class="llg-grid"></div>' +
        '<div class="llg-orb llg-orb1"></div><div class="llg-orb llg-orb2"></div><div class="llg-orb llg-orb3"></div>' +
        '<div class="llg-particles">' + parts + '</div>' +
        '<div class="llg-words-dim">' + wordHtml + '</div>' +
        '<div class="llg-words-bright" id="rv-bright">' + wordHtml + '</div>' +
        '<div class="llg-stage">' +
          '<div class="llg-logo-row"><img src="/logo-full.png" alt="RankViz"></div>' +
          '<div class="llg-tagline">KPI Portal</div>' +
          '<div class="llg-ai-chip"><span class="llg-ai-dot"></span> Secure sign-in for the <b>RankViz</b> team</div>' +
          '<div class="llg-card">' +
            '<div class="llg-welcome"><h1>Sign in</h1><p id="rv-sub"></p></div>' +
            '<div style="margin-top:26px;display:flex;justify-content:center"><div id="rv-btn" style="min-height:44px"></div></div>' +
            '<div id="rv-err" class="llg-error" style="display:none"></div>' +
          '</div>' +
          '<div class="llg-footer">\u00a9 ' + new Date().getFullYear() + ' <b>RankViz</b> \u00b7 hr@rankviz.com</div>' +
        '</div></div>';
      document.body.appendChild(o);
      const br = o.querySelector('#rv-bright');
      window.addEventListener('mousemove', e => { if (o.style.display !== 'none') { br.style.setProperty('--mx', e.clientX + 'px'); br.style.setProperty('--my', e.clientY + 'px'); } }, { passive: true });
    }
    o.style.display = 'block';
    return o;
  }
  const say = (m, isErr) => {
    const o = overlay();
    if (isErr) { const e = o.querySelector('#rv-err'); e.textContent = m || ''; e.style.display = m ? 'flex' : 'none'; }
    else o.querySelector('#rv-sub').textContent = m || '';
  };
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
      overlay(); say('Continue with your company Google account'); say(msg || '', true);
      (async () => {
        try {
          if (!cfg) cfg = await (await fetch('/api/auth/config')).json();
          if (!cfg.clientId) throw new Error('Portal is not configured yet (GOOGLE_CLIENT_ID missing).');
          say('Continue with your @' + cfg.domain + ' Google account');
          await loadGsi();
          google.accounts.id.initialize({
            client_id: cfg.clientId, hd: cfg.domain, auto_select: false, cancel_on_tap_outside: false,
            callback: async (resp) => {
              say('', true); say('Signing you in…');
              try {
                const d = await post('/api/auth/google', { credential: resp.credential });
                if (!d.ok) { say('Continue with your @' + cfg.domain + ' Google account'); say(d.error, true); return; }
                hide(); loginP = null; resolve();
              } catch (e) { say('Continue with your @' + cfg.domain + ' Google account'); say(e.message, true); }
            }
          });
          google.accounts.id.renderButton(document.getElementById('rv-btn'), { theme: 'outline', size: 'large', width: 336, shape: 'pill', text: 'continue_with' });
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
        try { localStorage.removeItem('rv_boot'); } catch (e) {}
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
  window.rvSignOut = async () => { try { localStorage.removeItem('rv_boot'); } catch (e) {} try { await post('/api/auth/logout'); } catch (e) {} location.reload(); };
  new MutationObserver(() => {
    const u = document.querySelector('.suser');
    if (u && !u.querySelector('.rv-so')) {
      const b = document.createElement('button'); b.className = 'rv-so'; b.textContent = 'Sign out'; b.title = 'Sign out';
      b.style.cssText = 'margin-left:auto;border:1px solid rgba(255,255,255,.25);background:transparent;color:#C9D8F5;border-radius:8px;padding:5px 9px;font-size:11px;cursor:pointer';
      b.onclick = window.rvSignOut; u.appendChild(b);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
