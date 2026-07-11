/**
 * /api/migrate-actual-timesheets
 *
 * Creates the deputy_actual_timesheets table and ensures report_daily has the
 * casual columns it needs. Call once after deploying code that writes to these
 * tables.
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const PROJECT_REF = 'tgxpvzlibquqnldgmwho';
const DB_PASSWORD = '!b2TOWN7ksPto1pZ';

const SQL = `
-- Raw actual timesheets fetched from Deputy (clock-in/out + meal breaks).
-- Deleted and re-inserted on every fetch so the table always reflects the
-- latest actuals for a centre/date.
CREATE TABLE IF NOT EXISTS deputy_actual_timesheets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     INTEGER NOT NULL,
  employee_name   TEXT NOT NULL,
  unit_id         INTEGER NOT NULL,
  unit_name       TEXT,
  date            DATE NOT NULL,
  actual_start    TEXT,
  actual_end      TEXT,
  is_in_progress  BOOLEAN NOT NULL DEFAULT false,
  is_real_time    BOOLEAN NOT NULL DEFAULT false,
  rostered_start  TEXT,
  rostered_end    TEXT,
  breaks          JSONB NOT NULL DEFAULT '[]',
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deputy_actual_timesheets_date_unit_idx
  ON deputy_actual_timesheets (date, unit_id);
CREATE INDEX IF NOT EXISTS deputy_actual_timesheets_date_employee_idx
  ON deputy_actual_timesheets (date, employee_id);

-- Snapshot tables for reporting. Created idempotently; existing tables are left alone.
CREATE TABLE IF NOT EXISTS report_daily (
  centre_id               TEXT NOT NULL,
  campus                  TEXT,
  date                    DATE NOT NULL,
  children_attended       INTEGER NOT NULL DEFAULT 0,
  floor_staff             INTEGER NOT NULL DEFAULT 0,
  float_staff             INTEGER NOT NULL DEFAULT 0,
  iss_staff               INTEGER NOT NULL DEFAULT 0,
  off_floor_staff         INTEGER NOT NULL DEFAULT 0,
  required_staff          INTEGER NOT NULL DEFAULT 0,
  room_surplus            NUMERIC NOT NULL DEFAULT 0,
  net_shortage            NUMERIC NOT NULL DEFAULT 0,
  buffer_required         NUMERIC NOT NULL DEFAULT 0,
  total_floaters_needed   NUMERIC NOT NULL DEFAULT 0,
  float_count             INTEGER NOT NULL DEFAULT 0,
  ad_available            INTEGER NOT NULL DEFAULT 0,
  float_surplus           NUMERIC NOT NULL DEFAULT 0,
  staffing_status         TEXT NOT NULL DEFAULT 'unknown',
  internal_casual_hours   NUMERIC NOT NULL DEFAULT 0,
  external_casual_hours   NUMERIC NOT NULL DEFAULT 0,
  internal_casual_count   INTEGER NOT NULL DEFAULT 0,
  external_casual_count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (centre_id, date)
);

CREATE TABLE IF NOT EXISTS report_slot_30 (
  centre_id       TEXT NOT NULL,
  campus          TEXT,
  date            DATE NOT NULL,
  time_slot       TEXT NOT NULL,
  children        INTEGER NOT NULL DEFAULT 0,
  floor_staff     INTEGER NOT NULL DEFAULT 0,
  required_staff  INTEGER NOT NULL DEFAULT 0,
  off_floor_staff INTEGER NOT NULL DEFAULT 0,
  iss_staff       INTEGER NOT NULL DEFAULT 0,
  surplus         NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (centre_id, date, time_slot)
);

ALTER TABLE deputy_actual_timesheets ENABLE ROW LEVEL SECURITY;
DO $body$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='deputy_actual_timesheets' AND policyname='service role all'
  ) THEN
    CREATE POLICY "service role all" ON deputy_actual_timesheets
      USING (true) WITH CHECK (true);
  END IF;
END $body$;

-- Ensure the daily snapshot table has columns for casual breakdown.
-- These are additive; existing tables keep working without them.
DO $cols$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='report_daily' AND column_name='internal_casual_hours'
  ) THEN
    ALTER TABLE report_daily ADD COLUMN internal_casual_hours NUMERIC NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='report_daily' AND column_name='external_casual_hours'
  ) THEN
    ALTER TABLE report_daily ADD COLUMN external_casual_hours NUMERIC NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='report_daily' AND column_name='internal_casual_count'
  ) THEN
    ALTER TABLE report_daily ADD COLUMN internal_casual_count INTEGER NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='report_daily' AND column_name='external_casual_count'
  ) THEN
    ALTER TABLE report_daily ADD COLUMN external_casual_count INTEGER NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='report_daily' AND column_name='net_shortage'
  ) THEN
    ALTER TABLE report_daily ADD COLUMN net_shortage NUMERIC NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='report_daily' AND column_name='total_floaters_needed'
  ) THEN
    ALTER TABLE report_daily ADD COLUMN total_floaters_needed NUMERIC NOT NULL DEFAULT 0;
  END IF;
END $cols$;
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
        return res.status(200).json({ status: 'created', message: 'Migration completed successfully' });
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
