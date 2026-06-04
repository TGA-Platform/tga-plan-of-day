/**
 * /api/migrate-roster-cache
 * GET /api/migrate-roster-cache
 * Creates the deputy_roster_cache table if it doesn't exist.
 * Call once from a Vercel server (which can reach Supabase pg).
 */

const SUPABASE_URL  = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const PROJECT_REF   = 'tgxpvzlibquqnldgmwho';
const DB_PASSWORD   = '!b2TOWN7ksPto1pZ';

const SQL = `
CREATE TABLE IF NOT EXISTS deputy_roster_cache (
  date        DATE        NOT NULL PRIMARY KEY,
  rosters     JSONB       NOT NULL DEFAULT '[]',
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deputy_roster_cache_fetched_idx
  ON deputy_roster_cache (date, fetched_at DESC);
ALTER TABLE deputy_roster_cache ENABLE ROW LEVEL SECURITY;
DO $body$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='deputy_roster_cache' AND policyname='service role all'
  ) THEN
    CREATE POLICY "service role all" ON deputy_roster_cache
      USING (true) WITH CHECK (true);
  END IF;
END $body$;
`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Check if table already exists
  const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/deputy_roster_cache?limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (checkRes.ok) {
    return res.status(200).json({ status: 'ok', message: 'Table deputy_roster_cache already exists' });
  }

  // Try to create via pg
  try {
    const { Client } = await import('pg');
    const configs = [
      {
        connectionString: `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(DB_PASSWORD)}@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`,
        ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000,
      },
      {
        connectionString: `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(DB_PASSWORD)}@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres`,
        ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000,
      },
      {
        host: `db.${PROJECT_REF}.supabase.co`, port: 5432, database: 'postgres',
        user: 'postgres', password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
      },
    ];

    for (const config of configs) {
      const client = new Client(config);
      try {
        await client.connect();
        await client.query(SQL);
        await client.end();
        return res.status(200).json({ status: 'created', message: 'Table deputy_roster_cache created successfully' });
      } catch (err) {
        try { await client.end(); } catch {}
        console.error('pg attempt failed:', err.message);
      }
    }

    return res.status(503).json({
      status: 'manual_required',
      message: 'Could not create table automatically. Please run the SQL in the Supabase dashboard.',
      sql: SQL,
      dashboard_url: `https://supabase.com/dashboard/project/${PROJECT_REF}/editor`,
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message, sql: SQL });
  }
}
