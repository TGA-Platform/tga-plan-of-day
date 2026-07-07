/**
 * Sanity-check the Morning Briefing surplus calculation against real data.
 * This replicates the corrected logic from src/pages/MorningBriefingPage.tsx
 * and prints the results so we can verify no huge deficits before deploying.
 */

const BASE_URL = 'https://plan.tga.edu.au';
const DATE = process.argv[2] || new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });

const CENTRES = [
  { id:'oatley',           name:'Oatley',           ownaName:'Oatley',           floatUnitIds:[224], issUnitIds:[230], leaveUnitIds:[134,142,139], nonRatioUnitIds:[130,131,197,165,141,235,324,337], rooms:[{id:'oat_0_1', deputyUnitId:213, ownaRoomName:'0-1 Room', ratio:4},{id:'oat_1_2', deputyUnitId:132, ownaRoomName:'1-2 Room', ratio:4},{id:'oat_2_3', deputyUnitId:133, ownaRoomName:'2-3 Room', ratio:5},{id:'oat_2_5', deputyUnitId:196, ownaRoomName:'2.5-3.5 Room', ratio:5},{id:'oat_3_4', deputyUnitId:159, ownaRoomName:'3-4 Room', ratio:10},{id:'oat_3_5', deputyUnitId:223, ownaRoomName:'3.5-5 Room', ratio:10}] },
  { id:'wollongong',       name:'Wollongong',       ownaName:'Wollongong',       floatUnitIds:[126], issUnitIds:[231], leaveUnitIds:[128,460,127], nonRatioUnitIds:[116,117,124,166,202,312,326,339], rooms:[{id:'wol_0_2', deputyUnitId:118, ownaRoomName:'0-2 Room', ratio:4},{id:'wol_2_3', deputyUnitId:119, ownaRoomName:'2-3 Room', ratio:5},{id:'wol_3_5', deputyUnitId:201, ownaRoomName:'3-5 Room', ratio:10}] },
  { id:'mount-annan',      name:'Mount Annan',      ownaName:'Mount Annan',      floatUnitIds:[222], issUnitIds:[225], leaveUnitIds:[108,456,109], nonRatioUnitIds:[72,73,101,162,234,323,335,79],    rooms:[{id:'ma_0_1', deputyUnitId:74, ownaRoomName:'0-1 Room', ratio:4},{id:'ma_1_2', deputyUnitId:76, ownaRoomName:'1-2 Room', ratio:4},{id:'ma_2_3', deputyUnitId:221, ownaRoomName:'2-3 Room', ratio:5},{id:'ma_3_4', deputyUnitId:78, ownaRoomName:'3-4 Room', ratio:10},{id:'ma_4_5', deputyUnitId:193, ownaRoomName:'4-5 Room', ratio:10}] },
  { id:'spring-farm',      name:'Spring Farm',      ownaName:'Spring Farm',      floatUnitIds:[270], issUnitIds:[278], leaveUnitIds:[272,273,275], nonRatioUnitIds:[263,264,277,271,311,325,338,279], rooms:[{id:'sf_0_1', deputyUnitId:265, ownaRoomName:'0-1', ratio:4},{id:'sf_1_2', deputyUnitId:266, ownaRoomName:'1-2', ratio:4},{id:'sf_2_3', deputyUnitId:267, ownaRoomName:'2-3', ratio:5},{id:'sf_3_5', deputyUnitId:269, ownaRoomName:'3-5', ratio:10}] },
  { id:'denham-court',     name:'Denham Court',     ownaName:'Denham Court',     floatUnitIds:[252], issUnitIds:[260], leaveUnitIds:[254,448,257], nonRatioUnitIds:[245,246,259,253,301,320,333,261], rooms:[{id:'dc_0_1', deputyUnitId:247, ownaRoomName:'0-1', ratio:4},{id:'dc_1_2', deputyUnitId:248, ownaRoomName:'1-2', ratio:4},{id:'dc_2_3a', deputyUnitId:300, ownaRoomName:'2-3 Room 1', ratio:5},{id:'dc_2_3b', deputyUnitId:249, ownaRoomName:'2-3 Room 2', ratio:5},{id:'dc_3_4', deputyUnitId:250, ownaRoomName:'3-4', ratio:10},{id:'dc_4_5', deputyUnitId:251, ownaRoomName:'4-5', ratio:10}] },
  { id:'ed-park-1',        name:'Edmondson Park 1', ownaName:'Ed Park 1',        floatUnitIds:[207], issUnitIds:[228], leaveUnitIds:[102,454,100], nonRatioUnitIds:[89,90,94,163,308,321,340,104],   rooms:[{id:'ep1_0_1', deputyUnitId:91, ownaRoomName:'0-1 Room', ratio:4},{id:'ep1_1_2', deputyUnitId:92, ownaRoomName:'1-2 Room', ratio:4},{id:'ep1_2_3', deputyUnitId:93, ownaRoomName:'2-3 Room', ratio:5},{id:'ep1_3_4', deputyUnitId:103, ownaRoomName:'3-4 Room', ratio:10},{id:'ep1_4_5', deputyUnitId:204, ownaRoomName:'4-5 Room', ratio:10}] },
  { id:'ed-park-2',        name:'Edmondson Park 2', ownaName:'Ed Park 2',        floatUnitIds:[220], issUnitIds:[229], leaveUnitIds:[188,455,194], nonRatioUnitIds:[172,173,190,191,309,322,334,177], rooms:[{id:'ep2_0_1', deputyUnitId:174, ownaRoomName:'0-1 Room', ratio:4},{id:'ep2_1_2', deputyUnitId:175, ownaRoomName:'1-2 Room', ratio:4},{id:'ep2_2_3', deputyUnitId:187, ownaRoomName:'2-3 Room', ratio:5},{id:'ep2_3_4', deputyUnitId:218, ownaRoomName:'3-4 Room', ratio:10},{id:'ep2_4_5', deputyUnitId:219, ownaRoomName:'4-5 Room', ratio:10}] },
  { id:'wilton',           name:'Wilton',           ownaName:'Wilton',           floatUnitIds:[372], issUnitIds:[365], leaveUnitIds:[442,459,376], nonRatioUnitIds:[360,361,362,363,364,374,375,373], rooms:[{id:'wil_0_1', deputyUnitId:366, ownaRoomName:'Explorers 0-1', ratio:4},{id:'wil_1_2a', deputyUnitId:367, ownaRoomName:'Adventurers 1-2', ratio:4},{id:'wil_1_2b', deputyUnitId:428, ownaRoomName:'Wonderers 1-2', ratio:4},{id:'wil_2_3', deputyUnitId:368, ownaRoomName:'Voyagers 2-3', ratio:5},{id:'wil_3_4', deputyUnitId:370, ownaRoomName:'Creators 3-4', ratio:5},{id:'wil_4_5a', deputyUnitId:371, ownaRoomName:'Achievers 4-5', ratio:10},{id:'wil_4_5b', deputyUnitId:429, ownaRoomName:'Achievers 4-5', ratio:10}] },
  { id:'dapto-1',          name:'Dapto 1',          ownaName:'Dapto 1',          floatUnitIds:[205], issUnitIds:[233], leaveUnitIds:[144,452,145], nonRatioUnitIds:[135,136,143,167,306,331,146],    rooms:[{id:'d1_0_1', deputyUnitId:137, ownaRoomName:'0-1 Room CS', ratio:4},{id:'d1_1_2', deputyUnitId:138, ownaRoomName:'1-2 Room CS', ratio:4},{id:'d1_2_3', deputyUnitId:182, ownaRoomName:'2-3 Room CS', ratio:5},{id:'d1_3_4', deputyUnitId:183, ownaRoomName:'3-4 Room CS', ratio:10},{id:'d1_4_5', deputyUnitId:170, ownaRoomName:'4-5 Room CS', ratio:10}] },
  { id:'dapto-2',          name:'Dapto 2',          ownaName:'Dapto 2',          floatUnitIds:[206], issUnitIds:[227], leaveUnitIds:[185,211,160], nonRatioUnitIds:[153,154,217,168,307,319,332,161], rooms:[{id:'d2_0_1', deputyUnitId:155, ownaRoomName:'Explorers', ratio:4},{id:'d2_1_2', deputyUnitId:186, ownaRoomName:'Adventurers', ratio:4},{id:'d2_2_3', deputyUnitId:157, ownaRoomName:'Voyagers', ratio:5},{id:'d2_3_4a', deputyUnitId:203, ownaRoomName:'Pioneers', ratio:10},{id:'d2_3_4b', deputyUnitId:184, ownaRoomName:'Creators', ratio:10},{id:'d2_4_5', deputyUnitId:156, ownaRoomName:'Achievers', ratio:10}] },
  { id:'north-wollongong', name:'North Wollongong', ownaName:'North Wollongong', floatUnitIds:[288], issUnitIds:[296], leaveUnitIds:[290,457,293], nonRatioUnitIds:[281,282,287,289,429,297,313,336], rooms:[{id:'nw_0_1', deputyUnitId:283, ownaRoomName:'Explorers', ratio:4},{id:'nw_1_2', deputyUnitId:284, ownaRoomName:'Adventurers', ratio:4},{id:'nw_2_3a', deputyUnitId:285, ownaRoomName:'Voyagers', ratio:5},{id:'nw_2_3b', deputyUnitId:286, ownaRoomName:'Creators', ratio:5},{id:'nw_3_5', deputyUnitId:327, ownaRoomName:'Achievers', ratio:10}] },
  { id:'shell-cove',       name:'Shell Cove',       ownaName:'Shell Cove',       floatUnitIds:[355], issUnitIds:[348], leaveUnitIds:[440,458,359], nonRatioUnitIds:[343,344,345,346,347,357,358,356], rooms:[{id:'sc_0_1', deputyUnitId:349, ownaRoomName:'Explorers 0-1', ratio:4},{id:'sc_1_2', deputyUnitId:350, ownaRoomName:'1 Pioneers 2-3', ratio:4},{id:'sc_2_3', deputyUnitId:351, ownaRoomName:'2 Voyagers 2-3', ratio:5},{id:'sc_3_4a', deputyUnitId:352, ownaRoomName:'Creators 3-4', ratio:5},{id:'sc_4_5a', deputyUnitId:354, ownaRoomName:'Achievers 4-5', ratio:10},{id:'sc_4_5b', deputyUnitId:430, ownaRoomName:'Achievers 4-5', ratio:10},{id:'sc_4_5c', deputyUnitId:353, ownaRoomName:'Achievers 4-5', ratio:10},{id:'sc_4_5d', deputyUnitId:431, ownaRoomName:'Achievers 4-5', ratio:10}] },
  { id:'bexley',           name:'Bexley',           ownaName:'Bexley',           floatUnitIds:[181], issUnitIds:[226], leaveUnitIds:[446,451,195], nonRatioUnitIds:[111,112,216,164,305,318,330,232], rooms:[{id:'bx_0_2', deputyUnitId:113, ownaRoomName:'0-2 Room', ratio:4},{id:'bx_2_3', deputyUnitId:125, ownaRoomName:'2-3 Room', ratio:5},{id:'bx_3_4a', deputyUnitId:115, ownaRoomName:'3-4 Room 1', ratio:10},{id:'bx_3_4b', deputyUnitId:121, ownaRoomName:'3-4 Room 2', ratio:10},{id:'bx_4_5', deputyUnitId:114, ownaRoomName:'4-5 Room', ratio:10}] },
  { id:'belfield',         name:'Belfield',         ownaName:'Belfield',         floatUnitIds:[389], issUnitIds:[382], leaveUnitIds:[445,450,393], nonRatioUnitIds:[377,378,379,380,381,390,391,392], rooms:[{id:'bf_0_1', deputyUnitId:383, ownaRoomName:'0-1 Explorers', ratio:4},{id:'bf_1_2', deputyUnitId:384, ownaRoomName:'1-2 Adventurers', ratio:4},{id:'bf_2_3a', deputyUnitId:385, ownaRoomName:'2-3 Pioneers', ratio:5},{id:'bf_2_3b', deputyUnitId:386, ownaRoomName:'2-3 Voyagers', ratio:5},{id:'bf_3_4', deputyUnitId:387, ownaRoomName:'3-4 Creators', ratio:10},{id:'bf_4_5a', deputyUnitId:388, ownaRoomName:'4-5 Achievers', ratio:10},{id:'bf_4_5b', deputyUnitId:439, ownaRoomName:'4-5 Inventors', ratio:10}] },
  { id:'bankstown',        name:'Bankstown',        ownaName:'Bankstown',        floatUnitIds:[423], issUnitIds:[416], leaveUnitIds:[444,449,427], nonRatioUnitIds:[411,412,413,414,415,425,424],     rooms:[{id:'bk_0_2', deputyUnitId:417, ownaRoomName:'0-2 Explorers', ratio:4},{id:'bk_2_3', deputyUnitId:420, ownaRoomName:'2-3 Voyagers', ratio:5},{id:'bk_3_5', deputyUnitId:422, ownaRoomName:'3-5 Achievers', ratio:10}] },
  { id:'glendale',         name:'Glendale',         ownaName:'Glendale',         floatUnitIds:[473], issUnitIds:[465], leaveUnitIds:[476,477,475], nonRatioUnitIds:[461,462,463,464,479,478,474],     rooms:[{id:'gl_0_1', deputyUnitId:466, ownaRoomName:'Explorers', ratio:4},{id:'gl_1_2', deputyUnitId:467, ownaRoomName:'Adventurers', ratio:4},{id:'gl_2_3', deputyUnitId:468, ownaRoomName:'Voyagers', ratio:5},{id:'gl_2_3b', deputyUnitId:469, ownaRoomName:'Pioneers', ratio:5},{id:'gl_3_4a', deputyUnitId:470, ownaRoomName:'Creators', ratio:10},{id:'gl_4_5', deputyUnitId:471, ownaRoomName:'Achievers', ratio:10}] },
  { id:'edgeworth',        name:'Edgeworth',        ownaName:'Edgeworth',        floatUnitIds:[406], issUnitIds:[399], leaveUnitIds:[447,453,410], nonRatioUnitIds:[394,395,396,397,398,407,408,409], rooms:[{id:'ew_0_1', deputyUnitId:400, ownaRoomName:'0-1 Explorers', ratio:4},{id:'ew_1_2', deputyUnitId:401, ownaRoomName:'1-2 Adventurers', ratio:4},{id:'ew_2_3a', deputyUnitId:403, ownaRoomName:'2-3 Voyagers', ratio:5},{id:'ew_2_3b', deputyUnitId:435, ownaRoomName:'2-3 Wonderlings', ratio:5},{id:'ew_3_4a', deputyUnitId:404, ownaRoomName:'3-4 Creators', ratio:10},{id:'ew_3_4b', deputyUnitId:436, ownaRoomName:'3-4 Dreamers', ratio:10},{id:'ew_4_5a', deputyUnitId:402, ownaRoomName:'4-5 Achievers', ratio:10},{id:'ew_4_5b', deputyUnitId:405, ownaRoomName:'4-5 Inventors', ratio:10}] },
  { id:'charlestown',      name:'Charlestown',      ownaName:'Charlestown',      floatUnitIds:[496], issUnitIds:[488], leaveUnitIds:[501,502,500], nonRatioUnitIds:[483,484,485,486,487,497,498,499], rooms:[{id:'ch_0_1', deputyUnitId:489, ownaRoomName:'Explorers', ratio:4},{id:'ch_1_2', deputyUnitId:490, ownaRoomName:'Adventurers', ratio:4},{id:'ch_2_3a', deputyUnitId:491, ownaRoomName:'Voyagers', ratio:5},{id:'ch_2_3b', deputyUnitId:492, ownaRoomName:'Pioneers', ratio:5},{id:'ch_3_4', deputyUnitId:493, ownaRoomName:'Creators', ratio:10},{id:'ch_4_5a', deputyUnitId:495, ownaRoomName:'Inventors', ratio:10},{id:'ch_4_5b', deputyUnitId:494, ownaRoomName:'Achievers', ratio:10}] },
];

