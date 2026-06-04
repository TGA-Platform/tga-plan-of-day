const DEPUTY_TOKEN = 'cf73b1628a5e3498d713879bcf07a974';
const HOST = 'https://thegroveacademy.au.deputy.com';
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDE3MjUsImV4cCI6MjA4OTUxNzcyNX0.v_thHOU7xq0gaFhcnb2A3iBl5H7bAp9IbT9IPMg_jTY';

// Ed Park 1 config
const ep1 = {
  id: 'ed-park-1',
  ownaName: 'Ed Park 1',
  rooms: [
    { id: 'ep1_0_1', name: '0-1 Explorers',   deputyUnitId: 91,  ownaRoomName: '0-1' },
    { id: 'ep1_1_2', name: '1-2 Adventurers', deputyUnitId: 92,  ownaRoomName: '1-2' },
    { id: 'ep1_2_3', name: '2-3 Voyagers',    deputyUnitId: 93,  ownaRoomName: '2-3' },
    { id: 'ep1_3_4', name: '3-4 Creators',    deputyUnitId: 103, ownaRoomName: '3-4' },
    { id: 'ep1_4_5', name: '4-5 Achievers',   deputyUnitId: 204, ownaRoomName: '4-5' },
  ],
  floatUnitIds:    [207],
  issUnitIds:      [228],
  leaveUnitIds:    [102, 454, 100],
  nonRatioUnitIds: [89, 90, 94, 163, 308, 321, 340, 104],
};

const date = '2026-05-22';
const campus = 'Ed Park 1';

// Ratios by age group
function calcRequired(children) {
  let under24 = children.filter(c => c.ageMonths < 24).length;
  let m24_36  = children.filter(c => c.ageMonths >= 24 && c.ageMonths < 36).length;
  let m36plus = children.filter(c => c.ageMonths >= 36).length;
  let staff = 0;
  let cap = 0;
  // 0-24 months: 1:4
  let s1 = Math.ceil(under24 / 4); cap = s1 * 4;
  const overflow24 = Math.max(0, cap - under24);
  staff += s1;
  // Use overflow capacity from baby room for 24-36 group
  const covered24_36 = Math.min(overflow24, m24_36);
  const remaining24_36 = m24_36 - covered24_36;
  let s2 = Math.ceil(remaining24_36 / 5); staff += s2; cap = s2 * 5;
  const overflow36 = Math.max(0, cap - remaining24_36);
  // 36+ months: 1:10
  const remaining36 = Math.max(0, m36plus - overflow36);
  let s3 = Math.ceil(remaining36 / 10); staff += s3;
  return staff;
}

function parseAgeMonths(age) {
  if (!age) return 48;
  const m = age.match(/(\d+)y\s*(\d+)m/);
  if (m) return parseInt(m[1]) * 12 + parseInt(m[2]);
  const mo = age.match(/(\d+)m/);
  if (mo) return parseInt(mo[1]);
  return 48;
}

// 1. Fetch attendance
const attRes = await fetch(
  `${SUPABASE_URL}/rest/v1/attendance_daily?campus=eq.${encodeURIComponent(campus)}&date=eq.${date}&select=room,age,sign_in,sign_out&limit=500`,
  { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
);
const att = await attRes.json();
console.log(`Attendance records for ${campus} on ${date}: ${att.length}`);

// 2. Fetch all rosters by date (our fixed method)
const rRes = await fetch(`${HOST}/api/v1/resource/Roster/QUERY`, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + DEPUTY_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({ max: 500, start: 1, search: { s1: { field: 'Date', type: 'eq', data: date } } }),
});
const allRosters = await rRes.json();
const allEp1UnitIds = new Set([
  ...ep1.rooms.map(r => r.deputyUnitId),
  ...ep1.floatUnitIds, ...ep1.issUnitIds,
  ...ep1.leaveUnitIds, ...ep1.nonRatioUnitIds,
]);
const rosters = allRosters.filter(r => allEp1UnitIds.has(r.OperationalUnit));
console.log(`Rosters for Ed Park 1: ${rosters.length}`);

