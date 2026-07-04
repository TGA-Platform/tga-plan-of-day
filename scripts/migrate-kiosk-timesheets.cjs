/**
 * Migration: create kiosk and timesheet tables in Supabase.
 * Run locally: node scripts/migrate-kiosk-timesheets.cjs
 */
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function postgrest(sql) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(sql),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PostgREST error ${res.status}: ${txt}`);
  }
  return res;
}

async function rpc(sql) {
  // Use the pg rpc extension if available, otherwise fall back to raw query via pgrest
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ sql }),
  });
  if (res.status === 404) {
    console.log('rpc/exec_sql not available; printing SQL for manual execution:');
    console.log(sql);
    return false;
  }
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`RPC error ${res.status}: ${txt}`);
  }
  return true;
}

const SQL = `
-- Kiosk staff PINs (directors create and reset these)
CREATE TABLE IF NOT EXISTS kiosk_staff_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id text NOT NULL,
  staff_id text NOT NULL,
  staff_name text NOT NULL,
  mobile text NOT NULL,
  pin text NOT NULL,
  role text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (centre_id, staff_id)
);

CREATE INDEX IF NOT EXISTS kiosk_staff_pins_centre_mobile ON kiosk_staff_pins (centre_id, mobile);
CREATE INDEX IF NOT EXISTS kiosk_staff_pins_centre_staff ON kiosk_staff_pins (centre_id, staff_id);

-- Kiosk timeclock events (start/end shifts and lunches)
CREATE TABLE IF NOT EXISTS kiosk_timeclock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id text NOT NULL,
  staff_id text NOT NULL,
  staff_name text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('start_shift','start_lunch','end_lunch','end_shift')),
  event_time timestamptz NOT NULL,
  event_date date NOT NULL,
  roster_shift_id uuid REFERENCES roster_shifts(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'kiosk',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kiosk_timeclock_events_staff_date ON kiosk_timeclock_events (centre_id, staff_id, event_date);
CREATE INDEX IF NOT EXISTS kiosk_timeclock_events_date ON kiosk_timeclock_events (centre_id, event_date);

-- Timesheet approvals (directors review and approve rounded actuals)
CREATE TABLE IF NOT EXISTS timesheet_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id text NOT NULL,
  staff_id text NOT NULL,
  staff_name text NOT NULL,
  date date NOT NULL,
  roster_shift_id uuid REFERENCES roster_shifts(id) ON DELETE SET NULL,
  roster_start_time text,
  roster_end_time text,
  roster_lunch_start text,
  roster_lunch_duration integer,
  actual_start_time text,
  actual_end_time text,
  actual_lunch_start text,
  actual_lunch_end text,
  approved_start_time text,
  approved_end_time text,
  approved_lunch_duration integer,
  approved_hours numeric(5,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','flagged')),
  flags text[] NOT NULL DEFAULT '{}',
  approver_name text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (centre_id, staff_id, date)
);

CREATE INDEX IF NOT EXISTS timesheet_approvals_centre_date ON timesheet_approvals (centre_id, date);
CREATE INDEX IF NOT EXISTS timesheet_approvals_status ON timesheet_approvals (centre_id, status);

-- Enable realtime for kiosk events (optional — for live dashboards)
ALTER PUBLICATION supabase_realtime ADD TABLE kiosk_timeclock_events;
`;

async function main() {
  try {
    const ok = await rpc(SQL);
    if (ok) console.log('Migration applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    console.log('\nRun this SQL manually in the Supabase SQL editor:\n');
    console.log(SQL);
    process.exit(1);
  }
}

main();
