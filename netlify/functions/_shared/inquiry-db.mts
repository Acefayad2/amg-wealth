import pg from 'pg';
import { getPool, secureDatabaseUrl } from './db.mjs';
import { SUPABASE_ROOT_CA } from './supabase-ca.mjs';

let pool: pg.Pool | null = null;

export function getInquiryPool() {
  const connectionString = Netlify.env.get('AMG_INQUIRIES_DATABASE_URL');
  if (!connectionString) return getPool();

  pool ||= new pg.Pool({
    connectionString: secureDatabaseUrl(connectionString),
    max: 2,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
  });
  return pool;
}
