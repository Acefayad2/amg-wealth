import pg from "pg";
import { SUPABASE_ROOT_CA } from "./supabase-ca.mjs";
import { verifyStorageConnection } from "./storage.mjs";

let pool: pg.Pool | null = null;

const AMG_PORTAL_POOLER = {
  host: "aws-1-us-east-2.pooler.supabase.com",
  port: 6543,
  database: "postgres",
  user: "postgres.jkwhoisuhcbkokwntrfg",
} as const;

// node-postgres parses URL TLS options after the explicit ssl object. Remove
// those options so no URL flag can discard the CA or disable peer/host checks.
export function secureDatabaseUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("ssl") || key.toLowerCase() === "uselibpqcompat") url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    throw Object.assign(new Error("CRM storage URL is invalid."), { status: 503 });
  }
}

export function getPool() {
  const connectionString = Netlify.env.get("AMG_CRM_DATABASE_URL");
  const password = Netlify.env.get("AMG_CRM_DATABASE_PASSWORD");
  if (!connectionString && !password) {
    throw Object.assign(new Error("CRM storage is not configured."), { status: 503 });
  }
  pool ||= new pg.Pool({
    ...(connectionString ? { connectionString: secureDatabaseUrl(connectionString) } : { ...AMG_PORTAL_POOLER, password }),
    max: 1,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
  });
  return pool;
}

export async function verifyCrmStorage() {
  return verifyStorageConnection(
    () => getPool().query("SELECT 1"),
    3500,
  );
}
