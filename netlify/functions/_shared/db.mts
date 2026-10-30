import pg from "pg";
import { verifyStorageConnection } from "./storage.mjs";

let pool: pg.Pool | null = null;

export function getPool() {
  const connectionString = Netlify.env.get("AMG_CRM_DATABASE_URL");
  if (!connectionString) {
    throw Object.assign(new Error("CRM storage is not configured."), { status: 503 });
  }
  pool ||= new pg.Pool({
    connectionString,
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
