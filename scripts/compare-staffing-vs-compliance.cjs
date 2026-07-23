/**
 * Compare Plan-of-Day Staffing Analysis vs Compliance Report numbers
 * for Spring Farm and Shell Cove on a given date.
 *
 * Usage: node scripts/compare-staffing-vs-compliance.cjs [YYYY-MM-DD]
 */

const date = process.argv[2] || new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
const HOST = 'https://plan.tga.edu.au';

const CENTRES = [
  {
    id: 'spring-farm', name: 'Spring Farm', approvedPlaces: 68,
    rooms: [
      { id: 'sf_0_1', name: '0-1 Explorers', ratio: 4, deputyUnitId: 265, ownaRoomName: 'Explorers', aliases: ['0-1'] },
      { id: 'sf_1_2', name: '1-2 Adventurers', ratio: 4, deputyUnitId: 266, ownaRoomName: 'Adventurers', aliases: ['1-2'] },
      { id: 'sf_2_3', name: '2-3 Voyagers', ratio: 5, deputyUnitId: 267, ownaRoomName: 'Voyagers', aliases: ['2-3'] },
      { id: 'sf_3_5', name: '3-5 Achievers', ratio: 10, deputyUnitId: 269, ownaRoomName: 'Achievers', aliases: ['3-5'] },
    ],
    floatUnitIds: [270], issUnitIds: [278], leaveUnitIds: [272, 273, 275],
    nonRatioUnitIds: [263, 264, 277, 271, 311, 325, 338, 279],
  },
  {
    id: 'shell-cove', name: 'Shell Cove', approvedPlaces: 142,
    rooms: [
      { id: 'sc_0_1', name: '0-1 Explorers', ratio: 4, deputyUnitId: 349, ownaRoomName: 'Explorers 0-1', aliases: ['0-1'] },
      { id: 'sc_1_2', name: '1-2 Adventurers', ratio: 4, deputyUnitId: 350, ownaRoomName: 'Adventurers 1-2', aliases: ['1-2'] },
      { id: 'sc_2_3a', name: '2-3 Pioneers', ratio: 5, deputyUnitId: 351, ownaRoomName: '1 Pioneers 2-3', aliases: ['pioneers'] },
      { id: 'sc_2_3b', name: '2-3 Voyagers', ratio: 5, deputyUnitId: 352, ownaRoomName: '2 Voyagers 2-3', aliases: ['voyagers'] },
      { id: 'sc_3_4a', name: '3-4 Creators', ratio: 10, deputyUnitId: 353, ownaRoomName: 'Creators 3-4', aliases: ['creators'] },
      { id: 'sc_3_4b', name: '3-4 Dreamers', ratio: 10, deputyUnitId: 430, ownaRoomName: 'Dreamers 3-4', aliases: ['dreamers'] },
      { id: 'sc_4_5a', name: '4-5 Achievers', ratio: 10, deputyUnitId: 354, ownaRoomName: 'Achievers 4-5', aliases: ['achievers'] },
      { id: 'sc_4_5b', name: '4-5 Inventors', ratio: 10, deputyUnitId: 431, ownaRoomName: 'Inventors 4-5', aliases: ['inventors'] },
    ],
    floatUnitIds: [355], issUnitIds: [356], leaveUnitIds: [357, 358, 359],
    nonRatioUnitIds: [360, 361, 362, 363, 364, 365, 366, 367],
  },
];

function parseAgeMonths(ageStr) {
  if (!ageStr) return -1;
  const y = String(ageStr).match(/(\d+)y/);
  const m = String(ageStr).match(/(\d+)m/);
  return (y ? parseInt(y[1]) * 12 : 0) + (m ? parseInt(m[1]) : 0);
}

const AGE_BRACKETS = [
  { minMonths: 0, maxMonths: 24, ratio: 4 },
  { minMonths: 24, maxMonths: 36, ratio: 5 },
  { minMonths: 36, maxMonths: 999, ratio: 10 },
];

function calcRequiredStaff(children) {
  let totalStaff = 0;
  let carryover = 0;
  for (const group of AGE_BRACKETS) {
    const count = children.filter(c => c.ageMonths >= group.minMonths && c.ageMonths < group.maxMonths && c.ageMonths >= 0).length;
    if (count === 0) continue;
    const coveredByCarryover = Math.min(count, carryover);
    const stillNeeded = count - coveredByCarryover;
    const newStaff = Math.ceil(stillNeeded / group.ratio);
    totalStaff += newStaff;
    carryover = (newStaff * group.ratio - stillNeeded) + (carryover - coveredByCarryover);
  }
  return totalStaff;
}

