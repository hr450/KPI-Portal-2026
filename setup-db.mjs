// npm run db:setup   (needs DATABASE_URL in the environment)
import fs from 'node:fs';
import pg from 'pg';
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(1); }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
await c.query(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
await c.end();
console.log('Database ready.');
