/**
 * /api/migrate-staff-wwcc
 * Creates the staff_wwcc table if it doesn't exist.
 */
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const PROJECT_REF  = 'tgxpvzlibquqnldgmwho';
const DB_PASSWORD  = '!b2TOWN7ksPto1pZ';

const SQL = `
CREATE TABLE IF NOT EXISTS staff_wwcc (
  monday_item_id  TEXT        NOT NULL PRIMARY KEY,
  full_name       TEXT        NOT NULL,
  full_name_norm  TEXT        NOT NULL,
  first_name      TEXT,
  last_name       TEXT,
  wwcc_number     TEXT,
  wwcc_expiry     DATE,
  centre          TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_wwcc_name_idx ON staff_wwcc (full_name_norm);
ALTER TABLE staff_wwcc ENABLE ROW LEVEL SECURITY;
`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const check = await fetch(`${SUPABASE_URL}/rest/v1/staff_wwcc?limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (check.ok) return res.status(200).json({ status: 'ok', message: 'Table staff_wwcc already exists' });

  try {
    const { Client } = await import('pg');
    const configs = [
      { connectionString: `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(DB_PASSWORD)}@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 },
      { connectionString: `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(DB_PASSWORD)}@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres`, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 },
      { host: `db.${PROJECT_REF}.supabase.co`, port: 5432, database: 'postgres', user: 'postgres', password: DB_PASSWORD, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 },
    ];
    for (const config of configs) {
      const client = new Client(config);
      try {
        await client.connect();
        await client.query(SQL);
        await client.end();
        return res.status(200).json({ status: 'created', message: 'Table staff_wwcc created successfully' });
      } catch (err) {
        try { await client.end(); } catch {}
      }
    }
    return res.status(503).json({ status: 'manual_required', sql: SQL, dashboard_url: `https://supabase.com/dashboard/project/${PROJECT_REF}/editor` });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message, sql: SQL });
  }
}
