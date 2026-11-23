import pg from 'pg';

// One small pool per serverless instance (reused between requests).
const pool = globalThis.__rvPool || (globalThis.__rvPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
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
