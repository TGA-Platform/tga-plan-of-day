const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function checkRatioCheckData() {
  console.log('\n=== RATIO_CHECK_DATA TABLE (1 July, midday) ===');
  const url = `${SUPABASE_URL}/rest/v1/ratio_check_data?centre_id=eq.Oatley&date=eq.2026-07-01&session=eq.midday`;
  const r = await fetch(url, { headers: HEADERS });
  const rows = await r.json();
  
  if (rows.length > 0) {
    const data = rows[0].data;
    console.log('Full ratio_check_data record:');
    console.log(JSON.stringify(rows[0], null, 2));
    
    if (data?.staffTimeOverrides?.['7377']) {
      console.log('\n✓ Hayley staffTimeOverride in ratio_check:');
      console.log(JSON.stringify(data.staffTimeOverrides['7377'], null, 2));
    } else {
      console.log('\n✗ No staffTimeOverride for Hayley ID 7377');
      console.log('Available staff overrides:', Object.keys(data?.staffTimeOverrides ?? {}).slice(0, 10));
    }
  } else {
    console.log('No ratio_check_data records found');
  }
}

async function checkLunchSchedules() {
  console.log('\n=== LUNCH_SCHEDULES TABLE (all for 1 July) ===');
  const url = `${SUPABASE_URL}/rest/v1/lunch_schedules?centre_id=eq.Oatley&date=eq.2026-07-01&limit=5`;
  const r = await fetch(url, { headers: HEADERS });
  const rows = await r.json();
  
  console.log('Sample lunch_schedules records:');
  console.log(JSON.stringify(rows.slice(0, 2), null, 2));
  
  // Find Hayley if she exists
  const hayley = rows.find(r => r.employee_name?.includes('Hayley') || r.name?.includes('Hayley'));
  if (hayley) {
    console.log('\n✓ Found Hayley in lunch_schedules:');
    console.log(JSON.stringify(hayley, null, 2));
  }
}

async function checkFloatSchedules() {
  console.log('\n=== FLOAT_SCHEDULES TABLE (1 July, first 3 records) ===');
  const url = `${SUPABASE_URL}/rest/v1/float_schedules?centre_id=eq.Oatley&date=eq.2026-07-01&limit=3`;
  const r = await fetch(url, { headers: HEADERS });
  const rows = await r.json();
  
  console.log('Sample float_schedules records:');
  console.log(JSON.stringify(rows, null, 2));
}

(async () => {
  try {
    await checkRatioCheckData();
    await checkLunchSchedules();
    await checkFloatSchedules();
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
