import pg from "pg";
import { verifyStorageConnection } from "./storage.mjs";

let pool: pg.Pool | null = null;

const AMG_PORTAL_POOLER = {
  host: "aws-1-us-east-2.pooler.supabase.com",
  port: 6543,
  database: "postgres",
  user: "postgres.jkwhoisuhcbkokwntrfg",
} as const;

export function getPool() {
  const connectionString = Netlify.env.get("AMG_CRM_DATABASE_URL");
  const password = Netlify.env.get("AMG_CRM_DATABASE_PASSWORD");
  if (!connectionString && !password) {
    throw Object.assign(new Error("CRM storage is not configured."), { status: 503 });
  }
  pool ||= new pg.Pool({
    ...(connectionString ? { connectionString } : { ...AMG_PORTAL_POOLER, password }),
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: true },
  });
  return pool;
}

export async function verifyCrmStorage() {
  return verifyStorageConnection(
    () => getPool().query("SELECT 1"),
    3500,
  );
}