// 3. Per-room breakdown
const roomSet  = new Set(ep1.rooms.map(r => r.deputyUnitId));
const floatSet = new Set(ep1.floatUnitIds);
const issSet   = new Set(ep1.issUnitIds);
const leaveSet = new Set(ep1.leaveUnitIds);

console.log('\n=== ROOM BREAKDOWN ===');
let totalRequired = 0;
let totalRoomStaff = 0;

for (const room of ep1.rooms) {
  const roomRosters = rosters.filter(r => r.OperationalUnit === room.deputyUnitId);
  const owna = room.ownaRoomName.toLowerCase();
  const kids = att.filter(c => c.room?.toLowerCase().includes(owna) && c.sign_in);
  const kidsWithAge = kids.map(c => ({ ageMonths: parseAgeMonths(c.age) }));
  
  // Simple required calc
  const required = kids.length > 0 ? Math.max(1, calcRequired(kidsWithAge)) : 0;
  const staffCount = roomRosters.length;
  const shortage = required - staffCount;
  
  totalRequired += required;
  totalRoomStaff += staffCount;
  
  console.log(`  ${room.name}: ${kids.length} kids → need ${required} staff, have ${staffCount} → ${shortage > 0 ? `SHORT ${shortage}` : shortage < 0 ? `SURPLUS ${Math.abs(shortage)}` : 'EXACT'}`);
  roomRosters.forEach(r => {
    const name = r._DPMetaData?.EmployeeInfo?.DisplayName || 'Staff #' + r.Employee;
    console.log(`    - ${name}`);
  });
}

const floatRosters = rosters.filter(r => floatSet.has(r.OperationalUnit));
const issRosters   = rosters.filter(r => issSet.has(r.OperationalUnit));
const leaveRosters = rosters.filter(r => leaveSet.has(r.OperationalUnit));

console.log(`\nFloat Pool: ${floatRosters.length} staff`);
floatRosters.forEach(r => console.log(`  - ${r._DPMetaData?.EmployeeInfo?.DisplayName}`));
console.log(`ISS: ${issRosters.length} staff`);
issRosters.forEach(r => console.log(`  - ${r._DPMetaData?.EmployeeInfo?.DisplayName}`));
console.log(`On Leave: ${leaveRosters.length}`);
leaveRosters.forEach(r => console.log(`  - ${r._DPMetaData?.EmployeeInfo?.DisplayName} (${r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName})`));

console.log('\n=== SUMMARY ===');
console.log(`Total children attended: ${att.filter(c => c.sign_in).length}`);
console.log(`Total required staff:    ${totalRequired}`);
console.log(`Total room staff:        ${totalRoomStaff}`);
console.log(`Float available:         ${floatRosters.length}`);
console.log(`ISS available:           ${issRosters.length}`);
console.log(`Total available:         ${totalRoomStaff + floatRosters.length}`);
console.log(`Net (room+float vs req): ${(totalRoomStaff + floatRosters.length) - totalRequired > 0 ? '+' : ''}${(totalRoomStaff + floatRosters.length) - totalRequired}`);
console.log(`\nDashboard says: -2 deficit`);
console.log(`Ratio dashboard says: +3 surplus`);
console.log(`\nDifference likely due to:`);
console.log(`  - Dashboard counting absent staff (leave) differently`);
console.log(`  - Dashboard vs ratio dashboard using different child counts (attended vs present)`);
console.log(`  - ISS being counted in one but not the other`);

// Check if absent staff are being subtracted
const absent = leaveRosters.length;
console.log(`\nIf absent staff (${absent}) are subtracted from rostered:`);
console.log(`  Room staff - absent = ${totalRoomStaff} - ${absent} = ${totalRoomStaff - absent}`);
console.log(`  Available = ${totalRoomStaff - absent + floatRosters.length}`);
console.log(`  Net vs required = ${(totalRoomStaff - absent + floatRosters.length) - totalRequired > 0 ? '+' : ''}${(totalRoomStaff - absent + floatRosters.length) - totalRequired}`);
