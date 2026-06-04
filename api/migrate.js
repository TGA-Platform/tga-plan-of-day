/**
 * /api/migrate
 * GET /api/migrate
 * Creates pod_interval_forecast table if it doesn't exist.
 * Uses direct PostgreSQL connection (works from Vercel's network).
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const PROJECT_REF = 'tgxpvzlibquqnldgmwho';
const DB_PASSWORD = '!b2TOWN7ksPto1pZ';

const SQL = `
CREATE TABLE IF NOT EXISTS pod_interval_forecast (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  centre_id text NOT NULL,
  room_name text NOT NULL,
  day_of_week integer NOT NULL,
  slot_start text NOT NULL,
  avg_count numeric NOT NULL DEFAULT 0,
  sample_weeks integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pod_interval_forecast_unique ON pod_interval_forecast(centre_id, room_name, day_of_week, slot_start);
ALTER TABLE pod_interval_forecast ENABLE ROW LEVEL SECURITY;
DO $body$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='pod_interval_forecast' AND policyname='anon read') THEN
    CREATE POLICY "anon read" ON pod_interval_forecast FOR SELECT USING (true);
  END IF;
END $body$;
`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // First check if table already exists via REST API
  const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/pod_interval_forecast?limit=1`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    }
  });
  
  if (checkRes.ok) {
    return res.status(200).json({ 
      status: 'ok', 
      message: 'Table pod_interval_forecast already exists' 
    });
  }

  // Table doesn't exist — try to create via pg
  try {
    const { Client } = await import('pg');
    
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
      }
    ];

    for (const config of configs) {
      const client = new Client(config);
      try {
        await client.connect();
        await client.query(SQL);
        await client.end();
        return res.status(200).json({ 
          status: 'created', 
          message: 'Table pod_interval_forecast created successfully' 
        });
      } catch (err) {
        try { await client.end(); } catch {}
        console.error('pg connection failed:', err.message);
      }
    }
    
    // If we get here, couldn't create via pg — return SQL for manual execution
    return res.status(503).json({
      status: 'manual_required',
      message: 'Could not create table automatically. Please run the SQL manually.',
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
