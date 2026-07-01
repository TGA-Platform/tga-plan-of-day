const CENTRES = [
  {
    id: 'spring-farm', name: 'Spring Farm', approvedPlaces: 68,
    ownaName: 'Spring Farm',
    rooms: [
      { id: 'sf_0_1', name: '0-1 Explorers', ageGroup: '0-1 yrs', ratio: 4, deputyUnitId: 265, ownaRoomName: '0-1' },
      { id: 'sf_1_2', name: '1-2 Adventurers', ageGroup: '1-2 yrs', ratio: 4, deputyUnitId: 266, ownaRoomName: '1-2' },
      { id: 'sf_2_3', name: '2-3 Voyagers', ageGroup: '2-3 yrs', ratio: 5, deputyUnitId: 267, ownaRoomName: '2-3' },
      { id: 'sf_3_5', name: '3-5 Achievers', ageGroup: '3-5 yrs', ratio: 10, deputyUnitId: 269, ownaRoomName: '3-5' },
    ],
    floatUnitIds: [270],
    issUnitIds: [278],
    leaveUnitIds: [272, 273, 275],
    nonRatioUnitIds: [263, 264, 277, 271, 311, 325, 338, 279],
  }
];

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
    { label: '0–2 yrs', minMonths: 0, maxMonths: 24, ratio: 4 },
    { label: '2–3 yrs', minMonths: 24, maxMonths: 36, ratio: 5 },
    { label: '3–6 yrs', minMonths: 36, maxMonths: 999, ratio: 10 },
  ];
  const groups = AGE_BRACKETS.map(b => ({
    ...b,
    count: children.filter(c => c.ageMonths >= b.minMonths && c.ageMonths < b.maxMonths && c.ageMonths >= 0).length,
    staffAllocated: 0,
  }));
  let totalStaff = 0;
  let carryover = 0;
  for (const group of groups) {
    if (group.count === 0) continue;
    const coveredByCarryover = Math.min(group.count, carryover);
    const stillNeeded = group.count - coveredByCarryover;
    const newStaff = Math.ceil(stillNeeded / group.ratio);
    group.staffAllocated = newStaff;
    totalStaff += newStaff;
    const unusedFromNew = newStaff * group.ratio - stillNeeded;
    const unusedFromCarryover = carryover - coveredByCarryover;
    carryover = unusedFromNew + unusedFromCarryover;
  }
  return { required: totalStaff };
}

