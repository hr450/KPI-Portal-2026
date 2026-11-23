import { readSession, sameOrigin, findActive, clearCookie } from '../lib/auth.js';
import { FUNCTIONS } from '../lib/service.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Blocked.' });

  try {
    const email = await readSession(req);
    if (!email) return res.status(401).json({ ok: false, code: 'AUTH', error: 'Please sign in.' });

    const me = await findActive(email);
    if (!me) {   // removed / marked Left after signing in
      res.setHeader('Set-Cookie', clearCookie());
      return res.status(401).json({ ok: false, code: 'AUTH', error: 'Your account is not active in this portal. Please contact HR.' });
    }

    const { fn, args } = req.body || {};
    if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, fn)) return res.status(400).json({ ok: false, error: 'Unknown request.' });

    const result = await FUNCTIONS[fn](me, ...(Array.isArray(args) ? args : []));
    return res.status(200).json({ ok: true, result: result === undefined ? null : result });
  } catch (e) {
    if (e && e.expose) return res.status(200).json({ ok: false, error: e.message });
    console.error('rpc error:', e);
    return res.status(500).json({ ok: false, error: 'Something went wrong on the server. Please try again.' });
  }
}