function calcRequired(children) {
  const sorted = [...children].sort((a, b) => a - b);
  let staff = 0, i = 0;
  while (i < sorted.length) {
    const age = sorted[i];
    let ratio, groupEnd;
    if (age < 24)       { ratio = 4;  groupEnd = 24; }
    else if (age < 36)  { ratio = 5;  groupEnd = 36; }
    else                { ratio = 10; groupEnd = Infinity; }
    let count = 0;
    while (i < sorted.length && sorted[i] < groupEnd) { count++; i++; }
    staff += Math.ceil(count / ratio);
  }
  return staff;
}

function parseAgeMonths(ageStr) {
  if (!ageStr) return 48;
  const m = String(ageStr).match(/(\d+)\s*yr.*?(\d+)?\s*m/i);
  if (m) return parseInt(m[1]) * 12 + (parseInt(m[2]) || 0);
  const yr = String(ageStr).match(/^(\d+)/);
  if (yr) return parseInt(yr[1]) * 12;
  return 48;
}

function toMins(t) {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return null;
}

const CORE_WINDOW_START = 10 * 60;
const CORE_WINDOW_LATEST_START = 13 * 60 + 30;
function isEffectiveFloat(start, end) {
  const s = toMins(start);
  const e = toMins(end);
  if (s === null || e === null) return true;
  return e > CORE_WINDOW_START && s < CORE_WINDOW_LATEST_START;
}

