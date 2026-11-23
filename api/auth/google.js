import { OAuth2Client } from 'google-auth-library';
import { sessionCookie, sameOrigin, admit, domain } from '../../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Blocked.' });

  const cid = process.env.GOOGLE_CLIENT_ID;
  if (!cid) return res.status(500).json({ ok: false, error: 'GOOGLE_CLIENT_ID is not configured on the server.' });

  try {
    const credential = (req.body || {}).credential;
    if (!credential) return res.status(400).json({ ok: false, error: 'Missing credential.' });

    let p;
    try {
      const ticket = await new OAuth2Client(cid).verifyIdToken({ idToken: credential, audience: cid });
      p = ticket.getPayload();
    } catch (_) {
      return res.status(401).json({ ok: false, error: 'Google sign-in could not be verified. Please try again.' });
    }
    if (!p || !p.email || !p.email_verified || String(p.hd || '').toLowerCase() !== domain())
      return res.status(403).json({ ok: false, error: 'Please sign in with your @' + domain() + ' Google account.' });

    const me = await admit(p.email);
    if (!me) return res.status(403).json({ ok: false, error: p.email + ' is not registered in this portal. Please ask HR to add you.' });

    res.setHeader('Set-Cookie', await sessionCookie(me.email));
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('login error:', e);
    return res.status(500).json({ ok: false, error: 'Server error while signing in. Please try again.' });
  }
}
