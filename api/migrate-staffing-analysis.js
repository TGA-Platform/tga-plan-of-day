/**
 * /api/migrate-staffing-analysis
 *
 * Creates the staffing_analysis table used as the single source of truth for
 * the Plan of Day Float Pool surplus/deficit figure. Call once after deploying
 * code that reads/writes this table.
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const PROJECT_REF = 'tgxpvzlibquqnldgmwho';
const DB_PASSWORD = '!b2TOWN7ksPto1pZ';

const SQL = `
-- Single source of truth for the Plan of Day Staffing Analysis / Float Pool
-- surplus-deficit figure. Written by the Ratio Dashboard and read by the
-- forecast email and morning briefing.
CREATE TABLE IF NOT EXISTS staffing_analysis (
  centre_id                 TEXT NOT NULL,
  campus                    TEXT,
  date                      DATE NOT NULL,
  surplus_val               NUMERIC NOT NULL DEFAULT 0,
  casuals_needed            NUMERIC NOT NULL DEFAULT 0,
  float_surplus             NUMERIC NOT NULL DEFAULT 0,
  total_floaters_needed     NUMERIC NOT NULL DEFAULT 0,
  effective_float_count     NUMERIC NOT NULL DEFAULT 0,
  room_net_surplus          NUMERIC NOT NULL DEFAULT 0,
  ad_available              INTEGER NOT NULL DEFAULT 0,
  total_ratio_shortage      NUMERIC NOT NULL DEFAULT 0,
  total_surplus             NUMERIC NOT NULL DEFAULT 0,
  net_shortage_after_realloc NUMERIC NOT NULL DEFAULT 0,
  buffer_required           NUMERIC NOT NULL DEFAULT 0,
  floor_staff               INTEGER NOT NULL DEFAULT 0,
  required_staff            INTEGER NOT NULL DEFAULT 0,
  float_count               INTEGER NOT NULL DEFAULT 0,
  children_count            INTEGER NOT NULL DEFAULT 0,
  computed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  data                      JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (centre_id, date)
);

CREATE INDEX IF NOT EXISTS staffing_analysis_date_idx
  ON staffing_analysis (date);

ALTER TABLE staffing_analysis ENABLE ROW LEVEL SECURITY;
DO $body$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='staffing_analysis' AND policyname='service role all'
  ) THEN
    CREATE POLICY "service role all" ON staffing_analysis
      USING (true) WITH CHECK (true);
  END IF;
END $body$;
`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

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
        return res.status(200).json({ status: 'created', message: 'staffing_analysis migration completed' });
      } catch (err) {
        try { await client.end(); } catch {}
        console.error('pg attempt failed:', err.message);
      }
    }

    return res.status(503).json({
      status: 'manual_required',
      message: 'Could not run migration automatically. Please run the SQL in the Supabase dashboard.',
      sql: SQL,
      dashboard_url: `https://supabase.com/dashboard/project/${PROJECT_REF}/editor`,
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message, sql: SQL });
  }
}
