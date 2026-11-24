// POST /api/sync/employees   Authorization: Bearer <SYNC_SECRET>
// Called by the Attendance app whenever HR adds / edits an employee there.
// Body: { employees: [{ name, email, dept, active, prevEmail }] }
//
// - New email            -> employee is created here (Staff, scored, joined this month).
// - Existing email       -> only name + Active/Left are updated. Role, scored flag, scorers,
//                           department access and scores are never touched by the sync.
import crypto from 'node:crypto';
import { tx } from '../../lib/db.js';
import { domain } from '../../lib/auth.js';

const TZ = 'Asia/Karachi';
const curMonth = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return p.year + '-' + p.month;
};
const clean = (s) => String(s == null ? '' : s).trim();
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed.' });

  const secret = process.env.SYNC_SECRET;
  if (!secret || secret.length < 16) return res.status(500).json({ ok: false, error: 'SYNC_SECRET is not configured.' });
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m || !safeEq(m[1], secret)) return res.status(401).json({ ok: false, error: 'Unauthorized.' });

  const list = Array.isArray(req.body && req.body.employees) ? req.body.employees.slice(0, 500) : [];
  const out = { created: 0, updated: 0, skipped: [] };

  try {
    await tx(async (c) => {
      // 1) validate + de-duplicate by email
      const byEmail = new Map();
      for (const e of list) {
        const name = clean(e.name), email = clean(e.email).toLowerCase(), dept = clean(e.dept);
        const prevEmail = clean(e.prevEmail).toLowerCase();
        if (!name) { out.skipped.push({ email, reason: 'no name' }); continue; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !email.endsWith('@' + domain())) {
          out.skipped.push({ email, reason: 'email must be @' + domain() }); continue;
        }
        byEmail.set(email, { name, email, dept, prevEmail, status: e.active === false ? 'Left' : 'Active' });
      }
      const rows = [...byEmail.values()];
      if (!rows.length) return;

      // 2) ONE query to see who already exists (a loop of queries is far too slow on a remote DB)
      const lookup = [...new Set(rows.flatMap((r) => [r.email, r.prevEmail].filter(Boolean)))];
      const found = (await c.query('select id, email, role from employees where email = any($1::text[])', [lookup])).rows;
      const known = new Map(found.map((r) => [r.email, r]));

      // 3) email corrected in Attendance -> move the existing row to the new email (rare)
      for (const r of rows) {
        if (!known.has(r.email) && r.prevEmail && r.prevEmail !== r.email && known.has(r.prevEmail)) {
          const old = known.get(r.prevEmail);
          await c.query('update employees set email = $2 where id = $1', [old.id, r.email]);
          known.set(r.email, { ...old, email: r.email });
          known.delete(r.prevEmail);
        }
      }

      const upd = rows.filter((r) => known.has(r.email));
      const ins = rows.filter((r) => !known.has(r.email));

      // 4) existing people: name + Active/Left only (HR keeps their status so nobody gets locked out)
      if (upd.length) {
        const r = await c.query(
          `update employees e set name = v.name, status = case when e.role = 'HR' then e.status else v.status end
             from unnest($1::text[], $2::text[], $3::text[]) as v(email, name, status)
            where e.email = v.email`,
          [upd.map((x) => x.email), upd.map((x) => x.name), upd.map((x) => x.status)]);
        out.updated = r.rowCount;
      }

      // 5) new people: all in one insert
      if (ins.length) {
        const r = await c.query(
          `insert into employees (name, email, dept, role, scored, status, join_month)
           select v.name, v.email, v.dept, 'Staff', true, v.status, $5::text
             from unnest($1::text[], $2::text[], $3::text[], $4::text[]) as v(name, email, dept, status)
           on conflict (email) do nothing`,
          [ins.map((x) => x.name), ins.map((x) => x.email), ins.map((x) => x.dept), ins.map((x) => x.status), curMonth()]);
        out.created = r.rowCount;
      }

      if (out.created || out.updated) {
        await c.query('insert into audit_log (actor, action, detail) values ($1,$2,$3)',
          ['attendance-sync', 'syncEmployees', JSON.stringify({ created: out.created, updated: out.updated })]);
      }
    });
    return res.status(200).json({ ok: true, ...out });
  } catch (e) {
    console.error('sync error:', e);
    return res.status(500).json({ ok: false, error: 'Sync failed.' });
  }
}
