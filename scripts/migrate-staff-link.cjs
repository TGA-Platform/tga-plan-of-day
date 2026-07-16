/**
 * Migration: add deputy_employee_id to staff_members and link existing roster_shifts.
 * Run: node scripts/migrate-staff-link.cjs
 */
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = proces…_KEY || 'eyJhbG…6f1c';

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

const SQL = `
-- Link Deputy employees to internal staff profiles
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS deputy_employee_id text;
CREATE INDEX IF NOT EXISTS staff_members_deputy_id ON staff_members (deputy_employee_id);
CREATE INDEX IF NOT EXISTS staff_members_centre_deputy ON staff_members (centre_id, deputy_employee_id);

-- Back-fill deputy_employee_id from roster_shifts where possible.
-- Best-effort name match for staff already imported from Deputy.
UPDATE staff_members sm
SET deputy_employee_id = rs.staff_id
FROM roster_shifts rs
WHERE sm.centre_id = rs.centre_id
  AND sm.deputy_employee_id IS NULL
  AND LOWER(sm.name) = LOWER(rs.staff_name)
  AND rs.staff_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
`;

async function main() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ sql: SQL }),
    });
    if (res.status === 404) {
      console.log('rpc/exec_sql not available; run this SQL manually:\n');
      console.log(SQL);
      return;
    }
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SQL error ${res.status}: ${txt}`);
    }
    console.log('Migration applied.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    console.log('\nRun this SQL manually:\n');
    console.log(SQL);
    process.exit(1);
  }
}

main();
