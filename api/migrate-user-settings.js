/**
 * /api/migrate-user-settings
 * Creates user_settings table if it doesn't exist.
 */
const SUPABASE_URL  = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const PROJECT_REF   = 'tgxpvzlibquqnldgmwho';
const DB_PASSWORD   = '!b2TOWN7ksPto1pZ';

const SQL = `
CREATE TABLE IF NOT EXISTS user_settings (
  email TEXT PRIMARY KEY,
  allowed_centre_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
DO $body$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='user_settings' AND policyname='service_role all'
  ) THEN
    CREATE POLICY "service_role all" ON user_settings FOR ALL USING (true);
  END IF;
END $body$;
`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Check if table exists
  const check = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (check.ok) return res.status(200).json({ status: 'exists' });

  try {
    const { default: pkg } = await import('pg');
    const { Client } = pkg;
    const configs = [
      { connectionString: `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(DB_PASSWORD)}@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`, ssl: { rejectUnauthorized: false } },
      { host: `db.${PROJECT_REF}.supabase.co`, port: 5432, database: 'postgres', user: 'postgres', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } },
    ];
    for (const cfg of configs) {
      const client = new Client({ ...cfg, connectionTimeoutMillis: 10000 });
      try {
        await client.connect();
        await client.query(SQL);
        await client.end();
        return res.status(200).json({ status: 'created' });
      } catch (e) {
        try { await client.end(); } catch {}
      }
    }
    return res.status(503).json({ status: 'manual_required', sql: SQL });
  } catch (e) {
    return res.status(500).json({ error: e.message, sql: SQL });
  }
}
