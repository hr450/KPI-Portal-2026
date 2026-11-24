/**
 * All portal logic. Every exported function is callable from the browser as
 *   rpc(fn, args)  ->  FUNCTIONS[fn](me, ...args)
 * `me` is the signed-in employee row, loaded fresh from the database on every request.
 * Permissions are enforced HERE (server side) - never trust the browser.
 */
import { q, tx } from './db.js';
import { domain } from './auth.js';

export class UserError extends Error { constructor(m) { super(m); this.expose = true; } }
const fail = (m) => { throw new UserError(m); };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const TZ = 'Asia/Karachi';
const DEFAULT_CRIT = 'Generic scale: 5 = Exceptional | 4 = Good | 3 = Average | 2 = Below Average | 1 = Poor';
const TABLES = ['employees', 'employee_scorers', 'dept_access', 'kpis', 'kpi_applies', 'sub_metrics', 'scores'];

const prevMonth = (m) => { let [y, mo] = m.split('-').map(Number); mo--; if (!mo) { mo = 12; y--; } return y + '-' + String(mo).padStart(2, '0'); };
const curMonth = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return p.year + '-' + p.month;
};
const stamp = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
const requireHR = (me) => { if (me.role !== 'HR') fail('Only HR can do this.'); };
const clean = (s) => String(s == null ? '' : s).trim();
const weight = (w) => { const n = Number(w); if (!Number.isFinite(n) || n < 0 || n > 100) fail('Weight must be a number from 0 to 100.'); return n; };
const monthOrFail = (m, msg) => { if (!MONTH.test(m || '')) fail(msg || 'Choose a valid month.'); return m; };

async function audit(c, me, action, detail) {
  await c.query('insert into audit_log (actor, action, detail) values ($1, $2, $3)', [me.email, action, JSON.stringify(detail || {})]);
}

/* ------------------------------------------------------------------ read ---- */

export async function getBoot(me) {
  const [E, SC, AC, K, KA, SU, ALLSC, LAST] = await Promise.all([
    q(`select id, name, email, dept, role, scored, status, join_month from employees order by name`),
    q(`select employee_id, scorer_id from employee_scorers`),
    q(`select scorer_id, dept from dept_access`),
    q(`select id, name, descr, active, scope, owner_id from kpis order by length(id), id`),
    q(`select kpi_id, employee_id from kpi_applies`),
    q(`select id, kpi_id, name, criteria, weight::float8 as w, active, start_month, end_month from sub_metrics order by length(id), id`),
    q(`select month, employee_id, sub_id, value::float8 as v from scores`),
    q(`select max(updated_at) as t from scores`),
  ]);

  const byId = new Map(E.map((e) => [e.id, e]));
  const scorersOf = new Map();
  SC.forEach((r) => { if (!scorersOf.has(r.employee_id)) scorersOf.set(r.employee_id, []); scorersOf.get(r.employee_id).push(r.scorer_id); });
  const myDepts = new Set(AC.filter((a) => a.scorer_id === me.id).map((a) => a.dept));
  const isScorer = SC.some((r) => r.scorer_id === me.id) || myDepts.size > 0;
  const role = me.role === 'HR' ? 'HR' : me.role === 'CEO' ? 'CEO' : isScorer ? 'Scorer' : 'Employee';
  const seesAll = me.role === 'HR' || me.role === 'CEO';

  const direct = (e) => (scorersOf.get(e.id) || []).includes(me.id);
  const byDept = (e) => e.scored && e.dept && myDepts.has(e.dept);
  const canSee = (e) => seesAll || e.id === me.id || direct(e) || byDept(e);
  const canEdit = (e) => e.id !== me.id && e.scored && (e.status === 'Active' || me.role === 'HR') && (me.role === 'HR' || direct(e) || byDept(e));

  const vis = E.filter(canSee);
  const visIds = new Set(vis.map((e) => e.id));

  const list = vis.map((e) => ({
    name: e.name, email: e.email, dept: e.dept, scored: e.scored, active: e.status === 'Active',
    join: e.join_month || '', edit: canEdit(e), self: e.id === me.id,
    scorers: (scorersOf.get(e.id) || []).map((id) => (byId.get(id) || {}).name).filter(Boolean).join(', '),
  }));

  const sc = ALLSC.filter((r) => visIds.has(r.employee_id));
  const scores = sc.map((r) => [r.month, byId.get(r.employee_id).email, r.sub_id, r.v]);

  const applies = new Map();
  KA.forEach((a) => { if (!applies.has(a.kpi_id)) applies.set(a.kpi_id, []); applies.get(a.kpi_id).push(a.employee_id); });
  const showKpi = (k) => k.scope === 'ALL' || seesAll || k.owner_id === me.id || (applies.get(k.id) || []).some((id) => visIds.has(id));
  const KV = K.filter(showKpi);
  const kIds = new Set(KV.map((k) => k.id));

  const kpis = KV.map((k) => ({
    id: k.id, name: k.name, desc: k.descr, active: k.active, scope: k.scope, mine: k.owner_id === me.id,
    owner: k.owner_id ? (byId.get(k.owner_id) || {}).name || '' : '',
    applies: k.scope === 'ALL' ? null : (applies.get(k.id) || []).map((id) => (byId.get(id) || {}).email).filter(Boolean),
  }));
  const subs = SU.filter((s) => kIds.has(s.kpi_id)).map((s) => ({
    id: s.id, kpi: s.kpi_id, name: s.name, crit: s.criteria || DEFAULT_CRIT, w: s.w,
    active: s.active, start: s.start_month || '', end: s.end_month || '',
  }));

  const last = LAST[0].t;
  return { me: me.email, role, list, scores, kpis, subs, updated: stamp(last ? new Date(last) : new Date()) };
}

