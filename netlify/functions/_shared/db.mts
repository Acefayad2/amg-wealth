import pg from "pg";

let pool: pg.Pool | null = null;

export function getPool() {
  const connectionString = Netlify.env.get("AMG_CRM_DATABASE_URL");
  if (!connectionString) {
    throw Object.assign(new Error("CRM storage is not configured."), { status: 503 });
  }
  pool ||= new pg.Pool({ connectionString, max: 5, ssl: { rejectUnauthorized: true } });
  return pool;
}
