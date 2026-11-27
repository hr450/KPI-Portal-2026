import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { q } from './db.js';

const COOKIE = 'rv_session';
const MAX_AGE = 60 * 60 * 12; // 12 hours

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET is missing or too short.');
  return new TextEncoder().encode(s);
};

export const domain = () => (process.env.ALLOWED_DOMAIN || 'rankviz.com').toLowerCase();

const secure = () => (process.env.VERCEL ? '; Secure' : '');

/* Small readable hint cookie (NOT the session): it only says "this browser is signed in as <hash>".
   The page uses it to show its saved copy of the dashboard instantly, and only if that copy
   belongs to the same person. It holds no email and grants no access. */
export function hintValue(email) {
  return crypto.createHmac('sha256', secret()).update('hint.' + String(email).toLowerCase()).digest('hex').slice(0, 16);
}

/** Returns BOTH cookies (session + hint) as an array - pass it straight to res.setHeader('Set-Cookie', ...). */
export async function sessionCookie(email) {
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime(MAX_AGE + 's')
    .sign(secret());
  return [
    `${COOKIE}=${jwt}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}${secure()}`,
    `rv_in=${hintValue(email)}; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}${secure()}`,
  ];
}

export const clearCookie = () => [
  `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure()}`,
  `rv_in=; SameSite=Lax; Path=/; Max-Age=0${secure()}`,
];

/** Returns the signed-in email from the cookie, or null. */
export async function readSession(req) {
  const m = /(?:^|;\s*)rv_session=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  try {
    const { payload } = await jwtVerify(m[1], secret(), { algorithms: ['HS256'] });
    return payload.sub || null;
  } catch (_) { return null; }
}

/** Blocks cross-site POSTs (CSRF). Browsers always send Origin on cross-site POST. */
export function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch (_) { return false; }
}

/** The active employee row for this email (or null). */
export async function findActive(email) {
  const r = await q(`select * from employees where email = $1 and status = 'Active'`, [String(email).toLowerCase()]);
  return r[0] || null;
}

/**
 * Called after Google has verified the person. Returns the employee row if they may use the portal.
 * The very first HR account is created automatically (only while the employees table is empty).
 */
export async function admit(email) {
  email = String(email).toLowerCase();
  let rows = await q(`select * from employees where email = $1`, [email]);
  if (!rows.length && email === String(process.env.BOOTSTRAP_HR_EMAIL || '').toLowerCase()) {
    const n = (await q(`select count(*)::int as n from employees`))[0].n;
    if (n === 0) {
      rows = await q(
        `insert into employees (name, email, role, scored) values ($1, $2, 'HR', true) returning *`,
        [process.env.BOOTSTRAP_HR_NAME || 'HR Manager', email]);
    }
  }
  const me = rows[0];
  return me && me.status === 'Active' ? me : null;
}