export async function adminData(me) {
  requireHR(me);
  const [E, SC, AC] = await Promise.all([
    q(`select id, name, email, dept, role, scored, status, join_month from employees order by name`),
    q(`select employee_id, scorer_id from employee_scorers`),
    q(`select scorer_id, dept from dept_access order by dept`),
  ]);
  const byId = new Map(E.map((e) => [e.id, e]));
  const emps = E.map((e) => ({
    id: e.id, name: e.name, email: e.email, dept: e.dept, role: e.role, scored: e.scored, status: e.status, join: e.join_month || '',
    scorers: SC.filter((r) => r.employee_id === e.id).map((r) => (byId.get(r.scorer_id) || {}).email).filter(Boolean),
  }));
  const scorerIds = new Set([...SC.map((r) => r.scorer_id), ...AC.map((a) => a.scorer_id)]);
  const acc = [...scorerIds].map((id) => byId.get(id)).filter(Boolean)
    .map((s) => ({ email: s.email, name: s.name, depts: AC.filter((a) => a.scorer_id === s.id).map((a) => a.dept) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { emps, acc };
}

/* ------------------------------------------------------------ employees ----- */

export async function saveEmployee(me, d) {
  requireHR(me);
  d = d || {};
  const name = clean(d.name), email = clean(d.email).toLowerCase(), dept = clean(d.dept);
  if (!name) fail('Name is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !email.endsWith('@' + domain())) fail('Email must be a valid @' + domain() + ' address.');
  const status = d.status === 'Left' ? 'Left' : 'Active';
  const role = ['HR', 'CEO', 'Staff'].includes(d.role) ? d.role : 'Staff';
  const scored = d.scored !== false;
  const join = d.join ? monthOrFail(d.join, 'Invalid joining month.') : null;
  const scorerEmails = [...new Set((d.scorers || []).map((s) => clean(s).toLowerCase()))];

  return tx(async (c) => {
    const dup = (await c.query('select id from employees where email = $1', [email])).rows[0];
    if (dup && dup.id !== d.id) fail('Another employee already uses this email.');
    let id = d.id;
    if (id) {
      const cur = (await c.query('select id from employees where id = $1', [id])).rows[0];
      if (!cur) fail('Employee not found.');
      if (id === me.id && (status !== 'Active' || role !== 'HR')) fail('You cannot remove your own HR access.');
      await c.query('update employees set name=$2, email=$3, dept=$4, role=$5, scored=$6, status=$7, join_month=$8 where id=$1',
        [id, name, email, dept, role, scored, status, join]);
    } else {
      id = (await c.query(
        'insert into employees (name, email, dept, role, scored, status, join_month) values ($1,$2,$3,$4,$5,$6,$7) returning id',
        [name, email, dept, role, scored, status, join])).rows[0].id;
    }
    const sc = (await c.query('select id from employees where email = any($1) and id <> $2', [scorerEmails, id])).rows.map((r) => r.id);
    await c.query('delete from employee_scorers where employee_id = $1', [id]);
    if (sc.length) await c.query('insert into employee_scorers (employee_id, scorer_id) select $1, unnest($2::text[])', [id, sc]);
    await audit(c, me, 'saveEmployee', { id, email, status, role });
    return true;
  });
}

export async function saveAccess(me, scorerEmail, depts) {
  requireHR(me);
  const list = [...new Set((depts || []).map(clean).filter(Boolean))];
  return tx(async (c) => {
    const s = (await c.query('select id from employees where email = $1', [clean(scorerEmail).toLowerCase()])).rows[0];
    if (!s) fail('Scorer not found.');
    await c.query('delete from dept_access where scorer_id = $1', [s.id]);
    if (list.length) await c.query('insert into dept_access (scorer_id, dept) select $1, unnest($2::text[])', [s.id, list]);
    await audit(c, me, 'saveAccess', { scorer: scorerEmail, depts: list });
    return true;
  });
}

export async function renameDept(me, from, to) {
  requireHR(me);
  from = clean(from); to = clean(to);
  if (!from) fail('Choose a department.');
  if (!to) fail('New name is required.');
  if (from === to) return 0;
  return tx(async (c) => {
    const n = (await c.query('update employees set dept = $2 where dept = $1', [from, to])).rowCount;
    // scorer access: move to the new name (a scorer who already has both just keeps one row)
    await c.query('insert into dept_access (scorer_id, dept) select scorer_id, $2 from dept_access where dept = $1 on conflict do nothing', [from, to]);
    await c.query('delete from dept_access where dept = $1', [from]);
    await audit(c, me, 'renameDept', { from, to, employees: n });
    return n;
  });
}

export async function deleteDept(me, name) {
  requireHR(me);
  name = clean(name);
  if (!name) fail('Choose a department.');
  return tx(async (c) => {
    const n = Number((await c.query('select count(*) from employees where dept = $1', [name])).rows[0].count);
    if (n > 0) fail('This department still has ' + n + ' employee(s). Move or merge them first.');
    await c.query('delete from dept_access where dept = $1', [name]);
    await audit(c, me, 'deleteDept', { dept: name });
    return true;
  });
}

export async function deleteEmployee(me, email) {
  requireHR(me);
  return tx(async (c) => {
    const e = (await c.query('select id, status from employees where email = $1', [clean(email).toLowerCase()])).rows[0];
    if (!e) fail('Employee not found.');
    if (e.id === me.id) fail('You cannot delete yourself.');
    if (e.status !== 'Left') fail('Only former employees can be deleted. Mark them as Left first.');
    await c.query('delete from employees where id = $1', [e.id]);   // scores etc. are removed by cascade
    await audit(c, me, 'deleteEmployee', { email });
    return true;
  });
}

/* ----------------------------------------------------------- KPI setup ------ */

async function kpiFor(c, kpiId) {
  const k = (await c.query('select * from kpis where id = $1', [kpiId])).rows[0];
  if (!k) fail('KPI not found.');
  return k;
}
const canManage = (me, k) => me.role === 'HR' || k.owner_id === me.id;

export async function kpiAdd(me, name, desc, subs, start) {
  name = clean(name);
  if (!name) fail('KPI name is required.');
  monthOrFail(start, 'Choose the month this KPI starts from.');
  subs = (subs || []).filter((s) => clean(s.name));
  if (!subs.length) fail('Add at least one sub-metric.');
  subs.forEach((s) => weight(s.w));

  return tx(async (c) => {
    let scope = 'ALL', owner = null, team = [];
    if (me.role !== 'HR') {            // a scorer creates a TEAM KPI that applies to their own team
      scope = 'TEAM'; owner = me.id;
      team = (await c.query(`select e.id from employees e join employee_scorers s on s.employee_id = e.id
                              where s.scorer_id = $1 and e.status = 'Active' and e.scored`, [me.id])).rows.map((r) => r.id);
      if (!team.length) fail('Only HR, or a scorer with a team, can add KPIs.');
    }
    const kid = (await c.query('insert into kpis (name, descr, scope, owner_id) values ($1,$2,$3,$4) returning id',
      [name, clean(desc), scope, owner])).rows[0].id;
    for (const s of subs) {
      await c.query('insert into sub_metrics (kpi_id, name, criteria, weight, start_month) values ($1,$2,$3,$4,$5)',
        [kid, clean(s.name), clean(s.criteria), weight(s.w), start]);
    }
    if (team.length) await c.query('insert into kpi_applies (kpi_id, employee_id) select $1, unnest($2::text[])', [kid, team]);
    await audit(c, me, 'kpiAdd', { id: kid, name, scope });
    return true;
  });
}

export async function subAdd(me, kpiId, name, w, criteria, start) {
  name = clean(name);
  if (!name) fail('Sub-metric name is required.');
  const wt = weight(w);
  monthOrFail(start, 'Choose the month this sub-metric starts from.');
  return tx(async (c) => {
    const k = await kpiFor(c, kpiId);
    if (!canManage(me, k)) fail('You cannot change this KPI.');
    const id = (await c.query('insert into sub_metrics (kpi_id, name, criteria, weight, start_month) values ($1,$2,$3,$4,$5) returning id',
      [k.id, name, clean(criteria), wt, start])).rows[0].id;
    await audit(c, me, 'subAdd', { id, kpi: k.id, name });
    return true;
  });
}

export async function subWeight(me, subId, w) {
  const wt = weight(w);
  return tx(async (c) => {
    const s = (await c.query('select s.id, k.owner_id from sub_metrics s join kpis k on k.id = s.kpi_id where s.id = $1', [subId])).rows[0];
    if (!s) fail('Sub-metric not found.');
    if (!(me.role === 'HR' || s.owner_id === me.id)) fail('You cannot change this KPI.');
    await c.query('update sub_metrics set weight = $2 where id = $1', [subId, wt]);
    await audit(c, me, 'subWeight', { id: subId, weight: wt });
    return true;
  });
}

/** kind: 'kpi' | 'sub'.  active=false removes it FROM `fromMonth` onwards (earlier months keep it). */
export async function setActive(me, kind, id, active, fromMonth) {
  if (kind !== 'kpi' && kind !== 'sub') fail('Invalid request.');
  if (!active) monthOrFail(fromMonth, 'Choose the month to remove it from.');
  const end = active ? null : prevMonth(fromMonth);

  return tx(async (c) => {
    if (kind === 'sub') {
      const s = (await c.query('select s.id, k.owner_id from sub_metrics s join kpis k on k.id = s.kpi_id where s.id = $1', [id])).rows[0];
      if (!s) fail('Sub-metric not found.');
      if (!(me.role === 'HR' || s.owner_id === me.id)) fail('You cannot change this KPI.');
      await c.query('update sub_metrics set active = $2, end_month = $3 where id = $1', [id, active, end]);
    } else {
      const k = await kpiFor(c, id);
      if (!canManage(me, k)) fail('You cannot change this KPI.');
      if (active) {
        await c.query('update sub_metrics set active = true, end_month = null where kpi_id = $1 and not active and end_month is not distinct from $2', [id, k.end_month]);
        await c.query('update kpis set active = true, end_month = null where id = $1', [id]);
      } else {
        await c.query('update sub_metrics set active = false, end_month = $2 where kpi_id = $1 and active', [id, end]);
        await c.query('update kpis set active = false, end_month = $2 where id = $1', [id, end]);
      }
    }
    await audit(c, me, 'setActive', { kind, id, active, fromMonth });
    return true;
  });
}

/* -------------------------------------------------------------- scoring ----- */

async function canScore(me, emp) {
  if (emp.id === me.id || !emp.scored) return false;
  if (emp.status !== 'Active' && me.role !== 'HR') return false;
  if (me.role === 'HR') return true;
  const r = await q(`select 1 from (
      select 1 from employee_scorers where employee_id = $1 and scorer_id = $2
      union all
      select 1 from dept_access where scorer_id = $2 and dept = $3 and $3 <> ''
    ) x limit 1`, [emp.id, me.id, emp.dept]);
  return r.length > 0;
}

/** entries: [[subId, value | null], ...]  (null clears a score). Returns the entries that were applied. */
export async function saveScores(me, month, email, entries) {
  monthOrFail(month, 'Invalid month.');
  if (month > curMonth()) fail('You cannot score a future month.');
  if (!Array.isArray(entries) || !entries.length) return [];
  const emp = (await q('select * from employees where email = $1', [clean(email).toLowerCase()]))[0];
  if (!emp) fail('Employee not found.');
  if (!(await canScore(me, emp))) fail('You are not allowed to score this person.');

  return tx(async (c) => {
    const ids = entries.map((e) => String(e[0]));
    const subs = (await c.query(
      `select s.id, s.start_month, s.end_month, k.scope,
              exists (select 1 from kpi_applies a where a.kpi_id = k.id and a.employee_id = $2) as applies
         from sub_metrics s join kpis k on k.id = s.kpi_id where s.id = any($1)`, [ids, emp.id])).rows;
    const sm = new Map(subs.map((s) => [s.id, s]));
    const have = new Set((await c.query('select sub_id from scores where month = $1 and employee_id = $2', [month, emp.id])).rows.map((r) => r.sub_id));
    const out = [];
    for (const [sid0, val] of entries) {
      const sid = String(sid0), s = sm.get(sid);
      if (!s) fail('Unknown sub-metric.');
      if (!(s.scope === 'ALL' || s.applies)) fail('A selected sub-metric does not apply to this person.');
      if (val === null || val === undefined || val === '') {
        await c.query('delete from scores where month = $1 and employee_id = $2 and sub_id = $3', [month, emp.id, sid]);
        out.push([sid, null]); continue;
      }
      const v = Number(val);
      if (!(v >= 1 && v <= 5) || Math.round(v * 2) !== v * 2) fail('Scores must be between 1 and 5, in steps of 0.5.');
      const inWindow = (!s.start_month || s.start_month <= month) && (!s.end_month || month <= s.end_month);
      if (!inWindow && !have.has(sid)) fail('A selected sub-metric is not part of scoring in that month.');
      await c.query(
        `insert into scores (month, employee_id, sub_id, value, scored_by, updated_at) values ($1,$2,$3,$4,$5, now())
         on conflict (month, employee_id, sub_id) do update set value = excluded.value, scored_by = excluded.scored_by, updated_at = now()`,
        [month, emp.id, sid, v, me.email]);
      out.push([sid, v]);
    }
    await audit(c, me, 'saveScores', { month, employee: emp.email, count: out.length });
    return out;
  });
}

/* ------------------------------------------------------ backup / restore ---- */

async function snapshot(run) {
  const out = {};
  for (const t of TABLES) out[t] = (await run(`select coalesce(jsonb_agg(x), '[]'::jsonb) as j from ${t} x`))[0].j;
  return out;
}

export async function exportBackup(me) {
  requireHR(me);
  const tables = await snapshot((s) => q(s));
  return JSON.stringify({ app: 'rankviz-kpi-portal', version: 1, exported: new Date().toISOString(), tables });
}

export async function restoreBackup(me, text) {
  requireHR(me);
  let d; try { d = JSON.parse(text); } catch (_) { fail('This is not a valid backup file.'); }
  if (!d || d.app !== 'rankviz-kpi-portal' || !d.tables) fail('This is not a Rankviz KPI Portal backup file.');
  for (const t of TABLES) if (!Array.isArray(d.tables[t])) fail('The backup is missing "' + t + '". Nothing was changed.');
  const E = d.tables.employees;
  if (!E.length) fail('The backup has no employees. Nothing was changed.');
  if (!E.some((e) => e.email === me.email && e.role === 'HR' && e.status === 'Active'))
    fail('Your own HR account is not in this backup, so you would be locked out. Nothing was changed.');
  const bad = (rows, re) => rows.some((r) => !re.test(String(r.id)));
  if (bad(E, /^E\d+$/) || bad(d.tables.kpis, /^K\d+$/) || bad(d.tables.sub_metrics, /^S\d+$/))
    fail('The backup has unexpected IDs. Nothing was changed.');

  return tx(async (c) => {
    const cur = await snapshot(async (s) => (await c.query(s)).rows);
    await c.query('insert into backups (created_by, reason, data) values ($1, $2, $3)', [me.email, 'before restore', JSON.stringify(cur)]);
    await c.query('delete from backups where id not in (select id from backups order by id desc limit 10)');
    await c.query('truncate ' + TABLES.join(', ') + ' cascade');
    for (const t of TABLES) {
      await c.query(`insert into ${t} select * from jsonb_populate_recordset(null::${t}, $1::jsonb)`, [JSON.stringify(d.tables[t])]);
    }
    await c.query(`select setval('emp_seq', coalesce((select max(substring(id from 2)::int) from employees), 0) + 1, false)`);
    await c.query(`select setval('kpi_seq', coalesce((select max(substring(id from 2)::int) from kpis), 0) + 1, false)`);
    await c.query(`select setval('sub_seq', coalesce((select max(substring(id from 2)::int) from sub_metrics), 0) + 1, false)`);
    await audit(c, me, 'restoreBackup', { exported: d.exported });
    return 'Restored from backup of ' + String(d.exported || '').slice(0, 16).replace('T', ' ') + ': ' +
      TABLES.map((t) => d.tables[t].length + ' ' + t.replace('_', ' ')).join(', ') + '. A safety copy of the previous data was kept.';
  });
}

/** The only functions the browser may call. */
export const FUNCTIONS = {
  getBoot, adminData, saveEmployee, saveAccess, renameDept, deleteDept, deleteEmployee,
  kpiAdd, subAdd, subWeight, setActive, saveScores, exportBackup, restoreBackup,
};
