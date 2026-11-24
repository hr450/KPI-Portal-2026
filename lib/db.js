import pg from 'pg';

// Works with Supabase / Neon / any hosted Postgres.
// Hosted databases need SSL; we drop "sslmode=..." from the URL (newer pg versions would otherwise
// insist on full certificate verification and fail on pooler certificates) and enable SSL ourselves.
const raw = process.env.DATABASE_URL || '';
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(raw);
const url = raw.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '');

// One small pool per serverless instance (reused between requests).
const pool = globalThis.__rvPool || (globalThis.__rvPool = new pg.Pool({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 6,
  idleTimeoutMillis: 10000,
}));

/** Run one query, return the rows. */
export async function q(text, params = []) {
  return (await pool.query(text, params)).rows;
}

/** Run fn(client) inside a transaction. Any thrown error rolls everything back. */
export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    try { await c.query('rollback'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    c.release();
  }
}
