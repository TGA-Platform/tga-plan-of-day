/**
 * /api/migrate-ratio-check
 * GET /api/migrate-ratio-check
 * Creates ratio_check_data table if it doesn't exist.
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const PROJECT_REF  = 'tgxpvzlibquqnldgmwho';
const DB_PASSWORD  = '!b2TOWN7ksPto1pZ';

const SQL = `
CREATE TABLE IF NOT EXISTS ratio_check_data (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  centre_id TEXT NOT NULL,
  date DATE NOT NULL,
  session TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(centre_id, date, session)
);
ALTER TABLE ratio_check_data ENABLE ROW LEVEL SECURITY;
DO $body$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='ratio_check_data' AND policyname='service role all'
  ) THEN
    CREATE POLICY "service role all" ON ratio_check_data USING (true) WITH CHECK (true);
  END IF;
END $body$;
`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Check if table already exists
  const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/ratio_check_data?limit=1`, {
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    }
  });

  if (checkRes.ok) {
    return res.status(200).json({
      status: 'ok',
      message: 'Table ratio_check_data already exists',
    });
  }

  // Table doesn't exist — create via pg
  try {
    const { default: pkg } = await import('pg');
    const { Client } = pkg;

    const configs = [
      {
        connectionString: `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(DB_PASSWORD)}@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
      },
      {
        connectionString: `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(DB_PASSWORD)}@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres`,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
      },
      {
        host: `db.${PROJECT_REF}.supabase.co`,
        port: 5432,
        database: 'postgres',
        user: 'postgres',
        password: DB_PASSWORD,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
      },
    ];

    for (const config of configs) {
      const client = new Client(config);
      try {
        await client.connect();
        await client.query(SQL);
        await client.end();
        return res.status(200).json({
          status: 'created',
          message: 'Table ratio_check_data created successfully',
        });
      } catch (err) {
        try { await client.end(); } catch {}
        console.error('pg connection failed:', err.message);
      }
    }

    return res.status(503).json({
      status: 'manual_required',
      message: 'Could not create table automatically. Please run the SQL manually in the Supabase dashboard.',
      sql: SQL,
      dashboard_url: `https://supabase.com/dashboard/project/${PROJECT_REF}/editor`,
    });
  } catch (err) {
    return res.status(503).json({
      status: 'error',
      message: err.message,
      sql: SQL,
    });
  }
}
