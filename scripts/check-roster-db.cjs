const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';

async function check() {
  const centreId = process.argv[2] || 'wollongong';
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

  console.log('Checking centre:', centreId);

  // Check roster_weeks
  const weeksRes = await fetch(`${SUPABASE_URL}/rest/v1/roster_weeks?centre_id=eq.${centreId}&select=*`, { headers });
  const weeks = await weeksRes.json();
  console.log('roster_weeks:', weeks.length, JSON.stringify(weeks, null, 2));

  // Check roster_shifts
  const shiftsRes = await fetch(`${SUPABASE_URL}/rest/v1/roster_shifts?centre_id=eq.${centreId}&select=*&limit=1000`, { headers });
  const shifts = await shiftsRes.json();
  console.log('roster_shifts:', shifts.length);
  if (shifts.length > 0) {
    const byDate = {};
    for (const s of shifts) {
      byDate[s.date] = (byDate[s.date] || 0) + 1;
    }
    console.log('shifts by date:', byDate);
    console.log('first shift:', JSON.stringify(shifts[0], null, 2));
  }

  // Check RLS policies
  const policiesRes = await fetch(`${SUPABASE_URL}/rest/v1/pg_policies?tablename=in.(roster_weeks,roster_shifts)`, { headers });
  const policies = await policiesRes.json();
  console.log('policies:', JSON.stringify(policies, null, 2));
}

check().catch(e => { console.error(e); process.exit(1); });
