const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

function parseAgeMonths(ageStr) {
  if (!ageStr) return -1;
  const yearMatch = ageStr.match(/(\d+)y/);
  const monthMatch = ageStr.match(/(\d+)m/);
  const years = yearMatch ? parseInt(yearMatch[1]) : 0;
  const months = monthMatch ? parseInt(monthMatch[1]) : 0;
  return years * 12 + months;
}

function calcRequiredStaff(children) {
  const AGE_BRACKETS = [
    { label: '0-2 yrs', minMonths: 0, maxMonths: 24, ratio: 4 },
    { label: '2-3 yrs', minMonths: 24, maxMonths: 36, ratio: 5 },
    { label: '3-6 yrs', minMonths: 36, maxMonths: 999, ratio: 10 },
  ];
  const groups = AGE_BRACKETS.map(b => ({
    ...b,
    count: children.filter(c => c.ageMonths >= b.minMonths && c.ageMonths < b.maxMonths && c.ageMonths >= 0).length,
  }));
  let totalStaff = 0;
  let carryover = 0;
  for (const group of groups) {
    if (group.count === 0) continue;
    const coveredByCarryover = Math.min(group.count, carryover);
    const stillNeeded = group.count - coveredByCarryover;
    const newStaff = Math.ceil(stillNeeded / group.ratio);
    totalStaff += newStaff;
    const unusedFromNew = newStaff * group.ratio - stillNeeded;
    const unusedFromCarryover = carryover - coveredByCarryover;
    carryover = unusedFromNew + unusedFromCarryover;
  }
  return { required: totalStaff };
}

async function main() {
  const [centreName, date] = process.argv.slice(2);
  if (!centreName || !date) {
    console.error('Usage: node inspect-attendance.cjs <campus> <YYYY-MM-DD>');
    process.exit(1);
  }
  const url = `${SUPABASE_URL}/rest/v1/attendance_daily?campus=eq.${encodeURIComponent(centreName)}&date=eq.${date}&limit=1000`;
  const r = await fetch(url, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const rows = await r.json();
  console.log('total attendance rows', rows.length);
  console.log('rooms', [...new Set(rows.map(r => r.room))].sort());

  // Find centre config by ownaName or name
  const CENTRES = [
    { id: 'oatley', name: 'Oatley', rooms: [
      { name: 'Explorers', ownaRoomName: '0-1 Room' },
      { name: 'Adventurers', ownaRoomName: '1-2 Room' },
      { name: 'Pioneers', ownaRoomName: '2-3 Room 1' },
      { name: 'Voyagers', ownaRoomName: '2.5-3.5 Room' },
      { name: 'Creators', ownaRoomName: '3-4 Room' },
      { name: 'Achievers', ownaRoomName: '3.5-5 Room' },
    ]},
  ];
  const centre = CENTRES.find(c => c.name === centreName);
  if (!centre) { console.error('centre not found'); process.exit(1); }

  let totalRequired = 0;
  for (const room of centre.rooms) {
    const owna = (room.ownaRoomName ?? room.name).toLowerCase();
    const rk = rows.filter(c => c.sign_in && c.room?.toLowerCase().includes(owna));
    const { required } = calcRequiredStaff(rk.map(c => ({ ageMonths: parseAgeMonths(c.age) })));
    console.log(room.name, owna, 'count', rk.length, 'required', required);
    totalRequired += required;
  }
  console.log('total required', totalRequired);
}
main().catch(e => { console.error(e); process.exit(1); });
