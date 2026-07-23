const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function checkLunchSchedule() {
  console.log('\n=== LUNCH_SCHEDULES TABLE (1 July) ===');
  const url = `${SUPABASE_URL}/rest/v1/lunch_schedules?centre_id=eq.Oatley&date=eq.2026-07-01&employee_id=eq.7377`;
  const r = await fetch(url, { headers: HEADERS });
  const rows = await r.json();
  console.log('Hayley lunch_schedules records:');
  console.log(JSON.stringify(rows, null, 2));

  if (rows.length > 0) {
    console.log(`\n✓ Found ${rows.length} lunch schedule record(s) for Hayley`);
    for (const row of rows) {
      console.log(`  - ${row.lunch_start} to ${row.lunch_end}`);
    }
  } else {
    console.log('\n✗ No lunch_schedules record for Hayley on 1 July');
  }
}

async function checkRatioCheckOverride() {
  console.log('\n=== RATIO_CHECK TABLE (1 July, midday) ===');
  const url = `${SUPABASE_URL}/rest/v1/ratio_check_data?centre_id=eq.Oatley&date=eq.2026-07-01&session=eq.midday`;
  const r = await fetch(url, { headers: HEADERS });
  const rows = await r.json();
  
  if (rows.length > 0) {
    const data = rows[0].data;
    if (data?.staffTimeOverrides?.['7377']) {
      console.log('Hayley staffTimeOverride in ratio_check:');
      console.log(JSON.stringify(data.staffTimeOverrides['7377'], null, 2));
    } else {
      console.log('✗ No staffTimeOverride for Hayley ID 7377 in ratio_check');
    }
  }
}

async function checkFloatSchedules() {
  console.log('\n=== FLOAT_SCHEDULES TABLE (1 July, Hayley) ===');
  const url = `${SUPABASE_URL}/rest/v1/float_schedules?centre_id=eq.Oatley&date=eq.2026-07-01&employee_id=eq.7377`;
  const r = await fetch(url, { headers: HEADERS });
  const rows = await r.json();
  
  if (rows.length > 0) {
    console.log('Hayley float_schedules record:');
    console.log(JSON.stringify(rows[0], null, 2));
    
    // Parse the schedule to see lunch times
    if (rows[0].schedule && Array.isArray(rows[0].schedule)) {
      const schedule = rows[0].schedule;
      console.log('\nSchedule blocks:');
      for (const block of schedule) {
        console.log(`  - ${block.start} to ${block.end} (activity: ${block.activity})`);
      }
    }
  } else {
    console.log('✗ No float_schedules record for Hayley on 1 July');
  }
}

(async () => {
  try {
    await checkLunchSchedule();
    await checkRatioCheckOverride();
    await checkFloatSchedules();
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
