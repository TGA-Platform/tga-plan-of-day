const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = 'eyJhbG…6f1c';

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function checkStaffingAnalysis() {
  console.log('\n=== STAFFING_ANALYSIS TABLE ===');
  const url = `${SUPABASE_URL}/rest/v1/staffing_analysis?select=*&limit=10&order=date.desc`;
  const r = await fetch(url, { headers: HEADERS });
  const rows = await r.json();
  
  console.log(`Found ${rows.length} records`);
  if (rows.length > 0) {
    console.log('\nLatest 3 records:');
    for (const row of rows.slice(0, 3)) {
      console.log(`\nDate: ${row.date}, Centre: ${row.campus}`);
      console.log(`  present_surplus_val: ${row.present_surplus_val}`);
      console.log(`  present_casuals_needed: ${row.present_casuals_needed}`);
      console.log(`  present_float_surplus: ${row.present_float_surplus}`);
      console.log(`  present_total_floaters_needed: ${row.present_total_floaters_needed}`);
      console.log(`  present_effective_float_count: ${row.present_effective_float_count}`);
      console.log(`  present_room_net_surplus: ${row.present_room_net_surplus}`);
      console.log(`  present_children_count: ${row.present_children_count}`);
      console.log(`  present_required_staff: ${row.present_required_staff}`);
      console.log(`  present_computed_at: ${row.present_computed_at}`);
      console.log(`  allday_locked_at: ${row.allday_locked_at}`);
    }
  } else {
    console.log('\n✗ No records found in staffing_analysis table');
  }
}

(async () => {
  try {
    await checkStaffingAnalysis();
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
