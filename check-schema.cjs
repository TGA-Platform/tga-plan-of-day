const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function checkLunchScheduleSchema() {
  console.log('\n=== ALL LUNCH_SCHEDULES RECORDS (1 July Oatley) ===');
  const url = `${SUPABASE_URL}/rest/v1/lunch_schedules?centre_id=eq.Oatley&date=eq.2026-07-01`;
  const r = await fetch(url, { headers: HEADERS });
  const rows = await r.json();
  
  console.log(`Found ${rows.length} records`);
  if (rows.length > 0) {
    console.log('\nFirst record (shows all columns):');
    console.log(JSON.stringify(rows[0], null, 2));
    
    // Find Hayley
    const hayley = rows.find(r => r.employee_name?.toLowerCase().includes('hayley'));
    if (hayley) {
      console.log('\n✓ Found Hayley:');
      console.log(JSON.stringify(hayley, null, 2));
    }
  }
}

(async () => {
  try {
    await checkLunchScheduleSchema();
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
