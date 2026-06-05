// Check what Deputy actually calls Sayen and what unit names kitchen/support staff have
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const DEPUTY_TOKEN = 'cf73b1628a5e3498d713879bcf07a974';

// Oatley non-ratio unit IDs (directors, chefs, admin etc.)
const NON_RATIO_UNITS = [130, 131, 197, 165, 141, 235, 324, 337];
const ALL_OATLEY_UNITS = [213, 132, 133, 196, 159, 223, 224, 134, 142, 139, 230, ...NON_RATIO_UNITS];

async function main() {
  // Use cached roster data from Supabase for today/yesterday
  const dates = [new Date(), new Date(Date.now() - 86400000)].map(d =>
    d.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
  );

  for (const date of dates) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/deputy_roster_cache?date=eq.${date}&select=rosters`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const rows = await r.json();
    if (!rows.length || !rows[0].rosters?.length) continue;

    const rosters = rows[0].rosters;
    console.log(`\n=== ${date} — ${rosters.length} roster entries ===`);

    // Find Sayen
    const sayen = rosters.filter(r => {
      const name = (r._DPMetaData?.EmployeeInfo?.DisplayName || '').toLowerCase();
      return name.includes('sayen') || name.includes('farina');
    });
    console.log('\nSayen matches:');
    sayen.forEach(r => console.log(`  "${r._DPMetaData?.EmployeeInfo?.DisplayName}" → unit: "${r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName}" (id:${r.OperationalUnit})`));

    // Find kitchen/support staff by non-ratio unit IDs
    const support = rosters.filter(r => NON_RATIO_UNITS.includes(r.OperationalUnit));
    console.log('\nNon-ratio staff (directors, chefs, admin):');
    const seen = new Set();
    support.forEach(r => {
      const unitName = r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName || '';
      const empName  = r._DPMetaData?.EmployeeInfo?.DisplayName || '';
      const key = `${r.OperationalUnit}:${unitName}`;
      if (!seen.has(key)) { seen.add(key); console.log(`  unit id ${r.OperationalUnit}: "${unitName}"`); }
      if (unitName.toLowerCase().includes('chef') || unitName.toLowerCase().includes('kitchen') || unitName.toLowerCase().includes('cook')) {
        console.log(`    → ${empName}`);
      }
    });

    break; // found a date with data
  }
}
main().catch(console.error);