function roomNameMatches(childRoom, room) {
  const child = String(childRoom || '').toLowerCase();
  if (!child) return false;
  const aliases = [room.ownaRoomName, room.name, ...(room.aliases || [])].filter(Boolean).map(a => a.toLowerCase());
  return aliases.some(alias => child.includes(alias) || alias.includes(child));
}

function toMins(t) {
  if (!t) return null;
  const num = typeof t === 'string' ? parseInt(t, 10) : t;
  if (!isNaN(num) && num > 100000) {
    const d = new Date(num * 1000);
    const sydney = new Date(d.toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
    return sydney.getHours() * 60 + sydney.getMinutes();
  }
  const p = String(t).split(':').map(Number);
  if (p.length >= 2 && !isNaN(p[0])) return p[0] * 60 + (p[1] || 0);
  return null;
}

function overlapsCoreWindow(start, end) {
  const s = toMins(start);
  const e = toMins(end);
  if (s === null || e === null) return false;
  return s < 14 * 60 && e > 10 * 60;
}

async function fetchJson(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  return r.json();
}

function compute(centre, kids, rosters, staffMoves) {
  const roomUnitIds = new Set(centre.rooms.map(r => r.deputyUnitId));
  const floatSet = new Set(centre.floatUnitIds);
  const nonRatioSet = new Set(centre.nonRatioUnitIds);

  // --- Compliance-style: no staff moves, actual sign-in kids only ---
  const signedInKids = kids.filter(c => c.sign_in);
  const complianceRoomData = centre.rooms.map(room => {
    const rk = signedInKids.filter(c => roomNameMatches(c.room, room));
    const required = calcRequiredStaff(rk.map(c => ({ ageMonths: c.ageMonths ?? parseAgeMonths(c.age) })));
    const staff = new Set(rosters.filter(r => r.Employee && r.Employee !== 0 && r.OperationalUnit === room.deputyUnitId).map(r => r.Employee)).size;
    return { name: room.name, children: rk.length, required, staffCount: staff, shortage: required - staff };
  });

  // --- Plan-of-Day-style: apply staff moves, use all kids (forecast/expected) ---
  const allKids = kids.map(c => ({ ...c, ageMonths: c.ageMonths ?? parseAgeMonths(c.age) }));
  const podRoomData = centre.rooms.map(room => {
    const rk = allKids.filter(c => roomNameMatches(c.room, room));
    const required = calcRequiredStaff(rk);
    const staying = rosters.filter(r => {
      if (!r.Employee || r.Employee === 0) return false;
      const move = staffMoves[String(r.Employee)];
      if (move) return move === room.id;
      return r.OperationalUnit === room.deputyUnitId;
    });
    const movedIn = rosters.filter(r => {
      if (!r.Employee || r.Employee === 0) return false;
      return staffMoves[String(r.Employee)] === room.id && r.OperationalUnit !== room.deputyUnitId;
    });
    const staff = new Set([...staying, ...movedIn].map(r => r.Employee)).size;
    return { name: room.name, children: rk.length, required, staffCount: staff, shortage: required - staff };
  });

  // Floats
  const floatRosters = rosters.filter(r => r.Employee && r.Employee !== 0 && floatSet.has(r.OperationalUnit) && overlapsCoreWindow(r.StartTime, r.EndTime));
  const podFloatCount = floatRosters.filter(r => {
    const move = staffMoves[String(r.Employee)];
    return !move || move === 'float';
  }).length;
  const complianceFloatCount = floatRosters.length;

  // AD
  const adCount = rosters.filter(r => {
    if (!r.Employee || r.Employee === 0) return false;
    if (!nonRatioSet.has(r.OperationalUnit)) return false;
    const un = String(r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName || '').toLowerCase();
    return un.includes('assistant director') || un.includes('asst director') || un.includes('ass. director');
  }).length;
  const adAvailable = (signedInKids.length > 0 && signedInKids.length < 100) ? adCount : 0;

  function aggregate(rd) {
    const totalFloorStaff = rd.reduce((s, r) => s + r.staffCount, 0);
    const shortage = rd.reduce((s, r) => s + Math.max(0, r.required - r.staffCount), 0);
    const surplus = rd.reduce((s, r) => s + Math.max(0, r.staffCount - r.required), 0);
    const net = Math.max(0, shortage - surplus);
    const buffer = totalFloorStaff > 0 ? totalFloorStaff / 6 : 0;
    const roomNetSurplus = Math.max(0, surplus - shortage);
    const totalNeeded = net + buffer;
    return { rd, totalFloorStaff, shortage, surplus, net, buffer, roomNetSurplus, totalNeeded, adAvailable };
  }

  const compliance = aggregate(complianceRoomData);
  const pod = aggregate(podRoomData);
  pod.floatCount = podFloatCount;
  compliance.floatCount = complianceFloatCount;
  pod.casualsNeeded = Math.max(0, pod.totalNeeded - pod.floatCount - pod.roomNetSurplus - adAvailable);
  compliance.casualsNeeded = Math.max(0, compliance.totalNeeded - compliance.floatCount - compliance.roomNetSurplus - adAvailable);

  return { compliance, pod };
}

async function run() {
  console.log(`Date: ${date}\n`);
  for (const centre of CENTRES) {
    console.log(`\n=== ${centre.name} ===`);
    try {
      const unitIds = [
        ...centre.rooms.map(r => r.deputyUnitId),
        ...centre.floatUnitIds, ...centre.issUnitIds,
        ...centre.leaveUnitIds, ...centre.nonRatioUnitIds,
      ];
      const rosters = await fetchJson(`${HOST}/api/deputy-rosters`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, unitIds }),
      });
      const kids = await fetchJson(`${HOST}/api/attendance?campus=${encodeURIComponent(centre.name)}&date=${date}`);
      const allocRows = await fetchJson(`${HOST}/api/staff-allocations?centre=${centre.id}&date=${date}`);
      const staffMoves = allocRows[0]?.moves || {};

      const result = compute(centre, kids, rosters, staffMoves);

      console.log(`\n  Compliance Report style (raw rosters + signed-in children):`);
      console.log(`    Children signed in: ${kids.filter(c => c.sign_in).length}`);
      for (const r of result.compliance.rd) {
        console.log(`    ${r.name}: ${r.children} kids, req ${r.required}, staff ${r.staffCount}, ${r.shortage > 0 ? 'short ' + r.shortage : r.shortage < 0 ? 'surplus ' + (-r.shortage) : 'exact'}`);
      }
      console.log(`    Floor staff: ${result.compliance.totalFloorStaff}, shortage: ${result.compliance.shortage}, surplus: ${result.compliance.surplus}, net: ${result.compliance.net}`);
      console.log(`    Buffer: ${result.compliance.buffer.toFixed(2)}, floats: ${result.compliance.floatCount}, total needed: ${result.compliance.totalNeeded.toFixed(2)}, casuals needed: ${result.compliance.casualsNeeded.toFixed(2)}`);

      console.log(`\n  Plan-of-Day Staffing Analysis style (with staff moves + all children):`);
      console.log(`    Children total: ${kids.length}`);
      for (const r of result.pod.rd) {
        console.log(`    ${r.name}: ${r.children} kids, req ${r.required}, staff ${r.staffCount}, ${r.shortage > 0 ? 'short ' + r.shortage : r.shortage < 0 ? 'surplus ' + (-r.shortage) : 'exact'}`);
      }
      console.log(`    Floor staff: ${result.pod.totalFloorStaff}, shortage: ${result.pod.shortage}, surplus: ${result.pod.surplus}, net: ${result.pod.net}`);
      console.log(`    Buffer: ${result.pod.buffer.toFixed(2)}, floats: ${result.pod.floatCount}, room net surplus: ${result.pod.roomNetSurplus}, total needed: ${result.pod.totalNeeded.toFixed(2)}, casuals needed: ${result.pod.casualsNeeded.toFixed(2)}`);
      console.log(`    Staff moves applied: ${Object.keys(staffMoves).length}`);

    } catch (e) {
      console.error(`  ERROR: ${e.message}`);
    }
  }
}

run().catch(e => { console.error(e); process.exit(1); });
