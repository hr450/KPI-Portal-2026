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
      for (const e of list) {
        const name = clean(e.name), email = clean(e.email).toLowerCase(), dept = clean(e.dept);
        const prevEmail = clean(e.prevEmail).toLowerCase();
        const status = e.active === false ? 'Left' : 'Active';
        if (!name) { out.skipped.push({ email, reason: 'no name' }); continue; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !email.endsWith('@' + domain())) {
          out.skipped.push({ email, reason: 'email must be @' + domain() }); continue;
        }

        let row = (await c.query('select id, role from employees where email = $1', [email])).rows[0];
        if (!row && prevEmail && prevEmail !== email) {          // email was corrected in Attendance
          row = (await c.query('select id, role from employees where email = $1', [prevEmail])).rows[0];
          if (row) await c.query('update employees set email = $2 where id = $1', [row.id, email]);
        }

        if (row) {
          // Never lock HR out of the portal because of an Attendance change.
          if (row.role === 'HR') await c.query('update employees set name = $2 where id = $1', [row.id, name]);
          else await c.query('update employees set name = $2, status = $3 where id = $1', [row.id, name, status]);
          out.updated++;
        } else {
          await c.query(
            `insert into employees (name, email, dept, role, scored, status, join_month) values ($1,$2,$3,'Staff',true,$4,$5)`,
            [name, email, dept, status, curMonth()]);
          out.created++;
        }
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