async function main() {
  const centre = CENTRES[0];
  const date = '2026-06-30';

  // Fetch rosters
  const rosterRes = await fetch('https://tga-plan-of-qxyyzg8lh-matthew-maleks-projects.vercel.app/api/deputy-rosters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, unitIds: [265,266,267,269,270,278,272,273,275,263,264,277,271,311,325,338,279] })
  });
  const centreRosters = await rosterRes.json();

  // Fetch children
  const attRes = await fetch('https://tga-plan-of-qxyyzg8lh-matthew-maleks-projects.vercel.app/api/attendance?date=' + date);
  const allAtt = await attRes.json();
  const kids = allAtt.filter(c => c.campus === centre.name);

  // Fetch staff allocations
  const allocRes = await fetch('https://tga-plan-of-qxyyzg8lh-matthew-maleks-projects.vercel.app/api/staff-allocations?centre=' + centre.id + '&date=' + date);
  const allocRows = await allocRes.json();
  const staffMoves = allocRows[0]?.moves || {};

  console.log('Children:', kids.length);
  console.log('Rosters:', centreRosters.length);
  console.log('Staff moves:', JSON.stringify(staffMoves));

  const leaveSet = new Set(centre.leaveUnitIds);
  const floatSet = new Set(centre.floatUnitIds);
  const nonRatioSet = new Set(centre.nonRatioUnitIds);

  function effectiveUnitType(r) {
    const move = staffMoves[String(r.Employee)];
    if (move === 'float') return 'float';
    if (move === 'support') return 'support';
    if (move === 'iss') return 'support';
    if (move && centre.rooms.some(rm => rm.id === move)) return 'room';
    if (leaveSet.has(r.OperationalUnit)) return 'leave';
    if (floatSet.has(r.OperationalUnit)) return 'float';
    if (nonRatioSet.has(r.OperationalUnit)) return 'support';
    if (centre.rooms.some(rm => rm.deputyUnitId === r.OperationalUnit)) return 'room';
    return 'other';
  }

  const roomData = centre.rooms.map(room => {
    const owna = (room.ownaRoomName || room.name).toLowerCase();
    const rk = kids.filter(c => c.room.toLowerCase().includes(owna));
    const { required: roomRequired } = calcRequiredStaff(rk.map(c => ({ ageMonths: parseAgeMonths(c.age) })));
    const roomStaff = centreRosters.filter(r => {
      const dest = staffMoves[String(r.Employee)];
      if (dest) return dest === room.id;
      return r.OperationalUnit === room.deputyUnitId;
    });
    console.log(`Room ${room.name}: ${rk.length} children, required ${roomRequired}, staff ${roomStaff.length}`);
    return { required: roomRequired, staffCount: roomStaff.length };
  });

  const required = roomData.reduce((sum, r) => sum + r.required, 0);
  const staffIds = new Set(centreRosters.filter(r => effectiveUnitType(r) === 'room').map(r => r.Employee));
  const absentIds = new Set(centreRosters.filter(r => effectiveUnitType(r) === 'leave').map(r => r.Employee));
  const floatEntries = centreRosters.filter(r => effectiveUnitType(r) === 'float');
  const floatIds = new Set(floatEntries.map(r => r.Employee));
  const floatCount = floatEntries.length;
  const adCount = centreRosters.filter(r =>
    effectiveUnitType(r) === 'support' &&
    (r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName?.toLowerCase().includes('assistant director') ||
     r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName?.toLowerCase().includes('asst director') ||
     r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName?.toLowerCase().includes('ass. director'))
  ).length;
  const totalStaff = staffIds.size + floatIds.size;
  const absent = absentIds.size;
  const adAvailable = (kids.length > 0 && kids.length < 100) ? adCount : 0;

  const totalRatioShortage = roomData.reduce((s, r) => s + Math.max(0, r.required - r.staffCount), 0);
  const totalSurplus = roomData.reduce((s, r) => s + Math.max(0, r.staffCount - r.required), 0);
  const netShortageAfterRealloc = Math.max(0, totalRatioShortage - totalSurplus);
  const totalFloorStaff = roomData.reduce((s, r) => s + r.staffCount, 0);
  const bufferRequired = totalFloorStaff > 0 ? totalFloorStaff / 6 : 0;
  const roomNetSurplus = Math.max(0, totalSurplus - totalRatioShortage);
  const effectiveFloatCount = floatCount + roomNetSurplus;
  const totalFloatersNeeded = Math.max(0, netShortageAfterRealloc + bufferRequired);
  const casualsNeeded = Math.max(0, totalFloatersNeeded - effectiveFloatCount - adAvailable);

  console.log('---');
  console.log('required:', required);
  console.log('staffIds.size:', staffIds.size);
  console.log('floatIds.size:', floatIds.size);
  console.log('totalStaff:', totalStaff);
  console.log('absent:', absent);
  console.log('adCount:', adCount, 'adAvailable:', adAvailable);
  console.log('totalFloorStaff:', totalFloorStaff);
  console.log('totalRatioShortage:', totalRatioShortage);
  console.log('totalSurplus:', totalSurplus);
  console.log('netShortageAfterRealloc:', netShortageAfterRealloc);
  console.log('bufferRequired:', bufferRequired.toFixed(2));
  console.log('effectiveFloatCount:', effectiveFloatCount);
  console.log('totalFloatersNeeded:', totalFloatersNeeded.toFixed(2));
  console.log('casualsNeeded:', casualsNeeded.toFixed(2));
}

main().catch(e => console.error(e));