async function postJson(path, body) {
  const res = await fetch(BASE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function getJson(path) {
  const res = await fetch(BASE_URL + path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

(async () => {
  const allUnitIds = [...new Set(CENTRES.flatMap(c => [
    ...c.rooms.map(r => r.deputyUnitId),
    ...c.floatUnitIds,
    ...c.leaveUnitIds,
    ...c.nonRatioUnitIds,
    ...c.issUnitIds,
  ]))];

  const [rosters, attendance, staffAllocations, zCasuals] = await Promise.all([
    postJson('/api/deputy-rosters', { date: DATE, unitIds: allUnitIds }),
    getJson(`/api/attendance?date=${DATE}`),
    getJson(`/api/staff-allocations?centre=all&date=${DATE}`).catch(() => []),
    getJson(`/api/z-casuals?centre=all&date=${DATE}`).catch(() => []),
  ]);

  const movesByCentre = {};
  for (const row of staffAllocations || []) {
    if (!row.centre_id || !row.moves) continue;
    movesByCentre[row.centre_id] = { ...(movesByCentre[row.centre_id] || {}), ...row.moves };
  }
  const zCasualByCentre = {};
  for (const row of zCasuals || []) {
    if (!row.centre || !row.start_time || !row.end_time) continue;
    (zCasualByCentre[row.centre] ??= []).push(row);
  }

  console.log(`\nMorning Briefing surplus sanity check for ${DATE}\n`);
  console.log(['Centre','Attended','Req','Rostered','Absent','Floats','AD','Buffer','Needed','Surplus'].join('\t'));

  for (const centre of CENTRES) {
    const campus = centre.ownaName ?? centre.name;
    const campusAtt = (attendance || []).filter(a => a.campus === campus && a.sign_in);
    const moves = movesByCentre[centre.id] || {};
    const zCas = (zCasualByCentre[centre.name] || []).filter(z => isEffectiveFloat(z.start_time, z.end_time));

    const leaveSet = new Set(centre.leaveUnitIds);
    const floatSet = new Set(centre.floatUnitIds);
    const nonRatioSet = new Set(centre.nonRatioUnitIds);

    const centreRosters = rosters.filter(r => {
      const uid = r.OperationalUnit;
      return centre.rooms.some(rm => rm.deputyUnitId === uid) || floatSet.has(uid) || leaveSet.has(uid) || nonRatioSet.has(uid) || centre.issUnitIds.includes(uid);
    }).map(r => ({
      employeeId: r.Employee,
      unitId: r.OperationalUnit,
      unitName: r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName ?? '',
      startTime: r.StartTime,
      endTime: r.EndTime,
      isSplitShift: r.isSplitShift,
    }));

    function rawUnitType(r) {
      if (leaveSet.has(r.unitId)) return 'leave';
      if (floatSet.has(r.unitId)) return 'float';
      if (nonRatioSet.has(r.unitId)) return 'support';
      if (centre.rooms.some(rm => rm.deputyUnitId === r.unitId)) return 'room';
      return 'other';
    }
    function effectiveDestination(r) {
      const move = moves[r.employeeId];
      if (move) return move;
      const raw = rawUnitType(r);
      if (raw === 'room') {
        const room = centre.rooms.find(rm => rm.deputyUnitId === r.unitId);
        return room?.id ?? 'room';
      }
      return raw;
    }
    const isAdName = n => /assistant director|asst director|ass\. director/i.test(n);

    const roomData = centre.rooms.map(room => {
      const owna = (room.ownaRoomName ?? '').toLowerCase();
      const rk = campusAtt.filter(a => owna && a.room && a.room.toLowerCase().includes(owna));
      const required = calcRequired(rk.map(a => parseAgeMonths(a.age)));
      const staffCount = centreRosters.filter(r => effectiveDestination(r) === room.id).length;
      return { required, staffCount };
    });

    const totalRatioShortage = roomData.reduce((s, r) => s + Math.max(0, r.required - r.staffCount), 0);
    const totalSurplus = roomData.reduce((s, r) => s + Math.max(0, r.staffCount - r.required), 0);
    const netShortageAfterRealloc = Math.max(0, totalRatioShortage - totalSurplus);
    const totalFloorStaff = roomData.reduce((s, r) => s + r.staffCount, 0);
    const bufferRequired = totalFloorStaff > 0 ? totalFloorStaff / 6 : 0;
    const roomNetSurplus = Math.max(0, totalSurplus - totalRatioShortage);

    const floatEntries = centreRosters.filter(r => effectiveDestination(r) === 'float');
    const effectiveFloatEntries = floatEntries.filter(r => {
      if (moves[r.employeeId]) return true;
      if (r.isSplitShift) return false;
      return isEffectiveFloat(r.startTime, r.endTime);
    });
    const floatCount = effectiveFloatEntries.length + zCas.length;

    const adCount = centreRosters.filter(r => effectiveDestination(r) === 'support' && isAdName(r.unitName)).length;
    const adAvail = (campusAtt.length > 0 && campusAtt.length < 100) ? adCount : 0;

    const totalFloatersNeeded = Math.max(0, netShortageAfterRealloc + bufferRequired);
    const effectiveFloatCount = floatCount + roomNetSurplus;
    const casualsNeeded = Math.max(0, totalFloatersNeeded - effectiveFloatCount - adAvail);
    const floatSurplus = casualsNeeded <= 0 ? (effectiveFloatCount + adAvail - totalFloatersNeeded) : 0;
    const surplusVal = casualsNeeded > 0 ? -casualsNeeded : floatSurplus;

    const totalRequired = roomData.reduce((s, r) => s + r.required, 0);
    const rawFloatIds = new Set(centreRosters.filter(r => rawUnitType(r) === 'float').map(r => r.employeeId));
    const rawRoomIds = new Set(centreRosters.filter(r => rawUnitType(r) === 'room').map(r => r.employeeId));
    const totalStaff = new Set([...rawRoomIds, ...rawFloatIds]).size;
    const absentIds = new Set(centreRosters.filter(r => rawUnitType(r) === 'leave').map(r => r.employeeId));
    const roomAndFloatAbsent = [...absentIds].filter(id => rawRoomIds.has(id) || rawFloatIds.has(id)).length;
    const absent = absentIds.size;

    const row = [
      centre.name,
      campusAtt.length,
      totalRequired,
      totalStaff,
      absent,
      effectiveFloatEntries.length + zCas.length,
      adAvail,
      bufferRequired.toFixed(1),
      totalFloatersNeeded.toFixed(1),
      (surplusVal > 0 ? '+' : '') + surplusVal.toFixed(1),
    ];
    console.log(row.join('\t'));
  }
})();
