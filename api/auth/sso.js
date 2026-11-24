// GET /api/auth/sso?t=<token>
// One-click sign-in coming from the Attendance app.
// Token = base64url(JSON {e: email, x: expiry-in-unix-seconds}) + "." + base64url(HMAC-SHA256(SYNC_SECRET, "sso." + payload))
// The token is valid for 60 seconds. If anything is wrong we simply redirect to the normal login page.
import crypto from 'node:crypto';
import { sessionCookie, admit, domain } from '../../lib/auth.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const go = (to) => { res.statusCode = 302; res.setHeader('Location', to); res.end(); };

  try {
    const secret = process.env.SYNC_SECRET;
    const t = String((req.query && req.query.t) || '');
    const parts = t.split('.');
    if (!secret || secret.length < 16 || parts.length !== 2) return go('/');

    const expect = b64u(crypto.createHmac('sha256', secret).update('sso.' + parts[0]).digest());
    if (!safeEq(parts[1], expect)) return go('/');

    const p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (!p || !p.e || !p.x || p.x < now || p.x > now + 300) return go('/');

    const email = String(p.e).trim().toLowerCase();
    if (!email.endsWith('@' + domain())) return go('/');

    const me = await admit(email);          // must be an Active employee in the KPI portal
    if (!me) return go('/');

    res.setHeader('Set-Cookie', await sessionCookie(me.email));
    return go('/?sso=1');
  } catch (e) {
    console.error('sso error:', e);
    return go('/');
  }
}
