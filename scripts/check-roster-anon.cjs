const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDE3MjUsImV4cCI6MjA4OTUxNzcyNX0.v_thHOU7xq0gaFhcnb2A3iBl5H7bAp9IbT9IPMg_jTY';
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';

async function check() {
  const centreId = process.argv[2] || 'wollongong';
  const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

  console.log('Checking with ANON key for centre:', centreId);

  const weeksRes = await fetch(`${SUPABASE_URL}/rest/v1/roster_weeks?centre_id=eq.${centreId}&select=*`, { headers });
  console.log('weeks status:', weeksRes.status);
  const weeksText = await weeksRes.text();
  console.log('weeks body:', weeksText.slice(0, 200));

  const shiftsRes = await fetch(`${SUPABASE_URL}/rest/v1/roster_shifts?centre_id=eq.${centreId}&select=*&limit=10`, { headers });
  console.log('shifts status:', shiftsRes.status);
  const shiftsText = await shiftsRes.text();
  console.log('shifts body:', shiftsText.slice(0, 200));
}

check().catch(e => { console.error(e); process.exit(1); });
