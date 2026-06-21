import { readFileSync } from 'fs';
const src = readFileSync(new URL('../api/deputy-rosters.js', import.meta.url), 'utf8');
const SK = src.match(/SERVICE_KEY\s*=\s*'([^']+)'/)[1];
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });

// 1. Check what name is in staff_wwcc for Sharmin
const wwccRes = await fetch(`https://tgxpvzlibquqnldgmwho.supabase.co/rest/v1/staff_wwcc?select=full_name,full_name_norm,is_internal_casual,centre&full_name=ilike.*sharmin*&limit=10`, {
  headers: { apikey: SK, Authorization: `Bearer ${SK}` }
});
const wwcc = await wwccRes.json();
console.log('staff_wwcc matches for "sharmin":', JSON.stringify(wwcc, null, 2));

// 2. Check what name Deputy has for today's EP1 rosters
const rosterRes = await fetch(`https://tgxpvzlibquqnldgmwho.supabase.co/rest/v1/deputy_roster_cache?select=rosters&date=eq.${today}&limit=1`, {
  headers: { apikey: SK, Authorization: `Bearer ${SK}` }
});
const rows = await rosterRes.json();
const data = rows[0]?.rosters || [];
const ep1 = data.filter(r => (r._DPMetaData?.OperationalUnitInfo?.CompanyName || '').includes('Edmondson Park 1'));
const sharmin = ep1.filter(r => (r._DPMetaData?.EmployeeInfo?.DisplayName || '').toLowerCase().includes('sharmin'));
console.log('\nDeputy EP1 entries matching "sharmin":');
sharmin.forEach(r => console.log(' ', r._DPMetaData.EmployeeInfo.DisplayName, '→', r._DPMetaData.OperationalUnitInfo.OperationalUnitName));

// 3. Also check Monday.com EP1 IC group for Sharmin via the staffing board WWCC records
const boardRes = await fetch(`https://tgxpvzlibquqnldgmwho.supabase.co/rest/v1/staff_wwcc?select=full_name,full_name_norm,is_internal_casual,centre&centre=eq.Edmondson Park 1&is_internal_casual=eq.true&limit=50`, {
  headers: { apikey: SK, Authorization: `Bearer ${SK}` }
});
const board = await boardRes.json();
console.log('\nAll EP1 ICs in staff_wwcc:');
board.forEach(r => console.log(' ', r.full_name, '|', r.full_name_norm));
