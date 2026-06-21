import { readFileSync } from 'fs';
const src = readFileSync(new URL('../api/deputy-rosters.js', import.meta.url), 'utf8');
const SK = src.match(/SERVICE_KEY\s*=\s*'([^']+)'/)[1];
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });

const r = await fetch(`https://tgxpvzlibquqnldgmwho.supabase.co/rest/v1/deputy_roster_cache?select=rosters&date=eq.${today}&limit=1`, {
  headers: { apikey: SK, Authorization: `Bearer ${SK}` }
});
const rows = await r.json();
const data = rows[0]?.rosters || [];

// Denham Court config
const leaveUnitIds   = [254, 448, 257];
const floatUnitIds   = [252];
const roomUnitIds    = [247, 248, 300, 249, 250, 251];
const nonRatioUnitIds = [245, 246, 259, 253, 301, 320, 333, 261];

const dc = data.filter(r => (r._DPMetaData?.OperationalUnitInfo?.CompanyName || '').includes('Denham Court'));
console.log(`Denham Court entries: ${dc.length}`);

const leaveIds = new Set();
const staffIds = new Set();
const floatIds = new Set();

for (const r of dc) {
  const uid = r.OperationalUnit;
  const eid = r.Employee;
  const name = r._DPMetaData?.EmployeeInfo?.DisplayName || '';
  const uname = r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName || '';
  if (leaveUnitIds.includes(uid)) { leaveIds.add(eid); console.log(`  LEAVE: ${name} [${uname}]`); }
  else if (floatUnitIds.includes(uid)) { floatIds.add(eid); }
  else if (roomUnitIds.includes(uid)) { staffIds.add(eid); }
}

const roomAndFloatAbsent = [...leaveIds].filter(id => staffIds.has(id) || floatIds.has(id));
const roomAbsent = [...leaveIds].filter(id => staffIds.has(id));
console.log(`\nLeave IDs: ${leaveIds.size}, Room staff IDs: ${staffIds.size}, Float IDs: ${floatIds.size}`);
console.log(`Room+float absent (in both leave AND room/float): ${roomAndFloatAbsent.length}`);
console.log(`Room only absent: ${roomAbsent.length}`);

// Show all entries to spot the pattern
console.log('\nAll DC entries:');
for (const r of dc) {
  const uid = r.OperationalUnit;
  const name = r._DPMetaData?.EmployeeInfo?.DisplayName || '';
  const uname = r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName || '';
  const type = leaveUnitIds.includes(uid) ? 'LEAVE' : floatUnitIds.includes(uid) ? 'FLOAT' : roomUnitIds.includes(uid) ? 'ROOM' : nonRatioUnitIds.includes(uid) ? 'NONRATIO' : `OTHER(${uid})`;
  console.log(`  [${type}] ${name} → ${uname}`);
}
